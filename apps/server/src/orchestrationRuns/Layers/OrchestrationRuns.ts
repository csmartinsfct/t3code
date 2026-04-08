import type {
  CommandId,
  OrchestrationCommand,
  OrchestrationRun,
  OrchestrationRunStatus,
  OrchestrationRunSummary,
  OrchestrationTicketEntry,
  Ticket,
  ThreadId,
} from "@t3tools/contracts";
import { OrchestrationRunError, TicketId as TicketIdSchema } from "@t3tools/contracts";
import { Effect, Layer, Option, PubSub, Stream } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  OrchestrationRunRepository,
  type PersistedOrchestrationRun,
} from "../../persistence/Services/OrchestrationRuns.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { ServerRuntimeStartup } from "../../serverRuntimeStartup.ts";
import { TicketingService } from "../../ticketing/Services/Ticketing.ts";
import {
  OrchestrationRunService,
  type OrchestrationRunServiceShape,
} from "../Services/OrchestrationRuns.ts";

const VALID_TRANSITIONS: Record<OrchestrationRunStatus, Set<OrchestrationRunStatus>> = {
  pending: new Set(["running", "canceled"]),
  running: new Set(["paused", "completed", "canceled", "failed"]),
  paused: new Set(["running", "canceled"]),
  completed: new Set(),
  canceled: new Set(),
  failed: new Set(),
};

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
    createdAt: persisted.createdAt,
    updatedAt: persisted.updatedAt,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const compareIsoDateThenId = <T extends { createdAt: string; id: string }>(left: T, right: T) =>
  left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);

const makeOrchestrationRunService = Effect.gen(function* () {
  const repo = yield* OrchestrationRunRepository;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionThreadRepo = yield* ProjectionThreadRepository;
  const ticketing = yield* TicketingService;
  const startup = yield* ServerRuntimeStartup;

  const eventsPubSub =
    yield* PubSub.unbounded<import("@t3tools/contracts").OrchestrationRunStreamEvent>();

  const resolveTicketForProject = (projectId: string, ticketIdentifierOrId: string) =>
    Effect.gen(function* () {
      const ticket = yield* (
        UUID_RE.test(ticketIdentifierOrId)
          ? ticketing.getById({ id: TicketIdSchema.makeUnsafe(ticketIdentifierOrId) })
          : ticketing.getByIdentifier({ identifier: ticketIdentifierOrId })
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

      // Resolve ticket identifiers to UUIDs
      const tickets: Ticket[] = [];
      for (const identifier of input.ticketIdentifiers) {
        tickets.push(yield* resolveTicketForProject(input.projectId, identifier));
      }

      const runtimeMode = input.runtimeMode ?? "full-access";
      const runId = crypto.randomUUID() as import("@t3tools/contracts").OrchestrationRunId;
      const orchestrationThreadId = crypto.randomUUID() as ThreadId;
      const workingThreadIds = tickets.map(() => crypto.randomUUID() as ThreadId);
      const ticketOrder: OrchestrationTicketEntry[] = tickets.map((ticket, index) => ({
        ticketId: ticket.id,
        workingThreadId: workingThreadIds[index]!,
      }));
      const persisted: PersistedOrchestrationRun = {
        id: runId,
        orchestrationThreadId,
        projectId: input.projectId,
        status: "pending",
        ticketOrderJson: JSON.stringify(ticketOrder),
        currentTicketIndex: -1 as const,
        currentPhase: "working",
        reviewIteration: 0 as const,
        maxReviewIterations: input.maxReviewIterations ?? 1,
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
            title: "Orchestration Run" as any,
            modelSelection: input.modelSelection,
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

        for (const [index, ticket] of tickets.entries()) {
          const workingThreadId = workingThreadIds[index]!;
          yield* dispatchQueuedCommand(
            {
              type: "thread.create",
              commandId: crypto.randomUUID() as CommandId,
              threadId: workingThreadId,
              projectId: input.projectId,
              title: ticket.title,
              modelSelection: input.modelSelection,
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
        }
      });

      yield* createThreads.pipe(Effect.onError(() => cleanupFailedCreate(runId, createdThreadIds)));

      // Publish stream event
      yield* PubSub.publish(eventsPubSub, {
        type: "run.created" as const,
        projectId: input.projectId,
        run: toRun(persisted),
      });

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
      if (Option.isNone(row)) {
        return yield* new OrchestrationRunError({
          message: `Orchestration run not found: ${input.runId}`,
        });
      }
      return toRun(row.value);
    });

  const list: OrchestrationRunServiceShape["list"] = (input) =>
    repo.listByProject({ projectId: input.projectId }).pipe(
      Effect.map((rows) => rows.map(toSummary)),
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
        return persistedChildren
          .map((thread) => threadById.get(thread.threadId))
          .filter((thread): thread is NonNullable<typeof thread> => thread !== undefined)
          .toSorted(compareIsoDateThenId);
      }

      const ticketOrder = JSON.parse(run.value.ticketOrderJson) as Array<OrchestrationTicketEntry>;
      const orderedIds = new Set(ticketOrder.map((entry) => entry.workingThreadId));
      const orderedChildren = ticketOrder
        .map((entry) => threadById.get(entry.workingThreadId))
        .filter((thread): thread is NonNullable<typeof thread> => thread !== undefined);
      const extraChildren = childThreads
        .filter((thread) => !orderedIds.has(thread.id))
        .toSorted(compareIsoDateThenId);

      return [...orderedChildren, ...extraChildren];
    });

  const transitionStatus = (
    runId: import("@t3tools/contracts").OrchestrationRunId,
    targetStatus: OrchestrationRunStatus,
  ) =>
    Effect.gen(function* () {
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
        return yield* new OrchestrationRunError({
          message: `Orchestration run not found: ${runId}`,
        });
      }

      const current = row.value;
      const allowed = VALID_TRANSITIONS[current.status];
      if (!allowed?.has(targetStatus)) {
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

      return run;
    });

  const pause: OrchestrationRunServiceShape["pause"] = (input) =>
    transitionStatus(input.runId, "paused");

  const resume: OrchestrationRunServiceShape["resume"] = (input) =>
    transitionStatus(input.runId, "running");

  const cancel: OrchestrationRunServiceShape["cancel"] = (input) =>
    transitionStatus(input.runId, "canceled");

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
    streamEvents,
  } satisfies OrchestrationRunServiceShape;
});

export const OrchestrationRunServiceLive = Layer.effect(
  OrchestrationRunService,
  makeOrchestrationRunService,
);
