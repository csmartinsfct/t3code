import type {
  CommandId,
  ModelSelection,
  OrchestrationCommand,
  OrchestrationPromptId,
  OrchestrationProject,
  OrchestrationRun,
  OrchestrationRunId,
  OrchestrationResumeRunMode,
  OrchestrationThread,
  ProviderRuntimeEvent,
  PromptTemplateDocument,
  PromptTemplateValidationError,
  ReviewOutput,
  Ticket,
  ThreadId,
} from "@t3tools/contracts";
import {
  EventId,
  MessageId,
  OrchestrationRunError,
  ReviewOutput as ReviewOutputSchema,
  TurnId,
} from "@t3tools/contracts";
import {
  normalizeReviewOutputCandidate,
  parseReviewOutputJsonCandidates,
} from "@t3tools/shared/review";
import {
  renderPromptTemplate,
  resolveOrchestrationPromptDocuments,
  validatePromptTemplateDocument,
} from "@t3tools/shared/promptTemplates";
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Scope,
  Schema,
  Stream,
} from "effect";
import { formatTimelineLog } from "@t3tools/shared/timeline";

import {
  CheckpointDiffQuery,
  type CheckpointDiffQueryShape,
} from "../../checkpointing/Services/CheckpointDiffQuery.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderRateLimitsCache } from "../../provider/Services/ProviderRateLimitsCache.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import {
  ServerRuntimeStartup,
  type ServerRuntimeStartupShape,
} from "../../serverRuntimeStartup.ts";
import { ServerSettingsService, type ServerSettingsShape } from "../../serverSettings.ts";
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
  | { readonly result: "completed"; readonly turnId: TurnId | null }
  | {
      readonly result: "interrupted";
      readonly reason: string | null;
      readonly turnId: TurnId | null;
    }
  | {
      readonly result: "failed";
      readonly error: string | null;
      readonly promptId?: OrchestrationPromptId;
      readonly turnId?: TurnId | null;
    };

type ProviderTurnWatcherEvent = Extract<
  ProviderRuntimeEvent,
  { type: "turn.started" | "turn.completed" | "turn.aborted" }
>;

type ProviderTurnTerminalEvent = Extract<
  ProviderRuntimeEvent,
  { type: "turn.completed" | "turn.aborted" }
>;

type PromptRenderContext = {
  readonly ticket: Ticket;
  readonly project: Pick<OrchestrationProject, "title" | "workspaceRoot">;
  readonly commitDiff?: string;
  readonly reviewIteration?: number;
  readonly review?: ReviewOutput;
  readonly reviewSummary?: string;
};

type PriorRequestedChangesReview = {
  readonly reviewSummary?: string;
  readonly reviewedWorkingTurnCount?: number;
};

// ---------------------------------------------------------------------------
// Active run state — mutable in-memory tracker so pause/cancel/resume and
// user-takeover detection can reach into the running loop.
// ---------------------------------------------------------------------------

type ActiveRunState = {
  runId: OrchestrationRunId;
  orchestrationThreadId: ThreadId;
  /** Set when dispatching a turn, cleared on turn completion. */
  activeChildThreadId: ThreadId | null;
  /** Background fiber running the sequential execution loop. */
  fiber: Fiber.Fiber<void, never>;
};

const runnerCommandId = (tag: string): CommandId =>
  `runner:${tag}:${crypto.randomUUID()}` as CommandId;

class PromptRenderFailure extends Error {
  constructor(
    readonly promptId: OrchestrationPromptId,
    readonly detail: string,
  ) {
    super(`Failed to render orchestration prompt ${promptId}: ${detail}`);
    this.name = "PromptRenderFailure";
  }
}

const isProviderTurnWatcherEvent = (
  event: ProviderRuntimeEvent,
): event is ProviderTurnWatcherEvent =>
  event.type === "turn.started" || event.type === "turn.completed" || event.type === "turn.aborted";

const terminalReasonFromRuntimeEvent = (event: ProviderTurnTerminalEvent): string | null => {
  if (event.type === "turn.aborted") {
    return event.payload.reason;
  }
  return (
    event.payload.errorMessage ?? event.payload.terminalReason ?? event.payload.stopReason ?? null
  );
};

const formatAcceptanceCriteria = (acceptanceCriteria: Ticket["acceptanceCriteria"]): string =>
  acceptanceCriteria?.map((criterion) => `- ${criterion.text}`).join("\n") ?? "";

const formatReviewComments = (review: ReviewOutput): string =>
  review.comments
    .map((comment) => {
      const location =
        comment.file !== null
          ? `${comment.file}${comment.line !== null ? `:${comment.line}` : ""}`
          : "general";
      return `- [${comment.severity}] ${location} - ${comment.body}`;
    })
    .join("\n");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const buildPromptVariableMap = (input: PromptRenderContext) => ({
  ticketId: input.ticket.identifier,
  ticketTitle: input.ticket.title,
  ticketDescription: input.ticket.description ?? "",
  acceptanceCriteria: formatAcceptanceCriteria(input.ticket.acceptanceCriteria),
  worktree: input.ticket.worktree ?? "",
  projectTitle: input.project.title,
  projectPath: input.project.workspaceRoot,
  commitDiff: input.commitDiff ?? "",
  reviewIteration: typeof input.reviewIteration === "number" ? String(input.reviewIteration) : "",
  reviewSummary: input.reviewSummary ?? input.review?.summary ?? "",
  reviewComments: input.review ? formatReviewComments(input.review) : "",
});

const describePromptValidationErrors = (
  errors: ReadonlyArray<PromptTemplateValidationError>,
): string =>
  errors
    .map((error) => {
      const location = error.blockIndex !== null ? `block ${error.blockIndex}: ` : "";
      return `${location}${error.message}`;
    })
    .join("; ");

const renderValidatedPromptDocument = (input: {
  readonly promptId: OrchestrationPromptId;
  readonly promptDocument: PromptTemplateDocument;
  readonly context: PromptRenderContext;
}): Effect.Effect<string, PromptRenderFailure> => {
  const validation = validatePromptTemplateDocument({
    promptId: input.promptId,
    document: input.promptDocument,
  });

  if (!validation.ok) {
    return Effect.fail(
      new PromptRenderFailure(input.promptId, describePromptValidationErrors(validation.errors)),
    );
  }

  return Effect.succeed(
    renderPromptTemplate(validation.document, buildPromptVariableMap(input.context)),
  );
};

const buildOrchestrationTitle = (tickets: ReadonlyArray<Ticket>): string => {
  const parts = tickets.map((t) => `${t.identifier}: ${t.title}`);
  const title = `Orchestrate: ${parts.join(", ")}`;
  return title.length > 120 ? `${title.slice(0, 117)}...` : title;
};

interface OrchestrationRunRunnerDeps {
  readonly runService: OrchestrationRunServiceShape;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly providerService: ProviderServiceShape;
  readonly checkpointDiffQuery: CheckpointDiffQueryShape;
  readonly ticketing: TicketingServiceShape;
  readonly startup: ServerRuntimeStartupShape;
  readonly serverSettings: ServerSettingsShape;
}

export const makeOrchestrationRunRunnerFromDeps = (deps: OrchestrationRunRunnerDeps) =>
  Effect.gen(function* () {
    const {
      runService,
      orchestrationEngine,
      providerService,
      checkpointDiffQuery,
      ticketing,
      startup,
      serverSettings,
    } = deps;

    // Background orchestration work must outlive the individual RPC request
    // that triggered it, so keep these fibers in their own detached scope
    // instead of tying them to the caller's request scope.
    const runnerScope = yield* Scope.make("sequential");

    // Mutable in-memory state for the currently active run.
    let activeRunState: ActiveRunState | null = null;

    const decodeReviewOutput = Schema.decodeUnknownEffect(ReviewOutputSchema);

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
      readonly payload?: Record<string, unknown>;
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
            payload: input.payload ?? {},
            turnId: null,
            createdAt: now,
          },
          createdAt: now,
        },
        `Failed to post activity: ${input.kind}`,
      );
    };

    const getThread = (threadId: ThreadId) =>
      orchestrationEngine
        .getReadModel()
        .pipe(
          Effect.map(
            (readModel) => readModel.threads.find((thread) => thread.id === threadId) ?? null,
          ),
        );

    const getProject = (projectId: OrchestrationProject["id"]) =>
      orchestrationEngine
        .getReadModel()
        .pipe(
          Effect.map(
            (readModel) => readModel.projects.find((project) => project.id === projectId) ?? null,
          ),
        );

    const getResolvedProjectPromptContext = (projectId: OrchestrationProject["id"]) =>
      Effect.gen(function* () {
        const [project, settings] = yield* Effect.all([
          getProject(projectId),
          serverSettings.getSettings,
        ]);

        if (!project) {
          return yield* new OrchestrationRunError({
            message: `Project ${projectId} was not found while resolving orchestration prompts`,
          });
        }

        return {
          project,
          prompts: resolveOrchestrationPromptDocuments({
            projectOverrides: project.promptOverrides.orchestration,
            globalPrompts: settings.prompts.orchestration,
            shippedDefaults: settings.promptDefaults.orchestration,
          }),
        };
      });

    const getLatestRequestedChangesReview = (input: {
      readonly orchestrationThreadId: ThreadId;
      readonly ticketId: Ticket["id"];
    }) =>
      getThread(input.orchestrationThreadId).pipe(
        Effect.map((thread) => {
          if (!thread) {
            return null;
          }

          for (let index = thread.activities.length - 1; index >= 0; index -= 1) {
            const activity = thread.activities[index]!;
            if (activity.kind !== "orchestration.run.ticket.review.requested-changes") {
              continue;
            }

            if (!isRecord(activity.payload) || activity.payload.ticketId !== input.ticketId) {
              continue;
            }

            const reviewSummary =
              typeof activity.payload.reviewSummary === "string" &&
              activity.payload.reviewSummary.length > 0
                ? activity.payload.reviewSummary
                : undefined;
            const reviewedWorkingTurnCount =
              typeof activity.payload.reviewedWorkingTurnCount === "number" &&
              Number.isInteger(activity.payload.reviewedWorkingTurnCount) &&
              activity.payload.reviewedWorkingTurnCount >= 0
                ? activity.payload.reviewedWorkingTurnCount
                : undefined;

            return {
              ...(reviewSummary ? { reviewSummary } : {}),
              ...(reviewedWorkingTurnCount !== undefined ? { reviewedWorkingTurnCount } : {}),
            } satisfies PriorRequestedChangesReview;
          }

          return null;
        }),
      );

    const waitForThread = <A>(
      threadId: ThreadId,
      resolve: (thread: OrchestrationThread) => A | null,
      message: string,
    ) =>
      Effect.gen(function* () {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const thread = yield* getThread(threadId);
          if (thread) {
            const value = resolve(thread);
            if (value !== null) {
              return value;
            }
          }

          if (attempt < 19) {
            yield* Effect.sleep(Duration.millis(100));
          }
        }

        return yield* new OrchestrationRunError({ message });
      });

    const getCompletedTurnCount = (threadId: ThreadId) =>
      waitForThread(
        threadId,
        (thread) => {
          const latestTurn = thread.latestTurn;
          if (!latestTurn || latestTurn.state !== "completed") {
            return null;
          }
          const turnCheckpoint = thread.checkpoints.find(
            (checkpoint) => checkpoint.turnId === latestTurn.turnId,
          );
          return turnCheckpoint?.checkpointTurnCount ?? null;
        },
        `Timed out waiting for completed checkpoint state on thread ${threadId}`,
      );

    const getCompletedAssistantMessagesForTurn = (input: {
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
    }) =>
      getThread(input.threadId).pipe(
        Effect.map((thread) => {
          if (input.turnId === null || !thread) {
            return null;
          }

          const latestTurn = thread.latestTurn;
          if (
            !latestTurn ||
            latestTurn.turnId !== input.turnId ||
            latestTurn.state !== "completed"
          ) {
            return null;
          }

          const assistantMessages = thread.messages.filter(
            (message) =>
              message.turnId === input.turnId &&
              message.role === "assistant" &&
              message.streaming === false &&
              message.text.length > 0,
          );
          if (assistantMessages.length === 0) {
            return null;
          }

          return assistantMessages.toSorted((left, right) => {
            const leftPriority =
              latestTurn.assistantMessageId !== null && left.id === latestTurn.assistantMessageId
                ? 1
                : 0;
            const rightPriority =
              latestTurn.assistantMessageId !== null && right.id === latestTurn.assistantMessageId
                ? 1
                : 0;
            if (leftPriority !== rightPriority) {
              return rightPriority - leftPriority;
            }
            return right.updatedAt.localeCompare(left.updatedAt);
          });
        }),
      );

    const parseReviewOutput = (input: {
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
    }) =>
      Effect.gen(function* () {
        let lastParseError: OrchestrationRunError | null = null;

        for (let attempt = 0; attempt < 20; attempt += 1) {
          const assistantMessages = yield* getCompletedAssistantMessagesForTurn(input);
          if (assistantMessages !== null) {
            for (const assistantMessage of assistantMessages) {
              const parsedCandidatesExit = yield* Effect.exit(
                Effect.try({
                  try: () => parseReviewOutputJsonCandidates(assistantMessage.text),
                  catch: (cause) =>
                    new OrchestrationRunError({
                      message: `Review output for thread ${input.threadId} turn ${String(input.turnId)} was not valid JSON`,
                      cause,
                    }),
                }),
              );
              if (parsedCandidatesExit._tag === "Failure") {
                lastParseError = new OrchestrationRunError({
                  message: `Review output for thread ${input.threadId} turn ${String(input.turnId)} was not valid JSON`,
                  cause: parsedCandidatesExit.cause,
                });
                continue;
              }

              let lastDecodeCause: unknown = null;
              for (const parsedCandidate of parsedCandidatesExit.value) {
                const decodedExit = yield* Effect.exit(
                  decodeReviewOutput(normalizeReviewOutputCandidate(parsedCandidate)),
                );
                if (decodedExit._tag === "Success") {
                  return decodedExit.value;
                }
                lastDecodeCause = decodedExit.cause;
              }

              lastParseError = new OrchestrationRunError({
                message: `Review output for thread ${input.threadId} turn ${String(input.turnId)} did not match ReviewOutput`,
                cause: lastDecodeCause,
              });
            }
          }

          if (attempt < 19) {
            yield* Effect.sleep(Duration.millis(100));
          }
        }

        if (lastParseError !== null) {
          return yield* lastParseError;
        }

        return yield* new OrchestrationRunError({
          message: `Timed out waiting for finalized assistant output on thread ${input.threadId} for turn ${String(input.turnId)}`,
        });
      });

    const ensureReviewThreadModel = (input: {
      readonly reviewThreadId: ThreadId;
      readonly implementationModelSelection: ModelSelection;
    }) =>
      Effect.gen(function* () {
        const reviewThread = yield* getThread(input.reviewThreadId);
        if (!reviewThread) {
          return yield* new OrchestrationRunError({
            message: `Review thread ${input.reviewThreadId} was not found`,
          });
        }

        // Model selection is deterministic — the review thread was created
        // with the correct model from global settings or ticket overrides.
        return reviewThread.modelSelection;
      });

    /**
     * Wait for a turn to settle on a working thread by observing the canonical
     * provider runtime stream. This gives us an explicit terminal outcome
     * instead of inferring success from session lifecycle state.
     */
    const waitForTurnCompletion = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const turnDone = yield* Deferred.make<TurnOutcome>();
        let activeTurnId: string | null = null;

        const fiber = yield* Stream.runForEach(
          providerService.streamEvents.pipe(
            Stream.filter(
              (event): event is ProviderTurnWatcherEvent =>
                event.threadId === threadId && isProviderTurnWatcherEvent(event),
            ),
          ),
          (event) =>
            Effect.gen(function* () {
              yield* Effect.logInfo(
                formatTimelineLog(SCOPE, "runner.turn-watcher.runtime-event", {
                  threadId,
                  eventType: event.type,
                  turnId: event.turnId ?? null,
                  activeTurnId,
                }),
              );

              if (event.type === "turn.started") {
                activeTurnId = event.turnId ?? null;
                yield* Effect.logInfo(
                  formatTimelineLog(SCOPE, "runner.turn-watcher.saw-start", {
                    threadId,
                    turnId: activeTurnId,
                  }),
                );
                return;
              }

              if (activeTurnId === null) {
                yield* Effect.logInfo(
                  formatTimelineLog(SCOPE, "runner.turn-watcher.ignored-before-start", {
                    threadId,
                    eventType: event.type,
                    turnId: event.turnId ?? null,
                  }),
                );
                return;
              }

              if (event.turnId && event.turnId !== activeTurnId) {
                yield* Effect.logInfo(
                  formatTimelineLog(SCOPE, "runner.turn-watcher.ignored-foreign-turn", {
                    threadId,
                    eventType: event.type,
                    turnId: event.turnId,
                    activeTurnId,
                  }),
                );
                return;
              }

              if (event.type === "turn.aborted") {
                yield* Effect.logInfo(
                  formatTimelineLog(SCOPE, "runner.turn-watcher.resolved", {
                    threadId,
                    result: "interrupted",
                    reason: event.payload.reason,
                  }),
                );
                yield* Deferred.succeed(turnDone, {
                  result: "interrupted" as const,
                  reason: event.payload.reason,
                  turnId: activeTurnId ? TurnId.makeUnsafe(activeTurnId) : null,
                });
                return;
              }

              if (event.payload.state === "completed") {
                yield* Effect.logInfo(
                  formatTimelineLog(SCOPE, "runner.turn-watcher.resolved", {
                    threadId,
                    result: "completed",
                    turnId: activeTurnId,
                  }),
                );
                yield* Deferred.succeed(turnDone, {
                  result: "completed" as const,
                  turnId: activeTurnId ? TurnId.makeUnsafe(activeTurnId) : null,
                });
                return;
              }

              if (event.payload.state === "interrupted" || event.payload.state === "cancelled") {
                const reason = terminalReasonFromRuntimeEvent(event);
                yield* Effect.logInfo(
                  formatTimelineLog(SCOPE, "runner.turn-watcher.resolved", {
                    threadId,
                    result: "interrupted",
                    turnId: activeTurnId,
                    reason,
                    state: event.payload.state,
                  }),
                );
                yield* Deferred.succeed(turnDone, {
                  result: "interrupted" as const,
                  reason,
                  turnId: activeTurnId ? TurnId.makeUnsafe(activeTurnId) : null,
                });
                return;
              }

              const error = terminalReasonFromRuntimeEvent(event);
              yield* Effect.logInfo(
                formatTimelineLog(SCOPE, "runner.turn-watcher.resolved", {
                  threadId,
                  result: "failed",
                  turnId: activeTurnId,
                  error,
                  state: event.payload.state,
                }),
              );
              yield* Deferred.succeed(turnDone, {
                result: "failed" as const,
                error,
                turnId: activeTurnId ? TurnId.makeUnsafe(activeTurnId) : null,
              });
              return;
            }),
        ).pipe(Effect.forkScoped);

        // Wait for completion with a timeout
        const maybeOutcome = yield* Deferred.await(turnDone).pipe(
          Effect.timeoutOption(TURN_TIMEOUT),
        );
        const outcome: TurnOutcome = Option.match(maybeOutcome, {
          onNone: () => {
            return {
              result: "failed" as const,
              error: "Turn timed out after 30 minutes",
              turnId: activeTurnId ? TurnId.makeUnsafe(activeTurnId) : null,
            };
          },
          onSome: (value) => value,
        });
        if (Option.isNone(maybeOutcome)) {
          yield* Effect.logWarning(
            formatTimelineLog(SCOPE, "runner.turn-watcher.timeout", { threadId }),
          );
        }

        // Clean up the subscription fiber
        yield* Fiber.interrupt(fiber);

        return outcome;
      });

    const dispatchThreadTurn = (input: {
      readonly threadId: ThreadId;
      readonly text: string;
      readonly modelSelection?: ModelSelection;
      readonly promptId?: OrchestrationPromptId;
      readonly phase?: "working" | "reviewing";
      readonly dispatchMode?:
        | "start"
        | "resume"
        | "resumeFreshAgent"
        | "feedback"
        | "review"
        | "reReview";
    }) => {
      const now = new Date().toISOString();
      const messageId = MessageId.makeUnsafe(crypto.randomUUID());
      // The thread.turn.start command has fields with Schema defaults (runtimeMode,
      // interactionMode) that make structural typing awkward. Cast via unknown.
      const command = {
        type: "thread.turn.start",
        commandId: runnerCommandId("orchestration-turn"),
        threadId: input.threadId,
        message: {
          messageId,
          role: "user",
          text: input.text,
          attachments: [],
          ...(input.promptId && input.phase && input.dispatchMode
            ? {
                metadata: {
                  origin: {
                    kind: "orchestration-prompt" as const,
                    promptId: input.promptId,
                    phase: input.phase,
                    dispatchMode: input.dispatchMode,
                  },
                },
              }
            : {}),
        },
        ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
        createdAt: now,
      } as unknown as OrchestrationCommand;
      return dispatchCommand(command, `Failed to dispatch turn for thread ${input.threadId}`);
    };

    const wrapDispatchError = (message: string, cause: unknown) =>
      cause instanceof PromptRenderFailure
        ? cause
        : new OrchestrationRunError({
            message,
            cause,
          });

    type DispatchWorkTurnMode = "start" | "resume" | "resumeFreshAgent" | "feedback";

    /**
     * Dispatch the next work turn for a ticket on its working thread.
     */
    const dispatchWorkTurn = (input: {
      readonly projectId: OrchestrationProject["id"];
      readonly workingThreadId: ThreadId;
      readonly ticket: Ticket;
      readonly mode: DispatchWorkTurnMode;
      readonly reviewFeedback?: ReviewOutput;
    }) => {
      return getResolvedProjectPromptContext(input.projectId).pipe(
        Effect.flatMap(({ project, prompts }) => {
          if (input.mode === "resume") {
            return renderValidatedPromptDocument({
              promptId: "resume",
              promptDocument: prompts.resume,
              context: {
                ticket: input.ticket,
                project,
              },
            }).pipe(
              Effect.flatMap((text) =>
                dispatchThreadTurn({
                  threadId: input.workingThreadId,
                  text,
                  promptId: "resume",
                  phase: "working",
                  dispatchMode: "resume",
                }),
              ),
            );
          }

          if (input.mode === "resumeFreshAgent") {
            return renderValidatedPromptDocument({
              promptId: "resumeFreshAgent",
              promptDocument: prompts.resumeFreshAgent,
              context: {
                ticket: input.ticket,
                project,
              },
            }).pipe(
              Effect.flatMap((text) =>
                dispatchThreadTurn({
                  threadId: input.workingThreadId,
                  text,
                  promptId: "resumeFreshAgent",
                  phase: "working",
                  dispatchMode: "resumeFreshAgent",
                }),
              ),
            );
          }

          if (input.mode === "feedback" && input.reviewFeedback) {
            return renderValidatedPromptDocument({
              promptId: "reviewFeedback",
              promptDocument: prompts.reviewFeedback,
              context: {
                ticket: input.ticket,
                project,
                review: input.reviewFeedback,
              },
            }).pipe(
              Effect.flatMap((text) =>
                dispatchThreadTurn({
                  threadId: input.workingThreadId,
                  text,
                  promptId: "reviewFeedback",
                  phase: "working",
                  dispatchMode: "feedback",
                }),
              ),
            );
          }

          return renderValidatedPromptDocument({
            promptId: "implement",
            promptDocument: prompts.implement,
            context: {
              ticket: input.ticket,
              project,
            },
          }).pipe(
            Effect.flatMap((text) =>
              dispatchThreadTurn({
                threadId: input.workingThreadId,
                text,
                promptId: "implement",
                phase: "working",
                dispatchMode: "start",
              }),
            ),
          );
        }),
        Effect.mapError((cause) =>
          wrapDispatchError(
            `Failed to dispatch work turn for ticket ${input.ticket.identifier}`,
            cause,
          ),
        ),
      );
    };

    const resolveReviewTurnPrompt = (input: {
      readonly projectId: OrchestrationProject["id"];
      readonly orchestrationThreadId: ThreadId;
      readonly ticket: Ticket;
      readonly workingThreadId: ThreadId;
      readonly reviewIteration: number;
      readonly priorRequestedChangesReview?: PriorRequestedChangesReview;
    }) =>
      Effect.gen(function* () {
        const turnCount = yield* getCompletedTurnCount(input.workingThreadId);
        const isReReview = input.reviewIteration >= 1;
        const priorRequestedChangesReview =
          input.priorRequestedChangesReview !== undefined
            ? input.priorRequestedChangesReview
            : ((yield* getLatestRequestedChangesReview({
                orchestrationThreadId: input.orchestrationThreadId,
                ticketId: input.ticket.id,
              })) ?? null);
        const priorReviewedWorkingTurnCount =
          priorRequestedChangesReview?.reviewedWorkingTurnCount ?? null;
        const diff =
          isReReview &&
          priorReviewedWorkingTurnCount !== null &&
          priorReviewedWorkingTurnCount <= turnCount
            ? yield* checkpointDiffQuery.getTurnDiff({
                threadId: input.workingThreadId,
                fromTurnCount: priorReviewedWorkingTurnCount,
                toTurnCount: turnCount,
              })
            : yield* checkpointDiffQuery.getFullThreadDiff({
                threadId: input.workingThreadId,
                toTurnCount: turnCount,
              });
        const { project, prompts } = yield* getResolvedProjectPromptContext(input.projectId);
        const promptId = isReReview ? "reReview" : "review";
        const prompt = yield* renderValidatedPromptDocument({
          promptId,
          promptDocument: prompts[promptId],
          context: {
            ticket: input.ticket,
            project,
            commitDiff: diff.diff,
            reviewIteration: input.reviewIteration + 1,
            ...(priorRequestedChangesReview?.reviewSummary
              ? { reviewSummary: priorRequestedChangesReview.reviewSummary }
              : {}),
          },
        });

        return {
          promptId,
          prompt,
        } as const;
      }).pipe(
        Effect.mapError((cause) =>
          wrapDispatchError(
            `Failed to render review turn for ticket ${input.ticket.identifier}`,
            cause,
          ),
        ),
      );

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

    const pauseRunForPromptRenderFailure = (input: {
      readonly runId: OrchestrationRunId;
      readonly orchestrationThreadId: ThreadId;
      readonly ticketId: Ticket["id"];
      readonly ticketIdentifier: Ticket["identifier"];
      readonly promptId: OrchestrationPromptId;
      readonly error: string;
    }) => {
      const reason = `Failed to render orchestration prompt ${input.promptId} for ticket ${input.ticketIdentifier}: ${input.error}`;
      return Effect.gen(function* () {
        yield* postActivity({
          threadId: input.orchestrationThreadId,
          kind: "orchestration.run.prompt.render.failed",
          summary: reason,
          tone: "error",
          payload: {
            ticketId: input.ticketId,
            ticketIdentifier: input.ticketIdentifier,
            promptId: input.promptId,
            error: input.error,
          },
        }).pipe(Effect.catch(() => Effect.void));

        yield* pauseRunWithReason(input.runId, input.orchestrationThreadId, reason);
      });
    };

    const resolveNextActionableTicketIndex = (run: OrchestrationRun) =>
      Effect.gen(function* () {
        const ticketOrder = run.ticketOrder;
        let resolvedIndex = run.currentTicketIndex;

        if (resolvedIndex < 0) {
          return 0;
        }

        while (resolvedIndex >= 0 && resolvedIndex < ticketOrder.length) {
          const currentEntry = ticketOrder[resolvedIndex]!;
          const ticket = yield* ticketing
            .getById({ id: currentEntry.ticketId })
            .pipe(Effect.catch(() => Effect.succeed(null as Ticket | null)));

          if (!ticket) {
            return resolvedIndex;
          }

          if (ticket.status !== "done" && ticket.status !== "canceled") {
            return resolvedIndex;
          }

          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.ticket.already-terminal", {
              runId: run.id,
              ticketId: currentEntry.ticketId,
              ticketIdentifier: ticket.identifier,
              status: ticket.status,
            }),
          );
          resolvedIndex += 1;
        }

        return resolvedIndex;
      });

    const finalizeCompletedRun = (
      runId: OrchestrationRunId,
      orchestrationThreadId: ThreadId,
      ticketCount: number,
    ) =>
      Effect.gen(function* () {
        const completedRun = yield* withRunService((service) =>
          service.complete({ runId }).pipe(Effect.option),
        );

        if (Option.isSome(completedRun)) {
          yield* postActivity({
            threadId: orchestrationThreadId,
            kind: "orchestration.run.completed",
            summary: `Orchestration complete: ${ticketCount}/${ticketCount} tickets done`,
          });
          return completedRun.value;
        }

        return yield* withRunService((service) => service.get({ runId }));
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

    const resolveFreshAgentResumeTarget = (input: {
      readonly run: OrchestrationRun;
      readonly resolvedStartIndex: number;
    }) =>
      Effect.gen(function* () {
        const ticketEntry = input.run.ticketOrder[input.resolvedStartIndex];
        if (!ticketEntry) {
          return yield* new OrchestrationRunError({
            message: `No ticket entry exists at index ${input.resolvedStartIndex} for run ${input.run.id}`,
          });
        }

        const ticket = yield* ticketing.getById({ id: ticketEntry.ticketId }).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationRunError({
                message: `Failed to resolve ticket ${ticketEntry.ticketId} for fresh-agent resume`,
                cause,
              }),
          ),
        );

        const shouldResumeCurrentTicket =
          input.run.currentTicketIndex >= 0 &&
          input.resolvedStartIndex === input.run.currentTicketIndex;
        const shouldResumeReviewPhase =
          shouldResumeCurrentTicket && input.run.currentPhase === "reviewing";

        if (shouldResumeReviewPhase && ticketEntry.reviewThreadId) {
          return {
            ticket,
            threadId: ticketEntry.reviewThreadId as ThreadId,
            phase: "reviewing" as const,
          };
        }

        if (shouldResumeReviewPhase && !ticketEntry.reviewThreadId) {
          yield* Effect.logWarning(
            formatTimelineLog(SCOPE, "runner.resume.fresh-agent.review-thread-missing", {
              runId: input.run.id,
              ticketId: ticket.id,
              ticketIdentifier: ticket.identifier,
              resolvedStartIndex: input.resolvedStartIndex,
            }),
          );
        }

        return {
          ticket,
          threadId: ticketEntry.workingThreadId as ThreadId,
          phase: "working" as const,
        };
      });

    const runChildTurn = (input: {
      readonly threadId: ThreadId;
      readonly dispatch: Effect.Effect<unknown, OrchestrationRunError | PromptRenderFailure>;
      readonly runId: OrchestrationRunId;
      readonly ticketId: Ticket["id"];
      readonly ticketIdentifier: Ticket["identifier"];
      readonly phase: "working" | "reviewing";
      readonly dispatchMode: string;
    }) =>
      Effect.gen(function* () {
        if (activeRunState) {
          activeRunState.activeChildThreadId = input.threadId;
        }

        const outcome: TurnOutcome = yield* Effect.scoped(
          Effect.gen(function* () {
            const completionFiber = yield* waitForTurnCompletion(input.threadId).pipe(
              Effect.forkScoped,
            );

            const dispatchExit = yield* Effect.exit(input.dispatch);
            if (dispatchExit._tag === "Failure") {
              yield* Fiber.interrupt(completionFiber);
              const dispatchFailure = Option.getOrNull(Cause.findErrorOption(dispatchExit.cause));
              return {
                result: "failed" as const,
                error:
                  dispatchFailure instanceof PromptRenderFailure
                    ? dispatchFailure.detail
                    : Schema.is(OrchestrationRunError)(dispatchFailure)
                      ? dispatchFailure.message
                      : "Failed to dispatch orchestration turn",
                ...(dispatchFailure instanceof PromptRenderFailure
                  ? { promptId: dispatchFailure.promptId }
                  : {}),
              };
            }

            yield* Effect.logInfo(
              formatTimelineLog(SCOPE, "runner.ticket.turn-dispatched", {
                runId: input.runId,
                ticketId: input.ticketId,
                ticketIdentifier: input.ticketIdentifier,
                threadId: input.threadId,
                phase: input.phase,
                dispatchMode: input.dispatchMode,
              }),
            );

            yield* Effect.logInfo(
              formatTimelineLog(SCOPE, "runner.ticket.awaiting-completion", {
                runId: input.runId,
                ticketId: input.ticketId,
                ticketIdentifier: input.ticketIdentifier,
                threadId: input.threadId,
                phase: input.phase,
              }),
            );

            return yield* Fiber.join(completionFiber);
          }),
        );

        if (activeRunState) {
          activeRunState.activeChildThreadId = null;
        }

        yield* Effect.logInfo(
          formatTimelineLog(SCOPE, "runner.ticket.turn-completed", {
            runId: input.runId,
            ticketId: input.ticketId,
            ticketIdentifier: input.ticketIdentifier,
            threadId: input.threadId,
            phase: input.phase,
            outcome: outcome.result,
            ...(outcome.result === "failed"
              ? {
                  error: outcome.error,
                  promptId: outcome.promptId ?? null,
                }
              : {}),
          }),
        );

        return outcome;
      });

    // ---------------------------------------------------------------------------
    // Sequential execution loop — extracted so both startRun and resumeRun
    // can invoke it.
    // ---------------------------------------------------------------------------

    /**
     * Run the sequential execution loop from `startIndex` through the ticket
     * plan. When `isResume` is true, the startup preamble (activity post,
     * title generation) is skipped because the run was already started.
     */
    const executeRunLoop = (
      runId: OrchestrationRunId,
      startIndex: number,
      options?: {
        readonly isResume?: boolean;
        readonly resumeCurrentTicketIndex?: number | null;
        readonly resumeMode?: OrchestrationResumeRunMode;
      },
    ) =>
      Effect.gen(function* () {
        const isResume = options?.isResume ?? false;
        const resumeCurrentTicketIndex = options?.resumeCurrentTicketIndex ?? null;
        const resumeMode = options?.resumeMode ?? "default";
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
            const shouldResumeExistingTicket =
              isResume &&
              resumeCurrentTicketIndex !== null &&
              index === startIndex &&
              index === resumeCurrentTicketIndex;
            const workingThread = yield* getThread(workingThreadId);
            if (!workingThread) {
              return yield* new OrchestrationRunError({
                message: `Working thread ${workingThreadId} for ticket ${ticket.identifier} was not found`,
              });
            }
            let reviewIteration = shouldResumeExistingTicket ? currentRun.reviewIteration : 0;
            let nextWorkMode: DispatchWorkTurnMode =
              shouldResumeExistingTicket && currentRun.currentPhase === "working"
                ? resumeMode === "fresh-agent"
                  ? "resumeFreshAgent"
                  : "resume"
                : "start";
            let pendingReviewFeedback: ReviewOutput | undefined;
            let pendingReviewedWorkingTurnCount: number | undefined;
            let resumeReviewTurn =
              shouldResumeExistingTicket && currentRun.currentPhase === "reviewing";
            const shouldRestartReviewWithFreshAgent =
              resumeReviewTurn && resumeMode === "fresh-agent";

            // 4c. Post ticket-started activity for fresh ticket dispatches only.
            if (!shouldResumeExistingTicket) {
              // Apply ticket-level model overrides if present
              if (ticket.implementerModelOverride) {
                yield* dispatchCommand(
                  {
                    type: "thread.meta.update",
                    commandId: runnerCommandId("ticket-implementer-model"),
                    threadId: workingThreadId,
                    modelSelection: ticket.implementerModelOverride as ModelSelection,
                  },
                  `Failed to apply implementer model override for ${ticket.identifier}`,
                );
              }
              if (ticket.reviewerModelOverride && entry.reviewThreadId) {
                yield* dispatchCommand(
                  {
                    type: "thread.meta.update",
                    commandId: runnerCommandId("ticket-reviewer-model"),
                    threadId: entry.reviewThreadId as ThreadId,
                    modelSelection: ticket.reviewerModelOverride as ModelSelection,
                  },
                  `Failed to apply reviewer model override for ${ticket.identifier}`,
                );
              }

              yield* postActivity({
                threadId: orchestrationThreadId,
                kind: "orchestration.run.ticket.started",
                summary: `Starting work on ticket ${ticket.identifier}: ${ticket.title}`,
                payload: {
                  ticketId: entry.ticketId,
                  ticketIdentifier: ticket.identifier,
                  workingThreadId,
                },
              });
            }

            while (true) {
              if (!resumeReviewTurn) {
                yield* withRunService((service) =>
                  service.updateRunProgress({
                    runId,
                    currentTicketIndex: index,
                    currentPhase: "working",
                    reviewIteration,
                  }),
                );

                yield* ticketing.update({ id: entry.ticketId, status: "in_progress" }).pipe(
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationRunError({
                        message: `Failed to update ticket ${ticket.identifier} status`,
                        cause,
                      }),
                  ),
                );

                const workOutcome = yield* runChildTurn({
                  threadId: workingThreadId,
                  dispatch: dispatchWorkTurn({
                    projectId: run.projectId,
                    workingThreadId,
                    ticket,
                    mode: nextWorkMode,
                    ...(pendingReviewFeedback ? { reviewFeedback: pendingReviewFeedback } : {}),
                  }),
                  runId,
                  ticketId: entry.ticketId,
                  ticketIdentifier: ticket.identifier,
                  phase: "working",
                  dispatchMode: nextWorkMode,
                });

                if (workOutcome.result === "failed") {
                  yield* ticketing
                    .update({ id: entry.ticketId, status: "blocked" })
                    .pipe(Effect.catch(() => Effect.void));
                  if (workOutcome.promptId) {
                    yield* pauseRunForPromptRenderFailure({
                      runId,
                      orchestrationThreadId,
                      ticketId: entry.ticketId,
                      ticketIdentifier: ticket.identifier,
                      promptId: workOutcome.promptId,
                      error: workOutcome.error ?? "unknown prompt render error",
                    });
                    return "blocked" as const;
                  }
                  yield* pauseRunWithReason(
                    runId,
                    orchestrationThreadId,
                    `Ticket ${ticket.identifier} failed: ${workOutcome.error ?? "unknown error"}`,
                  );
                  return "blocked" as const;
                }

                if (workOutcome.result === "interrupted") {
                  const latestRun = yield* withRunService((service) => service.get({ runId }));
                  if (latestRun.status !== "running") {
                    return "paused" as const;
                  }

                  yield* pauseRunWithReason(
                    runId,
                    orchestrationThreadId,
                    `Ticket ${ticket.identifier} was interrupted${workOutcome.reason ? `: ${workOutcome.reason}` : ""}`,
                  );
                  return "paused" as const;
                }

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

                if (currentRun.maxReviewIterations === 0) {
                  if (updatedTicket.status !== "done" && updatedTicket.status !== "canceled") {
                    yield* ticketing
                      .update({ id: entry.ticketId, status: "done" })
                      .pipe(Effect.catch(() => Effect.void));
                  }

                  yield* postActivity({
                    threadId: orchestrationThreadId,
                    kind: "orchestration.run.ticket.completed",
                    summary: `Completed ticket ${ticket.identifier}`,
                    payload: {
                      ticketId: entry.ticketId,
                      ticketIdentifier: ticket.identifier,
                      workingThreadId,
                    },
                  });

                  return "completed" as const;
                }

                yield* ticketing.update({ id: entry.ticketId, status: "in_review" }).pipe(
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationRunError({
                        message: `Failed to move ticket ${ticket.identifier} into review`,
                        cause,
                      }),
                  ),
                );
                const reviewThreadId = entry.reviewThreadId;
                if (!reviewThreadId) {
                  return yield* new OrchestrationRunError({
                    message: `Ticket ${ticket.identifier} is missing a review thread`,
                  });
                }
                yield* withRunService((service) =>
                  service.updateRunProgress({
                    runId,
                    currentTicketIndex: index,
                    currentPhase: "reviewing",
                    reviewIteration,
                  }),
                );
                yield* postActivity({
                  threadId: orchestrationThreadId,
                  kind: "orchestration.run.ticket.review.started",
                  summary: `Reviewing ticket ${ticket.identifier}`,
                  payload: {
                    ticketId: entry.ticketId,
                    ticketIdentifier: ticket.identifier,
                    workingThreadId,
                    reviewThreadId,
                    reviewIteration: reviewIteration + 1,
                  },
                });
              }

              const reviewThreadId = entry.reviewThreadId;
              if (!reviewThreadId) {
                return yield* new OrchestrationRunError({
                  message: `Ticket ${ticket.identifier} is missing a review thread`,
                });
              }
              yield* withRunService((service) =>
                service.updateRunProgress({
                  runId,
                  currentTicketIndex: index,
                  currentPhase: "reviewing",
                  reviewIteration,
                }),
              );

              const reviewModelSelection = yield* ensureReviewThreadModel({
                reviewThreadId,
                implementationModelSelection: workingThread.modelSelection,
              });
              let dispatchedReviewPromptId: "review" | "reReview" | null = null;

              const reviewOutcome = yield* runChildTurn({
                threadId: reviewThreadId,
                dispatch:
                  resumeReviewTurn && !shouldRestartReviewWithFreshAgent
                    ? getResolvedProjectPromptContext(run.projectId).pipe(
                        Effect.flatMap(({ project, prompts }) =>
                          renderValidatedPromptDocument({
                            promptId: "resume",
                            promptDocument: prompts.resume,
                            context: {
                              ticket,
                              project,
                            },
                          }).pipe(
                            Effect.flatMap((text) =>
                              dispatchThreadTurn({
                                threadId: reviewThreadId,
                                text,
                                modelSelection: reviewModelSelection,
                                promptId: "resume",
                                phase: "reviewing",
                                dispatchMode: "resume",
                              }),
                            ),
                          ),
                        ),
                        Effect.mapError((cause) =>
                          wrapDispatchError(
                            `Failed to resume review turn for ticket ${ticket.identifier}`,
                            cause,
                          ),
                        ),
                      )
                    : resolveReviewTurnPrompt({
                        projectId: run.projectId,
                        orchestrationThreadId,
                        ticket,
                        workingThreadId,
                        reviewIteration,
                        ...(pendingReviewFeedback || pendingReviewedWorkingTurnCount !== undefined
                          ? {
                              priorRequestedChangesReview: {
                                ...(pendingReviewFeedback
                                  ? { reviewSummary: pendingReviewFeedback.summary }
                                  : {}),
                                ...(pendingReviewedWorkingTurnCount !== undefined
                                  ? {
                                      reviewedWorkingTurnCount: pendingReviewedWorkingTurnCount,
                                    }
                                  : {}),
                              } satisfies PriorRequestedChangesReview,
                            }
                          : {}),
                      }).pipe(
                        Effect.tap(({ promptId }) =>
                          Effect.sync(() => {
                            dispatchedReviewPromptId = promptId;
                          }),
                        ),
                        Effect.flatMap(({ prompt, promptId }) =>
                          dispatchThreadTurn({
                            threadId: reviewThreadId,
                            text: prompt,
                            modelSelection: reviewModelSelection,
                            promptId,
                            phase: "reviewing",
                            dispatchMode: promptId,
                          }),
                        ),
                      ),
                runId,
                ticketId: entry.ticketId,
                ticketIdentifier: ticket.identifier,
                phase: "reviewing",
                dispatchMode:
                  resumeReviewTurn && !shouldRestartReviewWithFreshAgent
                    ? "resume"
                    : (dispatchedReviewPromptId ?? (reviewIteration >= 1 ? "reReview" : "review")),
              });

              resumeReviewTurn = false;
              pendingReviewFeedback = undefined;
              pendingReviewedWorkingTurnCount = undefined;

              if (reviewOutcome.result === "failed") {
                yield* ticketing
                  .update({ id: entry.ticketId, status: "blocked" })
                  .pipe(Effect.catch(() => Effect.void));
                if (reviewOutcome.promptId) {
                  yield* pauseRunForPromptRenderFailure({
                    runId,
                    orchestrationThreadId,
                    ticketId: entry.ticketId,
                    ticketIdentifier: ticket.identifier,
                    promptId: reviewOutcome.promptId,
                    error: reviewOutcome.error ?? "unknown prompt render error",
                  });
                  return "blocked" as const;
                }
                yield* pauseRunWithReason(
                  runId,
                  orchestrationThreadId,
                  `Review failed for ticket ${ticket.identifier}: ${reviewOutcome.error ?? "unknown error"}`,
                );
                return "blocked" as const;
              }

              if (reviewOutcome.result === "interrupted") {
                const latestRun = yield* withRunService((service) => service.get({ runId }));
                if (latestRun.status !== "running") {
                  return "paused" as const;
                }

                yield* pauseRunWithReason(
                  runId,
                  orchestrationThreadId,
                  `Review for ticket ${ticket.identifier} was interrupted${reviewOutcome.reason ? `: ${reviewOutcome.reason}` : ""}`,
                );
                return "paused" as const;
              }

              const reviewExit = yield* Effect.exit(
                parseReviewOutput({
                  threadId: reviewThreadId,
                  turnId: reviewOutcome.turnId,
                }),
              );
              if (reviewExit._tag === "Failure") {
                yield* Effect.logWarning(
                  formatTimelineLog(SCOPE, "runner.review-parse.failed", {
                    ticketIdentifier: ticket.identifier,
                    reviewThreadId,
                    reviewTurnId: reviewOutcome.turnId,
                    cause: Cause.pretty(reviewExit.cause),
                  }),
                );
                yield* ticketing
                  .update({ id: entry.ticketId, status: "blocked" })
                  .pipe(Effect.catch(() => Effect.void));
                yield* pauseRunWithReason(
                  runId,
                  orchestrationThreadId,
                  `Review output for ticket ${ticket.identifier} was invalid`,
                );
                return "blocked" as const;
              }
              const review = reviewExit.value;
              const reviewedWorkingTurnCount = yield* getCompletedTurnCount(workingThreadId);

              if (!review.changesNeeded) {
                yield* ticketing
                  .update({ id: entry.ticketId, status: "done" })
                  .pipe(Effect.catch(() => Effect.void));
                yield* postActivity({
                  threadId: orchestrationThreadId,
                  kind: "orchestration.run.ticket.review.approved",
                  summary: `Review approved ticket ${ticket.identifier}`,
                  payload: {
                    ticketId: entry.ticketId,
                    ticketIdentifier: ticket.identifier,
                    reviewThreadId,
                    workingThreadId,
                    reviewIteration: reviewIteration + 1,
                    reviewSummary: review.summary,
                    reviewedWorkingTurnCount,
                  },
                });
                yield* postActivity({
                  threadId: orchestrationThreadId,
                  kind: "orchestration.run.ticket.completed",
                  summary: `Completed ticket ${ticket.identifier}`,
                  payload: {
                    ticketId: entry.ticketId,
                    ticketIdentifier: ticket.identifier,
                    workingThreadId,
                    reviewThreadId,
                  },
                });
                return "completed" as const;
              }

              if (reviewIteration < currentRun.maxReviewIterations) {
                reviewIteration += 1;
                nextWorkMode = "feedback";
                pendingReviewFeedback = review;
                pendingReviewedWorkingTurnCount = reviewedWorkingTurnCount;
                yield* ticketing
                  .update({ id: entry.ticketId, status: "in_progress" })
                  .pipe(Effect.catch(() => Effect.void));
                yield* postActivity({
                  threadId: orchestrationThreadId,
                  kind: "orchestration.run.ticket.review.requested-changes",
                  summary: `Review requested changes for ticket ${ticket.identifier}`,
                  payload: {
                    ticketId: entry.ticketId,
                    ticketIdentifier: ticket.identifier,
                    workingThreadId,
                    reviewThreadId,
                    reviewIteration,
                    reviewSummary: review.summary,
                    reviewedWorkingTurnCount,
                  },
                });
                continue;
              }

              yield* ticketing
                .update({ id: entry.ticketId, status: "blocked" })
                .pipe(Effect.catch(() => Effect.void));
              yield* postActivity({
                threadId: orchestrationThreadId,
                kind: "orchestration.run.ticket.review.exhausted",
                summary: `Review budget exhausted for ticket ${ticket.identifier}`,
                tone: "error",
                payload: {
                  ticketId: entry.ticketId,
                  ticketIdentifier: ticket.identifier,
                  workingThreadId,
                  reviewThreadId,
                  reviewIteration,
                  reviewSummary: review.summary,
                  reviewedWorkingTurnCount,
                },
              });
              yield* pauseRunWithReason(
                runId,
                orchestrationThreadId,
                `Ticket ${ticket.identifier} still needs changes after exhausting the review budget`,
              );
              return "blocked" as const;
            }
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
        yield* finalizeCompletedRun(runId, orchestrationThreadId, ticketOrder.length);

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
      options?: {
        readonly isResume?: boolean;
        readonly resumeCurrentTicketIndex?: number | null;
        readonly resumeMode?: OrchestrationResumeRunMode;
      },
    ) =>
      Effect.gen(function* () {
        const fiber = yield* executeRunLoop(runId, startIndex, options).pipe(
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
          activeChildThreadId: null,
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
          {
            isResume: false,
            resumeCurrentTicketIndex: null,
          },
        );

        return run;
      });

    const pauseRun: OrchestrationRunRunnerShape["pauseRun"] = (input) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(formatTimelineLog(SCOPE, "runner.pause", { runId: input.runId }));

        const currentRun = yield* withRunService((service) => service.get(input));

        if (
          currentRun.status === "completed" ||
          currentRun.status === "canceled" ||
          currentRun.status === "failed"
        ) {
          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.pause.already-terminal", {
              runId: input.runId,
              status: currentRun.status,
            }),
          );
          return currentRun;
        }

        if (currentRun.status === "paused") {
          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.pause.already-paused", { runId: input.runId }),
          );
          return currentRun;
        }

        const resolvedIndex = yield* resolveNextActionableTicketIndex(currentRun);
        if (resolvedIndex >= currentRun.ticketOrder.length) {
          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.pause.finalizing-completed-run", {
              runId: input.runId,
              originalIndex: currentRun.currentTicketIndex,
              resolvedIndex,
            }),
          );
          return yield* finalizeCompletedRun(
            input.runId,
            currentRun.orchestrationThreadId as ThreadId,
            currentRun.ticketOrder.length,
          );
        }

        // Transition running → paused
        const run = yield* withRunService((runService) => runService.pause(input));

        // Interrupt active agent turn if one is running
        if (activeRunState?.runId === input.runId && activeRunState.activeChildThreadId) {
          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.pause.interrupting", {
              runId: input.runId,
              childThreadId: activeRunState.activeChildThreadId,
            }),
          );
          yield* interruptWorkingThread(activeRunState.activeChildThreadId);
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
        const resumeMode = input.mode ?? "default";
        yield* Effect.logInfo(
          formatTimelineLog(SCOPE, "runner.resume", { runId: input.runId, resumeMode }),
        );

        // Load run to check current state
        const currentRun = yield* withRunService((runService) => runService.get(input));

        // Idempotent: if already running, return as-is
        if (currentRun.status === "running") {
          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.resume.already-running", { runId: input.runId }),
          );
          return currentRun;
        }

        if (
          currentRun.status === "completed" ||
          currentRun.status === "canceled" ||
          currentRun.status === "failed"
        ) {
          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.resume.already-terminal", {
              runId: input.runId,
              status: currentRun.status,
            }),
          );
          return currentRun;
        }

        const resolvedStartIndex = yield* resolveNextActionableTicketIndex(currentRun);
        if (resolvedStartIndex >= currentRun.ticketOrder.length) {
          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.resume.nothing-left-to-run", {
              runId: input.runId,
              originalIndex: currentRun.currentTicketIndex,
              resolvedStartIndex,
            }),
          );
          return yield* finalizeCompletedRun(
            input.runId,
            currentRun.orchestrationThreadId as ThreadId,
            currentRun.ticketOrder.length,
          );
        }

        const freshAgentTarget =
          resumeMode === "fresh-agent"
            ? yield* resolveFreshAgentResumeTarget({
                run: currentRun,
                resolvedStartIndex,
              })
            : null;

        if (freshAgentTarget) {
          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "runner.resume.fresh-agent.restart", {
              runId: input.runId,
              resolvedStartIndex,
              ticketId: freshAgentTarget.ticket.id,
              ticketIdentifier: freshAgentTarget.ticket.identifier,
              phase: freshAgentTarget.phase,
              threadId: freshAgentTarget.threadId,
            }),
          );
          yield* interruptWorkingThread(freshAgentTarget.threadId);
          yield* stopWorkingThread(freshAgentTarget.threadId);
        }

        // Transition paused → running
        const run = yield* withRunService((runService) => runService.resume(input));
        const orchestrationThreadId = run.orchestrationThreadId as ThreadId;

        // Post resume activity
        yield* postActivity({
          threadId: orchestrationThreadId,
          kind: "orchestration.run.resumed",
          summary: freshAgentTarget
            ? `Resumed ${freshAgentTarget.ticket.identifier} with fresh agent`
            : "Orchestration resumed",
          ...(freshAgentTarget
            ? {
                payload: {
                  resumeMode,
                  ticketId: freshAgentTarget.ticket.id,
                  ticketIdentifier: freshAgentTarget.ticket.identifier,
                  phase: freshAgentTarget.phase,
                  restartedThreadId: freshAgentTarget.threadId,
                },
              }
            : {}),
        }).pipe(Effect.catch(() => Effect.void));

        yield* Effect.logInfo(
          formatTimelineLog(SCOPE, "runner.resume.resolved-start", {
            runId: input.runId,
            originalIndex: currentRun.currentTicketIndex,
            resolvedStartIndex,
          }),
        );

        const shouldResumeCurrentTicket =
          currentRun.currentTicketIndex >= 0 &&
          resolvedStartIndex === currentRun.currentTicketIndex;

        // Fork a new execution loop from the resolved index
        yield* forkExecutionLoop(input.runId, orchestrationThreadId, resolvedStartIndex, {
          isResume: true,
          resumeCurrentTicketIndex: shouldResumeCurrentTicket ? resolvedStartIndex : null,
          resumeMode,
        });

        return run;
      });

    const cancelRun: OrchestrationRunRunnerShape["cancelRun"] = (input) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(formatTimelineLog(SCOPE, "runner.cancel", { runId: input.runId }));

        // Transition running/paused → canceled
        const run = yield* withRunService((runService) => runService.cancel(input));

        // Interrupt active agent turn and stop session if running
        if (activeRunState?.runId === input.runId && activeRunState.activeChildThreadId) {
          const workingThreadId = activeRunState.activeChildThreadId;
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
              activeChildThreadId: currentActiveRunState.activeChildThreadId,
            }),
          );

          // Interrupt the active agent turn (may be same or different thread)
          if (currentActiveRunState.activeChildThreadId) {
            yield* interruptWorkingThread(currentActiveRunState.activeChildThreadId);
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
  const providerService = yield* ProviderService;
  yield* ProviderRateLimitsCache;
  const checkpointDiffQuery = yield* CheckpointDiffQuery;
  const ticketing = yield* TicketingService;
  const startup = yield* ServerRuntimeStartup;
  const serverSettings = yield* ServerSettingsService;

  return yield* makeOrchestrationRunRunnerFromDeps({
    runService,
    orchestrationEngine,
    providerService,
    checkpointDiffQuery,
    ticketing,
    startup,
    serverSettings,
  });
});

export const OrchestrationRunRunnerLive = Layer.effect(
  OrchestrationRunRunner,
  makeOrchestrationRunRunner,
);
