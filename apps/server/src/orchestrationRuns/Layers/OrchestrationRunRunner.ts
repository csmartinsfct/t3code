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

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  ServerRuntimeStartup,
  type ServerRuntimeStartupShape,
} from "../../serverRuntimeStartup.ts";
import {
  TicketingService,
  type TicketingServiceShape,
} from "../../ticketing/Services/Ticketing.ts";
import {
  OrchestrationRunService,
  type OrchestrationRunServiceShape,
} from "../Services/OrchestrationRuns.ts";
import {
  OrchestrationRunRunner,
  type OrchestrationRunRunnerShape,
} from "../Services/OrchestrationRunRunner.ts";

const SCOPE = "server.orchestration-runner";
const TURN_TIMEOUT = Duration.minutes(30);

type TurnOutcome =
  | { readonly result: "completed" }
  | { readonly result: "failed"; readonly error: string | null };

// ---------------------------------------------------------------------------
// Active run state — mutable in-memory tracker so pause/cancel/resume and
// user-takeover detection can reach into the running loop.
// ---------------------------------------------------------------------------

type ActiveRunState = {
  runId: OrchestrationRunId;
  orchestrationThreadId: ThreadId;
  /** Set when dispatching a turn, cleared on turn completion. */
  activeWorkingThreadId: ThreadId | null;
  /** Background fiber running the sequential execution loop. */
  fiber: Fiber.Fiber<void, never>;
};

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

interface OrchestrationRunRunnerDeps {
  readonly runService: OrchestrationRunServiceShape;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly ticketing: TicketingServiceShape;
  readonly startup: ServerRuntimeStartupShape;
}

export const makeOrchestrationRunRunnerFromDeps = (deps: OrchestrationRunRunnerDeps) =>
  Effect.gen(function* () {
    const { runService, orchestrationEngine, ticketing, startup } = deps;

    // Create a scope for background fibers that lives as long as the service.
    const runnerScope = yield* Scope.make("sequential");
    yield* Effect.addFinalizer(() => Scope.close(runnerScope, Exit.void));

    // Mutable in-memory state for the currently active run.
    let activeRunState: ActiveRunState | null = null;

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

    const withRunService = <A, E>(
      useRunService: (runService: OrchestrationRunServiceShape) => Effect.Effect<A, E>,
    ) => useRunService(runService);

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
        const maybeOutcome = yield* Deferred.await(turnDone).pipe(
          Effect.timeoutOption(TURN_TIMEOUT),
        );
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
      return dispatchCommand(
        command,
        `Failed to dispatch work turn for ticket ${ticket.identifier}`,
      );
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
        yield* withRunService((runService) =>
          runService.pause({ runId }).pipe(Effect.catch(() => Effect.void)),
        );
        yield* postActivity({
          threadId: orchestrationThreadId,
          kind: "orchestration.run.paused",
          summary: reason,
          tone: "error",
        }).pipe(Effect.catch(() => Effect.void));
      });

    // ---------------------------------------------------------------------------
    // Interrupt / stop helpers
    // ---------------------------------------------------------------------------

    /** Dispatch a turn interrupt for a working thread (best-effort). */
    const interruptWorkingThread = (threadId: ThreadId) =>
      dispatchCommand(
        {
          type: "thread.turn.interrupt",
          commandId: runnerCommandId("interrupt"),
          threadId,
          createdAt: new Date().toISOString(),
        },
        `Failed to interrupt turn on thread ${threadId}`,
      ).pipe(Effect.catch(() => Effect.void));

    /** Dispatch a session stop for a working thread (best-effort). */
    const stopWorkingThread = (threadId: ThreadId) =>
      dispatchCommand(
        {
          type: "thread.session.stop",
          commandId: runnerCommandId("stop"),
          threadId,
          createdAt: new Date().toISOString(),
        },
        `Failed to stop session on thread ${threadId}`,
      ).pipe(Effect.catch(() => Effect.void));

    // ---------------------------------------------------------------------------
    // Sequential execution loop — extracted so both startRun and resumeRun
    // can invoke it.
    // ---------------------------------------------------------------------------

    /**
     * Run the sequential execution loop from `startIndex` through the ticket
     * plan. When `isResume` is true, the startup preamble (activity post,
     * title generation) is skipped because the run was already started.
     */
    const executeRunLoop = (runId: OrchestrationRunId, startIndex: number, isResume: boolean) =>
      Effect.gen(function* () {
        // 1. Load run and parse ticket order
        const run = yield* withRunService((runService) => runService.get({ runId }));
        const ticketOrder = run.ticketOrder;
        const orchestrationThreadId = run.orchestrationThreadId as ThreadId;

        yield* Effect.logInfo(
          formatTimelineLog(SCOPE, "runner.execute.loaded", {
            runId,
            ticketCount: ticketOrder.length,
            orchestrationThreadId,
            startIndex,
            isResume,
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

        // 3. Startup preamble — only on fresh start, not resume
        if (!isResume) {
          yield* postActivity({
            threadId: orchestrationThreadId,
            kind: "orchestration.run.started",
            summary: `Orchestration run started with ${ticketOrder.length} ticket${ticketOrder.length === 1 ? "" : "s"}`,
          });

          // Generate orchestration thread title
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
        }

        // 4. Sequential loop
        for (let index = startIndex; index < ticketOrder.length; index++) {
          const entry = ticketOrder[index]!;
          const ticket = tickets.get(entry.ticketId)!;
          const workingThreadId = entry.workingThreadId as ThreadId;

          // 4a. Check run status — may have been paused/canceled externally
          const currentRun = yield* withRunService((runService) => runService.get({ runId }));
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
            // 4b. Update progress
            yield* withRunService((runService) =>
              runService.updateRunProgress({
                runId,
                currentTicketIndex: index,
                currentPhase: "working",
              }),
            );

            yield* Effect.logInfo(
              formatTimelineLog(SCOPE, "runner.ticket.progress-updated", {
                runId,
                index,
                ticketId: entry.ticketId,
                ticketIdentifier: ticket.identifier,
              }),
            );

            // 4c. Post ticket-started activity
            yield* postActivity({
              threadId: orchestrationThreadId,
              kind: "orchestration.run.ticket.started",
              summary: `Starting work on ticket ${ticket.identifier}: ${ticket.title}`,
            });

            // 4d. Set ticket to in_progress
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

            // 4e-h. Start subscription, dispatch turn, wait for completion.
            // Track the active working thread for pause/cancel/takeover.
            if (activeRunState) {
              activeRunState.activeWorkingThreadId = workingThreadId;
            }

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

            // Clear active working thread after turn completes
            if (activeRunState) {
              activeRunState.activeWorkingThreadId = null;
            }

            yield* Effect.logInfo(
              formatTimelineLog(SCOPE, "runner.ticket.turn-completed", {
                runId,
                ticketId: entry.ticketId,
                ticketIdentifier: ticket.identifier,
                outcome: outcome.result,
                ...(outcome.result === "failed" ? { error: outcome.error } : {}),
              }),
            );

            // 4i. Handle outcome
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

        // 5. All tickets done — mark run completed
        yield* withRunService((runService) =>
          runService.complete({ runId }).pipe(Effect.catch(() => Effect.void)),
        );

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

    /**
     * Fork the execution loop as a background fiber. On completion or failure
     * the active run state is cleared.
     */
    const forkExecutionLoop = (
      runId: OrchestrationRunId,
      orchestrationThreadId: ThreadId,
      startIndex: number,
      isResume: boolean,
    ) =>
      Effect.gen(function* () {
        const fiber = yield* executeRunLoop(runId, startIndex, isResume).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (activeRunState?.runId === runId) {
                activeRunState = null;
              }
            }),
          ),
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* Effect.logWarning(
                formatTimelineLog(SCOPE, "runner.execute.catastrophic-failure", { runId }),
              );
              yield* Effect.logError("Orchestration run failed unexpectedly", { runId, cause });
              yield* withRunService((runService) =>
                runService.fail({ runId }).pipe(Effect.catch(() => Effect.void)),
              );
            }),
          ),
          Effect.forkIn(runnerScope),
        );

        activeRunState = {
          runId,
          orchestrationThreadId,
          activeWorkingThreadId: null,
          fiber,
        };
      });

    // ---------------------------------------------------------------------------
    // Public methods
    // ---------------------------------------------------------------------------

    const startRun: OrchestrationRunRunnerShape["startRun"] = (input) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(formatTimelineLog(SCOPE, "runner.start", { runId: input.runId }));

        // Transition pending → running
        const run = yield* withRunService((runService) => runService.start(input));

        yield* Effect.logInfo(
          formatTimelineLog(SCOPE, "runner.start.completed", {
            runId: input.runId,
            status: run.status,
          }),
        );

        yield* forkExecutionLoop(
          input.runId,
          run.orchestrationThreadId as ThreadId,
          run.currentTicketIndex + 1,
          false,
        );

        return run;
      });

    const pauseRun: OrchestrationRunRunnerShape["pauseRun"] = (input) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(formatTimelineLog(SCOPE, "runner.pause", { runId: input.runId }));

        // Transition running → paused
        const run = yield* withRunService((runService) => runService.pause(input));

        // Interrupt active agent turn if one is running
        if (activeRunState?.runId === input.runId && activeRunState.activeWorkingThreadId) {
          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.pause.interrupting", {
              runId: input.runId,
              workingThreadId: activeRunState.activeWorkingThreadId,
            }),
          );
          yield* interruptWorkingThread(activeRunState.activeWorkingThreadId);
        }

        yield* postActivity({
          threadId: run.orchestrationThreadId as ThreadId,
          kind: "orchestration.run.paused",
          summary: "Orchestration paused",
        }).pipe(Effect.catch(() => Effect.void));

        return run;
      });

    const resumeRun: OrchestrationRunRunnerShape["resumeRun"] = (input) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(formatTimelineLog(SCOPE, "runner.resume", { runId: input.runId }));

        // Load run to check current state
        const currentRun = yield* withRunService((runService) => runService.get(input));

        // Idempotent: if already running, return as-is
        if (currentRun.status === "running") {
          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.resume.already-running", { runId: input.runId }),
          );
          return currentRun;
        }

        // Transition paused → running
        const run = yield* withRunService((runService) => runService.resume(input));
        const orchestrationThreadId = run.orchestrationThreadId as ThreadId;
        const ticketOrder = run.ticketOrder;

        // Post resume activity
        yield* postActivity({
          threadId: orchestrationThreadId,
          kind: "orchestration.run.resumed",
          summary: "Orchestration resumed",
        }).pipe(Effect.catch(() => Effect.void));

        // Re-evaluate current ticket to determine where to resume
        let resolvedStartIndex = run.currentTicketIndex;
        if (resolvedStartIndex >= 0 && resolvedStartIndex < ticketOrder.length) {
          const currentEntry = ticketOrder[resolvedStartIndex]!;
          const ticket = yield* ticketing
            .getById({ id: currentEntry.ticketId })
            .pipe(Effect.catch(() => Effect.succeed(null as Ticket | null)));

          if (ticket) {
            if (ticket.status === "done" || ticket.status === "canceled") {
              // User finished it manually while paused — advance
              yield* Effect.logInfo(
                formatTimelineLog(SCOPE, "runner.resume.ticket-already-terminal", {
                  runId: input.runId,
                  ticketId: currentEntry.ticketId,
                  ticketIdentifier: ticket.identifier,
                  status: ticket.status,
                }),
              );
              resolvedStartIndex += 1;
            }
            // Otherwise (in_progress, blocked, todo) — re-dispatch from this index
          }
        } else {
          // currentTicketIndex is -1 (never started) — start from 0
          resolvedStartIndex = 0;
        }

        yield* Effect.logInfo(
          formatTimelineLog(SCOPE, "runner.resume.resolved-start", {
            runId: input.runId,
            originalIndex: run.currentTicketIndex,
            resolvedStartIndex,
          }),
        );

        // Check if all tickets are already done
        if (resolvedStartIndex >= ticketOrder.length) {
          yield* withRunService((runService) =>
            runService.complete({ runId: input.runId }).pipe(Effect.catch(() => Effect.void)),
          );
          yield* postActivity({
            threadId: orchestrationThreadId,
            kind: "orchestration.run.completed",
            summary: `Orchestration complete: ${ticketOrder.length}/${ticketOrder.length} tickets done`,
          }).pipe(Effect.catch(() => Effect.void));
          return yield* withRunService((runService) => runService.get(input));
        }

        // Fork a new execution loop from the resolved index
        yield* forkExecutionLoop(input.runId, orchestrationThreadId, resolvedStartIndex, true);

        return run;
      });

    const cancelRun: OrchestrationRunRunnerShape["cancelRun"] = (input) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(formatTimelineLog(SCOPE, "runner.cancel", { runId: input.runId }));

        // Transition running/paused → canceled
        const run = yield* withRunService((runService) => runService.cancel(input));

        // Interrupt active agent turn and stop session if running
        if (activeRunState?.runId === input.runId && activeRunState.activeWorkingThreadId) {
          const workingThreadId = activeRunState.activeWorkingThreadId;
          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.cancel.interrupting", {
              runId: input.runId,
              workingThreadId,
            }),
          );
          yield* interruptWorkingThread(workingThreadId);
          yield* stopWorkingThread(workingThreadId);
        }

        // Clear active state
        if (activeRunState?.runId === input.runId) {
          activeRunState = null;
        }

        yield* postActivity({
          threadId: run.orchestrationThreadId as ThreadId,
          kind: "orchestration.run.canceled",
          summary: "Orchestration canceled",
        }).pipe(Effect.catch(() => Effect.void));

        return run;
      });

    // ---------------------------------------------------------------------------
    // User-takeover detection — watches domain events for user-initiated turns
    // on child threads belonging to an active orchestration run.
    // ---------------------------------------------------------------------------

    yield* Stream.runForEach(
      orchestrationEngine.streamDomainEvents.pipe(
        Stream.filter((event) => event.type === "thread.turn-start-requested"),
      ),
      (event) =>
        Effect.gen(function* () {
          // Ignore engine-dispatched turns
          const commandId = event.commandId ?? "";
          if (commandId.startsWith("runner:")) return;

          const threadId = (event.payload as { threadId?: string }).threadId;
          if (!threadId) return;

          // Look up the thread to check if it's an orchestration child
          const readModel = yield* orchestrationEngine.getReadModel();
          const thread = readModel.threads.find((t) => t.id === threadId);
          if (!thread || !thread.parentThreadId) return;

          // Check if there's an active run for the parent orchestration thread
          if (!activeRunState || activeRunState.orchestrationThreadId !== thread.parentThreadId) {
            return;
          }
          const currentActiveRunState = activeRunState;

          // Verify the run is still running
          const currentRun = yield* withRunService((runService) =>
            runService
              .get({ runId: currentActiveRunState.runId })
              .pipe(
                Effect.catch(() =>
                  Effect.succeed(null as import("@t3tools/contracts").OrchestrationRun | null),
                ),
              ),
          );
          if (!currentRun || currentRun.status !== "running") return;

          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.user-takeover.detected", {
              runId: currentActiveRunState.runId,
              userThreadId: threadId,
              activeWorkingThreadId: currentActiveRunState.activeWorkingThreadId,
            }),
          );

          // Interrupt the active agent turn (may be same or different thread)
          if (currentActiveRunState.activeWorkingThreadId) {
            yield* interruptWorkingThread(currentActiveRunState.activeWorkingThreadId);
          }

          // Resolve the ticket identifier for the separator message
          const ticketOrder = currentRun.ticketOrder;
          const takenOverEntry = ticketOrder.find((e) => e.workingThreadId === threadId);
          let ticketLabel = "a ticket";
          if (takenOverEntry) {
            const ticket = yield* ticketing
              .getById({ id: takenOverEntry.ticketId })
              .pipe(Effect.catch(() => Effect.succeed(null as Ticket | null)));
            if (ticket) {
              ticketLabel = ticket.identifier;
            }
          }

          // Auto-pause the run
          yield* withRunService((runService) =>
            runService
              .pause({ runId: currentActiveRunState.runId })
              .pipe(Effect.catch(() => Effect.void)),
          );

          yield* postActivity({
            threadId: currentActiveRunState.orchestrationThreadId,
            kind: "orchestration.run.user-takeover",
            summary: `User took over ${ticketLabel} — orchestration paused`,
          }).pipe(Effect.catch(() => Effect.void));

          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.user-takeover.paused", {
              runId: currentActiveRunState.runId,
              ticketLabel,
            }),
          );
        }),
    ).pipe(Effect.forkIn(runnerScope));

    return { startRun, pauseRun, resumeRun, cancelRun } satisfies OrchestrationRunRunnerShape;
  });

export const makeOrchestrationRunRunner = Effect.gen(function* () {
  const runService = yield* OrchestrationRunService;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const ticketing = yield* TicketingService;
  const startup = yield* ServerRuntimeStartup;

  return yield* makeOrchestrationRunRunnerFromDeps({
    runService,
    orchestrationEngine,
    ticketing,
    startup,
  });
});

export const OrchestrationRunRunnerLive = Layer.effect(
  OrchestrationRunRunner,
  makeOrchestrationRunRunner,
);
