import {
  ProjectId,
  ScheduledTaskId,
  type OrchestrationCommand,
  type OrchestrationProject,
  type OrchestrationStartupSnapshot,
  type ScheduledTask,
  type ScheduledTaskRun,
  type SelectedProviderCapability,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Option, Stream } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ScheduledTaskRepository } from "../../persistence/Services/ScheduledTasks.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ScheduledTaskService } from "../Services/ScheduledTasks.ts";
import { ScheduledTaskServiceLive } from "./ScheduledTasks.ts";

const projectId = ProjectId.makeUnsafe("project-scheduled");

const spotifyCapability = {
  provider: "codex" as const,
  kind: "plugin" as const,
  id: "spotify@openai-curated-remote",
  name: "spotify",
  displayName: "Spotify",
  capabilityRootPath: "/Users/example/.codex/plugins/cache/spotify/4.0.0",
  appIds: ["asdk_app_spotify"],
  iconUrl: "https://files.openai.com/spotify.png",
} satisfies SelectedProviderCapability;

const project: OrchestrationProject = {
  id: projectId,
  title: "Scheduled Project",
  workspaceRoot: "/tmp/scheduled-project",
  defaultModelSelection: null,
  systemPrompt: null,
  promptOverrides: { orchestration: {} },
  scripts: [],
  createdAt: "2026-06-29T00:00:00.000Z",
  updatedAt: "2026-06-29T00:00:00.000Z",
  deletedAt: null,
};

const emptyStartupSnapshot: OrchestrationStartupSnapshot = {
  snapshotSequence: 0,
  projects: [project],
  threads: [],
  updatedAt: "2026-06-29T00:00:00.000Z",
};

function makeJob(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    jobId: ScheduledTaskId.makeUnsafe("task-auto-send"),
    name: "Auto send task",
    description: null,
    cronExpression: "0 9 * * *",
    enabled: true,
    jobType: "new_thread",
    newThreadConfig: {
      projectId,
      prompt: "Run the scheduled check.",
      providerCapabilities: [spotifyCapability],
      autoSend: true,
      ...overrides.newThreadConfig,
    },
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
    lastRunAt: null,
    nextRunAt: "2026-06-29T09:00:00.000Z",
    ...overrides,
  };
}

function makeScheduledTaskLayer(input: {
  readonly job: ScheduledTask;
  readonly commands: OrchestrationCommand[];
  readonly runs: ScheduledTaskRun[];
}) {
  let job = input.job;
  let sequence = 0;

  const dependencies = Layer.mergeAll(
    Layer.succeed(ScheduledTaskRepository, {
      createJob: (nextJob) =>
        Effect.sync(() => {
          job = nextJob;
        }),
      updateJob: (nextJob) =>
        Effect.sync(() => {
          job = nextJob;
        }),
      getJobById: ({ jobId }) =>
        Effect.succeed(job.jobId === jobId ? Option.some(job) : Option.none()),
      listJobs: () => Effect.succeed([job]),
      listEnabledDueJobs: () => Effect.succeed([]),
      deleteJob: () => Effect.void,
      createRun: (run) =>
        Effect.sync(() => {
          input.runs.push(run);
        }),
      listRunsByJob: () => Effect.succeed(input.runs),
      getLatestRunByJob: () => Effect.succeed(Option.none()),
    }),
    Layer.succeed(OrchestrationEngineService, {
      getReadModel: () => Effect.succeed(emptyStartupSnapshot),
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Effect.sync(() => {
          input.commands.push(command);
          sequence += 1;
          return { sequence };
        }),
      streamDomainEvents: Stream.empty,
    }),
    Layer.succeed(ProjectionSnapshotQuery, {
      getSnapshot: () =>
        Effect.succeed({
          snapshotSequence: 0,
          projects: [project],
          threads: [],
          updatedAt: "2026-06-29T00:00:00.000Z",
        }),
      getStartupSnapshot: () => Effect.succeed(emptyStartupSnapshot),
      listProjects: () => Effect.succeed([project]),
      getThreadContent: (threadId) =>
        Effect.succeed({
          threadId,
          sequence: 0,
          messages: [],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
        }),
      getCounts: () => Effect.succeed({ projectCount: 1, threadCount: 0 }),
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
      getProjectById: () => Effect.succeed(Option.some(project)),
      getThreadById: () => Effect.succeed(Option.none()),
      hasThreadUserMessages: () => Effect.succeed(Option.some(false)),
      getThreadCheckpointContext: () => Effect.succeed(Option.none()),
    }),
    ServerSettingsService.layerTest({
      orchestrationImplementerModelSelection: {
        provider: "codex",
        model: "gpt-5.5",
        options: { reasoningEffort: "high" },
      },
    }),
    NodeServices.layer,
  );
  return ScheduledTaskServiceLive.pipe(Layer.provide(dependencies));
}

it.effect("scheduled tasks auto-send with the implementer model by default", () =>
  Effect.gen(function* () {
    const commands: OrchestrationCommand[] = [];
    const runs: ScheduledTaskRun[] = [];
    const job = makeJob();

    yield* Effect.scoped(
      Effect.gen(function* () {
        const service = yield* ScheduledTaskService;
        const run = yield* service.runNow({
          jobId: job.jobId,
        });

        assert.strictEqual(run.status, "created");
      }).pipe(Effect.provide(makeScheduledTaskLayer({ job, commands, runs }))),
    );

    assert.deepStrictEqual(
      commands.map((command) => command.type),
      ["thread.create", "thread.turn.start"],
    );
    const turnStart = commands.find((command) => command.type === "thread.turn.start");
    const threadCreate = commands.find((command) => command.type === "thread.create");
    assert.ok(threadCreate);
    assert.ok(turnStart);
    assert.strictEqual(turnStart.message.text, "Run the scheduled check.");
    assert.deepStrictEqual(threadCreate.initialDraft?.providerCapabilities, [spotifyCapability]);
    assert.deepStrictEqual(turnStart.providerCapabilities, [spotifyCapability]);
    assert.deepStrictEqual(turnStart.message.metadata?.providerCapabilities, [spotifyCapability]);
    assert.deepStrictEqual(turnStart.modelSelection, {
      provider: "codex",
      model: "gpt-5.5",
      options: { reasoningEffort: "high" },
    });
  }),
);

it.effect("scheduled tasks auto-send with a per-task model override", () =>
  Effect.gen(function* () {
    const commands: OrchestrationCommand[] = [];
    const runs: ScheduledTaskRun[] = [];
    const job = makeJob({
      newThreadConfig: {
        projectId,
        prompt: "Run the scheduled check.",
        autoSend: true,
        modelSelection: {
          provider: "codex",
          model: "gpt-5.6",
          options: { reasoningEffort: "medium" },
        },
      },
    });

    yield* Effect.scoped(
      Effect.gen(function* () {
        const service = yield* ScheduledTaskService;
        yield* service.runNow({
          jobId: job.jobId,
        });
      }).pipe(Effect.provide(makeScheduledTaskLayer({ job, commands, runs }))),
    );

    const turnStart = commands.find((command) => command.type === "thread.turn.start");
    assert.ok(turnStart);
    assert.deepStrictEqual(turnStart.modelSelection, {
      provider: "codex",
      model: "gpt-5.6",
      options: { reasoningEffort: "medium" },
    });
  }),
);
