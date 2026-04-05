import { randomUUID } from "node:crypto";
import * as nodePath from "node:path";
import { promises as fs } from "node:fs";

import {
  ManagedRunDetail,
  ManagedRunId,
  ManagedRunLogLine,
  ManagedRunNotFoundError,
  ManagedRunOperationError,
  ManagedRunProjectLookupError,
  ManagedRunScriptLookupError,
  ManagedRunStatus,
  ManagedRunError,
  ManagedRunStreamEvent,
  ManagedRunSummary,
  ProjectId,
  type ThreadId,
  type ManagedRunLaunchProjectScriptInput,
  type ManagedRunLaunchProjectScriptResult,
  type ManagedRunListInput,
  type ManagedRunGetInput,
  type ManagedRunGetLogsInput,
  type ManagedRunStopInput,
  type ManagedRunServiceSnapshot,
} from "@t3tools/contracts";
import { Effect, Exit, Fiber, Layer, Option, PubSub, Ref, Scope, Stream } from "effect";

import { checkAllServices } from "../healthCheck";
import { splitCompleteLines } from "../utils";

import { ServerConfig } from "../../config";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ManagedRunRepository } from "../../persistence/Services/ManagedRuns";
import { TerminalManager } from "../../terminal/Services/Manager";
import { ManagedRunService, type ManagedRunMcpAccess } from "../Services/ManagedRuns";

const MANAGED_RUN_TERMINAL_COLS = 120;
const MANAGED_RUN_TERMINAL_ROWS = 30;
const STARTUP_GRACE_MS = 1_500;
const LOG_RETENTION_MS = 2 * 24 * 60 * 60 * 1_000;
const LOG_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;
const HEALTH_POLL_INTERVAL_MS = 12_000;

type LiveRunState = {
  readonly runId: ManagedRunId;
  readonly projectId: ProjectId;
  readonly terminalThreadId: string;
  readonly terminalId: string;
  partialLineBuffer: string;
  intentionalStop: boolean;
};

function toManagedRunId(value: string) {
  return ManagedRunId.makeUnsafe(value);
}

function toTerminalKey(threadId: string, terminalId: string) {
  return `${threadId}\u0000${terminalId}`;
}

function isActiveStatus(status: ManagedRunStatus): boolean {
  return status === "starting" || status === "running";
}

function summarize(row: Omit<ManagedRunDetail, "evidence">): ManagedRunSummary {
  return {
    runId: row.runId,
    projectId: row.projectId,
    scriptId: row.scriptId,
    createdByThreadId: row.createdByThreadId,
    lastTouchedByThreadId: row.lastTouchedByThreadId,
    cwd: row.cwd,
    launchMode: row.launchMode,
    status: row.status,
    detectedUrl: row.detectedUrl,
    detectedPort: row.detectedPort,
    terminalThreadId: row.terminalThreadId,
    terminalId: row.terminalId,
    terminalPid: row.terminalPid,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    lastExitCode: row.lastExitCode,
    lastExitSignal: row.lastExitSignal,
    serviceStatuses: row.serviceStatuses ?? [],
  };
}

function lineLogPath(baseDir: string, projectId: ProjectId, runId: ManagedRunId): string {
  return nodePath.join(baseDir, projectId, `${runId}.ndjson`);
}

async function appendNdjsonLine(
  baseDir: string,
  projectId: ProjectId,
  runId: ManagedRunId,
  line: ManagedRunLogLine,
) {
  const filePath = lineLogPath(baseDir, projectId, runId);
  await fs.mkdir(nodePath.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(line)}\n`, "utf8");
}

async function readNdjsonLines(
  baseDir: string,
  projectId: ProjectId,
  runId: ManagedRunId,
): Promise<ReadonlyArray<ManagedRunLogLine>> {
  try {
    const raw = await fs.readFile(lineLogPath(baseDir, projectId, runId), "utf8");
    const lines = raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ManagedRunLogLine);
    return lines;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function deleteNdjsonLines(baseDir: string, projectId: ProjectId, runId: ManagedRunId) {
  try {
    await fs.rm(lineLogPath(baseDir, projectId, runId), { force: true });
  } catch {
    // best-effort cleanup
  }
}

function projectScriptRuntimeEnv(input: {
  readonly projectRoot: string;
  readonly worktreePath?: string | null;
  readonly extraEnv?: Record<string, string>;
}) {
  const env: Record<string, string> = {
    T3CODE_PROJECT_ROOT: input.projectRoot,
  };
  if (input.worktreePath) {
    env.T3CODE_WORKTREE_PATH = input.worktreePath;
  }
  return input.extraEnv ? { ...env, ...input.extraEnv } : env;
}

function nowIso() {
  return new Date().toISOString();
}

function logsExpiryIso() {
  return new Date(Date.now() + LOG_RETENTION_MS).toISOString();
}

function toManagedRunOperationError(operation: string, cause: unknown): ManagedRunOperationError {
  return new ManagedRunOperationError({
    operation,
    message: cause instanceof Error ? cause.message : `Managed run operation failed: ${operation}`,
    ...(cause !== undefined ? { cause } : {}),
  });
}

const makeManagedRunService = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const repository = yield* ManagedRunRepository;
  const terminalManager = yield* TerminalManager;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const workerScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(workerScope, Exit.void));

  const logsDir = nodePath.join(serverConfig.logsDir, "managed-runs");
  yield* Effect.tryPromise({
    try: () => fs.mkdir(logsDir, { recursive: true }),
    catch: (cause) => toManagedRunOperationError("managedRuns.createLogsDir", cause),
  }).pipe(Effect.orDie);

  const liveRunsRef = yield* Ref.make(new Map<string, LiveRunState>());
  const terminalKeyToRunIdRef = yield* Ref.make(new Map<string, ManagedRunId>());
  const mcpAccessRef = yield* Ref.make(
    new Map<string, { projectId: ProjectId; threadId: ThreadId }>(),
  );
  const healthPollFibersRef = yield* Ref.make(new Map<string, Fiber.Fiber<void>>());
  const eventsPubSub = yield* PubSub.unbounded<ManagedRunStreamEvent>();

  const readRunDetail = Effect.fn("managedRuns.readRunDetail")(function* (runId: ManagedRunId) {
    const row = yield* repository
      .getById({ runId })
      .pipe(
        Effect.mapError((cause) => toManagedRunOperationError("managedRuns.readRunDetail", cause)),
      );
    if (Option.isNone(row)) {
      return yield* new ManagedRunNotFoundError({ runId });
    }
    const evidence = yield* repository
      .listEvidence({ runId })
      .pipe(
        Effect.mapError((cause) => toManagedRunOperationError("managedRuns.readEvidence", cause)),
      );
    return {
      ...row.value,
      evidence,
    } satisfies ManagedRunDetail;
  });

  const publishRun = (run: ManagedRunSummary) =>
    PubSub.publish(eventsPubSub, {
      type: "upserted",
      projectId: run.projectId,
      run,
    }).pipe(Effect.asVoid);

  const updateRun = Effect.fn("managedRuns.updateRun")(function* (
    runId: ManagedRunId,
    mutate: (current: ManagedRunDetail) => ManagedRunDetail,
  ) {
    const current = yield* readRunDetail(runId);
    const next = mutate(current);
    yield* repository
      .update({
        ...summarize(next),
        lastError: next.lastError,
        logsExpireAt: next.logsExpireAt,
      })
      .pipe(Effect.mapError((cause) => toManagedRunOperationError("managedRuns.update", cause)));
    yield* publishRun(summarize(next));
    return next;
  });

  const addEvidence = Effect.fn("managedRuns.addEvidence")(function* (
    runId: ManagedRunId,
    evidence: ManagedRunDetail["evidence"][number],
  ) {
    yield* repository
      .insertEvidence({ runId, evidence })
      .pipe(
        Effect.mapError((cause) => toManagedRunOperationError("managedRuns.addEvidence", cause)),
      );
  });

  const ensureRunning = Effect.fn("managedRuns.ensureRunning")(function* (runId: ManagedRunId) {
    const detail = yield* readRunDetail(runId);
    if (detail.status !== "starting") {
      return detail;
    }
    const updated = yield* updateRun(runId, (current) => ({
      ...current,
      status: "running",
      updatedAt: nowIso(),
    }));

    // Start health polling if the run has declared services
    if (updated.serviceStatuses.length > 0) {
      yield* updateServiceStatuses(runId).pipe(Effect.catch(() => Effect.void));
      yield* startHealthPollFiber(runId);
    }

    return updated;
  });

  const flushPartialBuffer = Effect.fn("managedRuns.flushPartialBuffer")(function* (
    live: LiveRunState,
  ) {
    const line = live.partialLineBuffer;
    if (line.length === 0) {
      return;
    }
    live.partialLineBuffer = "";
    const logLine: ManagedRunLogLine = {
      timestamp: nowIso(),
      stream: "pty",
      line,
    };
    yield* Effect.tryPromise({
      try: () => appendNdjsonLine(logsDir, live.projectId, live.runId, logLine),
      catch: (cause) => toManagedRunOperationError("managedRuns.flushPartialBuffer", cause),
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("failed to flush managed run log line", {
          runId: live.runId,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      ),
    );
  });

  const updateServiceStatuses = Effect.fn("managedRuns.updateServiceStatuses")(function* (
    runId: ManagedRunId,
  ) {
    const detail = yield* readRunDetail(runId);
    if (detail.serviceStatuses.length === 0) return detail;

    const results = yield* checkAllServices(detail.serviceStatuses);
    const now = nowIso();
    const updatedStatuses: ManagedRunServiceSnapshot[] = detail.serviceStatuses.map((s) => {
      const result = results.find((r) => r.name === s.name);
      return {
        ...s,
        status: result?.status ?? "unhealthy",
        lastCheckedAt: now,
      };
    });

    return yield* updateRun(runId, (current) => ({
      ...current,
      serviceStatuses: updatedStatuses,
      updatedAt: now,
    }));
  });

  const stopHealthPollFiber = (runId: ManagedRunId) =>
    Effect.gen(function* () {
      const fibers = yield* Ref.get(healthPollFibersRef);
      const existing = fibers.get(runId);
      if (existing) {
        yield* Fiber.interrupt(existing);
        yield* Ref.update(healthPollFibersRef, (current) => {
          const next = new Map(current);
          next.delete(runId);
          return next;
        });
      }
    });

  const startHealthPollFiber = Effect.fn("managedRuns.startHealthPollFiber")(function* (
    runId: ManagedRunId,
  ) {
    // Stop existing fiber if any
    yield* stopHealthPollFiber(runId);

    const fiber = yield* Effect.forever(
      Effect.gen(function* () {
        yield* Effect.sleep(HEALTH_POLL_INTERVAL_MS);
        const detail = yield* readRunDetail(runId).pipe(Effect.catch(() => Effect.succeed(null)));
        if (!detail || !isActiveStatus(detail.status) || detail.serviceStatuses.length === 0) {
          return; // Will be interrupted externally
        }

        const updated = yield* updateServiceStatuses(runId).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        if (!updated) return;

        // If ALL services are unhealthy, stop the run
        const allUnhealthy = updated.serviceStatuses.every((s) => s.status === "unhealthy");
        if (allUnhealthy) {
          yield* updateRun(runId, (current) => ({
            ...current,
            status: "stopped",
            updatedAt: nowIso(),
            completedAt: nowIso(),
            logsExpireAt: logsExpiryIso(),
          })).pipe(Effect.catch(() => Effect.void));
          // The fiber will be interrupted by the caller after this
        }
      }),
    ).pipe(Effect.forkIn(workerScope));

    yield* Ref.update(healthPollFibersRef, (current) => {
      const next = new Map(current);
      next.set(runId, fiber);
      return next;
    });
  });

  const handleTerminalOutput = Effect.fn("managedRuns.handleTerminalOutput")(function* (
    threadId: string,
    terminalId: string,
    data: string,
  ) {
    const terminalKey = toTerminalKey(threadId, terminalId);
    const runId = yield* Ref.get(terminalKeyToRunIdRef).pipe(
      Effect.map((mapping) => mapping.get(terminalKey) ?? null),
    );
    if (runId === null) {
      return;
    }

    const live = yield* Ref.get(liveRunsRef).pipe(Effect.map((runs) => runs.get(runId) ?? null));
    if (live === null) {
      return;
    }

    const split = splitCompleteLines(live.partialLineBuffer, data);
    live.partialLineBuffer = split.remainder;

    if (split.lines.length > 0) {
      yield* ensureRunning(runId);
    }

    for (const line of split.lines) {
      const logLine: ManagedRunLogLine = {
        timestamp: nowIso(),
        stream: "pty",
        line,
      };
      yield* Effect.tryPromise({
        try: () => appendNdjsonLine(logsDir, live.projectId, runId, logLine),
        catch: (cause) => toManagedRunOperationError("managedRuns.appendLogLine", cause),
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to append managed run log line", {
            runId,
            error: cause instanceof Error ? cause.message : String(cause),
          }),
        ),
      );
    }
  });

  const unregisterLiveRun = (runId: ManagedRunId, terminalThreadId: string, terminalId: string) =>
    Effect.all([
      Ref.update(liveRunsRef, (current) => {
        const next = new Map(current);
        next.delete(runId);
        return next;
      }),
      Ref.update(terminalKeyToRunIdRef, (current) => {
        const next = new Map(current);
        next.delete(toTerminalKey(terminalThreadId, terminalId));
        return next;
      }),
    ]).pipe(Effect.asVoid);

  const handleTerminalExit = Effect.fn("managedRuns.handleTerminalExit")(function* (
    threadId: string,
    terminalId: string,
    exitCode: number | null,
    exitSignal: number | null,
  ) {
    const terminalKey = toTerminalKey(threadId, terminalId);
    const runId = yield* Ref.get(terminalKeyToRunIdRef).pipe(
      Effect.map((mapping) => mapping.get(terminalKey) ?? null),
    );
    if (runId === null) {
      return;
    }

    const live = yield* Ref.get(liveRunsRef).pipe(Effect.map((runs) => runs.get(runId) ?? null));
    if (live === null) {
      return;
    }

    yield* flushPartialBuffer(live);

    if (live.intentionalStop) {
      // Intentional stop — mark stopped, stop health poll
      yield* stopHealthPollFiber(runId);
      yield* updateRun(runId, (current) => ({
        ...current,
        status: "stopped",
        updatedAt: nowIso(),
        completedAt: nowIso(),
        lastExitCode: exitCode,
        lastExitSignal: exitSignal,
        logsExpireAt: logsExpiryIso(),
      })).pipe(Effect.catch(() => Effect.void));
    } else if (exitCode !== 0) {
      // Non-zero exit — failed
      yield* stopHealthPollFiber(runId);
      yield* updateRun(runId, (current) => ({
        ...current,
        status: "failed",
        updatedAt: nowIso(),
        completedAt: nowIso(),
        lastExitCode: exitCode,
        lastExitSignal: exitSignal,
        logsExpireAt: logsExpiryIso(),
      })).pipe(Effect.catch(() => Effect.void));
    } else {
      // Exit code 0 — check declared services
      const detail = yield* readRunDetail(runId).pipe(Effect.catch(() => Effect.succeed(null)));
      if (!detail || detail.serviceStatuses.length === 0) {
        // No declared services — completed (backward compat)
        yield* updateRun(runId, (current) => ({
          ...current,
          status: "completed",
          updatedAt: nowIso(),
          completedAt: nowIso(),
          lastExitCode: exitCode,
          lastExitSignal: exitSignal,
          logsExpireAt: logsExpiryIso(),
        })).pipe(Effect.catch(() => Effect.void));
      } else {
        // Has declared services — check health
        const updated = yield* updateServiceStatuses(runId).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        const anyHealthy = updated?.serviceStatuses.some((s) => s.status === "healthy") ?? false;
        if (anyHealthy) {
          // Services are up — keep running, start health poll
          yield* updateRun(runId, (current) => ({
            ...current,
            status: "running",
            updatedAt: nowIso(),
            lastExitCode: exitCode,
            lastExitSignal: exitSignal,
          })).pipe(Effect.catch(() => Effect.void));
          yield* startHealthPollFiber(runId);
        } else {
          // Retry after 3s (services may still be starting)
          yield* Effect.sleep(3_000);
          const retried = yield* updateServiceStatuses(runId).pipe(
            Effect.catch(() => Effect.succeed(null)),
          );
          const anyHealthyRetry =
            retried?.serviceStatuses.some((s) => s.status === "healthy") ?? false;
          if (anyHealthyRetry) {
            yield* updateRun(runId, (current) => ({
              ...current,
              status: "running",
              updatedAt: nowIso(),
              lastExitCode: exitCode,
              lastExitSignal: exitSignal,
            })).pipe(Effect.catch(() => Effect.void));
            yield* startHealthPollFiber(runId);
          } else {
            yield* updateRun(runId, (current) => ({
              ...current,
              status: "stopped",
              updatedAt: nowIso(),
              completedAt: nowIso(),
              lastExitCode: exitCode,
              lastExitSignal: exitSignal,
              logsExpireAt: logsExpiryIso(),
            })).pipe(Effect.catch(() => Effect.void));
          }
        }
      }
    }

    yield* unregisterLiveRun(runId, live.terminalThreadId, live.terminalId);
  });

  const handleTerminalError = Effect.fn("managedRuns.handleTerminalError")(function* (
    threadId: string,
    terminalId: string,
    message: string,
  ) {
    const terminalKey = toTerminalKey(threadId, terminalId);
    const runId = yield* Ref.get(terminalKeyToRunIdRef).pipe(
      Effect.map((mapping) => mapping.get(terminalKey) ?? null),
    );
    if (runId === null) {
      return;
    }

    const live = yield* Ref.get(liveRunsRef).pipe(Effect.map((runs) => runs.get(runId) ?? null));

    yield* updateRun(runId, (current) => ({
      ...current,
      status: "failed",
      updatedAt: nowIso(),
      completedAt: nowIso(),
      lastError: message,
      logsExpireAt: logsExpiryIso(),
    })).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("failed to record managed run terminal error", {
          runId,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      ),
    );

    if (live) {
      yield* unregisterLiveRun(runId, live.terminalThreadId, live.terminalId);
    }
  });

  const unsubscribeTerminalEvents = yield* terminalManager.subscribe((event) => {
    if (event.type === "output") {
      return handleTerminalOutput(event.threadId, event.terminalId, event.data).pipe(
        Effect.catch(() => Effect.void),
      );
    }
    if (event.type === "exited") {
      return handleTerminalExit(event.threadId, event.terminalId, event.exitCode, event.exitSignal);
    }
    if (event.type === "error") {
      return handleTerminalError(event.threadId, event.terminalId, event.message);
    }
    return Effect.void;
  });
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribeTerminalEvents));

  const cleanupExpiredLogs = Effect.fn("managedRuns.cleanupExpiredLogs")(function* () {
    const rows = yield* repository
      .listByStatuses({
        statuses: ["completed", "failed", "stopped", "lost"],
      })
      .pipe(Effect.mapError((cause) => toManagedRunOperationError("managedRuns.cleanup", cause)));
    const now = Date.now();
    yield* Effect.forEach(
      rows,
      (row) => {
        if (!row.logsExpireAt || Date.parse(row.logsExpireAt) > now) {
          return Effect.void;
        }
        return Effect.tryPromise({
          try: () => deleteNdjsonLines(logsDir, row.projectId, row.runId),
          catch: (cause) => toManagedRunOperationError("managedRuns.deleteExpiredLogs", cause),
        }).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("failed to delete expired managed run logs", {
              runId: row.runId,
              error: cause instanceof Error ? cause.message : String(cause),
            }),
          ),
        );
      },
      { discard: true },
    );
  });

  const reconcileRun = Effect.fn("managedRuns.reconcileRun")(function* (run: ManagedRunDetail) {
    if (!isActiveStatus(run.status)) {
      return;
    }

    if (run.serviceStatuses.length > 0) {
      const updated = yield* updateServiceStatuses(run.runId);
      const anyHealthy = updated.serviceStatuses.some((s) => s.status === "healthy");
      if (anyHealthy) {
        // Services alive — keep running, start poll fiber
        yield* repository
          .update({
            ...summarize(updated),
            status: "running",
            updatedAt: nowIso(),
            lastError: run.lastError,
            logsExpireAt: run.logsExpireAt,
          })
          .pipe(
            Effect.mapError((cause) => toManagedRunOperationError("managedRuns.reconcile", cause)),
          );
        yield* startHealthPollFiber(run.runId);
      } else {
        yield* repository
          .update({
            ...summarize(run),
            status: "lost",
            updatedAt: nowIso(),
            lastError: run.lastError,
            logsExpireAt: run.logsExpireAt ?? logsExpiryIso(),
          })
          .pipe(
            Effect.mapError((cause) => toManagedRunOperationError("managedRuns.reconcile", cause)),
          );
      }
    } else {
      // No declared services, process is gone — lost
      yield* repository
        .update({
          ...summarize(run),
          status: "lost",
          updatedAt: nowIso(),
          lastError: run.lastError,
          logsExpireAt: run.logsExpireAt ?? logsExpiryIso(),
        })
        .pipe(
          Effect.mapError((cause) => toManagedRunOperationError("managedRuns.reconcile", cause)),
        );
    }
  });

  const recoverActiveRuns = Effect.gen(function* () {
    yield* Effect.log("managedRuns: reconciling active runs on startup");
    const recoverableRows = yield* repository
      .listByStatuses({
        statuses: ["starting", "running"],
      })
      .pipe(
        Effect.mapError((cause) => toManagedRunOperationError("managedRuns.recover", cause)),
        Effect.catch((cause) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("managedRuns: failed to query recoverable runs", {
              error: cause instanceof Error ? cause.message : String(cause),
            });
            return [] as const;
          }),
        ),
      );

    yield* Effect.log(`managedRuns: found ${recoverableRows.length} runs to reconcile`);

    yield* Effect.forEach(
      recoverableRows,
      (row) =>
        Effect.gen(function* () {
          const detail = yield* readRunDetail(row.runId);
          yield* Effect.log(
            `managedRuns: reconciling run ${row.runId} (status=${detail.status}, evidence=${detail.evidence.length})`,
          );
          yield* reconcileRun(detail);
        }).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("failed to reconcile managed run", {
              runId: row.runId,
              error: cause instanceof Error ? cause.message : String(cause),
            }),
          ),
        ),
      { discard: true },
    );

    yield* Effect.log("managedRuns: reconciliation complete");
  });

  const cleanupOrphanedRuns = Effect.fn("managedRuns.cleanupOrphanedRuns")(function* () {
    const allRuns = yield* repository
      .listByStatuses({
        statuses: ["starting", "running", "completed", "failed", "stopped", "lost"],
      })
      .pipe(Effect.catch(() => Effect.succeed([] as const)));
    if (allRuns.length === 0) return;

    const readModel = yield* snapshotQuery
      .getSnapshot()
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!readModel) return;

    for (const run of allRuns) {
      const project = readModel.projects.find((p) => p.id === run.projectId);
      const scriptExists = project?.scripts.some((s) => s.id === run.scriptId) ?? false;
      if (!scriptExists) {
        yield* Effect.log(
          `managedRuns: orphaned run ${run.runId} (script ${run.scriptId} not found), deleting`,
        );
        // Stop if live
        const live = yield* Ref.get(liveRunsRef).pipe(
          Effect.map((runs) => runs.get(run.runId) ?? null),
        );
        if (live) {
          live.intentionalStop = true;
          yield* terminalManager
            .close({ threadId: live.terminalThreadId, terminalId: live.terminalId })
            .pipe(Effect.catch(() => Effect.void));
          yield* unregisterLiveRun(run.runId, live.terminalThreadId, live.terminalId);
        }
        yield* stopHealthPollFiber(run.runId);
        // Delete from DB
        yield* repository.deleteById({ runId: run.runId }).pipe(Effect.catch(() => Effect.void));
        // Delete log files
        yield* Effect.tryPromise({
          try: () => deleteNdjsonLines(logsDir, run.projectId, run.runId),
          catch: () => undefined,
        }).pipe(Effect.catch(() => Effect.void));
      }
    }
  });

  yield* recoverActiveRuns.pipe(Effect.forkIn(workerScope));
  yield* cleanupOrphanedRuns().pipe(Effect.forkIn(workerScope));
  yield* Effect.forever(cleanupExpiredLogs().pipe(Effect.delay(LOG_CLEANUP_INTERVAL_MS))).pipe(
    Effect.forkIn(workerScope),
  );
  yield* Effect.forever(cleanupOrphanedRuns().pipe(Effect.delay(60_000))).pipe(
    Effect.forkIn(workerScope),
  );

  // On shutdown: flush log buffers and close terminals, but do NOT change
  // run statuses. Reconciliation on next startup will check service health
  // and determine the correct status for each run.
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const liveRunValues = yield* Ref.get(liveRunsRef).pipe(
        Effect.map((runs) => Array.from(runs.values())),
      );
      yield* Effect.forEach(
        liveRunValues,
        (live) =>
          Effect.gen(function* () {
            yield* stopHealthPollFiber(live.runId);
            yield* flushPartialBuffer(live);
            yield* terminalManager
              .close({
                threadId: live.terminalThreadId,
                terminalId: live.terminalId,
              })
              .pipe(Effect.catch(() => Effect.void));
          }),
        { discard: true },
      );
    }),
  );

  const launchProjectScript = Effect.fn("managedRuns.launchProjectScript")(function* (
    input: ManagedRunLaunchProjectScriptInput,
  ): Effect.fn.Return<ManagedRunLaunchProjectScriptResult, ManagedRunError> {
    const readModel = yield* snapshotQuery
      .getSnapshot()
      .pipe(
        Effect.mapError((cause) => toManagedRunOperationError("managedRuns.getSnapshot", cause)),
      );
    const project = readModel.projects.find((candidate) => candidate.id === input.projectId);
    if (!project) {
      return yield* new ManagedRunProjectLookupError({
        projectId: input.projectId,
        message: `Unable to find project '${input.projectId}'.`,
      });
    }

    const thread = readModel.threads.find((candidate) => candidate.id === input.threadId) ?? null;
    const script = project.scripts.find((candidate) => candidate.id === input.scriptId) ?? null;
    if (!script) {
      return yield* new ManagedRunScriptLookupError({
        projectId: input.projectId,
        scriptId: input.scriptId,
      });
    }

    const runId = toManagedRunId(randomUUID());
    const createdAt = nowIso();
    const cwd = input.cwd ?? input.worktreePath ?? thread?.worktreePath ?? project.workspaceRoot;
    const terminalThreadId = `managed-run:${runId}`;
    const terminalId = `managed-run-${runId}`;

    const baseDetail: ManagedRunDetail = {
      runId,
      projectId: input.projectId,
      scriptId: script.id,
      createdByThreadId: input.threadId,
      lastTouchedByThreadId: input.threadId,
      cwd,
      launchMode: "attached",
      status: "starting",
      detectedUrl: null,
      detectedPort: null,
      terminalThreadId,
      terminalId,
      terminalPid: null,
      createdAt,
      updatedAt: createdAt,
      startedAt: createdAt,
      completedAt: null,
      lastExitCode: null,
      lastExitSignal: null,
      serviceStatuses: (script.services ?? []).map((s) => ({
        name: s.name,
        healthCheck: s.healthCheck,
        status: "unknown" as const,
        lastCheckedAt: null,
      })),
      lastError: null,
      logsExpireAt: null,
      evidence: [],
    };

    yield* repository
      .create({
        ...summarize(baseDetail),
        lastError: baseDetail.lastError,
        logsExpireAt: baseDetail.logsExpireAt,
      })
      .pipe(Effect.mapError((cause) => toManagedRunOperationError("managedRuns.create", cause)));

    const runtimeEnv = projectScriptRuntimeEnv({
      projectRoot: project.workspaceRoot,
      worktreePath: input.worktreePath ?? thread?.worktreePath ?? null,
      ...(input.env ? { extraEnv: input.env } : {}),
    });

    const launchTerminalAndRun = Effect.gen(function* () {
      const terminal = yield* terminalManager
        .open({
          threadId: terminalThreadId,
          terminalId,
          cwd,
          env: runtimeEnv,
          cols: MANAGED_RUN_TERMINAL_COLS,
          rows: MANAGED_RUN_TERMINAL_ROWS,
        })
        .pipe(
          Effect.mapError((cause) => toManagedRunOperationError("managedRuns.openTerminal", cause)),
        );

      const live: LiveRunState = {
        runId,
        projectId: input.projectId,
        terminalThreadId,
        terminalId,
        partialLineBuffer: "",
        intentionalStop: false,
      };

      yield* Ref.update(liveRunsRef, (current) => {
        const next = new Map(current);
        next.set(runId, live);
        return next;
      });
      yield* Ref.update(terminalKeyToRunIdRef, (current) => {
        const next = new Map(current);
        next.set(toTerminalKey(terminalThreadId, terminalId), runId);
        return next;
      });

      if (terminal.pid !== null) {
        yield* addEvidence(runId, {
          type: "process",
          source: "inferred",
          createdAt,
          value: {
            pid: terminal.pid,
            command: script.command,
            cwd,
            startedAt: createdAt,
          },
        }).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("failed to persist process evidence", {
              runId,
              error: cause instanceof Error ? cause.message : String(cause),
            }),
          ),
        );
      }

      const detailAfterTerminal = yield* updateRun(runId, (current) => ({
        ...current,
        terminalPid: terminal.pid,
        updatedAt: nowIso(),
      }));

      yield* terminalManager
        .write({
          threadId: terminalThreadId,
          terminalId,
          data: `${script.command}\r`,
        })
        .pipe(
          Effect.mapError((cause) =>
            toManagedRunOperationError("managedRuns.writeTerminal", cause),
          ),
        );

      yield* Effect.sleep(STARTUP_GRACE_MS).pipe(
        Effect.andThen(() => ensureRunning(runId)),
        Effect.catch(() => Effect.void),
        Effect.forkIn(workerScope),
      );

      return {
        run: summarize(detailAfterTerminal),
        terminal,
      };
    });

    return yield* launchTerminalAndRun.pipe(
      Effect.catch((cause) =>
        Effect.gen(function* () {
          yield* repository
            .update({
              ...summarize(baseDetail),
              status: "failed",
              updatedAt: nowIso(),
              completedAt: nowIso(),
              lastError: cause instanceof Error ? cause.message : String(cause),
              logsExpireAt: logsExpiryIso(),
            })
            .pipe(Effect.catch(() => Effect.void));
          return yield* toManagedRunOperationError("managedRuns.launchProjectScript", cause);
        }),
      ),
    );
  });

  const list = (input: ManagedRunListInput) =>
    repository.listByProject(input).pipe(
      Effect.map((rows) => rows.map(summarize)),
      Effect.mapError((cause) => toManagedRunOperationError("managedRuns.list", cause)),
    );

  const get = (input: ManagedRunGetInput) => readRunDetail(input.runId);

  const getLogs = Effect.fn("managedRuns.getLogs")(function* (input: ManagedRunGetLogsInput) {
    const detail = yield* readRunDetail(input.runId);
    let lines = yield* Effect.tryPromise({
      try: () => readNdjsonLines(logsDir, detail.projectId, detail.runId),
      catch: (cause) => toManagedRunOperationError("managedRuns.getLogs", cause),
    }).pipe(Effect.mapError((cause) => toManagedRunOperationError("managedRuns.getLogs", cause)));

    if (input.stream && input.stream !== "pty") {
      lines = lines.filter((line) => line.stream === input.stream);
    }
    if (input.tailLines) {
      lines = lines.slice(-input.tailLines);
    }
    return lines;
  });

  const stop = Effect.fn("managedRuns.stop")(function* (input: ManagedRunStopInput) {
    const detail = yield* readRunDetail(input.runId);
    const live = yield* Ref.get(liveRunsRef).pipe(
      Effect.map((runs) => runs.get(detail.runId) ?? null),
    );
    if (live === null) {
      return yield* new ManagedRunOperationError({
        operation: "managedRuns.stop",
        message: `Managed run '${detail.runId}' is not under live T3 control.`,
      });
    }
    live.intentionalStop = true;
    yield* terminalManager
      .close({
        threadId: live.terminalThreadId,
        terminalId: live.terminalId,
      })
      .pipe(Effect.mapError((cause) => toManagedRunOperationError("managedRuns.stop", cause)));
  });

  const streamEvents = (projectId: ProjectId) =>
    Stream.fromPubSub(eventsPubSub).pipe(Stream.filter((event) => event.projectId === projectId));

  const issueMcpAccess = (projectId: ProjectId, threadId: ThreadId) =>
    Effect.gen(function* () {
      const token = randomUUID();
      yield* Ref.update(mcpAccessRef, (current) => {
        const next = new Map(current);
        next.set(token, { projectId, threadId });
        return next;
      });
      return { token, projectId, threadId } satisfies ManagedRunMcpAccess;
    });

  const resolveContextForToken = (token: string) =>
    Ref.get(mcpAccessRef).pipe(Effect.map((tokens) => tokens.get(token) ?? null));

  return {
    launchProjectScript,
    list,
    get,
    getLogs,
    stop,
    streamEvents,
    issueMcpAccess,
    resolveContextForToken,
  };
});

export const ManagedRunServiceLive = Layer.effect(ManagedRunService, makeManagedRunService);
