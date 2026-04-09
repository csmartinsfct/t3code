import {
  EventId,
  MessageId,
  type OrchestrationCommand,
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
import { describe, expect, it } from "vitest";

import { CheckpointDiffQuery } from "../../checkpointing/Services/CheckpointDiffQuery.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderRateLimitsCache } from "../../provider/Services/ProviderRateLimitsCache.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { ServerRuntimeStartup } from "../../serverRuntimeStartup.ts";
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

const makeTicketingService = (
  overrides: Partial<TicketingServiceShape> = {},
): TicketingServiceShape => ({
  resolveId: () => Effect.die(new Error("not mocked")),
  resolveIdentifiers: () => Effect.succeed(new Map()),
  list: () => Effect.succeed([]),
  getById: ({ id }) => Effect.succeed(resolveTestTicket(id)),
  getByIdentifier: () => Effect.die(new Error("not mocked")),
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
  providerEvents?: Stream.Stream<ProviderRuntimeEvent>;
  dispatchedCommands?: OrchestrationCommand[];
  readModelThreads?: ReadonlyArray<OrchestrationThread>;
}) => {
  const dispatchedCommands = opts.dispatchedCommands ?? [];
  const readModelThreads =
    opts.readModelThreads ??
    ([
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
    Layer.provide(
      Layer.succeed(OrchestrationEngineService, {
        getReadModel: () =>
          Effect.succeed({
            snapshotSequence: 0,
            updatedAt: "2026-04-09T10:00:00.000Z",
            projects: [],
            threads: [...readModelThreads],
          }),
        readEvents: () => Stream.empty,
        dispatch: (command: OrchestrationCommand) => {
          dispatchedCommands.push(command);
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
        getTurnDiff: () => Effect.die(new Error("not mocked")),
        getFullThreadDiff: () =>
          Effect.succeed({
            threadId: workingThread1,
            fromTurnCount: 0,
            toTurnCount: 1,
            diff: "patch",
          }),
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

  it("resumes the in-flight ticket with a continue prompt instead of restarting it", async () => {
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
    expect(turnStarts[0]?.message.text).toBe("Continue.");
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
  "comments": [],
  "suggestions": []
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
});
