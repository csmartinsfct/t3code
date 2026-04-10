import {
  EventId,
  MessageId,
  DEFAULT_SERVER_SETTINGS,
  type OrchestrationCommand,
  type OrchestrationProject,
  OrchestrationRunId,
  ProjectId,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  ThreadId,
  TicketId,
  TurnId,
  type Ticket,
  type OrchestrationRun,
  OrchestrationRunError,
} from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { type DeepPartial } from "@t3tools/shared/Struct";
import {
  CheckpointDiffQuery,
  type CheckpointDiffQueryShape,
} from "../../checkpointing/Services/CheckpointDiffQuery.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderRateLimitsCache } from "../../provider/Services/ProviderRateLimitsCache.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
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
import { OrchestrationRunRunner } from "../Services/OrchestrationRunRunner.ts";
import { OrchestrationRunRunnerLive } from "./OrchestrationRunRunner.ts";

const projectId = ProjectId.makeUnsafe("project-runner-test");
const runId = OrchestrationRunId.makeUnsafe("run-1");
const orchestrationThreadId = ThreadId.makeUnsafe("thread-orch");
const workingThread1 = ThreadId.makeUnsafe("thread-work-1");
const workingThread2 = ThreadId.makeUnsafe("thread-work-2");
const reviewThread1 = ThreadId.makeUnsafe("thread-review-1");
const reviewThread2 = ThreadId.makeUnsafe("thread-review-2");
const ticket1Id = TicketId.makeUnsafe("ticket-1");
const ticket2Id = TicketId.makeUnsafe("ticket-2");

const makeTicket = (overrides: { id: string; identifier: string; title: string }): Ticket => ({
  id: TicketId.makeUnsafe(overrides.id),
  projectId,
  parentId: null,
  ticketNumber: 1,
  identifier: overrides.identifier as Ticket["identifier"],
  title: overrides.title as Ticket["title"],
  description: null,
  status: "todo",
  priority: "medium",
  sortOrder: 0,
  isArchived: false,
  worktree: null,
  implementerModelOverride: null,
  reviewerModelOverride: null,
  acceptanceCriteria: null,
  labels: [],
  dependencies: [],
  subTickets: [],
  comments: [],
  artifacts: [],
  createdAt: "2026-04-09T10:00:00.000Z",
  updatedAt: "2026-04-09T10:00:00.000Z",
});

const ticket1 = makeTicket({ id: ticket1Id, identifier: "T3CO-1", title: "First ticket" });
const ticket2 = makeTicket({ id: ticket2Id, identifier: "T3CO-2", title: "Second ticket" });

const resolveTestTicket = (id: TicketId): Ticket => {
  if (id === ticket1Id) return ticket1;
  if (id === ticket2Id) return ticket2;
  throw new Error(`Unknown ticket: ${id}`);
};

const makeRun = (overrides: Partial<OrchestrationRun> = {}): OrchestrationRun => ({
  id: runId,
  orchestrationThreadId,
  projectId,
  status: "running",
  ticketOrder: [
    { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
    { ticketId: ticket2Id, workingThreadId: workingThread2, reviewThreadId: reviewThread2 },
  ],
  currentTicketIndex: -1,
  currentPhase: "working",
  reviewIteration: 0,
  maxReviewIterations: 0,
  createdAt: "2026-04-09T10:00:00.000Z",
  updatedAt: "2026-04-09T10:00:00.000Z",
  ...overrides,
});

const makeTurnStartedRuntimeEvent = (input: {
  threadId: ThreadId;
  turnId?: string;
}): ProviderRuntimeEvent => ({
  eventId: EventId.makeUnsafe(crypto.randomUUID()),
  provider: "codex",
  threadId: input.threadId,
  createdAt: "2026-04-09T10:00:00.000Z",
  turnId: TurnId.makeUnsafe(input.turnId ?? "turn-1"),
  type: "turn.started",
  payload: {
    model: "gpt-5.4",
  },
});

const makeTurnCompletedRuntimeEvent = (input: {
  threadId: ThreadId;
  turnId?: string;
  state?: "completed" | "failed" | "interrupted" | "cancelled";
  errorMessage?: string;
}): ProviderRuntimeEvent => ({
  eventId: EventId.makeUnsafe(crypto.randomUUID()),
  provider: "codex",
  threadId: input.threadId,
  createdAt: "2026-04-09T10:00:01.000Z",
  turnId: TurnId.makeUnsafe(input.turnId ?? "turn-1"),
  type: "turn.completed",
  payload: {
    state: input.state ?? "completed",
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  },
});

const makeTurnAbortedRuntimeEvent = (input: {
  threadId: ThreadId;
  turnId?: string;
  reason?: string;
}): ProviderRuntimeEvent => ({
  eventId: EventId.makeUnsafe(crypto.randomUUID()),
  provider: "codex",
  threadId: input.threadId,
  createdAt: "2026-04-09T10:00:01.000Z",
  turnId: TurnId.makeUnsafe(input.turnId ?? "turn-1"),
  type: "turn.aborted",
  payload: {
    reason: input.reason ?? "interrupted",
  },
});

const makeOrchestrationParentThread = (
  overrides: Partial<OrchestrationThread> = {},
): OrchestrationThread => ({
  id: orchestrationThreadId,
  projectId,
  title: "Orchestration",
  modelSelection: { provider: "codex", model: "gpt-5-codex" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  parentThreadId: null,
  isOrchestrationThread: true,
  ticketId: null,
  latestTurn: null,
  createdAt: "2026-04-09T10:00:00.000Z",
  updatedAt: "2026-04-09T10:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
  ...overrides,
});

const makeCompletedWorkAndReviewThreads = (
  reviewText: string,
): ReadonlyArray<OrchestrationThread> => [
  {
    id: workingThread1,
    projectId,
    title: ticket1.title,
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    parentThreadId: orchestrationThreadId,
    isOrchestrationThread: false,
    ticketId: ticket1Id,
    latestTurn: {
      turnId: TurnId.makeUnsafe("turn-work"),
      state: "completed",
      requestedAt: "2026-04-09T10:00:00.000Z",
      startedAt: "2026-04-09T10:00:00.000Z",
      completedAt: "2026-04-09T10:00:01.000Z",
      assistantMessageId: MessageId.makeUnsafe("assistant-work"),
    },
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:01.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [
      {
        turnId: TurnId.makeUnsafe("turn-work"),
        checkpointTurnCount: 1,
        checkpointRef: "checkpoint:work-1" as never,
        status: "ready",
        files: [],
        assistantMessageId: MessageId.makeUnsafe("assistant-work"),
        completedAt: "2026-04-09T10:00:01.000Z",
      },
    ],
    session: null,
  },
  {
    id: reviewThread1,
    projectId,
    title: `${ticket1.title} Review`,
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    parentThreadId: orchestrationThreadId,
    isOrchestrationThread: false,
    ticketId: ticket1Id,
    latestTurn: {
      turnId: TurnId.makeUnsafe("turn-review"),
      state: "completed",
      requestedAt: "2026-04-09T10:00:02.000Z",
      startedAt: "2026-04-09T10:00:02.000Z",
      completedAt: "2026-04-09T10:00:03.000Z",
      assistantMessageId: MessageId.makeUnsafe("assistant-review"),
    },
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:03.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [
      {
        id: MessageId.makeUnsafe("assistant-review"),
        role: "assistant",
        text: reviewText,
        turnId: TurnId.makeUnsafe("turn-review"),
        streaming: false,
        createdAt: "2026-04-09T10:00:03.000Z",
        updatedAt: "2026-04-09T10:00:03.000Z",
      },
    ],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  },
];

const makeTicketingService = (
  overrides: Partial<TicketingServiceShape> = {},
): TicketingServiceShape => ({
  resolveId: () => Effect.die(new Error("not mocked")),
  resolveIdentifiers: () => Effect.succeed(new Map()),
  list: () => Effect.succeed([]),
  getById: ({ id }) => Effect.succeed(resolveTestTicket(id)),
  getByIdentifier: () => Effect.die(new Error("not mocked")),
  getThreadLinks: ({ ticketId }) =>
    Effect.succeed({ ticketId, originThread: null, relatedThreads: [] }),
  create: () => Effect.die(new Error("not mocked")),
  update: ({ id, ...changes }) =>
    Effect.succeed({
      ...resolveTestTicket(id),
      ...changes,
    } as Ticket),
  delete: () => Effect.void,
  reorder: () => Effect.void,
  search: () => Effect.succeed([]),
  getTree: () => Effect.succeed([]),
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
  deleteArtifact: () => Effect.void,
  streamEvents: Stream.empty,
  ...overrides,
});

const makeRunService = (
  overrides: Partial<OrchestrationRunServiceShape> = {},
): OrchestrationRunServiceShape => ({
  create: () => Effect.die(new Error("not mocked")),
  get: () => Effect.succeed(makeRun()),
  list: () => Effect.succeed([]),
  getChildThreads: () => Effect.succeed([]),
  pause: () => Effect.succeed(makeRun({ status: "paused" })),
  resume: () => Effect.succeed(makeRun({ status: "running" })),
  cancel: () => Effect.succeed(makeRun({ status: "canceled" })),
  start: () => Effect.succeed(makeRun({ status: "running" })),
  complete: () => Effect.succeed(makeRun({ status: "completed" })),
  fail: () => Effect.succeed(makeRun({ status: "failed" })),
  updateRunProgress: () => Effect.succeed(makeRun()),
  streamEvents: () => Stream.empty,
  ...overrides,
});

const makeProviderService = (
  overrides: Partial<ProviderServiceShape> = {},
): ProviderServiceShape => ({
  startSession: () => Effect.die(new Error("not mocked")),
  sendTurn: () => Effect.die(new Error("not mocked")),
  interruptTurn: () => Effect.void,
  respondToRequest: () => Effect.die(new Error("not mocked")),
  respondToUserInput: () => Effect.die(new Error("not mocked")),
  stopSession: () => Effect.void,
  listSessions: () => Effect.succeed([]),
  getCapabilities: () => Effect.die(new Error("not mocked")),
  rollbackConversation: () => Effect.die(new Error("not mocked")),
  streamEvents: Stream.empty,
  probeAllRateLimits: () => Effect.succeed([]),
  ...overrides,
});

const makeLayer = (opts: {
  runService?: Partial<OrchestrationRunServiceShape>;
  ticketing?: Partial<TicketingServiceShape>;
  providerService?: Partial<ProviderServiceShape>;
  checkpointDiffQuery?: Partial<CheckpointDiffQueryShape>;
  providerEvents?: Stream.Stream<ProviderRuntimeEvent>;
  dispatchedCommands?: OrchestrationCommand[];
  onDispatch?: (command: OrchestrationCommand) => void;
  readModelProjects?: ReadonlyArray<OrchestrationProject>;
  readModelThreads?: ReadonlyArray<OrchestrationThread>;
  serverSettingsOverrides?: DeepPartial<typeof DEFAULT_SERVER_SETTINGS>;
}) => {
  const dispatchedCommands = opts.dispatchedCommands ?? [];
  const readModelProjects =
    opts.readModelProjects ??
    ([
      {
        id: projectId,
        title: "Runner project",
        workspaceRoot: "/tmp/runner-project",
        defaultModelSelection: null,
        systemPrompt: null,
        promptOverrides: { orchestration: {} },
        scripts: [],
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-09T10:00:00.000Z",
        deletedAt: null,
      },
    ] as const satisfies ReadonlyArray<OrchestrationProject>);
  const readModelThreads =
    opts.readModelThreads ??
    ([
      makeOrchestrationParentThread(),
      {
        id: workingThread1,
        projectId,
        title: ticket1.title,
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        parentThreadId: orchestrationThreadId,
        isOrchestrationThread: false,
        ticketId: ticket1Id,
        latestTurn: null,
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-09T10:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
      {
        id: workingThread2,
        projectId,
        title: ticket2.title,
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        parentThreadId: orchestrationThreadId,
        isOrchestrationThread: false,
        ticketId: ticket2Id,
        latestTurn: null,
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-09T10:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
      {
        id: reviewThread1,
        projectId,
        title: `${ticket1.title} Review`,
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        parentThreadId: orchestrationThreadId,
        isOrchestrationThread: false,
        ticketId: ticket1Id,
        latestTurn: null,
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-09T10:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
      {
        id: reviewThread2,
        projectId,
        title: `${ticket2.title} Review`,
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        parentThreadId: orchestrationThreadId,
        isOrchestrationThread: false,
        ticketId: ticket2Id,
        latestTurn: null,
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-09T10:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ] as const satisfies ReadonlyArray<OrchestrationThread>);
  return OrchestrationRunRunnerLive.pipe(
    Layer.provide(Layer.succeed(OrchestrationRunService, makeRunService(opts.runService))),
    Layer.provide(Layer.succeed(TicketingService, makeTicketingService(opts.ticketing))),
    Layer.provide(
      Layer.succeed(
        ProviderService,
        makeProviderService({
          ...opts.providerService,
          streamEvents: opts.providerEvents ?? opts.providerService?.streamEvents ?? Stream.empty,
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(ServerRuntimeStartup, {
        awaitCommandReady: Effect.void,
        markHttpListening: Effect.void,
        enqueueCommand: <A, E>(effect: Effect.Effect<A, E>) => effect,
      }),
    ),
    Layer.provide(ServerSettingsService.layerTest(opts.serverSettingsOverrides ?? {})),
    Layer.provide(
      Layer.succeed(OrchestrationEngineService, {
        getReadModel: () =>
          Effect.succeed({
            snapshotSequence: 0,
            updatedAt: "2026-04-09T10:00:00.000Z",
            projects: [...readModelProjects],
            threads: [...readModelThreads],
          }),
        readEvents: () => Stream.empty,
        dispatch: (command: OrchestrationCommand) => {
          dispatchedCommands.push(command);
          opts.onDispatch?.(command);
          return Effect.succeed({ sequence: dispatchedCommands.length });
        },
        streamDomainEvents: Stream.empty,
      }),
    ),
    Layer.provide(
      Layer.succeed(ProviderRegistry, {
        getProviders: Effect.succeed([]),
        refresh: () => Effect.succeed([]),
        streamChanges: Stream.empty,
      }),
    ),
    Layer.provide(
      Layer.succeed(ProviderRateLimitsCache, {
        set: () => Effect.void,
        setOAuthTiers: () => Effect.void,
        getAll: Effect.succeed([]),
        streamChanges: Stream.empty,
      }),
    ),
    Layer.provide(
      Layer.succeed(CheckpointDiffQuery, {
        getTurnDiff: () =>
          Effect.succeed({
            threadId: workingThread1,
            fromTurnCount: 1,
            toTurnCount: 2,
            diff: "patch-delta",
          }),
        getFullThreadDiff: () =>
          Effect.succeed({
            threadId: workingThread1,
            fromTurnCount: 0,
            toTurnCount: 1,
            diff: "patch",
          }),
        ...opts.checkpointDiffQuery,
      }),
    ),
  );
};

describe("OrchestrationRunRunner", () => {
  it("rejects start when run is not in pending state", async () => {
    const layer = makeLayer({
      runService: {
        start: () =>
          Effect.fail(
            new OrchestrationRunError({
              message: "Invalid status transition: running → running",
            }),
          ),
      },
    });

    const result = await Effect.runPromiseExit(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );

    expect(result._tag).toBe("Failure");
  });

  it("transitions pending → running and returns the run", async () => {
    const startedRun = makeRun({ status: "running" });
    const layer = makeLayer({
      runService: {
        start: () => Effect.succeed(startedRun),
      },
    });

    const result = await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("running");
    expect(result.id).toBe(runId);
  });

  it("builds correct work prompt with ticket details", () => {
    // Test the deterministic work prompt template format
    const expectedPrompt =
      "Work on ticket Fix auth - T3CO-99. Worktree: default. Pull the ticket details and any other context you need yourself. If you get blocked, update the ticket status to blocked and stop. Try to complete the acceptance criteria mentioned in the ticket, if defined. Otherwise try to comply with the specifications in the ticket.";

    // Validate the prompt template contains required parts
    expect(expectedPrompt).toContain("Fix auth");
    expect(expectedPrompt).toContain("T3CO-99");
    expect(expectedPrompt).toContain("Worktree: default");
    expect(expectedPrompt).toContain("Pull the ticket details");
    expect(expectedPrompt).toContain("update the ticket status to blocked");
    expect(expectedPrompt).toContain("acceptance criteria");
  });

  it("finalizes instead of pausing when the last ticket already completed", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const runningSingleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      currentTicketIndex: 0,
      status: "running",
    });
    const completedSingleTicketRun = makeRun({
      ...runningSingleTicketRun,
      status: "completed",
    });
    const layer = makeLayer({
      dispatchedCommands,
      runService: {
        get: () => Effect.succeed(runningSingleTicketRun),
        complete: () => Effect.succeed(completedSingleTicketRun),
      },
      ticketing: {
        getById: ({ id }) => {
          if (id === ticket1Id) {
            return Effect.succeed({ ...ticket1, status: "done" satisfies Ticket["status"] });
          }
          return Effect.die(new Error(`Unknown ticket: ${id}`));
        },
      },
    });

    const result = await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.pauseRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("completed");

    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );

    expect(parentActivities.map((command) => command.activity.kind)).toContain(
      "orchestration.run.completed",
    );
    expect(parentActivities.map((command) => command.activity.kind)).not.toContain(
      "orchestration.run.paused",
    );
  });

  it("treats resume on a terminal run as a no-op", async () => {
    const completedRun = makeRun({ status: "completed" });
    const dispatchedCommands: OrchestrationCommand[] = [];
    const layer = makeLayer({
      dispatchedCommands,
      runService: {
        get: () => Effect.succeed(completedRun),
      },
    });

    const result = await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.resumeRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("completed");
    expect(dispatchedCommands).toEqual([]);
  });

  it("resumes the in-flight ticket with the resolved resume prompt instead of restarting it", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const pausedSingleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      currentTicketIndex: 0,
      status: "paused",
    });
    const runningSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "running",
    });
    const completedSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "completed",
    });
    let getCallCount = 0;

    const layer = makeLayer({
      dispatchedCommands,
      serverSettingsOverrides: {
        prompts: {
          orchestration: {
            resume: {
              version: 1,
              blocks: [
                {
                  when: null,
                  text: "Resume custom ${ticketId} in ${projectTitle}",
                },
              ],
            },
          },
        },
      },
      runService: {
        get: () => {
          getCallCount += 1;
          if (getCallCount === 1) {
            return Effect.succeed(pausedSingleTicketRun);
          }
          return Effect.succeed(runningSingleTicketRun);
        },
        resume: () => Effect.succeed(runningSingleTicketRun),
        updateRunProgress: () =>
          Effect.succeed(
            makeRun({
              ...pausedSingleTicketRun,
              status: "running",
              currentTicketIndex: 0,
            }),
          ),
        complete: () => Effect.succeed(completedSingleTicketRun),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-resume" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-resume" }),
      ]),
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.resumeRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );
    const turnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start" && command.threadId === workingThread1,
    );

    expect(turnStarts).toHaveLength(1);
    expect(turnStarts[0]?.message.text).toBe("Resume custom T3CO-1 in Runner project");
    expect(parentActivities.map((command) => command.activity.kind)).toContain(
      "orchestration.run.resumed",
    );
    expect(parentActivities.map((command) => command.activity.kind)).not.toContain(
      "orchestration.run.ticket.started",
    );
    expect(parentActivities.map((command) => command.activity.kind)).toContain(
      "orchestration.run.ticket.completed",
    );
    expect(parentActivities.map((command) => command.activity.kind)).toContain(
      "orchestration.run.completed",
    );
  });

  it("restarts the working thread session when resuming with a fresh agent", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const pausedSingleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      currentTicketIndex: 0,
      currentPhase: "working",
      status: "paused",
    });
    const runningSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "running",
    });
    const completedSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "completed",
    });
    let getCallCount = 0;

    const layer = makeLayer({
      dispatchedCommands,
      runService: {
        get: () => {
          getCallCount += 1;
          return Effect.succeed(
            getCallCount === 1 ? pausedSingleTicketRun : runningSingleTicketRun,
          );
        },
        resume: () => Effect.succeed(runningSingleTicketRun),
        updateRunProgress: () => Effect.succeed(runningSingleTicketRun),
        complete: () => Effect.succeed(completedSingleTicketRun),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-resume-fresh" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-resume-fresh" }),
      ]),
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.resumeRun({ runId, mode: "fresh-agent" }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const interruptCommands = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.interrupt" }> =>
        command.type === "thread.turn.interrupt",
    );
    const stopCommands = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.session.stop" }> =>
        command.type === "thread.session.stop",
    );
    const turnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start",
    );
    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );
    const resumeActivity = parentActivities.find(
      (command) => command.activity.kind === "orchestration.run.resumed",
    );

    expect(interruptCommands.map((command) => command.threadId)).toContain(workingThread1);
    expect(stopCommands.map((command) => command.threadId)).toContain(workingThread1);
    expect(turnStarts).toHaveLength(1);
    expect(turnStarts[0]?.threadId).toBe(workingThread1);
    expect(turnStarts[0]?.message.text).toContain(
      "You are taking over this ticket with a fresh agent session",
    );
    expect(resumeActivity?.activity.summary).toBe("Resumed T3CO-1 with fresh agent");
    expect(resumeActivity?.activity.payload).toMatchObject({
      resumeMode: "fresh-agent",
      ticketId: ticket1Id,
      ticketIdentifier: "T3CO-1",
      phase: "working",
      restartedThreadId: workingThread1,
    });
  });

  it("restarts the review thread session when resuming a review with a fresh agent", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const pausedSingleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      currentTicketIndex: 0,
      currentPhase: "reviewing",
      reviewIteration: 0,
      maxReviewIterations: 1,
      status: "paused",
    });
    const runningSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "running",
    });
    const completedSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "completed",
    });
    let getCallCount = 0;

    const layer = makeLayer({
      dispatchedCommands,
      readModelThreads: makeCompletedWorkAndReviewThreads(
        JSON.stringify({
          changesNeeded: false,
          summary: "Looks good.",
          comments: [],
        }),
      ),
      runService: {
        get: () => {
          getCallCount += 1;
          return Effect.succeed(
            getCallCount === 1 ? pausedSingleTicketRun : runningSingleTicketRun,
          );
        },
        resume: () => Effect.succeed(runningSingleTicketRun),
        updateRunProgress: () => Effect.succeed(runningSingleTicketRun),
        complete: () => Effect.succeed(completedSingleTicketRun),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-fresh" }),
        makeTurnCompletedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-fresh" }),
      ]),
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.resumeRun({ runId, mode: "fresh-agent" }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const interruptCommands = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.interrupt" }> =>
        command.type === "thread.turn.interrupt",
    );
    const stopCommands = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.session.stop" }> =>
        command.type === "thread.session.stop",
    );
    const turnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start",
    );
    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );
    const resumeActivity = parentActivities.find(
      (command) => command.activity.kind === "orchestration.run.resumed",
    );

    expect(interruptCommands.map((command) => command.threadId)).toContain(reviewThread1);
    expect(stopCommands.map((command) => command.threadId)).toContain(reviewThread1);
    expect(turnStarts).toHaveLength(1);
    expect(turnStarts[0]?.threadId).toBe(reviewThread1);
    expect(turnStarts[0]?.message.text).toContain("Return valid JSON only.");
    expect(resumeActivity?.activity.summary).toBe("Resumed T3CO-1 with fresh agent");
    expect(resumeActivity?.activity.payload).toMatchObject({
      resumeMode: "fresh-agent",
      ticketId: ticket1Id,
      ticketIdentifier: "T3CO-1",
      phase: "reviewing",
      restartedThreadId: reviewThread1,
    });
  });

  it("keeps using the resume prompt for normal review resumes", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const pausedSingleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      currentTicketIndex: 0,
      currentPhase: "reviewing",
      reviewIteration: 0,
      maxReviewIterations: 1,
      status: "paused",
    });
    const runningSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "running",
    });
    const completedSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "completed",
    });
    let getCallCount = 0;

    const layer = makeLayer({
      dispatchedCommands,
      serverSettingsOverrides: {
        prompts: {
          orchestration: {
            resume: {
              version: 1,
              blocks: [
                {
                  when: null,
                  text: "Resume review ${ticketId} in ${projectTitle}",
                },
              ],
            },
          },
        },
      },
      readModelThreads: makeCompletedWorkAndReviewThreads(
        JSON.stringify({
          changesNeeded: false,
          summary: "Looks good.",
          comments: [],
        }),
      ),
      runService: {
        get: () => {
          getCallCount += 1;
          return Effect.succeed(
            getCallCount === 1 ? pausedSingleTicketRun : runningSingleTicketRun,
          );
        },
        resume: () => Effect.succeed(runningSingleTicketRun),
        updateRunProgress: () => Effect.succeed(runningSingleTicketRun),
        complete: () => Effect.succeed(completedSingleTicketRun),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-resume" }),
        makeTurnCompletedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-resume" }),
      ]),
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.resumeRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const turnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start",
    );

    expect(turnStarts).toHaveLength(1);
    expect(turnStarts[0]?.threadId).toBe(reviewThread1);
    expect(turnStarts[0]?.message.text).toBe("Resume review T3CO-1 in Runner project");
  });

  it("targets the next actionable ticket when fresh-agent resume skips completed work", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const pausedRun = makeRun({
      currentTicketIndex: 0,
      currentPhase: "working",
      status: "paused",
    });
    const runningRun = makeRun({
      ...pausedRun,
      status: "running",
    });
    const completedRun = makeRun({
      ...pausedRun,
      status: "completed",
      currentTicketIndex: 1,
    });
    let getCallCount = 0;

    const layer = makeLayer({
      dispatchedCommands,
      runService: {
        get: () => {
          getCallCount += 1;
          return Effect.succeed(getCallCount === 1 ? pausedRun : runningRun);
        },
        resume: () => Effect.succeed(runningRun),
        updateRunProgress: ({ currentTicketIndex, currentPhase, reviewIteration }) =>
          Effect.succeed(
            makeRun({
              ...runningRun,
              currentTicketIndex,
              currentPhase: currentPhase ?? runningRun.currentPhase,
              reviewIteration: reviewIteration ?? runningRun.reviewIteration,
            }),
          ),
        complete: () => Effect.succeed(completedRun),
      },
      ticketing: {
        getById: ({ id }) => {
          if (id === ticket1Id) {
            return Effect.succeed({ ...ticket1, status: "done" satisfies Ticket["status"] });
          }
          return Effect.succeed(ticket2);
        },
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread2, turnId: "turn-ticket-2" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread2, turnId: "turn-ticket-2" }),
      ]),
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.resumeRun({ runId, mode: "fresh-agent" }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const interruptCommands = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.interrupt" }> =>
        command.type === "thread.turn.interrupt",
    );
    const stopCommands = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.session.stop" }> =>
        command.type === "thread.session.stop",
    );
    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );
    const resumeActivity = parentActivities.find(
      (command) => command.activity.kind === "orchestration.run.resumed",
    );

    expect(interruptCommands.map((command) => command.threadId)).toContain(workingThread2);
    expect(stopCommands.map((command) => command.threadId)).toContain(workingThread2);
    expect(resumeActivity?.activity.summary).toBe("Resumed T3CO-2 with fresh agent");
    expect(resumeActivity?.activity.payload).toMatchObject({
      resumeMode: "fresh-agent",
      ticketId: ticket2Id,
      ticketIdentifier: "T3CO-2",
      phase: "working",
      restartedThreadId: workingThread2,
    });
  });

  it("uses customized resumeFreshAgent prompts for working fresh-agent resumes", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const pausedSingleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      currentTicketIndex: 0,
      currentPhase: "working",
      status: "paused",
    });
    const runningSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "running",
    });
    const completedSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "completed",
    });
    let getCallCount = 0;

    const layer = makeLayer({
      dispatchedCommands,
      serverSettingsOverrides: {
        prompts: {
          orchestration: {
            resumeFreshAgent: {
              version: 1,
              blocks: [
                {
                  when: null,
                  text: "Fresh handoff ${ticketId} in ${projectTitle}",
                },
              ],
            },
          },
        },
      },
      runService: {
        get: () => {
          getCallCount += 1;
          return Effect.succeed(
            getCallCount === 1 ? pausedSingleTicketRun : runningSingleTicketRun,
          );
        },
        resume: () => Effect.succeed(runningSingleTicketRun),
        updateRunProgress: () => Effect.succeed(runningSingleTicketRun),
        complete: () => Effect.succeed(completedSingleTicketRun),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({
          threadId: workingThread1,
          turnId: "turn-resume-fresh-custom",
        }),
        makeTurnCompletedRuntimeEvent({
          threadId: workingThread1,
          turnId: "turn-resume-fresh-custom",
        }),
      ]),
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.resumeRun({ runId, mode: "fresh-agent" }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const turnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start" && command.threadId === workingThread1,
    );

    expect(turnStarts).toHaveLength(1);
    expect(turnStarts[0]?.message.text).toBe("Fresh handoff T3CO-1 in Runner project");
  });

  it("prefers project resumeFreshAgent overrides over global prompt settings", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const pausedSingleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      currentTicketIndex: 0,
      currentPhase: "working",
      status: "paused",
    });
    const runningSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "running",
    });
    const completedSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "completed",
    });
    let getCallCount = 0;

    const layer = makeLayer({
      dispatchedCommands,
      readModelProjects: [
        {
          id: projectId,
          title: "Runner project",
          workspaceRoot: "/tmp/runner-project",
          defaultModelSelection: null,
          systemPrompt: null,
          promptOverrides: {
            orchestration: {
              resumeFreshAgent: {
                version: 1,
                blocks: [
                  {
                    when: null,
                    text: "Project fresh handoff ${ticketId} @ ${projectPath}",
                  },
                ],
              },
            },
          },
          scripts: [],
          createdAt: "2026-04-09T10:00:00.000Z",
          updatedAt: "2026-04-09T10:00:00.000Z",
          deletedAt: null,
        },
      ],
      serverSettingsOverrides: {
        prompts: {
          orchestration: {
            resumeFreshAgent: {
              version: 1,
              blocks: [
                {
                  when: null,
                  text: "Global fresh handoff ${ticketId}",
                },
              ],
            },
          },
        },
      },
      runService: {
        get: () => {
          getCallCount += 1;
          return Effect.succeed(
            getCallCount === 1 ? pausedSingleTicketRun : runningSingleTicketRun,
          );
        },
        resume: () => Effect.succeed(runningSingleTicketRun),
        updateRunProgress: () => Effect.succeed(runningSingleTicketRun),
        complete: () => Effect.succeed(completedSingleTicketRun),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({
          threadId: workingThread1,
          turnId: "turn-resume-fresh-project-override",
        }),
        makeTurnCompletedRuntimeEvent({
          threadId: workingThread1,
          turnId: "turn-resume-fresh-project-override",
        }),
      ]),
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.resumeRun({ runId, mode: "fresh-agent" }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const turnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start" && command.threadId === workingThread1,
    );

    expect(turnStarts).toHaveLength(1);
    expect(turnStarts[0]?.message.text).toBe("Project fresh handoff T3CO-1 @ /tmp/runner-project");
  });

  it("uses customized global orchestration prompt templates from server settings", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const singleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      maxReviewIterations: 1,
    });
    const readModelThreads = makeCompletedWorkAndReviewThreads(
      JSON.stringify({
        changesNeeded: false,
        summary: "Looks good.",
        comments: [],
      }),
    );

    const layer = makeLayer({
      dispatchedCommands,
      readModelThreads,
      serverSettingsOverrides: {
        prompts: {
          orchestration: {
            implement: {
              version: 1,
              blocks: [
                {
                  when: null,
                  text: "Custom implement ${ticketId} in ${projectTitle}",
                },
              ],
            },
            resume: {
              version: 1,
              blocks: [
                {
                  when: null,
                  text: "Resume custom ${ticketId}",
                },
              ],
            },
            review: {
              version: 1,
              blocks: [
                {
                  when: null,
                  text: "Review custom ${ticketId} :: ${commitDiff}",
                },
              ],
            },
            reviewFeedback: {
              version: 1,
              blocks: [
                {
                  when: null,
                  text: "Feedback custom ${ticketId}: ${reviewSummary}",
                },
              ],
            },
          },
        },
      },
      runService: {
        get: () => Effect.succeed(singleTicketRun),
        start: () => Effect.succeed(singleTicketRun),
        updateRunProgress: () =>
          Effect.succeed(
            makeRun({
              ...singleTicketRun,
              currentTicketIndex: 0,
              currentPhase: "reviewing",
            }),
          ),
        complete: () => Effect.succeed(makeRun({ ...singleTicketRun, status: "completed" })),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work" }),
        makeTurnStartedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review" }),
        makeTurnCompletedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review" }),
      ]),
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const turnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start",
    );

    expect(turnStarts.find((command) => command.threadId === workingThread1)?.message.text).toBe(
      "Custom implement T3CO-1 in Runner project",
    );
    expect(turnStarts.find((command) => command.threadId === reviewThread1)?.message.text).toBe(
      "Review custom T3CO-1 :: patch",
    );
  });

  it("prefers project prompt overrides over global orchestration prompt settings", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const singleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      maxReviewIterations: 1,
    });
    const readModelThreads = makeCompletedWorkAndReviewThreads(
      JSON.stringify({
        changesNeeded: false,
        summary: "Project prompt review passed.",
        comments: [],
      }),
    );

    const layer = makeLayer({
      dispatchedCommands,
      readModelThreads,
      readModelProjects: [
        {
          id: projectId,
          title: "Runner project",
          workspaceRoot: "/tmp/runner-project",
          defaultModelSelection: null,
          systemPrompt: null,
          promptOverrides: {
            orchestration: {
              implement: {
                version: 1,
                blocks: [
                  {
                    when: null,
                    text: "Project implement ${ticketId} in ${projectTitle} @ ${projectPath}",
                  },
                ],
              },
              review: {
                version: 1,
                blocks: [
                  {
                    when: null,
                    text: "Project review ${ticketId} :: ${commitDiff}",
                  },
                ],
              },
            },
          },
          scripts: [],
          createdAt: "2026-04-09T10:00:00.000Z",
          updatedAt: "2026-04-09T10:00:00.000Z",
          deletedAt: null,
        },
      ],
      serverSettingsOverrides: {
        prompts: {
          orchestration: {
            implement: {
              version: 1,
              blocks: [{ when: null, text: "Global implement ${ticketId}" }],
            },
            review: {
              version: 1,
              blocks: [{ when: null, text: "Global review ${ticketId}" }],
            },
          },
        },
      },
      runService: {
        get: () => Effect.succeed(singleTicketRun),
        start: () => Effect.succeed(singleTicketRun),
        updateRunProgress: () =>
          Effect.succeed(
            makeRun({
              ...singleTicketRun,
              currentTicketIndex: 0,
              currentPhase: "reviewing",
            }),
          ),
        complete: () => Effect.succeed(makeRun({ ...singleTicketRun, status: "completed" })),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work" }),
        makeTurnStartedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review" }),
        makeTurnCompletedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review" }),
      ]),
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const turnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start",
    );

    expect(turnStarts.find((command) => command.threadId === workingThread1)?.message.text).toBe(
      "Project implement T3CO-1 in Runner project @ /tmp/runner-project",
    );
    expect(turnStarts.find((command) => command.threadId === reviewThread1)?.message.text).toBe(
      "Project review T3CO-1 :: patch",
    );
  });

  it("renders the reviewFeedback prompt for follow-up implementation turns", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const singleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      maxReviewIterations: 1,
    });

    const workingThreadState: OrchestrationThread = {
      id: workingThread1,
      projectId,
      title: ticket1.title,
      modelSelection: { provider: "codex", model: "gpt-5-codex" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      parentThreadId: orchestrationThreadId,
      isOrchestrationThread: false,
      ticketId: ticket1Id,
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-work"),
        state: "completed",
        requestedAt: "2026-04-09T10:00:00.000Z",
        startedAt: "2026-04-09T10:00:00.000Z",
        completedAt: "2026-04-09T10:00:01.000Z",
        assistantMessageId: MessageId.makeUnsafe("assistant-work"),
      },
      createdAt: "2026-04-09T10:00:00.000Z",
      updatedAt: "2026-04-09T10:00:01.000Z",
      archivedAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [
        {
          turnId: TurnId.makeUnsafe("turn-work"),
          checkpointTurnCount: 1,
          checkpointRef: "checkpoint:work-1" as never,
          status: "ready",
          files: [],
          assistantMessageId: MessageId.makeUnsafe("assistant-work"),
          completedAt: "2026-04-09T10:00:01.000Z",
        },
      ],
      session: null,
    };

    const reviewThreadState: OrchestrationThread = {
      id: reviewThread1,
      projectId,
      title: `${ticket1.title} Review`,
      modelSelection: { provider: "codex", model: "gpt-5-codex" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      parentThreadId: orchestrationThreadId,
      isOrchestrationThread: false,
      ticketId: ticket1Id,
      latestTurn: null,
      createdAt: "2026-04-09T10:00:00.000Z",
      updatedAt: "2026-04-09T10:00:00.000Z",
      archivedAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    };
    const mutableReviewThreadState = reviewThreadState as {
      latestTurn: OrchestrationThread["latestTurn"];
      messages: OrchestrationThread["messages"];
      updatedAt: OrchestrationThread["updatedAt"];
    };

    let reviewDispatchCount = 0;
    const setReviewResult = (input: {
      turnId: string;
      assistantMessageId: string;
      text: string;
      completedAt: string;
    }) => {
      mutableReviewThreadState.latestTurn = {
        turnId: TurnId.makeUnsafe(input.turnId),
        state: "completed",
        requestedAt: input.completedAt,
        startedAt: input.completedAt,
        completedAt: input.completedAt,
        assistantMessageId: MessageId.makeUnsafe(input.assistantMessageId),
      };
      mutableReviewThreadState.messages = [
        {
          id: MessageId.makeUnsafe(input.assistantMessageId),
          role: "assistant",
          text: input.text,
          turnId: TurnId.makeUnsafe(input.turnId),
          streaming: false,
          createdAt: input.completedAt,
          updatedAt: input.completedAt,
        },
      ];
      mutableReviewThreadState.updatedAt = input.completedAt;
    };

    const layer = makeLayer({
      dispatchedCommands,
      onDispatch: (command) => {
        if (command.type !== "thread.turn.start" || command.threadId !== reviewThread1) {
          return;
        }
        reviewDispatchCount += 1;
        if (reviewDispatchCount === 1) {
          setReviewResult({
            turnId: "turn-review-1",
            assistantMessageId: "assistant-review-1",
            completedAt: "2026-04-09T10:00:03.000Z",
            text: JSON.stringify({
              changesNeeded: true,
              summary: "Tighten the auth guard.",
              comments: [
                {
                  file: "src/auth.ts",
                  line: 7,
                  severity: "critical",
                  body: "Handle the missing token case.",
                },
                {
                  file: null,
                  line: null,
                  severity: "suggestion",
                  body: "Re-run the edge-case path.",
                },
              ],
            }),
          });
          return;
        }

        setReviewResult({
          turnId: "turn-review-2",
          assistantMessageId: "assistant-review-2",
          completedAt: "2026-04-09T10:00:05.000Z",
          text: JSON.stringify({
            changesNeeded: false,
            summary: "Ready to accept.",
            comments: [],
          }),
        });
      },
      serverSettingsOverrides: {
        prompts: {
          orchestration: {
            reviewFeedback: {
              version: 1,
              blocks: [
                {
                  when: null,
                  text: "Feedback custom ${ticketId}: ${reviewSummary}",
                },
                {
                  when: { type: "exists", variable: "reviewComments" },
                  text: "\n${reviewComments}",
                },
              ],
            },
          },
        },
      },
      runService: {
        get: () => Effect.succeed(singleTicketRun),
        start: () => Effect.succeed(singleTicketRun),
        updateRunProgress: () => Effect.succeed(singleTicketRun),
        complete: () => Effect.succeed(makeRun({ ...singleTicketRun, status: "completed" })),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work-1" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work-1" }),
        makeTurnStartedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-1" }),
        makeTurnCompletedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-1" }),
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work-2" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work-2" }),
        makeTurnStartedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-2" }),
        makeTurnCompletedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-2" }),
      ]),
      readModelThreads: [workingThreadState, reviewThreadState],
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const workTurnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start" && command.threadId === workingThread1,
    );

    expect(workTurnStarts).toHaveLength(2);
    expect(workTurnStarts[1]?.message.text).toBe(
      "Feedback custom T3CO-1: Tighten the auth guard.\n- [critical] src/auth.ts:7 - Handle the missing token case.\n- [suggestion] general - Re-run the edge-case path.",
    );
  });

  it("uses reReview with prior summary and delta diff on later review iterations", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const singleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      maxReviewIterations: 2,
    });
    const completedSingleTicketRun = makeRun({
      ...singleTicketRun,
      status: "completed",
      currentTicketIndex: 0,
    });
    const [initialWorkingThread, initialReviewThread] = makeCompletedWorkAndReviewThreads(
      JSON.stringify({
        changesNeeded: false,
        summary: "placeholder",
        comments: [],
      }),
    );
    const orchestrationThreadState = makeOrchestrationParentThread();
    const workingThreadState = {
      ...initialWorkingThread,
      latestTurn: null,
      messages: [],
      checkpoints: [],
    } as OrchestrationThread;
    const reviewThreadState = {
      ...initialReviewThread,
      latestTurn: null,
      messages: [],
      updatedAt: "2026-04-09T10:00:00.000Z",
    } as OrchestrationThread;
    const mutableWorkingThreadState = workingThreadState as {
      latestTurn: OrchestrationThread["latestTurn"];
      checkpoints: OrchestrationThread["checkpoints"];
      updatedAt: OrchestrationThread["updatedAt"];
    };
    const mutableReviewThreadState = reviewThreadState as {
      latestTurn: OrchestrationThread["latestTurn"];
      messages: OrchestrationThread["messages"];
      updatedAt: OrchestrationThread["updatedAt"];
    };

    let workDispatchCount = 0;
    let reviewDispatchCount = 0;
    const getFullThreadDiff = vi.fn(({ toTurnCount }: { toTurnCount: number }) =>
      Effect.succeed({
        threadId: workingThread1,
        fromTurnCount: 0,
        toTurnCount,
        diff: `full-${toTurnCount}`,
      }),
    );
    const getTurnDiff = vi.fn(
      ({ fromTurnCount, toTurnCount }: { fromTurnCount: number; toTurnCount: number }) =>
        Effect.succeed({
          threadId: workingThread1,
          fromTurnCount,
          toTurnCount,
          diff: `delta-${fromTurnCount}-${toTurnCount}`,
        }),
    );

    const layer = makeLayer({
      dispatchedCommands,
      checkpointDiffQuery: {
        getFullThreadDiff,
        getTurnDiff,
      },
      onDispatch: (command) => {
        if (command.type === "thread.turn.start" && command.threadId === workingThread1) {
          workDispatchCount += 1;
          const turnId = TurnId.makeUnsafe(`turn-work-${workDispatchCount}`);
          const assistantMessageId = MessageId.makeUnsafe(`assistant-work-${workDispatchCount}`);
          mutableWorkingThreadState.latestTurn = {
            turnId,
            state: "completed",
            requestedAt: `2026-04-09T10:00:0${workDispatchCount}.000Z`,
            startedAt: `2026-04-09T10:00:0${workDispatchCount}.000Z`,
            completedAt: `2026-04-09T10:00:0${workDispatchCount}.000Z`,
            assistantMessageId,
          };
          mutableWorkingThreadState.checkpoints = [
            {
              turnId,
              checkpointTurnCount: workDispatchCount,
              checkpointRef: `checkpoint:work-${workDispatchCount}` as never,
              status: "ready",
              files: [],
              assistantMessageId,
              completedAt: `2026-04-09T10:00:0${workDispatchCount}.000Z`,
            },
          ];
          mutableWorkingThreadState.updatedAt = `2026-04-09T10:00:0${workDispatchCount}.000Z`;
          return;
        }

        if (command.type !== "thread.turn.start" || command.threadId !== reviewThread1) {
          return;
        }

        reviewDispatchCount += 1;
        const turnId = TurnId.makeUnsafe(`turn-review-${reviewDispatchCount}`);
        const assistantMessageId = MessageId.makeUnsafe(`assistant-review-${reviewDispatchCount}`);
        mutableReviewThreadState.latestTurn = {
          turnId,
          state: "completed",
          requestedAt: `2026-04-09T10:00:1${reviewDispatchCount}.000Z`,
          startedAt: `2026-04-09T10:00:1${reviewDispatchCount}.000Z`,
          completedAt: `2026-04-09T10:00:1${reviewDispatchCount}.000Z`,
          assistantMessageId,
        };
        mutableReviewThreadState.messages = [
          {
            id: assistantMessageId,
            role: "assistant",
            text: JSON.stringify(
              reviewDispatchCount === 1
                ? {
                    changesNeeded: true,
                    summary: "Tighten the auth guard.",
                    comments: [],
                  }
                : {
                    changesNeeded: false,
                    summary: "Looks good now.",
                    comments: [],
                  },
            ),
            turnId,
            streaming: false,
            createdAt: `2026-04-09T10:00:1${reviewDispatchCount}.000Z`,
            updatedAt: `2026-04-09T10:00:1${reviewDispatchCount}.000Z`,
          },
        ];
        mutableReviewThreadState.updatedAt = `2026-04-09T10:00:1${reviewDispatchCount}.000Z`;
      },
      readModelThreads: [orchestrationThreadState, workingThreadState, reviewThreadState],
      runService: {
        get: () => Effect.succeed(singleTicketRun),
        start: () => Effect.succeed(singleTicketRun),
        updateRunProgress: () => Effect.succeed(singleTicketRun),
        complete: () => Effect.succeed(completedSingleTicketRun),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work-1" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work-1" }),
        makeTurnStartedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-1" }),
        makeTurnCompletedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-1" }),
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work-2" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work-2" }),
        makeTurnStartedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-2" }),
        makeTurnCompletedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-2" }),
      ]),
      serverSettingsOverrides: {
        prompts: {
          orchestration: {
            review: {
              version: 1,
              blocks: [{ when: null, text: "Review ${ticketId} ${commitDiff} ${reviewIteration}" }],
            },
            reReview: {
              version: 1,
              blocks: [
                { when: null, text: "ReReview ${ticketId}" },
                {
                  when: { type: "exists", variable: "reviewSummary" },
                  text: "\n${reviewSummary}",
                },
                { when: null, text: "\n${commitDiff}\n${reviewIteration}" },
              ],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const reviewTurnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start" && command.threadId === reviewThread1,
    );

    expect(reviewTurnStarts).toHaveLength(2);
    expect(reviewTurnStarts[0]?.message.text).toBe("Review T3CO-1 full-1 1");
    expect(reviewTurnStarts[1]?.message.text).toBe(
      "ReReview T3CO-1\nTighten the auth guard.\ndelta-1-2\n2",
    );
    expect(getFullThreadDiff).toHaveBeenCalledTimes(1);
    expect(getTurnDiff).toHaveBeenCalledTimes(1);
    expect(getTurnDiff).toHaveBeenCalledWith({
      threadId: workingThread1,
      fromTurnCount: 1,
      toTurnCount: 2,
    });
  });

  it("falls back to the full diff for reReview when no prior review boundary exists", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const pausedSingleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      currentTicketIndex: 0,
      currentPhase: "working",
      reviewIteration: 1,
      maxReviewIterations: 2,
      status: "paused",
    });
    const runningSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "running",
    });
    const completedSingleTicketRun = makeRun({
      ...pausedSingleTicketRun,
      status: "completed",
    });
    const [initialWorkingThread, initialReviewThread] = makeCompletedWorkAndReviewThreads(
      JSON.stringify({
        changesNeeded: false,
        summary: "placeholder",
        comments: [],
      }),
    );
    const orchestrationThreadState = makeOrchestrationParentThread();
    const workingThreadState = {
      ...initialWorkingThread,
      updatedAt: "2026-04-09T10:00:00.000Z",
    } as OrchestrationThread;
    const reviewThreadState = {
      ...initialReviewThread,
      latestTurn: null,
      messages: [],
      updatedAt: "2026-04-09T10:00:00.000Z",
    } as OrchestrationThread;
    const mutableWorkingThreadState = workingThreadState as {
      latestTurn: OrchestrationThread["latestTurn"];
      checkpoints: OrchestrationThread["checkpoints"];
      updatedAt: OrchestrationThread["updatedAt"];
    };
    const mutableReviewThreadState = reviewThreadState as {
      latestTurn: OrchestrationThread["latestTurn"];
      messages: OrchestrationThread["messages"];
      updatedAt: OrchestrationThread["updatedAt"];
    };
    let getCallCount = 0;

    const getFullThreadDiff = vi.fn(({ toTurnCount }: { toTurnCount: number }) =>
      Effect.succeed({
        threadId: workingThread1,
        fromTurnCount: 0,
        toTurnCount,
        diff: `full-${toTurnCount}`,
      }),
    );
    const getTurnDiff = vi.fn(() => Effect.die(new Error("getTurnDiff should not be called")));

    const layer = makeLayer({
      dispatchedCommands,
      checkpointDiffQuery: {
        getFullThreadDiff,
        getTurnDiff,
      },
      onDispatch: (command) => {
        if (command.type === "thread.turn.start" && command.threadId === workingThread1) {
          const turnId = TurnId.makeUnsafe("turn-work-2");
          const assistantMessageId = MessageId.makeUnsafe("assistant-work-2");
          mutableWorkingThreadState.latestTurn = {
            turnId,
            state: "completed",
            requestedAt: "2026-04-09T10:00:02.000Z",
            startedAt: "2026-04-09T10:00:02.000Z",
            completedAt: "2026-04-09T10:00:02.000Z",
            assistantMessageId,
          };
          mutableWorkingThreadState.checkpoints = [
            {
              turnId: TurnId.makeUnsafe("turn-work-1"),
              checkpointTurnCount: 1,
              checkpointRef: "checkpoint:work-1" as never,
              status: "ready",
              files: [],
              assistantMessageId: MessageId.makeUnsafe("assistant-work"),
              completedAt: "2026-04-09T10:00:01.000Z",
            },
            {
              turnId,
              checkpointTurnCount: 2,
              checkpointRef: "checkpoint:work-2" as never,
              status: "ready",
              files: [],
              assistantMessageId,
              completedAt: "2026-04-09T10:00:02.000Z",
            },
          ];
          mutableWorkingThreadState.updatedAt = "2026-04-09T10:00:02.000Z";
          return;
        }

        if (command.type !== "thread.turn.start" || command.threadId !== reviewThread1) {
          return;
        }

        const turnId = TurnId.makeUnsafe("turn-review-2");
        const assistantMessageId = MessageId.makeUnsafe("assistant-review-2");
        mutableReviewThreadState.latestTurn = {
          turnId,
          state: "completed",
          requestedAt: "2026-04-09T10:00:03.000Z",
          startedAt: "2026-04-09T10:00:03.000Z",
          completedAt: "2026-04-09T10:00:03.000Z",
          assistantMessageId,
        };
        mutableReviewThreadState.messages = [
          {
            id: assistantMessageId,
            role: "assistant",
            text: JSON.stringify({
              changesNeeded: false,
              summary: "Looks good now.",
              comments: [],
            }),
            turnId,
            streaming: false,
            createdAt: "2026-04-09T10:00:03.000Z",
            updatedAt: "2026-04-09T10:00:03.000Z",
          },
        ];
        mutableReviewThreadState.updatedAt = "2026-04-09T10:00:03.000Z";
      },
      readModelThreads: [orchestrationThreadState, workingThreadState, reviewThreadState],
      runService: {
        get: () => {
          getCallCount += 1;
          return Effect.succeed(
            getCallCount === 1 ? pausedSingleTicketRun : runningSingleTicketRun,
          );
        },
        resume: () => Effect.succeed(runningSingleTicketRun),
        updateRunProgress: () => Effect.succeed(runningSingleTicketRun),
        complete: () => Effect.succeed(completedSingleTicketRun),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work-2" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work-2" }),
        makeTurnStartedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-2" }),
        makeTurnCompletedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review-2" }),
      ]),
      serverSettingsOverrides: {
        prompts: {
          orchestration: {
            reReview: {
              version: 1,
              blocks: [
                { when: null, text: "ReReview ${ticketId}" },
                {
                  when: { type: "exists", variable: "reviewSummary" },
                  text: "\n${reviewSummary}",
                },
                { when: null, text: "\n${commitDiff}\n${reviewIteration}" },
              ],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.resumeRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const reviewTurnStart = dispatchedCommands.find(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start" && command.threadId === reviewThread1,
    );

    expect(reviewTurnStart?.message.text).toBe("ReReview T3CO-1\nfull-2\n2");
    expect(getFullThreadDiff).toHaveBeenCalledTimes(1);
    expect(getTurnDiff).not.toHaveBeenCalled();
  });

  it("pauses with a prompt-specific activity when the effective prompt document is invalid", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const singleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
    });
    const pausedRun = makeRun({
      ...singleTicketRun,
      status: "paused",
      currentTicketIndex: 0,
    });

    const layer = makeLayer({
      dispatchedCommands,
      serverSettingsOverrides: {
        prompts: {
          orchestration: {
            implement: {
              version: 1,
              blocks: [
                {
                  when: null,
                  text: "Broken ${reviewSummary}",
                },
              ],
            },
          },
        },
      },
      runService: {
        get: () => Effect.succeed(singleTicketRun),
        start: () => Effect.succeed(singleTicketRun),
        updateRunProgress: () => Effect.succeed(singleTicketRun),
        pause: () => Effect.succeed(pausedRun),
      },
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );
    const workTurnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start" && command.threadId === workingThread1,
    );

    expect(workTurnStarts).toHaveLength(0);
    expect(parentActivities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: "orchestration.run.prompt.render.failed",
            summary: expect.stringContaining("implement"),
            payload: expect.objectContaining({
              ticketId: ticket1Id,
              ticketIdentifier: ticket1.identifier,
              promptId: "implement",
            }),
          }),
        }),
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: "orchestration.run.paused",
            summary: expect.stringContaining("implement"),
          }),
        }),
      ]),
    );
  });

  it("pauses with a prompt-specific activity when the resumeFreshAgent prompt document is invalid", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const pausedRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      status: "paused",
      currentTicketIndex: 0,
      currentPhase: "working",
    });
    const runningRun = makeRun({
      ...pausedRun,
      status: "running",
    });
    let getCallCount = 0;

    const layer = makeLayer({
      dispatchedCommands,
      serverSettingsOverrides: {
        prompts: {
          orchestration: {
            resumeFreshAgent: {
              version: 1,
              blocks: [
                {
                  when: null,
                  text: "Broken ${reviewSummary}",
                },
              ],
            },
          },
        },
      },
      runService: {
        get: () => {
          getCallCount += 1;
          return Effect.succeed(getCallCount === 1 ? pausedRun : runningRun);
        },
        resume: () => Effect.succeed(runningRun),
        updateRunProgress: () => Effect.succeed(runningRun),
        pause: () => Effect.succeed(pausedRun),
      },
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.resumeRun({ runId, mode: "fresh-agent" }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );
    const workTurnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start" && command.threadId === workingThread1,
    );

    expect(workTurnStarts).toHaveLength(0);
    expect(parentActivities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: "orchestration.run.prompt.render.failed",
            summary: expect.stringContaining("resumeFreshAgent"),
            payload: expect.objectContaining({
              ticketId: ticket1Id,
              ticketIdentifier: ticket1.identifier,
              promptId: "resumeFreshAgent",
            }),
          }),
        }),
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: "orchestration.run.paused",
            summary: expect.stringContaining("resumeFreshAgent"),
          }),
        }),
      ]),
    );
  });

  it("includes ticket metadata in parent orchestration activities", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const singleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
    });
    const layer = makeLayer({
      dispatchedCommands,
      runService: {
        get: () => Effect.succeed(singleTicketRun),
        start: () => Effect.succeed(singleTicketRun),
        updateRunProgress: () =>
          Effect.succeed(
            makeRun({
              ...singleTicketRun,
              currentTicketIndex: 0,
            }),
          ),
        complete: () => Effect.succeed(makeRun({ ...singleTicketRun, status: "completed" })),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1 }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1 }),
      ]),
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );
    const ticketStarted = parentActivities.find(
      (command) => command.activity.kind === "orchestration.run.ticket.started",
    );
    const ticketCompleted = parentActivities.find(
      (command) => command.activity.kind === "orchestration.run.ticket.completed",
    );

    expect(ticketStarted?.activity.payload).toMatchObject({
      ticketId: ticket1Id,
      ticketIdentifier: ticket1.identifier,
      workingThreadId: workingThread1,
    });
    expect(ticketCompleted?.activity.payload).toMatchObject({
      ticketId: ticket1Id,
      ticketIdentifier: ticket1.identifier,
      workingThreadId: workingThread1,
    });
  });

  it("moves directly to the next ticket when automated review is disabled", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const statusUpdates: Array<{ id: TicketId; status?: Ticket["status"] }> = [];
    const progressUpdates: Array<{
      currentTicketIndex: number;
      currentPhase?: OrchestrationRun["currentPhase"];
      reviewIteration?: number;
    }> = [];
    const ticketState = new Map<TicketId, Ticket>([
      [ticket1Id, ticket1],
      [ticket2Id, ticket2],
    ]);
    const noReviewRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1 },
        { ticketId: ticket2Id, workingThreadId: workingThread2 },
      ],
      maxReviewIterations: 0,
    });
    const completedRun = makeRun({
      ...noReviewRun,
      status: "completed",
    });

    const layer = makeLayer({
      dispatchedCommands,
      runService: {
        get: () => Effect.succeed(noReviewRun),
        start: () => Effect.succeed(noReviewRun),
        updateRunProgress: ({ currentTicketIndex, currentPhase, reviewIteration }) =>
          Effect.sync(() => {
            progressUpdates.push({
              currentTicketIndex,
              ...(currentPhase ? { currentPhase } : {}),
              ...(reviewIteration !== undefined ? { reviewIteration } : {}),
            });
            return noReviewRun;
          }),
        complete: () => Effect.succeed(completedRun),
      },
      ticketing: {
        getById: ({ id }) => Effect.succeed(ticketState.get(id)!),
        update: ({ id, ...changes }) =>
          Effect.sync(() => {
            statusUpdates.push({
              id,
              ...(changes.status !== undefined ? { status: changes.status } : {}),
            });
            const nextTicket = {
              ...ticketState.get(id)!,
              ...changes,
            } as Ticket;
            ticketState.set(id, nextTicket);
            return nextTicket;
          }),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work-1" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work-1" }),
        makeTurnStartedRuntimeEvent({ threadId: workingThread2, turnId: "turn-work-2" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread2, turnId: "turn-work-2" }),
      ]),
      readModelThreads: [
        {
          id: workingThread1,
          projectId,
          title: ticket1.title,
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          parentThreadId: orchestrationThreadId,
          isOrchestrationThread: false,
          ticketId: ticket1Id,
          latestTurn: null,
          createdAt: "2026-04-09T10:00:00.000Z",
          updatedAt: "2026-04-09T10:00:00.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: null,
        },
        {
          id: workingThread2,
          projectId,
          title: ticket2.title,
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          parentThreadId: orchestrationThreadId,
          isOrchestrationThread: false,
          ticketId: ticket2Id,
          latestTurn: null,
          createdAt: "2026-04-09T10:00:00.000Z",
          updatedAt: "2026-04-09T10:00:00.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: null,
        },
      ],
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const workingTurnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start" &&
        (command.threadId === workingThread1 || command.threadId === workingThread2),
    );
    const reviewTurnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start" &&
        (command.threadId === reviewThread1 || command.threadId === reviewThread2),
    );
    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );
    const completedActivities = parentActivities.filter(
      (command) => command.activity.kind === "orchestration.run.ticket.completed",
    );

    expect(workingTurnStarts.map((command) => command.threadId)).toEqual([
      workingThread1,
      workingThread2,
    ]);
    expect(reviewTurnStarts).toHaveLength(0);
    expect(statusUpdates.map((update) => [update.id, update.status])).toEqual([
      [ticket1Id, "in_progress"],
      [ticket1Id, "done"],
      [ticket2Id, "in_progress"],
      [ticket2Id, "done"],
    ]);
    expect(progressUpdates).toEqual([
      { currentTicketIndex: 0, currentPhase: "working", reviewIteration: 0 },
      { currentTicketIndex: 1, currentPhase: "working", reviewIteration: 0 },
    ]);
    expect(parentActivities.map((command) => command.activity.kind)).toEqual([
      "orchestration.run.started",
      "orchestration.run.ticket.started",
      "orchestration.run.ticket.completed",
      "orchestration.run.ticket.started",
      "orchestration.run.ticket.completed",
      "orchestration.run.completed",
    ]);
    expect(
      completedActivities.map((command) => {
        const payload = command.activity.payload as {
          ticketId: TicketId;
          reviewThreadId?: ThreadId;
        };
        return {
          ticketId: payload.ticketId,
          reviewThreadId: payload.reviewThreadId,
        };
      }),
    ).toEqual([
      { ticketId: ticket1Id, reviewThreadId: undefined },
      { ticketId: ticket2Id, reviewThreadId: undefined },
    ]);
  });

  it("treats an aborted provider turn as paused instead of completed", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const singleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
    });
    const pausedSingleTicketRun = makeRun({
      ...singleTicketRun,
      status: "paused",
      currentTicketIndex: 0,
    });

    const layer = makeLayer({
      dispatchedCommands,
      runService: {
        get: () => Effect.succeed(singleTicketRun),
        start: () => Effect.succeed(singleTicketRun),
        updateRunProgress: () =>
          Effect.succeed(
            makeRun({
              ...singleTicketRun,
              currentTicketIndex: 0,
            }),
          ),
        pause: () => Effect.succeed(pausedSingleTicketRun),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-abort" }),
        makeTurnAbortedRuntimeEvent({
          threadId: workingThread1,
          turnId: "turn-abort",
          reason: "user interrupt",
        }),
      ]),
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );

    expect(parentActivities.map((command) => command.activity.kind)).toContain(
      "orchestration.run.paused",
    );
    expect(parentActivities.map((command) => command.activity.kind)).not.toContain(
      "orchestration.run.ticket.completed",
    );
    expect(parentActivities.map((command) => command.activity.kind)).not.toContain(
      "orchestration.run.completed",
    );
  });

  it("routes successful work through the review thread before completing the ticket", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const singleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      maxReviewIterations: 1,
    });
    const layer = makeLayer({
      dispatchedCommands,
      runService: {
        get: () => Effect.succeed(singleTicketRun),
        start: () => Effect.succeed(singleTicketRun),
        updateRunProgress: () => Effect.succeed(singleTicketRun),
        complete: () => Effect.succeed(makeRun({ ...singleTicketRun, status: "completed" })),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work" }),
        makeTurnStartedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review" }),
        makeTurnCompletedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review" }),
      ]),
      readModelThreads: [
        {
          id: workingThread1,
          projectId,
          title: ticket1.title,
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          parentThreadId: orchestrationThreadId,
          isOrchestrationThread: false,
          ticketId: ticket1Id,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-work"),
            state: "completed",
            requestedAt: "2026-04-09T10:00:00.000Z",
            startedAt: "2026-04-09T10:00:00.000Z",
            completedAt: "2026-04-09T10:00:01.000Z",
            assistantMessageId: MessageId.makeUnsafe("assistant-work"),
          },
          createdAt: "2026-04-09T10:00:00.000Z",
          updatedAt: "2026-04-09T10:00:01.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          activities: [],
          checkpoints: [
            {
              turnId: TurnId.makeUnsafe("turn-work"),
              checkpointTurnCount: 1,
              checkpointRef: "checkpoint:work-1" as never,
              status: "ready",
              files: [],
              assistantMessageId: MessageId.makeUnsafe("assistant-work"),
              completedAt: "2026-04-09T10:00:01.000Z",
            },
          ],
          session: null,
        },
        {
          id: reviewThread1,
          projectId,
          title: `${ticket1.title} Review`,
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          parentThreadId: orchestrationThreadId,
          isOrchestrationThread: false,
          ticketId: ticket1Id,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-review"),
            state: "completed",
            requestedAt: "2026-04-09T10:00:02.000Z",
            startedAt: "2026-04-09T10:00:02.000Z",
            completedAt: "2026-04-09T10:00:03.000Z",
            assistantMessageId: MessageId.makeUnsafe("assistant-review"),
          },
          createdAt: "2026-04-09T10:00:00.000Z",
          updatedAt: "2026-04-09T10:00:03.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [
            {
              id: MessageId.makeUnsafe("assistant-review"),
              role: "assistant",
              text: `The only "Projects" string used as a UI label was the one changed.

\`\`\`json
{
  "changesNeeded": false,
  "summary": "Looks good.",
  "comments": []
}
\`\`\``,
              turnId: TurnId.makeUnsafe("turn-review"),
              streaming: false,
              createdAt: "2026-04-09T10:00:03.000Z",
              updatedAt: "2026-04-09T10:00:03.000Z",
            },
          ],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: null,
        },
      ],
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );
    const reviewTurnStarts = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start" && command.threadId === reviewThread1,
    );

    expect(reviewTurnStarts).toHaveLength(1);
    expect(parentActivities.map((command) => command.activity.kind)).toContain(
      "orchestration.run.ticket.review.started",
    );
    expect(parentActivities.map((command) => command.activity.kind)).toContain(
      "orchestration.run.ticket.review.approved",
    );
    expect(parentActivities.map((command) => command.activity.kind)).toContain(
      "orchestration.run.ticket.completed",
    );
  });

  it("blocks and pauses when the review output is invalid JSON", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const singleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      maxReviewIterations: 1,
    });
    const pausedRun = makeRun({
      ...singleTicketRun,
      status: "paused",
      currentPhase: "reviewing",
      currentTicketIndex: 0,
    });
    const layer = makeLayer({
      dispatchedCommands,
      runService: {
        get: () => Effect.succeed(singleTicketRun),
        start: () => Effect.succeed(singleTicketRun),
        updateRunProgress: () => Effect.succeed(singleTicketRun),
        pause: () => Effect.succeed(pausedRun),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work" }),
        makeTurnStartedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review" }),
        makeTurnCompletedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review" }),
      ]),
      readModelThreads: [
        {
          id: workingThread1,
          projectId,
          title: ticket1.title,
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          parentThreadId: orchestrationThreadId,
          isOrchestrationThread: false,
          ticketId: ticket1Id,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-work"),
            state: "completed",
            requestedAt: "2026-04-09T10:00:00.000Z",
            startedAt: "2026-04-09T10:00:00.000Z",
            completedAt: "2026-04-09T10:00:01.000Z",
            assistantMessageId: MessageId.makeUnsafe("assistant-work"),
          },
          createdAt: "2026-04-09T10:00:00.000Z",
          updatedAt: "2026-04-09T10:00:01.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          activities: [],
          checkpoints: [
            {
              turnId: TurnId.makeUnsafe("turn-work"),
              checkpointTurnCount: 1,
              checkpointRef: "checkpoint:work-1" as never,
              status: "ready",
              files: [],
              assistantMessageId: MessageId.makeUnsafe("assistant-work"),
              completedAt: "2026-04-09T10:00:01.000Z",
            },
          ],
          session: null,
        },
        {
          id: reviewThread1,
          projectId,
          title: `${ticket1.title} Review`,
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          parentThreadId: orchestrationThreadId,
          isOrchestrationThread: false,
          ticketId: ticket1Id,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-review"),
            state: "completed",
            requestedAt: "2026-04-09T10:00:02.000Z",
            startedAt: "2026-04-09T10:00:02.000Z",
            completedAt: "2026-04-09T10:00:03.000Z",
            assistantMessageId: MessageId.makeUnsafe("assistant-review"),
          },
          createdAt: "2026-04-09T10:00:00.000Z",
          updatedAt: "2026-04-09T10:00:03.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [
            {
              id: MessageId.makeUnsafe("assistant-review"),
              role: "assistant",
              text: "not json",
              turnId: TurnId.makeUnsafe("turn-review"),
              streaming: false,
              createdAt: "2026-04-09T10:00:03.000Z",
              updatedAt: "2026-04-09T10:00:03.000Z",
            },
          ],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: null,
        },
      ],
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );

    expect(parentActivities.map((command) => command.activity.kind)).toContain(
      "orchestration.run.paused",
    );
    expect(parentActivities.map((command) => command.activity.kind)).not.toContain(
      "orchestration.run.ticket.review.approved",
    );
  });

  it("waits for the finalized assistant review message before parsing", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const singleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      maxReviewIterations: 1,
    });
    const completedRun = makeRun({
      ...singleTicketRun,
      status: "completed",
      currentTicketIndex: 0,
      currentPhase: "reviewing",
    });
    const workingThreadState = makeCompletedWorkAndReviewThreads(
      JSON.stringify({
        changesNeeded: false,
        summary: "unused",
        comments: [],
      }),
    )[0]!;
    const reviewThreadState = {
      ...makeCompletedWorkAndReviewThreads("{}")[1]!,
      latestTurn: null,
      messages: [],
      updatedAt: "2026-04-09T10:00:00.000Z",
    } as OrchestrationThread;
    const mutableReviewThreadState = reviewThreadState as {
      latestTurn: OrchestrationThread["latestTurn"];
      messages: OrchestrationThread["messages"];
      updatedAt: OrchestrationThread["updatedAt"];
    };

    const layer = makeLayer({
      dispatchedCommands,
      runService: {
        get: () => Effect.succeed(singleTicketRun),
        start: () => Effect.succeed(singleTicketRun),
        updateRunProgress: () => Effect.succeed(singleTicketRun),
        complete: () => Effect.succeed(completedRun),
        pause: () => Effect.die("pause should not be called"),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work" }),
        makeTurnStartedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review" }),
        makeTurnCompletedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review" }),
      ]),
      readModelThreads: [makeOrchestrationParentThread(), workingThreadState, reviewThreadState],
      onDispatch: (command) => {
        if (command.type !== "thread.turn.start" || command.threadId !== reviewThread1) {
          return;
        }

        mutableReviewThreadState.latestTurn = {
          turnId: TurnId.makeUnsafe("turn-review"),
          state: "completed",
          requestedAt: "2026-04-09T10:00:02.000Z",
          startedAt: "2026-04-09T10:00:02.000Z",
          completedAt: "2026-04-09T10:00:03.000Z",
          assistantMessageId: MessageId.makeUnsafe("assistant-review-plain"),
        };
        mutableReviewThreadState.messages = [
          {
            id: MessageId.makeUnsafe("assistant-review-plain"),
            role: "assistant",
            text: "All 8 browser tests pass. Let me verify scope quickly.",
            turnId: TurnId.makeUnsafe("turn-review"),
            streaming: false,
            createdAt: "2026-04-09T10:00:02.000Z",
            updatedAt: "2026-04-09T10:00:02.000Z",
          },
        ];
        mutableReviewThreadState.updatedAt = "2026-04-09T10:00:02.000Z";

        setTimeout(() => {
          mutableReviewThreadState.latestTurn = {
            turnId: TurnId.makeUnsafe("turn-review"),
            state: "completed",
            requestedAt: "2026-04-09T10:00:02.000Z",
            startedAt: "2026-04-09T10:00:02.000Z",
            completedAt: "2026-04-09T10:00:03.000Z",
            assistantMessageId: MessageId.makeUnsafe("assistant-review-final"),
          };
          mutableReviewThreadState.messages = [
            {
              id: MessageId.makeUnsafe("assistant-review-plain"),
              role: "assistant",
              text: "All 8 browser tests pass. Let me verify scope quickly.",
              turnId: TurnId.makeUnsafe("turn-review"),
              streaming: false,
              createdAt: "2026-04-09T10:00:02.000Z",
              updatedAt: "2026-04-09T10:00:02.000Z",
            },
            {
              id: MessageId.makeUnsafe("assistant-review-final"),
              role: "assistant",
              text: JSON.stringify({
                changesNeeded: false,
                summary: "Ready to accept.",
                comments: [],
              }),
              turnId: TurnId.makeUnsafe("turn-review"),
              streaming: false,
              createdAt: "2026-04-09T10:00:03.000Z",
              updatedAt: "2026-04-09T10:00:03.000Z",
            },
          ];
          mutableReviewThreadState.updatedAt = "2026-04-09T10:00:03.000Z";
        }, 50);
      },
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 125));

    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );

    expect(parentActivities.map((command) => command.activity.kind)).toContain(
      "orchestration.run.ticket.review.approved",
    );
    expect(parentActivities.map((command) => command.activity.kind)).toContain(
      "orchestration.run.completed",
    );
    expect(parentActivities.map((command) => command.activity.kind)).not.toContain(
      "orchestration.run.paused",
    );
  });

  it("approves a review when metadata JSON appears before the review payload", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const singleTicketRun = makeRun({
      ticketOrder: [
        { ticketId: ticket1Id, workingThreadId: workingThread1, reviewThreadId: reviewThread1 },
      ],
      maxReviewIterations: 1,
    });
    const layer = makeLayer({
      dispatchedCommands,
      runService: {
        get: () => Effect.succeed(singleTicketRun),
        start: () => Effect.succeed(singleTicketRun),
        updateRunProgress: () => Effect.succeed(singleTicketRun),
        pause: () => Effect.die("pause should not be called"),
      },
      providerEvents: Stream.fromIterable([
        makeTurnStartedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work" }),
        makeTurnCompletedRuntimeEvent({ threadId: workingThread1, turnId: "turn-work" }),
        makeTurnStartedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review" }),
        makeTurnCompletedRuntimeEvent({ threadId: reviewThread1, turnId: "turn-review" }),
      ]),
      readModelThreads: [
        {
          id: workingThread1,
          projectId,
          title: ticket1.title,
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          parentThreadId: orchestrationThreadId,
          isOrchestrationThread: false,
          ticketId: ticket1Id,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-work"),
            state: "completed",
            requestedAt: "2026-04-09T10:00:00.000Z",
            startedAt: "2026-04-09T10:00:00.000Z",
            completedAt: "2026-04-09T10:00:01.000Z",
            assistantMessageId: MessageId.makeUnsafe("assistant-work"),
          },
          createdAt: "2026-04-09T10:00:00.000Z",
          updatedAt: "2026-04-09T10:00:01.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          activities: [],
          checkpoints: [
            {
              turnId: TurnId.makeUnsafe("turn-work"),
              checkpointTurnCount: 1,
              checkpointRef: "checkpoint:work-1" as never,
              status: "ready",
              files: [],
              assistantMessageId: MessageId.makeUnsafe("assistant-work"),
              completedAt: "2026-04-09T10:00:01.000Z",
            },
          ],
          session: null,
        },
        {
          id: reviewThread1,
          projectId,
          title: `${ticket1.title} Review`,
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          parentThreadId: orchestrationThreadId,
          isOrchestrationThread: false,
          ticketId: ticket1Id,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-review"),
            state: "completed",
            requestedAt: "2026-04-09T10:00:02.000Z",
            startedAt: "2026-04-09T10:00:02.000Z",
            completedAt: "2026-04-09T10:00:03.000Z",
            assistantMessageId: MessageId.makeUnsafe("assistant-review"),
          },
          createdAt: "2026-04-09T10:00:00.000Z",
          updatedAt: "2026-04-09T10:00:03.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [
            {
              id: MessageId.makeUnsafe("assistant-review"),
              role: "assistant",
              text: `{"kind":"metadata"}

{"changesNeeded":false,"summary":"Looks good.","comments":[],"suggestions":["Legacy follow-up is still parseable."]}`,
              turnId: TurnId.makeUnsafe("turn-review"),
              streaming: false,
              createdAt: "2026-04-09T10:00:03.000Z",
              updatedAt: "2026-04-09T10:00:03.000Z",
            },
          ],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: null,
        },
      ],
    });

    await Effect.runPromise(
      Effect.flatMap(Effect.service(OrchestrationRunRunner), (runner) =>
        runner.startRun({ runId }),
      ).pipe(Effect.provide(layer)),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const parentActivities = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
        command.type === "thread.activity.append" && command.threadId === orchestrationThreadId,
    );

    expect(parentActivities.map((command) => command.activity.kind)).toContain(
      "orchestration.run.ticket.review.approved",
    );
    expect(parentActivities.map((command) => command.activity.kind)).not.toContain(
      "orchestration.run.paused",
    );
  });
});
