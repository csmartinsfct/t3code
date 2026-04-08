import type {
  CommandId,
  OrchestrationCommand,
  OrchestrationRunId,
  Ticket,
  ThreadId,
} from "@t3tools/contracts";
import { EventId, MessageId, OrchestrationRunError } from "@t3tools/contracts";
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Scope, Stream } from "effect";
import { formatTimelineLog } from "@t3tools/shared/timeline";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ServerRuntimeStartup } from "../../serverRuntimeStartup.ts";
import { TicketingService } from "../../ticketing/Services/Ticketing.ts";
import { OrchestrationRunService } from "../Services/OrchestrationRuns.ts";
import {
  OrchestrationRunRunner,
  type OrchestrationRunRunnerShape,
} from "../Services/OrchestrationRunRunner.ts";

const SCOPE = "server.orchestration-runner";
const TURN_TIMEOUT = Duration.minutes(30);

type TurnOutcome =
  | { readonly result: "completed" }
  | { readonly result: "failed"; readonly error: string | null };

const runnerCommandId = (tag: string): CommandId =>
  `runner:${tag}:${crypto.randomUUID()}` as CommandId;

const buildWorkPrompt = (ticket: Ticket): string => {
  const worktreePart = ticket.worktree ?? "default";
  return `Work on ticket ${ticket.title} - ${ticket.identifier}. Worktree: ${worktreePart}. Pull the ticket details and any other context you need yourself. If you get blocked, update the ticket status to blocked and stop. Try to complete the acceptance criteria mentioned in the ticket, if defined. Otherwise try to comply with the specifications in the ticket.`;
};

const buildOrchestrationTitle = (tickets: ReadonlyArray<Ticket>): string => {
  const parts = tickets.map((t) => `${t.identifier}: ${t.title}`);
  const title = `Orchestrate: ${parts.join(", ")}`;
  return title.length > 120 ? `${title.slice(0, 117)}...` : title;
};

const makeOrchestrationRunRunner = Effect.gen(function* () {
  const runService = yield* OrchestrationRunService;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const ticketing = yield* TicketingService;
  const startup = yield* ServerRuntimeStartup;

  // Create a scope for background fibers that lives as long as the service.
  const runnerScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(runnerScope, Exit.void));

  const dispatchCommand = (
    command: import("@t3tools/contracts").OrchestrationCommand,
    message: string,
  ) =>
    startup.enqueueCommand(orchestrationEngine.dispatch(command)).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationRunError({
            message,
            cause,
          }),
      ),
    );

  const postActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind: string;
    readonly summary: string;
    readonly tone?: "info" | "error";
  }) => {
    const now = new Date().toISOString();
    return dispatchCommand(
      {
        type: "thread.activity.append",
        commandId: runnerCommandId(input.kind),
        threadId: input.threadId,
        activity: {
          id: EventId.makeUnsafe(crypto.randomUUID()),
          tone: input.tone ?? "info",
          kind: input.kind,
          summary: input.summary,
          payload: {},
          turnId: null,
          createdAt: now,
        },
        createdAt: now,
      },
      `Failed to post activity: ${input.kind}`,
    );
  };

  /**
   * Wait for a turn to complete on a working thread by observing the domain
   * event stream. The subscription is established before the turn is
   * dispatched (by the caller) to avoid missing fast completions.
   *
   * Session lifecycle for a fresh thread is:
   *   session.started → "ready"  (no active turn yet)
   *   turn.started    → "running"
   *   turn.completed  → "ready" | "error"
   *
   * We must wait for the session to enter "running" first, then wait for it
   * to leave "running" — otherwise the initial "ready" from session start
   * would be mistaken for a completed turn.
   */
  const waitForTurnCompletion = (workingThreadId: ThreadId) =>
    Effect.gen(function* () {
      const turnDone = yield* Deferred.make<TurnOutcome>();

      // Track whether the session has entered "running" at least once.
      let sawRunning = false;

      const fiber = yield* Stream.runForEach(
        orchestrationEngine.streamDomainEvents.pipe(
          Stream.filter(
            (event) =>
              event.type === "thread.session-set" &&
              (event.payload as { threadId?: string }).threadId === workingThreadId,
          ),
          Stream.map((event) => {
            const session = (
              event.payload as { session: { status: string; lastError?: string | null } }
            ).session;
            return session;
          }),
        ),
        (session) =>
          Effect.gen(function* () {
            yield* Effect.logInfo(
              formatTimelineLog(SCOPE, "runner.turn-watcher.session-event", {
                workingThreadId,
                sessionStatus: session.status,
                sawRunning,
              }),
            );
            if (session.status === "running") {
              sawRunning = true;
              yield* Effect.logInfo(
                formatTimelineLog(SCOPE, "runner.turn-watcher.saw-running", { workingThreadId }),
              );
              return;
            }
            // Ignore non-terminal statuses, and ignore terminal statuses that
            // arrive before the turn has started (e.g. initial "ready" from
            // session.started on a fresh thread).
            if (!sawRunning) {
              return;
            }
            if (session.status === "error" || session.status === "stopped") {
              const outcome: TurnOutcome = {
                result: "failed" as const,
                error: session.lastError ?? null,
              };
              yield* Effect.logInfo(
                formatTimelineLog(SCOPE, "runner.turn-watcher.resolved", {
                  workingThreadId,
                  result: outcome.result,
                  error: outcome.error,
                }),
              );
              yield* Deferred.succeed(turnDone, outcome);
              return;
            }
            if (session.status === "ready") {
              yield* Effect.logInfo(
                formatTimelineLog(SCOPE, "runner.turn-watcher.resolved", {
                  workingThreadId,
                  result: "completed",
                }),
              );
              yield* Deferred.succeed(turnDone, { result: "completed" as const });
              return;
            }
          }),
      ).pipe(Effect.forkScoped);

      // Wait for completion with a timeout
      const maybeOutcome = yield* Deferred.await(turnDone).pipe(Effect.timeoutOption(TURN_TIMEOUT));
      const outcome: TurnOutcome = Option.match(maybeOutcome, {
        onNone: () => {
          return { result: "failed" as const, error: "Turn timed out after 30 minutes" };
        },
        onSome: (value) => value,
      });
      if (Option.isNone(maybeOutcome)) {
        yield* Effect.logWarning(
          formatTimelineLog(SCOPE, "runner.turn-watcher.timeout", { workingThreadId }),
        );
      }

      // Clean up the subscription fiber
      yield* Fiber.interrupt(fiber);

      return outcome;
    });

  /**
   * Dispatch the initial work turn for a ticket on its working thread.
   */
  const dispatchWorkTurn = (workingThreadId: ThreadId, ticket: Ticket) => {
    const now = new Date().toISOString();
    const messageId = MessageId.makeUnsafe(crypto.randomUUID());
    // The thread.turn.start command has fields with Schema defaults (runtimeMode,
    // interactionMode) that make structural typing awkward. Cast via unknown.
    const command = {
      type: "thread.turn.start",
      commandId: runnerCommandId("orchestration-turn"),
      threadId: workingThreadId,
      message: {
        messageId,
        role: "user",
        text: buildWorkPrompt(ticket),
        attachments: [],
      },
      createdAt: now,
    } as unknown as OrchestrationCommand;
    return dispatchCommand(command, `Failed to dispatch work turn for ticket ${ticket.identifier}`);
  };

  const pauseRunWithReason = (
    runId: OrchestrationRunId,
    orchestrationThreadId: ThreadId,
    reason: string,
  ) =>
    Effect.gen(function* () {
      yield* Effect.logWarning(
        formatTimelineLog(SCOPE, "runner.pause-with-reason", { runId, reason }),
      );
      yield* runService.pause({ runId }).pipe(Effect.catch(() => Effect.void));
      yield* postActivity({
        threadId: orchestrationThreadId,
        kind: "orchestration.run.paused",
        summary: reason,
        tone: "error",
      }).pipe(Effect.catch(() => Effect.void));
    });

  /**
   * The main sequential execution loop. Runs in the background after startRun
   * transitions the run to "running".
   */
  const executeRun = (runId: OrchestrationRunId) =>
    Effect.gen(function* () {
      // 1. Load run and parse ticket order
      const run = yield* runService.get({ runId });
      const ticketOrder = run.ticketOrder;
      const orchestrationThreadId = run.orchestrationThreadId as ThreadId;
      const startIndex = run.currentTicketIndex + 1;

      yield* Effect.logInfo(
        formatTimelineLog(SCOPE, "runner.execute.loaded", {
          runId,
          ticketCount: ticketOrder.length,
          orchestrationThreadId,
          startIndex,
        }),
      );

      // 2. Resolve all ticket details upfront
      const tickets = new Map<string, Ticket>();
      for (const entry of ticketOrder) {
        const ticket = yield* ticketing.getById({ id: entry.ticketId }).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationRunError({
                message: `Failed to resolve ticket ${entry.ticketId}`,
                cause,
              }),
          ),
        );
        tickets.set(entry.ticketId, ticket);
      }

      yield* Effect.logInfo(
        formatTimelineLog(SCOPE, "runner.execute.tickets-resolved", {
          runId,
          ticketIdentifiers: ticketOrder.map(
            (e) => tickets.get(e.ticketId)?.identifier ?? e.ticketId,
          ),
        }),
      );

      // 3. Post run-start activity
      yield* postActivity({
        threadId: orchestrationThreadId,
        kind: "orchestration.run.started",
        summary: `Orchestration run started with ${ticketOrder.length} ticket${ticketOrder.length === 1 ? "" : "s"}`,
      });

      // 4. Generate orchestration thread title
      const orderedTickets = ticketOrder.map((entry) => tickets.get(entry.ticketId)!);
      yield* dispatchCommand(
        {
          type: "thread.meta.update",
          commandId: runnerCommandId("orchestration-title"),
          threadId: orchestrationThreadId,
          title: buildOrchestrationTitle(orderedTickets),
        },
        "Failed to update orchestration thread title",
      ).pipe(Effect.catch(() => Effect.void));

      const generatedTitle = buildOrchestrationTitle(orderedTickets);
      yield* Effect.logInfo(
        formatTimelineLog(SCOPE, "runner.execute.title-set", { runId, title: generatedTitle }),
      );

      // 5. Sequential loop
      for (let index = startIndex; index < ticketOrder.length; index++) {
        const entry = ticketOrder[index]!;
        const ticket = tickets.get(entry.ticketId)!;
        const workingThreadId = entry.workingThreadId as ThreadId;

        // 5a. Check run status — may have been paused/canceled externally
        const currentRun = yield* runService.get({ runId });
        if (currentRun.status !== "running") {
          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.ticket.status-check.stopped", {
              runId,
              index,
              runStatus: currentRun.status,
            }),
          );
          return;
        }

        // Run the entire per-ticket body inside a catch so any unexpected
        // failure follows the same pause-with-reason path as an explicit turn
        // failure — including progress updates and post-success activities.
        type TicketResult = "completed" | "blocked" | "paused";
        const ticketResult: TicketResult = yield* Effect.gen(function* () {
          // 5b. Update progress
          yield* runService.updateRunProgress({
            runId,
            currentTicketIndex: index,
            currentPhase: "working",
          });

          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.ticket.progress-updated", {
              runId,
              index,
              ticketId: entry.ticketId,
              ticketIdentifier: ticket.identifier,
            }),
          );

          // 5c. Post ticket-started activity
          yield* postActivity({
            threadId: orchestrationThreadId,
            kind: "orchestration.run.ticket.started",
            summary: `Starting work on ticket ${ticket.identifier}: ${ticket.title}`,
          });

          // 5d. Set ticket to in_progress
          yield* ticketing.update({ id: entry.ticketId, status: "in_progress" }).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationRunError({
                  message: `Failed to update ticket ${ticket.identifier} status`,
                  cause,
                }),
            ),
          );

          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.ticket.set-in-progress", {
              runId,
              ticketId: entry.ticketId,
              ticketIdentifier: ticket.identifier,
            }),
          );

          // 5e-h. Start subscription, dispatch turn, wait for completion.
          // The turn completion listener is started BEFORE dispatching the turn
          // to avoid missing fast completions. Both run inside a shared scope
          // so the stream subscription fiber is cleaned up after we get a result.
          const outcome: TurnOutcome = yield* Effect.scoped(
            Effect.gen(function* () {
              const completionFiber = yield* waitForTurnCompletion(workingThreadId).pipe(
                Effect.forkScoped,
              );

              yield* dispatchWorkTurn(workingThreadId, ticket);

              yield* Effect.logInfo(
                formatTimelineLog(SCOPE, "runner.ticket.turn-dispatched", {
                  runId,
                  ticketId: entry.ticketId,
                  ticketIdentifier: ticket.identifier,
                  workingThreadId,
                }),
              );

              yield* Effect.logInfo(
                formatTimelineLog(SCOPE, "runner.ticket.awaiting-completion", {
                  runId,
                  ticketId: entry.ticketId,
                  workingThreadId,
                }),
              );

              return yield* Fiber.join(completionFiber);
            }),
          );

          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.ticket.turn-completed", {
              runId,
              ticketId: entry.ticketId,
              ticketIdentifier: ticket.identifier,
              outcome: outcome.result,
              ...(outcome.result === "failed" ? { error: outcome.error } : {}),
            }),
          );

          // 5i. Handle outcome
          if (outcome.result === "failed") {
            yield* Effect.logWarning(
              formatTimelineLog(SCOPE, "runner.ticket.failed", {
                runId,
                ticketId: entry.ticketId,
                ticketIdentifier: ticket.identifier,
                error: outcome.error,
              }),
            );
            yield* ticketing
              .update({ id: entry.ticketId, status: "blocked" })
              .pipe(Effect.catch(() => Effect.void));
            yield* pauseRunWithReason(
              runId,
              orchestrationThreadId,
              `Ticket ${ticket.identifier} failed: ${outcome.error ?? "unknown error"}`,
            );
            return "blocked" as const;
          }

          // Turn completed — check if agent set ticket to blocked
          const updatedTicket = yield* ticketing.getById({ id: entry.ticketId }).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationRunError({
                  message: `Failed to reload ticket ${ticket.identifier}`,
                  cause,
                }),
            ),
          );

          if (updatedTicket.status === "blocked") {
            yield* Effect.logWarning(
              formatTimelineLog(SCOPE, "runner.ticket.agent-blocked", {
                runId,
                ticketId: entry.ticketId,
                ticketIdentifier: ticket.identifier,
              }),
            );
            yield* pauseRunWithReason(
              runId,
              orchestrationThreadId,
              `Ticket ${ticket.identifier} is blocked`,
            );
            return "blocked" as const;
          }

          // Success — move ticket to done (unless agent already moved it to a terminal state)
          if (updatedTicket.status !== "done" && updatedTicket.status !== "canceled") {
            yield* ticketing
              .update({ id: entry.ticketId, status: "done" })
              .pipe(Effect.catch(() => Effect.void));
            yield* Effect.logInfo(
              formatTimelineLog(SCOPE, "runner.ticket.set-done", {
                runId,
                ticketId: entry.ticketId,
                ticketIdentifier: ticket.identifier,
              }),
            );
          } else {
            yield* Effect.logInfo(
              formatTimelineLog(SCOPE, "runner.ticket.already-terminal", {
                runId,
                ticketId: entry.ticketId,
                status: updatedTicket.status,
              }),
            );
          }

          yield* postActivity({
            threadId: orchestrationThreadId,
            kind: "orchestration.run.ticket.completed",
            summary: `Completed ticket ${ticket.identifier}`,
          });

          return "completed" as const;
        }).pipe(
          // Catch any unexpected error during the ticket processing and treat
          // it as a blocked ticket + paused run, matching the ticket spec.
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* Effect.logWarning(
                formatTimelineLog(SCOPE, "runner.ticket.unexpected-error", {
                  runId,
                  ticketId: entry.ticketId,
                  ticketIdentifier: ticket.identifier,
                }),
              );
              yield* Effect.logError("Unexpected error processing ticket", {
                runId,
                ticketId: entry.ticketId,
                cause,
              });
              yield* ticketing
                .update({ id: entry.ticketId, status: "blocked" })
                .pipe(Effect.catch(() => Effect.void));
              yield* pauseRunWithReason(
                runId,
                orchestrationThreadId,
                `Ticket ${ticket.identifier} failed unexpectedly`,
              );
              return "paused" as const;
            }),
          ),
        );

        if (ticketResult === "blocked" || ticketResult === "paused") {
          return;
        }
      }

      // 6. All tickets done — mark run completed
      yield* runService.complete({ runId }).pipe(Effect.catch(() => Effect.void));

      yield* postActivity({
        threadId: orchestrationThreadId,
        kind: "orchestration.run.completed",
        summary: `Orchestration complete: ${ticketOrder.length}/${ticketOrder.length} tickets done`,
      });

      yield* Effect.logInfo(
        formatTimelineLog(SCOPE, "runner.execute.completed", {
          runId,
          ticketCount: ticketOrder.length,
        }),
      );
    });

  const startRun: OrchestrationRunRunnerShape["startRun"] = (input) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(formatTimelineLog(SCOPE, "runner.start", { runId: input.runId }));

      // Transition pending → running
      const run = yield* runService.start(input);

      yield* Effect.logInfo(
        formatTimelineLog(SCOPE, "runner.start.completed", {
          runId: input.runId,
          status: run.status,
        }),
      );

      // Fork the execution loop in the runner scope so it outlives startRun.
      yield* executeRun(input.runId).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(
              formatTimelineLog(SCOPE, "runner.execute.catastrophic-failure", {
                runId: input.runId,
              }),
            );
            yield* Effect.logError("Orchestration run failed unexpectedly", {
              runId: input.runId,
              cause,
            });
            // Try to mark the run as failed
            yield* runService.fail({ runId: input.runId }).pipe(Effect.catch(() => Effect.void));
          }),
        ),
        Effect.forkIn(runnerScope),
      );

      return run;
    });

  return { startRun } satisfies OrchestrationRunRunnerShape;
});

export const OrchestrationRunRunnerLive = Layer.effect(
  OrchestrationRunRunner,
  makeOrchestrationRunRunner,
);
