import type {
  CommandId,
  OrchestrationCommand,
  OrchestrationRunId,
  Ticket,
  ThreadId,
} from "@t3tools/contracts";
import { EventId, MessageId, OrchestrationRunError } from "@t3tools/contracts";
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Scope, Stream } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ServerRuntimeStartup } from "../../serverRuntimeStartup.ts";
import { TicketingService } from "../../ticketing/Services/Ticketing.ts";
import { OrchestrationRunService } from "../Services/OrchestrationRuns.ts";
import {
  OrchestrationRunRunner,
  type OrchestrationRunRunnerShape,
} from "../Services/OrchestrationRunRunner.ts";

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
        (session) => {
          if (session.status === "running") {
            sawRunning = true;
            return Effect.void;
          }
          // Ignore non-terminal statuses, and ignore terminal statuses that
          // arrive before the turn has started (e.g. initial "ready" from
          // session.started on a fresh thread).
          if (!sawRunning) {
            return Effect.void;
          }
          if (session.status === "error" || session.status === "stopped") {
            return Deferred.succeed(turnDone, {
              result: "failed" as const,
              error: session.lastError ?? null,
            });
          }
          if (session.status === "ready") {
            return Deferred.succeed(turnDone, { result: "completed" as const });
          }
          return Effect.void;
        },
      ).pipe(Effect.forkScoped);

      // Wait for completion with a timeout
      const maybeOutcome = yield* Deferred.await(turnDone).pipe(Effect.timeoutOption(TURN_TIMEOUT));
      const outcome: TurnOutcome = Option.match(maybeOutcome, {
        onNone: () => ({ result: "failed" as const, error: "Turn timed out after 30 minutes" }),
        onSome: (value) => value,
      });

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

      // 5. Sequential loop
      const startIndex = run.currentTicketIndex + 1;
      for (let index = startIndex; index < ticketOrder.length; index++) {
        const entry = ticketOrder[index]!;
        const ticket = tickets.get(entry.ticketId)!;
        const workingThreadId = entry.workingThreadId as ThreadId;

        // 5a. Check run status — may have been paused/canceled externally
        const currentRun = yield* runService.get({ runId });
        if (currentRun.status !== "running") {
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
              return yield* Fiber.join(completionFiber);
            }),
          );

          // 5i. Handle outcome
          if (outcome.result === "failed") {
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
    });

  const startRun: OrchestrationRunRunnerShape["startRun"] = (input) =>
    Effect.gen(function* () {
      // Transition pending → running
      const run = yield* runService.start(input);

      // Fork the execution loop in the runner scope so it outlives startRun.
      yield* executeRun(input.runId).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
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
