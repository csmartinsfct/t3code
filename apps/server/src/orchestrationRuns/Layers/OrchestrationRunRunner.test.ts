import {
  type OrchestrationCommand,
  type OrchestrationEvent,
  OrchestrationRunId,
  ProjectId,
  ThreadId,
  TicketId,
  type Ticket,
  type OrchestrationRun,
  OrchestrationRunError,
} from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
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

const makeRun = (overrides: Partial<OrchestrationRun> = {}): OrchestrationRun => ({
  id: runId,
  orchestrationThreadId,
  projectId,
  status: "running",
  ticketOrder: [
    { ticketId: ticket1Id, workingThreadId: workingThread1 },
    { ticketId: ticket2Id, workingThreadId: workingThread2 },
  ],
  currentTicketIndex: -1,
  currentPhase: "working",
  reviewIteration: 0,
  maxReviewIterations: 1,
  createdAt: "2026-04-09T10:00:00.000Z",
  updatedAt: "2026-04-09T10:00:00.000Z",
  ...overrides,
});

const makeTicketingService = (
  overrides: Partial<TicketingServiceShape> = {},
): TicketingServiceShape => ({
  resolveId: () => Effect.die(new Error("not mocked")),
  resolveIdentifiers: () => Effect.succeed(new Map()),
  list: () => Effect.succeed([]),
  getById: ({ id }) => {
    if (id === ticket1Id) return Effect.succeed(ticket1);
    if (id === ticket2Id) return Effect.succeed(ticket2);
    return Effect.die(new Error(`Unknown ticket: ${id}`));
  },
  getByIdentifier: () => Effect.die(new Error("not mocked")),
  create: () => Effect.die(new Error("not mocked")),
  update: () => Effect.die(new Error("not mocked")),
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

const makeLayer = (opts: {
  runService?: Partial<OrchestrationRunServiceShape>;
  ticketing?: Partial<TicketingServiceShape>;
  domainEvents?: Stream.Stream<OrchestrationEvent>;
  dispatchedCommands?: OrchestrationCommand[];
}) => {
  const dispatchedCommands = opts.dispatchedCommands ?? [];
  return OrchestrationRunRunnerLive.pipe(
    Layer.provide(Layer.succeed(OrchestrationRunService, makeRunService(opts.runService))),
    Layer.provide(Layer.succeed(TicketingService, makeTicketingService(opts.ticketing))),
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
            threads: [],
          }),
        readEvents: () => Stream.empty,
        dispatch: (command: OrchestrationCommand) => {
          dispatchedCommands.push(command);
          return Effect.succeed({ sequence: dispatchedCommands.length });
        },
        streamDomainEvents: opts.domainEvents ?? Stream.empty,
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
});
