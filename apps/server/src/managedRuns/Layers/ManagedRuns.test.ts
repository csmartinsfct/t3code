import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ManagedRunId,
  type ManagedRunInferenceRecordDetail,
  type ManagedRunInferenceRecordSummary,
  type ManagedRunRuntimeService,
  ProjectId,
} from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import { type ServerConfigShape, ServerConfig } from "../../config.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  ManagedRunRepository,
  type ManagedRunRepositoryShape,
  type PersistedManagedRun,
} from "../../persistence/Services/ManagedRuns.ts";
import { TerminalManager, type TerminalManagerShape } from "../../terminal/Services/Manager.ts";
import { ManagedRunInference } from "../Services/Inference.ts";
import { ManagedRunService } from "../Services/ManagedRuns.ts";
import { ManagedRunServiceLive } from "./ManagedRuns.ts";

const projectId = ProjectId.makeUnsafe("project-1");
const runId = ManagedRunId.makeUnsafe("run-stale");

function makeServerConfig(logsDir: string): ServerConfigShape {
  const stateDir = path.dirname(logsDir);
  return {
    logLevel: "Error",
    traceMinLevel: "Info",
    traceTimingEnabled: true,
    traceBatchWindowMs: 200,
    traceMaxBytes: 10 * 1024 * 1024,
    traceMaxFiles: 10,
    otlpTracesUrl: undefined,
    otlpMetricsUrl: undefined,
    otlpExportIntervalMs: 10_000,
    otlpServiceName: "t3-server-test",
    mode: "web",
    port: 0,
    host: "127.0.0.1",
    cwd: process.cwd(),
    baseDir: stateDir,
    stateDir,
    dbPath: path.join(stateDir, "state.sqlite"),
    keybindingsConfigPath: path.join(stateDir, "keybindings.json"),
    settingsPath: path.join(stateDir, "settings.json"),
    worktreesDir: path.join(stateDir, "worktrees"),
    attachmentsDir: path.join(stateDir, "attachments"),
    logsDir,
    serverLogPath: path.join(logsDir, "server.log"),
    serverTracePath: path.join(logsDir, "server.trace.ndjson"),
    providerLogsDir: path.join(logsDir, "provider"),
    providerEventLogPath: path.join(logsDir, "provider", "events.log"),
    terminalLogsDir: path.join(logsDir, "terminals"),
    anonymousIdPath: path.join(stateDir, "anonymous-id"),
    staticDir: undefined,
    devUrl: undefined,
    noBrowser: true,
    authToken: undefined,
    logWebSocketEvents: false,
  };
}

function makeRuntimeService(): ManagedRunRuntimeService {
  return {
    serviceId: "main" as ManagedRunRuntimeService["serviceId"],
    declaredServiceName: "Pusher" as ManagedRunRuntimeService["declaredServiceName"],
    resolvedName: "Pusher" as ManagedRunRuntimeService["resolvedName"],
    role: "worker",
    canonicalHealthCheck: null,
    validationStatus: "healthy",
    inferenceConfidence: "high",
    inferenceSource: "llm",
    groundedBy: ["log"],
    evidenceLines: ["service started"],
    lastCheckedAt: "2026-05-02T12:00:00.000Z",
  };
}

function makePersistedRun(): PersistedManagedRun {
  return {
    runId,
    projectId,
    scriptId: "oracle-solana-pusher" as PersistedManagedRun["scriptId"],
    createdByThreadId: null,
    lastTouchedByThreadId: null,
    cwd: "/tmp/oracle-solana-pusher" as PersistedManagedRun["cwd"],
    launchMode: "attached",
    status: "running",
    detectedUrl: null,
    detectedPort: null,
    terminalThreadId: "managed-run:run-stale" as PersistedManagedRun["terminalThreadId"],
    terminalId: "managed-run-run-stale" as PersistedManagedRun["terminalId"],
    terminalPid: 59720,
    createdAt: "2026-05-02T10:00:00.000Z",
    updatedAt: "2026-05-02T10:01:00.000Z",
    startedAt: "2026-05-02T10:00:00.000Z",
    completedAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    declaredServices: [
      { name: "Pusher" as PersistedManagedRun["declaredServices"][number]["name"] },
    ],
    runtimeServices: [makeRuntimeService()],
    inferenceStatus: "ready",
    inferenceUpdatedAt: "2026-05-02T10:01:00.000Z",
    inferenceError: null,
    lastError: null,
    logsExpireAt: null,
  };
}

function makeRepository(rows: Map<string, PersistedManagedRun>): ManagedRunRepositoryShape {
  return {
    create: (input) =>
      Effect.sync(() => {
        rows.set(input.runId, input);
      }),
    update: (input) =>
      Effect.sync(() => {
        rows.set(input.runId, input);
      }),
    getById: ({ runId }) =>
      Effect.sync(() => {
        const row = rows.get(runId);
        return row ? Option.some(row) : Option.none<PersistedManagedRun>();
      }),
    listByProject: ({ projectId, includeHistorical }) =>
      Effect.sync(() =>
        Array.from(rows.values()).filter(
          (row) =>
            row.projectId === projectId &&
            (includeHistorical === true || row.status === "starting" || row.status === "running"),
        ),
      ),
    listByStatuses: ({ statuses }) =>
      Effect.sync(() => Array.from(rows.values()).filter((row) => statuses.includes(row.status))),
    insertEvidence: () => Effect.void,
    listEvidence: () => Effect.succeed([]),
    deleteById: ({ runId }) =>
      Effect.sync(() => {
        rows.delete(runId);
      }),
    createInferenceRecord: () => Effect.void,
    listInferenceRecords: () =>
      Effect.succeed([] as ReadonlyArray<ManagedRunInferenceRecordSummary>),
    getInferenceRecordById: () => Effect.succeed(Option.none<ManagedRunInferenceRecordDetail>()),
    getLatestInferenceRecordByRunId: () =>
      Effect.succeed(Option.none<ManagedRunInferenceRecordDetail>()),
  };
}

describe("ManagedRunService", () => {
  it("marks active persisted runs lost when stop finds no live controller", async () => {
    const logsDir = await fs.mkdtemp(path.join(os.tmpdir(), "t3-managed-runs-"));
    const rows = new Map<string, PersistedManagedRun>();
    let closeCalls = 0;

    const terminalManager: TerminalManagerShape = {
      open: () => Effect.die("unused"),
      write: () => Effect.die("unused"),
      resize: () => Effect.die("unused"),
      clear: () => Effect.die("unused"),
      restart: () => Effect.die("unused"),
      close: () =>
        Effect.sync(() => {
          closeCalls += 1;
        }),
      subscribe: () => Effect.succeed(() => undefined),
    };

    const layer = ManagedRunServiceLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ServerConfig, makeServerConfig(logsDir)),
          Layer.succeed(ManagedRunRepository, makeRepository(rows)),
          Layer.succeed(TerminalManager, terminalManager),
          Layer.succeed(ProjectionSnapshotQuery, {
            getSnapshot: () => Effect.die("unused"),
            getStartupSnapshot: () => Effect.die("unused"),
            listProjects: () => Effect.die("unused"),
            getThreadContent: () => Effect.die("unused"),
            getCounts: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
            getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
            getProjectById: () =>
              Effect.succeed(
                Option.some({
                  id: projectId,
                  title: "Project",
                  workspaceRoot: "/tmp/project",
                  scripts: [{ id: "oracle-solana-pusher" }],
                } as any),
              ),
            getThreadById: () => Effect.succeed(Option.none()),
            hasThreadUserMessages: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () => Effect.succeed(Option.none()),
          }),
          Layer.succeed(ManagedRunInference, {
            buildInferenceInput: () => Effect.die("unused"),
            inferRunServices: () => Effect.die("unused"),
          }),
        ),
      ),
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const managedRuns = yield* ManagedRunService;
          yield* Effect.sleep(10);
          rows.set(runId, makePersistedRun());

          yield* managedRuns.stop({ runId });

          const updated = rows.get(runId);
          expect(updated?.status).toBe("lost");
          expect(updated?.terminalThreadId).toBeNull();
          expect(updated?.terminalId).toBeNull();
          expect(updated?.terminalPid).toBeNull();
          expect(updated?.completedAt).not.toBeNull();
          expect(updated?.lastError).toContain("no longer under live T3 control");
          expect(updated?.runtimeServices[0]?.validationStatus).toBe("unknown");
          expect(updated?.runtimeServices[0]?.lastCheckedAt).toBeNull();
          expect(closeCalls).toBe(0);

          const activeRuns = yield* managedRuns.list({ projectId });
          expect(activeRuns).toEqual([]);
        }).pipe(Effect.provide(layer)),
      ),
    );
  });
});
