import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type OrchestrationCommand,
  OrchestrationRunId,
  ProjectId,
  ThreadId,
  TicketId,
  type Ticket,
  type TicketDependency,
  type TicketTreeNode,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  OrchestrationCommandInvariantError,
  type OrchestrationDispatchError,
} from "../../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  OrchestrationRunRepository,
  type OrchestrationRunRepositoryShape,
  type PersistedOrchestrationRun,
} from "../../persistence/Services/OrchestrationRuns.ts";
import {
  ProjectionThreadRepository,
  type ProjectionThreadRepositoryShape,
} from "../../persistence/Services/ProjectionThreads.ts";
import { ServerRuntimeStartup } from "../../serverRuntimeStartup.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  TicketingService,
  type TicketingServiceShape,
} from "../../ticketing/Services/Ticketing.ts";
import {
  OrchestrationRunService,
  type OrchestrationRunServiceShape,
} from "../Services/OrchestrationRuns.ts";
import { OrchestrationRunServiceLive } from "./OrchestrationRuns.ts";

const projectId = ProjectId.makeUnsafe("project-orchestration");
const otherProjectId = ProjectId.makeUnsafe("project-other");
const parentThreadId = ThreadId.makeUnsafe("thread-parent");
const childThreadOneId = ThreadId.makeUnsafe("thread-child-1");
const childThreadTwoId = ThreadId.makeUnsafe("thread-child-2");

const baseModelSelection = {
  provider: "codex",
  model: "gpt-5-codex",
} as const;

const makeTicket = (
  overrides: Omit<Partial<Ticket>, "id" | "identifier" | "title" | "projectId"> & {
    id: string;
    identifier: string;
    title: string;
    projectId?: string;
  },
): Ticket => {
  const { id, identifier, title, projectId: ticketProjectId, ...rest } = overrides;

  return {
    id: TicketId.makeUnsafe(id),
    projectId: ProjectId.makeUnsafe(ticketProjectId ?? projectId),
    parentId: null,
    ticketNumber: 1,
    identifier: identifier as Ticket["identifier"],
    title: title as Ticket["title"],
    description: null,
    status: "todo",
    priority: "medium",
    sortOrder: 0,
    isArchived: false,
    worktree: null,
    acceptanceCriteria: null,
    labels: [],
    dependencies: [],
    subTickets: [],
    comments: [],
    artifacts: [],
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
    ...rest,
  };
};

const makeTicketTree = (...tickets: ReadonlyArray<Ticket>): TicketTreeNode[] =>
  tickets.map((ticket) => ({
    ticket: {
      ...ticket,
      subTicketCount: ticket.subTickets.length,
      dependencyCount: ticket.dependencies.length,
    },
    children: [],
    dependencies: [],
  }));

const makeTicketTreeResult = (...tickets: ReadonlyArray<Ticket>) => ({
  roots: makeTicketTree(...tickets),
  truncated: false,
  totalCount: tickets.length,
});

const makeTicketDependency = (ticket: Ticket, dependsOn: Ticket): TicketDependency => ({
  ticketId: ticket.id,
  dependsOnTicketId: dependsOn.id,
  identifier: dependsOn.identifier,
  title: dependsOn.title,
  status: dependsOn.status,
});

const makeThread = (
  id: ThreadId,
  overrides: Partial<{
    parentThreadId: ThreadId | null;
    isOrchestrationThread: boolean;
    ticketId: TicketId | null;
    title: string;
    createdAt: string;
  }> = {},
) => ({
  id,
  projectId,
  title: overrides.title ?? `Thread ${id}`,
  modelSelection: baseModelSelection,
  runtimeMode: "full-access" as const,
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  branch: null,
  worktreePath: null,
  parentThreadId: overrides.parentThreadId ?? null,
  isOrchestrationThread: overrides.isOrchestrationThread ?? false,
  ticketId: overrides.ticketId ?? null,
  latestTurn: null,
  createdAt: overrides.createdAt ?? "2026-04-09T10:00:00.000Z",
  updatedAt: overrides.createdAt ?? "2026-04-09T10:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
});

const makeRunRepository = (
  overrides: Partial<OrchestrationRunRepositoryShape> = {},
): OrchestrationRunRepositoryShape => ({
  create: () => Effect.void,
  update: () => Effect.void,
  getById: () => Effect.succeed(Option.none()),
  getByOrchestrationThreadId: () => Effect.succeed(Option.none()),
  listByProject: () => Effect.succeed([]),
  deleteById: () => Effect.void,
  ...overrides,
});

const makeProjectionThreadRepository = (
  overrides: Partial<ProjectionThreadRepositoryShape> = {},
): ProjectionThreadRepositoryShape => ({
  upsert: () => Effect.void,
  getById: () => Effect.succeed(Option.none()),
  listByProjectId: () => Effect.succeed([]),
  listByParentThreadId: () => Effect.succeed([]),
  deleteById: () => Effect.void,
  ...overrides,
});

const makeTicketingService = (
  overrides: Partial<TicketingServiceShape> = {},
): TicketingServiceShape => ({
  resolveId: () => Effect.die(new Error("not mocked")),
  resolveIdentifiers: () => Effect.succeed(new Map()),
  list: () => Effect.succeed([]),
  getById: () => Effect.die(new Error("not mocked")),
  getByIdentifier: () => Effect.die(new Error("not mocked")),
  getThreadLinks: ({ ticketId }) => Effect.succeed({ ticketId, originThread: null }),
  getBody: () => Effect.die(new Error("not mocked")),
  searchBody: () => Effect.die(new Error("not mocked")),
  getBodySections: () => Effect.die(new Error("not mocked")),
  editBody: () => Effect.die(new Error("not mocked")),
  listCriteria: () => Effect.die(new Error("not mocked")),
  editCriteria: () => Effect.die(new Error("not mocked")),
  create: () => Effect.die(new Error("not mocked")),
  update: () => Effect.die(new Error("not mocked")),
  delete: () => Effect.void,
  archive: () => Effect.die(new Error("not mocked")),
  unarchive: () => Effect.die(new Error("not mocked")),
  reorder: () => Effect.void,
  search: () => Effect.succeed([]),
  getTree: () => Effect.succeed({ roots: [], truncated: false, totalCount: 0 }),
  setDependencies: () => Effect.void,
  addDependency: () => Effect.void,
  removeDependency: () => Effect.void,
  updateCriterionStatus: () => Effect.die(new Error("not mocked")),
  getHistory: () => Effect.succeed([]),
  listLabels: () => Effect.succeed([]),
  createLabel: () => Effect.die(new Error("not mocked")),
  updateLabel: () => Effect.die(new Error("not mocked")),
  deleteLabel: () => Effect.void,
  addTicketLabel: () => Effect.void,
  removeTicketLabel: () => Effect.void,
  listComments: () => Effect.succeed([]),
  createComment: () => Effect.die(new Error("not mocked")),
  updateComment: () => Effect.die(new Error("not mocked")),
  deleteComment: () => Effect.void,
  listArtifacts: () => Effect.succeed([]),
  createArtifact: () => Effect.die(new Error("not mocked")),
  updateArtifact: () => Effect.die(new Error("not mocked")),
  deleteArtifact: () => Effect.void,
  listTemplates: () => Effect.succeed([]),
  getTemplate: () => Effect.die(new Error("not mocked")),
  createTemplate: () => Effect.succeed({} as any),
  updateTemplate: () => Effect.succeed({} as any),
  deleteTemplate: () => Effect.void,
  ensureShippedDefaults: () => Effect.void,
  streamEvents: Stream.empty,
  ...overrides,
});

const makeServiceLayer = ({
  repository,
  projectionThreads,
  ticketing,
  dispatch,
  readModelThreads,
}: {
  repository: OrchestrationRunRepositoryShape;
  projectionThreads?: ProjectionThreadRepositoryShape;
  ticketing: TicketingServiceShape;
  dispatch?: (
    command: OrchestrationCommand,
  ) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError>;
  readModelThreads?: ReadonlyArray<ReturnType<typeof makeThread>>;
}) =>
  OrchestrationRunServiceLive.pipe(
    Layer.provide(Layer.succeed(OrchestrationRunRepository, repository)),
    Layer.provide(
      Layer.succeed(
        ProjectionThreadRepository,
        projectionThreads ?? makeProjectionThreadRepository(),
      ),
    ),
    Layer.provide(Layer.succeed(TicketingService, ticketing)),
    Layer.provide(
      Layer.succeed(ServerRuntimeStartup, {
        awaitCommandReady: Effect.void,
        markHttpListening: Effect.void,
        enqueueCommand: <A, E>(effect: Effect.Effect<A, E>) => effect,
      }),
    ),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provide(
      Layer.succeed(OrchestrationEngineService, {
        getReadModel: () =>
          Effect.succeed({
            snapshotSequence: 0,
            updatedAt: "2026-04-09T10:00:00.000Z",
            projects: [],
            threads: [...(readModelThreads ?? [])],
          } as any),
        readEvents: () => Stream.empty,
        dispatch:
          dispatch ??
          (() =>
            Effect.succeed({
              sequence: 1,
            })),
        streamDomainEvents: Stream.empty,
      }),
    ),
    Layer.provide(
      Layer.succeed(ProjectionSnapshotQuery, {
        getSnapshot: () =>
          Effect.succeed({
            snapshotSequence: 0,
            updatedAt: "2026-04-09T10:00:00.000Z",
            projects: [],
            threads: [...(readModelThreads ?? [])],
          }),
      } as any),
    ),
  );

const serviceEffect = <A, E>(
  layer: Layer.Layer<OrchestrationRunService, never, never>,
  f: (service: OrchestrationRunServiceShape) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E, never> =>
  Effect.flatMap(Effect.service(OrchestrationRunService), (service) => f(service)).pipe(
    Effect.provide(layer),
  );

describe("OrchestrationRunService", () => {
  it("creates paired working and review threads when automated review is enabled", async () => {
    const ticket = makeTicket({ id: "ticket-1", identifier: "T3CO-1", title: "First ticket" });
    const dispatchedCommands: OrchestrationCommand[] = [];
    const createdRuns: PersistedOrchestrationRun[] = [];
    const layer = makeServiceLayer({
      repository: makeRunRepository({
        create: (input) =>
          Effect.sync(() => {
            createdRuns.push(input);
          }),
      }),
      ticketing: makeTicketingService({
        getTree: () => Effect.succeed(makeTicketTreeResult(ticket)),
        getByIdentifier: ({ identifier }) =>
          identifier === ticket.identifier
            ? Effect.succeed(ticket)
            : Effect.die(new Error("unexpected ticket lookup")),
      }),
      dispatch: (command) =>
        Effect.sync(() => {
          dispatchedCommands.push(command);
          return { sequence: dispatchedCommands.length };
        }),
    });

    const result = await Effect.runPromise(
      serviceEffect(layer, (service) =>
        service.create({
          projectId,
          selectedTicketIdentifiers: [ticket.identifier],
          implementerModelSelection: baseModelSelection,
          reviewerModelSelection: baseModelSelection,
        }),
      ),
    );

    expect(createdRuns[0]?.maxReviewIterations).toBe(3);
    expect(createdRuns[0]?.ticketOrderJson).toContain('"reviewThreadId"');

    const threadCreates = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.create" }> =>
        command.type === "thread.create",
    );
    expect(threadCreates).toHaveLength(3);
    expect(threadCreates[1]?.title).toBe(ticket.title);
    expect(threadCreates[2]?.title).toBe(`${ticket.title} Review`);
    expect(threadCreates[1]?.ticketId).toBe(ticket.id);
    expect(threadCreates[2]?.ticketId).toBe(ticket.id);
    expect(result.workingThreadIds).toHaveLength(1);
  });

  it("skips review thread creation when maxReviewIterations is 0", async () => {
    const ticket = makeTicket({ id: "ticket-1", identifier: "T3CO-1", title: "First ticket" });
    const dispatchedCommands: OrchestrationCommand[] = [];
    const createdRuns: PersistedOrchestrationRun[] = [];
    const layer = makeServiceLayer({
      repository: makeRunRepository({
        create: (input) =>
          Effect.sync(() => {
            createdRuns.push(input);
          }),
      }),
      ticketing: makeTicketingService({
        getTree: () => Effect.succeed(makeTicketTreeResult(ticket)),
        getByIdentifier: ({ identifier }) =>
          identifier === ticket.identifier
            ? Effect.succeed(ticket)
            : Effect.die(new Error("unexpected ticket lookup")),
      }),
      dispatch: (command) =>
        Effect.sync(() => {
          dispatchedCommands.push(command);
          return { sequence: dispatchedCommands.length };
        }),
    });

    const result = await Effect.runPromise(
      serviceEffect(layer, (service) =>
        service.create({
          projectId,
          selectedTicketIdentifiers: [ticket.identifier],
          implementerModelSelection: baseModelSelection,
          reviewerModelSelection: baseModelSelection,
          maxReviewIterations: 0,
        }),
      ),
    );

    expect(createdRuns[0]?.maxReviewIterations).toBe(0);
    expect(JSON.parse(createdRuns[0]?.ticketOrderJson ?? "[]")).toEqual([
      {
        ticketId: ticket.id,
        selectedTicketId: ticket.id,
        workingThreadId: expect.any(String),
      },
    ]);

    const threadCreates = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.create" }> =>
        command.type === "thread.create",
    );
    expect(threadCreates).toHaveLength(2);
    expect(threadCreates[1]?.title).toBe(ticket.title);
    expect(result.workingThreadIds).toHaveLength(1);
  });

  it("allows creating a run when selected tickets have unfinished external dependencies", async () => {
    const ticket = makeTicket({ id: "ticket-1", identifier: "T3CO-1", title: "First ticket" });
    const dependency = makeTicket({
      id: "ticket-2",
      identifier: "T3CO-2",
      title: "External dependency",
    });
    const dispatchedCommands: OrchestrationCommand[] = [];
    const createdRuns: PersistedOrchestrationRun[] = [];
    const layer = makeServiceLayer({
      repository: makeRunRepository({
        create: (input) =>
          Effect.sync(() => {
            createdRuns.push(input);
          }),
      }),
      ticketing: makeTicketingService({
        getTree: () =>
          Effect.succeed({
            roots: [
              {
                ticket: {
                  ...ticket,
                  subTicketCount: 0,
                  dependencyCount: 1,
                },
                children: [],
                dependencies: [makeTicketDependency(ticket, dependency)],
              },
              {
                ticket: {
                  ...dependency,
                  subTicketCount: 0,
                  dependencyCount: 0,
                },
                children: [],
                dependencies: [],
              },
            ],
            truncated: false,
            totalCount: 2,
          }),
        getByIdentifier: ({ identifier }) =>
          identifier === ticket.identifier
            ? Effect.succeed(ticket)
            : Effect.die(new Error("unexpected ticket lookup")),
      }),
      dispatch: (command) =>
        Effect.sync(() => {
          dispatchedCommands.push(command);
          return { sequence: dispatchedCommands.length };
        }),
    });

    const result = await Effect.runPromise(
      serviceEffect(layer, (service) =>
        service.create({
          projectId,
          selectedTicketIdentifiers: [ticket.identifier],
          implementerModelSelection: baseModelSelection,
          reviewerModelSelection: baseModelSelection,
          maxReviewIterations: 0,
        }),
      ),
    );

    expect(result.workingThreadIds).toHaveLength(1);
    expect(JSON.parse(createdRuns[0]?.ticketOrderJson ?? "[]")).toEqual([
      {
        ticketId: ticket.id,
        selectedTicketId: ticket.id,
        workingThreadId: expect.any(String),
      },
    ]);
  });

  it("rejects tickets that belong to a different project", async () => {
    const foreignTicket = makeTicket({
      id: "ticket-foreign",
      identifier: "T3CO-999",
      title: "Foreign ticket",
      projectId: otherProjectId,
    });

    const layer = makeServiceLayer({
      repository: makeRunRepository(),
      ticketing: makeTicketingService({
        getByIdentifier: ({ identifier }) =>
          identifier === foreignTicket.identifier
            ? Effect.succeed(foreignTicket)
            : Effect.die(new Error("unexpected ticket lookup")),
      }),
    });

    await expect(
      Effect.runPromise(
        serviceEffect(layer, (service) =>
          service.create({
            projectId,
            selectedTicketIdentifiers: [foreignTicket.identifier],
            implementerModelSelection: baseModelSelection,
            reviewerModelSelection: baseModelSelection,
          }),
        ),
      ),
    ).rejects.toThrow("does not belong to project");
  });

  it("cleans up created threads and deletes the run row if child thread creation fails", async () => {
    const tickets = [
      makeTicket({ id: "ticket-1", identifier: "T3CO-1", title: "First ticket" }),
      makeTicket({ id: "ticket-2", identifier: "T3CO-2", title: "Second ticket" }),
    ];
    const deletedRunIds: string[] = [];
    const dispatchedCommands: OrchestrationCommand[] = [];
    let secondThreadCreateSeen = false;

    const layer = makeServiceLayer({
      repository: makeRunRepository({
        create: () => Effect.void,
        deleteById: ({ runId }) =>
          Effect.sync(() => {
            deletedRunIds.push(runId);
          }),
      }),
      ticketing: makeTicketingService({
        getTree: () => Effect.succeed(makeTicketTreeResult(...tickets)),
        getByIdentifier: ({ identifier }) => {
          const ticket = tickets.find((entry) => entry.identifier === identifier);
          return ticket
            ? Effect.succeed(ticket)
            : Effect.die(new Error("unexpected ticket lookup"));
        },
      }),
      dispatch: (command) =>
        Effect.suspend(() => {
          dispatchedCommands.push(command);
          if (command.type === "thread.create" && command.parentThreadId !== undefined) {
            if (secondThreadCreateSeen) {
              return Effect.fail(
                new OrchestrationCommandInvariantError({
                  commandType: command.type,
                  detail: "boom",
                }),
              );
            }
            secondThreadCreateSeen = true;
          }
          return Effect.succeed({ sequence: dispatchedCommands.length });
        }),
    });

    await expect(
      Effect.runPromise(
        serviceEffect(layer, (service) =>
          service.create({
            projectId,
            selectedTicketIdentifiers: tickets.map((ticket) => ticket.identifier),
            implementerModelSelection: baseModelSelection,
            reviewerModelSelection: baseModelSelection,
          }),
        ),
      ),
    ).rejects.toThrow("Failed to create review thread");

    const deleteCommands = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.delete" }> =>
        command.type === "thread.delete",
    );
    expect(deleteCommands).toHaveLength(2);
    expect(new Set(deleteCommands.map((command) => command.threadId)).size).toBe(2);
    expect(deletedRunIds).toHaveLength(1);
  });

  it("returns child threads in persisted ticket order", async () => {
    const ticketOne = TicketId.makeUnsafe("ticket-1");
    const ticketTwo = TicketId.makeUnsafe("ticket-2");
    const layer = makeServiceLayer({
      repository: makeRunRepository({
        getByOrchestrationThreadId: () =>
          Effect.succeed(
            Option.some({
              id: OrchestrationRunId.makeUnsafe("run-1"),
              orchestrationThreadId: parentThreadId,
              projectId,
              status: "pending",
              ticketOrderJson: JSON.stringify([
                { ticketId: ticketTwo, workingThreadId: childThreadTwoId },
                { ticketId: ticketOne, workingThreadId: childThreadOneId },
              ]),
              currentTicketIndex: -1,
              currentPhase: "working",
              reviewIteration: 0,
              maxReviewIterations: 1,
              promptOverridesJson: null,
              createdAt: "2026-04-09T10:00:00.000Z",
              updatedAt: "2026-04-09T10:00:00.000Z",
            } satisfies PersistedOrchestrationRun),
          ),
      }),
      projectionThreads: makeProjectionThreadRepository({
        listByParentThreadId: () =>
          Effect.succeed([
            {
              threadId: childThreadOneId,
              projectId,
              title: "Child 1",
              modelSelection: baseModelSelection,
              runtimeMode: "full-access",
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              branch: null,
              worktreePath: null,
              parentThreadId,
              isOrchestrationThread: false,
              ticketId: ticketOne,
              latestTurnId: null,
              createdAt: "2026-04-09T10:00:00.000Z",
              updatedAt: "2026-04-09T10:00:00.000Z",
              archivedAt: null,
              deletedAt: null,
            },
            {
              threadId: childThreadTwoId,
              projectId,
              title: "Child 2",
              modelSelection: baseModelSelection,
              runtimeMode: "full-access",
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              branch: null,
              worktreePath: null,
              parentThreadId,
              isOrchestrationThread: false,
              ticketId: ticketTwo,
              latestTurnId: null,
              createdAt: "2026-04-09T10:00:00.000Z",
              updatedAt: "2026-04-09T10:00:00.000Z",
              archivedAt: null,
              deletedAt: null,
            },
          ]),
      }),
      ticketing: makeTicketingService(),
      readModelThreads: [
        makeThread(parentThreadId, {
          isOrchestrationThread: true,
          title: "Parent",
        }),
        makeThread(childThreadOneId, {
          parentThreadId,
          ticketId: ticketOne,
          title: "Child 1",
        }),
        makeThread(childThreadTwoId, {
          parentThreadId,
          ticketId: ticketTwo,
          title: "Child 2",
        }),
      ],
    });

    const result = await Effect.runPromise(
      serviceEffect(layer, (service) => service.getChildThreads({ parentThreadId })),
    );

    expect(result.map((thread) => thread.id)).toEqual([childThreadTwoId, childThreadOneId]);
  });
});
