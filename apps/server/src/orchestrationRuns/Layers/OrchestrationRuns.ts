import type {
  CommandId,
  OrchestrationCommand,
  OrchestrationPromptOverrides,
  OrchestrationRun,
  OrchestrationRunStatus,
  OrchestrationRunSummary,
  OrchestrationTicketEntry,
  Ticket,
  ThreadId,
} from "@t3tools/contracts";
import { OrchestrationRunError, TicketId as TicketIdSchema } from "@t3tools/contracts";
import { Effect, Layer, Option, PubSub, Stream } from "effect";
import { buildOrchestrationPlan, flattenTicketTree } from "@t3tools/shared/orchestrationPlan";
import { formatTimelineLog } from "@t3tools/shared/timeline";

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  OrchestrationRunRepository,
  type OrchestrationRunRepositoryShape,
  type PersistedOrchestrationRun,
} from "../../persistence/Services/OrchestrationRuns.ts";
import {
  ProjectionThreadRepository,
  type ProjectionThreadRepositoryShape,
} from "../../persistence/Services/ProjectionThreads.ts";
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
import { ServerSettingsService, type ServerSettingsShape } from "../../serverSettings.ts";

const SCOPE = "server.orchestration-runs";

const VALID_TRANSITIONS: Record<OrchestrationRunStatus, Set<OrchestrationRunStatus>> = {
  pending: new Set(["running", "canceled"]),
  running: new Set(["paused", "completed", "canceled", "failed"]),
  paused: new Set(["running", "completed", "canceled"]),
  completed: new Set(),
  canceled: new Set(),
  failed: new Set(),
};

function parsePromptOverrides(json: string | null): OrchestrationPromptOverrides {
  if (!json) return {};
  try {
    return JSON.parse(json) as OrchestrationPromptOverrides;
  } catch {
    return {};
  }
}

function toRun(persisted: PersistedOrchestrationRun): OrchestrationRun {
  return {
    id: persisted.id,
    orchestrationThreadId: persisted.orchestrationThreadId,
    projectId: persisted.projectId,
    status: persisted.status,
    ticketOrder: JSON.parse(persisted.ticketOrderJson) as Array<OrchestrationTicketEntry>,
    currentTicketIndex: persisted.currentTicketIndex,
    currentPhase: persisted.currentPhase,
    reviewIteration: persisted.reviewIteration,
    maxReviewIterations: persisted.maxReviewIterations,
    promptOverrides: parsePromptOverrides(persisted.promptOverridesJson),
    createdAt: persisted.createdAt,
    updatedAt: persisted.updatedAt,
  };
}

function toSummary(persisted: PersistedOrchestrationRun): OrchestrationRunSummary {
  const ticketOrder = JSON.parse(persisted.ticketOrderJson) as Array<OrchestrationTicketEntry>;
  return {
    id: persisted.id,
    orchestrationThreadId: persisted.orchestrationThreadId,
    projectId: persisted.projectId,
    status: persisted.status,
    currentTicketIndex: persisted.currentTicketIndex,
    ticketCount: ticketOrder.length,
    currentPhase: persisted.currentPhase,
    promptOverrides: parsePromptOverrides(persisted.promptOverridesJson),
    createdAt: persisted.createdAt,
    updatedAt: persisted.updatedAt,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const compareIsoDateThenId = <T extends { createdAt: string; id: string }>(left: T, right: T) =>
  left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);

interface OrchestrationRunServiceDeps {
  readonly repo: OrchestrationRunRepositoryShape;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly projectionThreadRepo: ProjectionThreadRepositoryShape;
  readonly ticketing: TicketingServiceShape;
  readonly startup: ServerRuntimeStartupShape;
  readonly serverSettings: ServerSettingsShape;
}

export const makeOrchestrationRunServiceFromDeps = (deps: OrchestrationRunServiceDeps) =>
  Effect.gen(function* () {
    const { repo, orchestrationEngine, projectionThreadRepo, ticketing, startup, serverSettings } =
      deps;

    const eventsPubSub =
      yield* PubSub.unbounded<import("@t3tools/contracts").OrchestrationRunStreamEvent>();

    const resolveTicketForProject = (projectId: string, ticketIdentifierOrId: string) =>
      Effect.gen(function* () {
        const ticket = yield* (
          UUID_RE.test(ticketIdentifierOrId)
            ? ticketing.getById({ id: TicketIdSchema.makeUnsafe(ticketIdentifierOrId) })
            : ticketing.getByIdentifier({
                identifier: ticketIdentifierOrId,
                projectId: projectId as never,
              })
        ).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationRunError({
                message: `Failed to resolve ticket '${ticketIdentifierOrId}'`,
                cause,
              }),
          ),
        );

        if (ticket.projectId !== projectId) {
          yield* Effect.logWarning(
            formatTimelineLog(SCOPE, "run.resolve-ticket.failed", {
              ticketIdentifierOrId,
              projectId,
              reason: "ticket belongs to different project",
            }),
          );
          return yield* new OrchestrationRunError({
            message: `Ticket '${ticketIdentifierOrId}' does not belong to project ${projectId}`,
          });
        }

        return ticket;
      });

    const dispatchQueuedCommand = (command: OrchestrationCommand, message: string) =>
      startup.enqueueCommand(orchestrationEngine.dispatch(command)).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationRunError({
              message,
              cause,
            }),
        ),
      );

    const cleanupFailedCreate = (
      runId: import("@t3tools/contracts").OrchestrationRunId,
      createdThreadIds: ReadonlyArray<ThreadId>,
    ) =>
      Effect.gen(function* () {
        yield* Effect.logWarning(
          formatTimelineLog(SCOPE, "run.create.cleanup-started", {
            runId,
            createdThreadCount: createdThreadIds.length,
          }),
        );
        for (const threadId of createdThreadIds.toReversed()) {
          yield* dispatchQueuedCommand(
            {
              type: "thread.delete",
              commandId: crypto.randomUUID() as CommandId,
              threadId,
            },
            `Failed to delete partially created thread ${threadId}`,
          ).pipe(Effect.catch(() => Effect.void));
        }

        yield* repo.deleteById({ runId }).pipe(Effect.catch(() => Effect.void));
      });

    const create: OrchestrationRunServiceShape["create"] = (input) =>
      Effect.gen(function* () {
        const now = new Date().toISOString();

        yield* Effect.logInfo(
          formatTimelineLog(SCOPE, "run.create.start", {
            projectId: input.projectId,
            selectedTicketCount: input.selectedTicketIdentifiers.length,
            selectedTicketIdentifiers: input.selectedTicketIdentifiers,
          }),
        );

        const selectedTickets: Ticket[] = [];
        for (const identifier of input.selectedTicketIdentifiers) {
          selectedTickets.push(yield* resolveTicketForProject(input.projectId, identifier));
        }

        const ticketTree = yield* ticketing.getTree({ projectId: input.projectId as never }).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationRunError({
                message: "Failed to load project ticket tree for orchestration run creation",
                cause,
              }),
          ),
        );
        const plan = buildOrchestrationPlan(
          new Set(selectedTickets.map((ticket) => ticket.id)),
          ticketTree,
          flattenTicketTree(ticketTree),
        );

        if (plan.kind === "blocked-external") {
          const first = plan.externalDeps[0];
          return yield* new OrchestrationRunError({
            message: first
              ? `Cannot orchestrate ${first.ticket.identifier} because it depends on unfinished ticket ${first.dependsOn.identifier}`
              : "Cannot orchestrate because there are unfinished external dependencies",
          });
        }

        if (plan.kind === "blocked-cycle") {
          return yield* new OrchestrationRunError({
            message: "Cannot orchestrate because the selected tickets contain a dependency cycle",
          });
        }

        const selectedTicketById = new Map(
          selectedTickets.map((ticket) => [ticket.id, ticket] as const),
        );
        const executionTickets: Array<{ ticket: Ticket; selectedTicketId: Ticket["id"] }> = [];
        for (const entry of plan.orderedTickets) {
          const ticket =
            selectedTicketById.get(entry.ticket.id) ??
            (yield* ticketing.getById({ id: entry.ticket.id }).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationRunError({
                    message: `Failed to load execution ticket ${entry.ticket.identifier}`,
                    cause,
                  }),
              ),
            ));
          executionTickets.push({
            ticket,
            selectedTicketId: entry.selectedTicketId,
          });
        }

        const settings = yield* serverSettings.getSettings.pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationRunError({
                message: "Failed to load server settings for orchestration run creation",
                cause,
              }),
          ),
        );
        const effectiveMaxReviewIterations =
          input.maxReviewIterations ?? settings.maxReviewIterations;
        const reviewEnabled = effectiveMaxReviewIterations > 0;
        const runtimeMode = input.runtimeMode ?? "full-access";
        const runId = crypto.randomUUID() as import("@t3tools/contracts").OrchestrationRunId;
        const orchestrationThreadId = crypto.randomUUID() as ThreadId;
        const workingThreadIds = executionTickets.map(() => crypto.randomUUID() as ThreadId);
        const reviewThreadIds = reviewEnabled
          ? executionTickets.map(() => crypto.randomUUID() as ThreadId)
          : executionTickets.map(() => undefined);
        const ticketOrder: OrchestrationTicketEntry[] = executionTickets.map(
          ({ ticket, selectedTicketId }, index) => ({
            ticketId: ticket.id,
            selectedTicketId,
            workingThreadId: workingThreadIds[index]!,
            ...(reviewThreadIds[index] ? { reviewThreadId: reviewThreadIds[index]! } : {}),
          }),
        );
        const selectedTicketTitleById = new Map(
          selectedTickets.map((ticket) => [ticket.id, ticket.title] as const),
        );
        const initialSelectedTicketId =
          ticketOrder[0]?.selectedTicketId ?? ticketOrder[0]?.ticketId ?? null;
        const orchestrationTitle =
          (initialSelectedTicketId ? selectedTicketTitleById.get(initialSelectedTicketId) : null) ??
          selectedTickets[0]?.title ??
          "Orchestration Run";
        const promptOverrides = input.promptOverrides ?? {};
        const hasOverrides = Object.keys(promptOverrides).length > 0;
        const persisted: PersistedOrchestrationRun = {
          id: runId,
          orchestrationThreadId,
          projectId: input.projectId,
          status: "pending",
          ticketOrderJson: JSON.stringify(ticketOrder),
          currentTicketIndex: -1 as const,
          currentPhase: "working",
          reviewIteration: 0 as const,
          maxReviewIterations: effectiveMaxReviewIterations,
          promptOverridesJson: hasOverrides ? JSON.stringify(promptOverrides) : null,
          createdAt: now,
          updatedAt: now,
        };

        yield* repo.create(persisted).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationRunError({
                message: "Failed to insert orchestration run",
                cause,
              }),
          ),
        );

        const createdThreadIds: ThreadId[] = [];

        const createThreads = Effect.gen(function* () {
          yield* dispatchQueuedCommand(
            {
              type: "thread.create",
              commandId: crypto.randomUUID() as CommandId,
              threadId: orchestrationThreadId,
              projectId: input.projectId,
              title: orchestrationTitle as any,
              modelSelection: input.implementerModelSelection,
              runtimeMode,
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              isOrchestrationThread: true,
              createdAt: now,
            },
            "Failed to create orchestration thread",
          );
          createdThreadIds.push(orchestrationThreadId);

          for (const [index, { ticket }] of executionTickets.entries()) {
            const workingThreadId = workingThreadIds[index]!;
            const reviewThreadId = reviewThreadIds[index];
            yield* dispatchQueuedCommand(
              {
                type: "thread.create",
                commandId: crypto.randomUUID() as CommandId,
                threadId: workingThreadId,
                projectId: input.projectId,
                title: ticket.title,
                modelSelection: input.implementerModelSelection,
                runtimeMode,
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                parentThreadId: orchestrationThreadId,
                ticketId: ticket.id,
                createdAt: now,
              },
              `Failed to create working thread for ticket ${ticket.identifier}`,
            );
            createdThreadIds.push(workingThreadId);

            if (!reviewThreadId) {
              continue;
            }

            yield* dispatchQueuedCommand(
              {
                type: "thread.create",
                commandId: crypto.randomUUID() as CommandId,
                threadId: reviewThreadId,
                projectId: input.projectId,
                title: `${ticket.title} Review`,
                modelSelection: input.reviewerModelSelection,
                runtimeMode,
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                parentThreadId: orchestrationThreadId,
                ticketId: ticket.id,
                createdAt: now,
              },
              `Failed to create review thread for ticket ${ticket.identifier}`,
            );
            createdThreadIds.push(reviewThreadId);
          }
        });

        yield* createThreads.pipe(
          Effect.onError(() => cleanupFailedCreate(runId, createdThreadIds)),
        );

        yield* Effect.logInfo(
          formatTimelineLog(SCOPE, "run.create.threads-created", {
            runId,
            orchestrationThreadId,
            workingThreadIds,
            ticketCount: executionTickets.length,
          }),
        );

        // Publish stream event
        yield* PubSub.publish(eventsPubSub, {
          type: "run.created" as const,
          projectId: input.projectId,
          run: toRun(persisted),
        });

        yield* Effect.logInfo(
          formatTimelineLog(SCOPE, "run.create.completed", {
            runId,
            orchestrationThreadId,
            status: "pending",
            ticketCount: executionTickets.length,
          }),
        );

        return {
          runId,
          orchestrationThreadId,
          workingThreadIds,
        };
      });

    const get: OrchestrationRunServiceShape["get"] = (input) =>
      Effect.gen(function* () {
        const row = yield* repo.getById({ runId: input.runId }).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationRunError({
                message: "Failed to load orchestration run",
                cause,
              }),
          ),
        );
        const found = Option.isSome(row);
        yield* Effect.logInfo(formatTimelineLog(SCOPE, "run.get", { runId: input.runId, found }));
        if (!found) {
          return yield* new OrchestrationRunError({
            message: `Orchestration run not found: ${input.runId}`,
          });
        }
        return toRun(row.value);
      });

    const list: OrchestrationRunServiceShape["list"] = (input) =>
      repo
        .listByProject({
          projectId: input.projectId,
          ...(input.status ? { status: input.status } : {}),
        })
        .pipe(
          Effect.map((rows) => rows.map(toSummary)),
          Effect.tap((summaries) =>
            Effect.logInfo(
              formatTimelineLog(SCOPE, "run.list", {
                projectId: input.projectId,
                count: summaries.length,
              }),
            ),
          ),
          Effect.mapError(
            (cause) =>
              new OrchestrationRunError({
                message: "Failed to list orchestration runs",
                cause,
              }),
          ),
        );

    const getChildThreads: OrchestrationRunServiceShape["getChildThreads"] = (input) =>
      Effect.gen(function* () {
        const readModel = yield* orchestrationEngine.getReadModel();
        const persistedChildren = yield* projectionThreadRepo
          .listByParentThreadId({ parentThreadId: input.parentThreadId })
          .pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationRunError({
                  message: "Failed to load child threads",
                  cause,
                }),
            ),
          );
        const childThreadIds = new Set(persistedChildren.map((thread) => thread.threadId));
        const childThreads = readModel.threads.filter((thread) => childThreadIds.has(thread.id));
        const threadById = new Map(childThreads.map((thread) => [thread.id, thread] as const));

        const run = yield* repo
          .getByOrchestrationThreadId({
            orchestrationThreadId: input.parentThreadId,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationRunError({
                  message: "Failed to load orchestration run for child threads",
                  cause,
                }),
            ),
          );
        if (Option.isNone(run)) {
          const result = persistedChildren
            .map((thread) => threadById.get(thread.threadId))
            .filter((thread): thread is NonNullable<typeof thread> => thread !== undefined)
            .toSorted(compareIsoDateThenId);
          yield* Effect.logInfo(
            formatTimelineLog(SCOPE, "run.child-threads", {
              parentThreadId: input.parentThreadId,
              count: result.length,
            }),
          );
          return result;
        }

        const ticketOrder = JSON.parse(
          run.value.ticketOrderJson,
        ) as Array<OrchestrationTicketEntry>;
        const orderedIds = new Set(
          ticketOrder.flatMap((entry) =>
            entry.reviewThreadId !== undefined
              ? [entry.workingThreadId, entry.reviewThreadId]
              : [entry.workingThreadId],
          ),
        );
        const orderedChildren = ticketOrder
          .flatMap((entry) =>
            entry.reviewThreadId !== undefined
              ? [threadById.get(entry.workingThreadId), threadById.get(entry.reviewThreadId)]
              : [threadById.get(entry.workingThreadId)],
          )
          .filter((thread): thread is NonNullable<typeof thread> => thread !== undefined);
        const extraChildren = childThreads
          .filter((thread) => !orderedIds.has(thread.id))
          .toSorted(compareIsoDateThenId);

        const result = [...orderedChildren, ...extraChildren];
        yield* Effect.logInfo(
          formatTimelineLog(SCOPE, "run.child-threads", {
            parentThreadId: input.parentThreadId,
            count: result.length,
          }),
        );
        return result;
      });

    const transitionStatus = (
      runId: import("@t3tools/contracts").OrchestrationRunId,
      targetStatus: OrchestrationRunStatus,
    ) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(
          formatTimelineLog(SCOPE, "run.transition.start", { runId, to: targetStatus }),
        );

        const row = yield* repo.getById({ runId }).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationRunError({
                message: "Failed to load orchestration run",
                cause,
              }),
          ),
        );
        if (Option.isNone(row)) {
          yield* Effect.logWarning(
            formatTimelineLog(SCOPE, "run.transition.not-found", { runId, to: targetStatus }),
          );
          return yield* new OrchestrationRunError({
            message: `Orchestration run not found: ${runId}`,
          });
        }

        const current = row.value;
        const allowed = VALID_TRANSITIONS[current.status];
        if (!allowed?.has(targetStatus)) {
          yield* Effect.logWarning(
            formatTimelineLog(SCOPE, "run.transition.rejected", {
              runId,
              from: current.status,
              to: targetStatus,
              reason: "invalid transition",
            }),
          );
          return yield* new OrchestrationRunError({
            message: `Invalid status transition: ${current.status} → ${targetStatus}`,
          });
        }

        const now = new Date().toISOString();
        const updated: PersistedOrchestrationRun = {
          ...current,
          status: targetStatus,
          updatedAt: now,
        };

        yield* repo.update(updated).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationRunError({
                message: "Failed to update orchestration run",
                cause,
              }),
          ),
        );

        const run = toRun(updated);

        yield* PubSub.publish(eventsPubSub, {
          type: "run.updated" as const,
          projectId: current.projectId,
          run,
        });

        yield* Effect.logInfo(
          formatTimelineLog(SCOPE, "run.transition.completed", {
            runId,
            from: current.status,
            to: targetStatus,
            updatedAt: now,
          }),
        );

        return run;
      });

    const pause: OrchestrationRunServiceShape["pause"] = (input) =>
      transitionStatus(input.runId, "paused");

    const resume: OrchestrationRunServiceShape["resume"] = (input) =>
      transitionStatus(input.runId, "running");

    const cancel: OrchestrationRunServiceShape["cancel"] = (input) =>
      transitionStatus(input.runId, "canceled");

    const start: OrchestrationRunServiceShape["start"] = (input) =>
      transitionStatus(input.runId, "running");

    const complete: OrchestrationRunServiceShape["complete"] = (input) =>
      transitionStatus(input.runId, "completed");

    const fail: OrchestrationRunServiceShape["fail"] = (input) =>
      transitionStatus(input.runId, "failed");

    const updateRunProgress: OrchestrationRunServiceShape["updateRunProgress"] = (input) =>
      Effect.gen(function* () {
        const row = yield* repo.getById({ runId: input.runId }).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationRunError({
                message: "Failed to load orchestration run",
                cause,
              }),
          ),
        );
        if (Option.isNone(row)) {
          return yield* new OrchestrationRunError({
            message: `Orchestration run not found: ${input.runId}`,
          });
        }

        const current = row.value;
        if (current.status !== "running") {
          yield* Effect.logWarning(
            formatTimelineLog(SCOPE, "run.progress.rejected", {
              runId: input.runId,
              status: current.status,
              reason: "not running",
            }),
          );
          return yield* new OrchestrationRunError({
            message: `Cannot update progress of run in '${current.status}' status`,
          });
        }

        const now = new Date().toISOString();
        const updated: PersistedOrchestrationRun = {
          ...current,
          currentTicketIndex: input.currentTicketIndex,
          ...(input.currentPhase !== undefined ? { currentPhase: input.currentPhase } : {}),
          ...(input.reviewIteration !== undefined
            ? { reviewIteration: input.reviewIteration }
            : {}),
          updatedAt: now,
        };

        yield* repo.update(updated).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationRunError({
                message: "Failed to update orchestration run progress",
                cause,
              }),
          ),
        );

        const run = toRun(updated);

        yield* PubSub.publish(eventsPubSub, {
          type: "run.updated" as const,
          projectId: current.projectId,
          run,
        });

        yield* Effect.logInfo(
          formatTimelineLog(SCOPE, "run.progress.updated", {
            runId: input.runId,
            previousIndex: current.currentTicketIndex,
            currentTicketIndex: input.currentTicketIndex,
            currentPhase: input.currentPhase ?? current.currentPhase,
            reviewIteration: input.reviewIteration ?? current.reviewIteration,
          }),
        );

        return run;
      });

    const streamEvents: OrchestrationRunServiceShape["streamEvents"] = (projectId) =>
      Stream.fromPubSub(eventsPubSub).pipe(Stream.filter((event) => event.projectId === projectId));

    return {
      create,
      get,
      list,
      getChildThreads,
      pause,
      resume,
      cancel,
      start,
      complete,
      fail,
      updateRunProgress,
      streamEvents,
    } satisfies OrchestrationRunServiceShape;
  });

export const makeOrchestrationRunService = Effect.gen(function* () {
  const repo = yield* OrchestrationRunRepository;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionThreadRepo = yield* ProjectionThreadRepository;
  const ticketing = yield* TicketingService;
  const startup = yield* ServerRuntimeStartup;
  const serverSettings = yield* ServerSettingsService;

  return yield* makeOrchestrationRunServiceFromDeps({
    repo,
    orchestrationEngine,
    projectionThreadRepo,
    ticketing,
    startup,
    serverSettings,
  });
});

export const OrchestrationRunServiceLive = Layer.effect(
  OrchestrationRunService,
  makeOrchestrationRunService,
);
