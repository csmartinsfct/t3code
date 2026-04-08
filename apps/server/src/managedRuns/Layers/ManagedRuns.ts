import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as nodePath from "node:path";

import { Effect, Exit, Fiber, Layer, Option, PubSub, Ref, Schema, Scope, Stream } from "effect";

import {
  ManagedRunDetail,
  ManagedRunGetInferenceRecordInput,
  ManagedRunGetInput,
  ManagedRunGetLogsInput,
  ManagedRunId,
  ManagedRunInferenceRecordNotFoundError,
  ManagedRunLaunchProjectScriptInput,
  ManagedRunLaunchProjectScriptResult,
  ManagedRunListInferenceRecordsInput,
  ManagedRunListInput,
  ManagedRunLogLine,
  ManagedRunNotFoundError,
  ManagedRunOperationError,
  ManagedRunProjectLookupError,
  ManagedRunScriptLookupError,
  ManagedRunStatus,
  ManagedRunStopInput,
  ManagedRunSummary,
  ProjectId,
  type ManagedRunDeclaredServiceSnapshot,
  type ManagedRunRuntimeService,
  type ManagedRunStreamEvent,
  type ThreadId,
} from "@t3tools/contracts";

import { checkService } from "../healthCheck";
import { splitCompleteLines } from "../utils";

import { ServerConfig } from "../../config";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ManagedRunRepository } from "../../persistence/Services/ManagedRuns";
import { TerminalManager } from "../../terminal/Services/Manager";
import { ManagedRunInference } from "../Services/Inference.ts";
import { ManagedRunService, type ManagedRunMcpAccess } from "../Services/ManagedRuns";

const MANAGED_RUN_TERMINAL_COLS = 120;
const MANAGED_RUN_TERMINAL_ROWS = 30;
const STARTUP_GRACE_MS = 1_500;
const HEALTH_POLL_INTERVAL_MS = 12_000;
const LOG_RETENTION_MS = 2 * 24 * 60 * 60 * 1_000;
const LOG_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

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

function nowIso() {
  return new Date().toISOString();
}

function logsExpiryIso() {
  return new Date(Date.now() + LOG_RETENTION_MS).toISOString();
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
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ManagedRunLogLine);
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

function summarize(row: ManagedRunDetail): ManagedRunSummary {
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
    declaredServices: row.declaredServices,
    runtimeServices: row.runtimeServices,
    inferenceStatus: row.inferenceStatus,
    inferenceUpdatedAt: row.inferenceUpdatedAt,
    inferenceError: row.inferenceError,
  };
}

function toManagedRunOperationError(operation: string, cause: unknown): ManagedRunOperationError {
  return new ManagedRunOperationError({
    operation,
    message: cause instanceof Error ? cause.message : `Managed run operation failed: ${operation}`,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function deriveDetectedUrl(services: ReadonlyArray<ManagedRunRuntimeService>): string | null {
  for (const service of services) {
    if (service.canonicalHealthCheck?.type === "url") {
      return service.canonicalHealthCheck.url;
    }
    if (service.canonicalHealthCheck?.type === "port") {
      return `http://${service.canonicalHealthCheck.host ?? "127.0.0.1"}:${service.canonicalHealthCheck.port}`;
    }
  }
  return null;
}

function deriveDetectedPort(services: ReadonlyArray<ManagedRunRuntimeService>): number | null {
  for (const service of services) {
    if (service.canonicalHealthCheck?.type === "port") {
      return service.canonicalHealthCheck.port;
    }
    if (service.canonicalHealthCheck?.type === "url") {
      try {
        const url = new URL(service.canonicalHealthCheck.url);
        const port = url.port.length > 0 ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
        return Number.isFinite(port) ? port : null;
      } catch {
        continue;
      }
    }
  }
  return null;
}

const makeManagedRunService = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const repository = yield* ManagedRunRepository;
  const terminalManager = yield* TerminalManager;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const inference = yield* ManagedRunInference;
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
  const inferenceFibersRef = yield* Ref.make(new Map<string, Fiber.Fiber<void>>());
  const eventsPubSub = yield* PubSub.unbounded<ManagedRunStreamEvent>();

  const resolveScript = Effect.fn("managedRuns.resolveScript")(function* (
    projectId: ProjectId,
    scriptId: string,
  ) {
    const readModel = yield* snapshotQuery.getSnapshot();
    const project = readModel.projects.find((candidate) => candidate.id === projectId) ?? null;
    return project?.scripts.find((candidate) => candidate.id === scriptId) ?? null;
  });

  const readRunDetail = Effect.fn("managedRuns.readRunDetail")(function* (runId: ManagedRunId) {
    const row = yield* repository
      .getById({ runId })
      .pipe(
        Effect.mapError((cause) => toManagedRunOperationError("managedRuns.readRunDetail", cause)),
      );
    if (Option.isNone(row)) {
      return yield* new ManagedRunNotFoundError({ runId });
    }
    const [evidence, latestInference] = yield* Effect.all([
      repository
        .listEvidence({ runId })
        .pipe(
          Effect.mapError((cause) => toManagedRunOperationError("managedRuns.readEvidence", cause)),
        ),
      repository
        .getLatestInferenceRecordByRunId({ runId })
        .pipe(
          Effect.mapError((cause) =>
            toManagedRunOperationError("managedRuns.readLatestInference", cause),
          ),
        ),
    ]);
    return {
      ...row.value,
      evidence,
      latestInference: Option.isSome(latestInference)
        ? {
            inferenceId: latestInference.value.inferenceId,
            provider: latestInference.value.provider,
            model: latestInference.value.model,
            rawPayload: latestInference.value.rawPayload,
            normalizedPayload: latestInference.value.normalizedPayload,
            createdAt: latestInference.value.createdAt,
          }
        : null,
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

  const stopHealthPollFiber = (runId: ManagedRunId) =>
    Effect.gen(function* () {
      const fibers = yield* Ref.get(healthPollFibersRef);
      const existing = fibers.get(runId);
      if (!existing) {
        return;
      }
      yield* Fiber.interrupt(existing);
      yield* Ref.update(healthPollFibersRef, (current) => {
        const next = new Map(current);
        next.delete(runId);
        return next;
      });
    });

  const stopInferenceFiber = (runId: ManagedRunId) =>
    Effect.gen(function* () {
      const fibers = yield* Ref.get(inferenceFibersRef);
      const existing = fibers.get(runId);
      if (!existing) {
        return;
      }
      yield* Fiber.interrupt(existing);
      yield* Ref.update(inferenceFibersRef, (current) => {
        const next = new Map(current);
        next.delete(runId);
        return next;
      });
    });

  const validateRuntimeServices = Effect.fn("managedRuns.validateRuntimeServices")(function* (
    runId: ManagedRunId,
  ) {
    const detail = yield* readRunDetail(runId);
    if (detail.runtimeServices.length === 0) {
      return detail;
    }

    const now = nowIso();
    const validated: ReadonlyArray<ManagedRunRuntimeService> = yield* Effect.forEach(
      detail.runtimeServices,
      (service) =>
        service.canonicalHealthCheck === null
          ? Effect.succeed<ManagedRunRuntimeService>({
              ...service,
              validationStatus: "unknown" as const,
              lastCheckedAt: now,
            })
          : checkService(service.canonicalHealthCheck).pipe(
              Effect.map(
                (status): ManagedRunRuntimeService => ({
                  ...service,
                  validationStatus: status,
                  lastCheckedAt: now,
                }),
              ),
            ),
      { concurrency: "unbounded" },
    );

    return yield* updateRun(runId, (current) => ({
      ...current,
      runtimeServices: validated,
      detectedUrl: deriveDetectedUrl(validated),
      detectedPort: deriveDetectedPort(validated),
      updatedAt: now,
    }));
  });

  const startHealthPollFiber = Effect.fn("managedRuns.startHealthPollFiber")(function* (
    runId: ManagedRunId,
  ) {
    yield* stopHealthPollFiber(runId);

    const fiber = yield* Effect.forever(
      Effect.gen(function* () {
        yield* Effect.sleep(HEALTH_POLL_INTERVAL_MS);
        const detail = yield* readRunDetail(runId).pipe(Effect.catch(() => Effect.succeed(null)));
        if (!detail || !isActiveStatus(detail.status) || detail.runtimeServices.length === 0) {
          return;
        }

        const updated = yield* validateRuntimeServices(runId).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        if (!updated) {
          return;
        }

        const allUnhealthy = updated.runtimeServices.every(
          (service) => service.validationStatus === "unhealthy",
        );
        if (!allUnhealthy) {
          return;
        }

        yield* updateRun(runId, (current) => ({
          ...current,
          status: "stopped",
          updatedAt: nowIso(),
          completedAt: nowIso(),
          logsExpireAt: logsExpiryIso(),
        })).pipe(Effect.catch(() => Effect.void));
      }),
    ).pipe(Effect.forkIn(workerScope));

    yield* Ref.update(healthPollFibersRef, (current) => {
      const next = new Map(current);
      next.set(runId, fiber);
      return next;
    });
  });

  const runInferenceForRun = Effect.fn("managedRuns.runInferenceForRun")(function* (
    runId: ManagedRunId,
  ) {
    const detail = yield* readRunDetail(runId);
    if (detail.inferenceStatus !== "pending") {
      return detail;
    }

    const script = yield* resolveScript(detail.projectId, detail.scriptId);
    const logs = yield* Effect.tryPromise({
      try: () => readNdjsonLines(logsDir, detail.projectId, detail.runId),
      catch: (cause) => toManagedRunOperationError("managedRuns.readLogsForInference", cause),
    });

    const builtInput = yield* inference.buildInferenceInput({
      runId: detail.runId,
      cwd: detail.cwd,
      command: script?.command ?? detail.scriptId,
      declaredServices: detail.declaredServices,
      detectedUrl: detail.detectedUrl,
      detectedPort: detail.detectedPort,
      logs,
    });
    const inferenceResult = yield* inference.inferRunServices(builtInput);

    const inferenceId = randomUUID();
    const createdAt = nowIso();
    yield* repository
      .createInferenceRecord({
        inferenceId,
        runId: detail.runId,
        projectId: detail.projectId,
        scriptId: detail.scriptId,
        scriptName: null,
        cwd: detail.cwd,
        provider: inferenceResult.provider,
        model: inferenceResult.model,
        status: inferenceResult.status,
        createdAt,
        runtimeServiceCount: inferenceResult.runtimeServices.length,
        declaredServices: detail.declaredServices,
        normalizedPayload: inferenceResult.normalizedPayload,
        rawPayload: inferenceResult.rawPayload,
        inferenceError: inferenceResult.inferenceError,
        groundingFailures: [...inferenceResult.groundingFailures],
        evidenceExcerpt: [...inferenceResult.evidenceExcerpt],
      })
      .pipe(
        Effect.mapError((cause) =>
          toManagedRunOperationError("managedRuns.createInferenceRecord", cause),
        ),
      );

    const updated = yield* updateRun(runId, (current) => ({
      ...current,
      runtimeServices: [...inferenceResult.runtimeServices],
      inferenceStatus: inferenceResult.status,
      inferenceUpdatedAt: createdAt,
      inferenceError: inferenceResult.inferenceError,
      detectedUrl: deriveDetectedUrl(inferenceResult.runtimeServices),
      detectedPort: deriveDetectedPort(inferenceResult.runtimeServices),
      updatedAt: createdAt,
      latestInference: {
        inferenceId,
        provider: inferenceResult.provider,
        model: inferenceResult.model,
        rawPayload: inferenceResult.rawPayload,
        normalizedPayload: inferenceResult.normalizedPayload,
        createdAt,
      },
    }));

    if (updated.runtimeServices.length === 0) {
      return updated;
    }

    const validated = yield* validateRuntimeServices(runId);
    if (validated.status === "running" || validated.status === "starting") {
      yield* startHealthPollFiber(runId);
    }
    return validated;
  });

  const scheduleInference = Effect.fn("managedRuns.scheduleInference")(function* (
    runId: ManagedRunId,
  ) {
    const existing = yield* Ref.get(inferenceFibersRef).pipe(
      Effect.map((fibers) => fibers.get(runId)),
    );
    if (existing) {
      return;
    }

    const fiber = yield* Effect.gen(function* () {
      yield* Effect.sleep(STARTUP_GRACE_MS);
      yield* runInferenceForRun(runId).pipe(Effect.catch(() => Effect.void));
    }).pipe(Effect.forkIn(workerScope));

    yield* Ref.update(inferenceFibersRef, (current) => {
      const next = new Map(current);
      next.set(runId, fiber);
      return next;
    });
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
    yield* scheduleInference(runId);
    return updated;
  });

  const flushPartialBuffer = Effect.fn("managedRuns.flushPartialBuffer")(function* (
    live: LiveRunState,
  ) {
    if (live.partialLineBuffer.length === 0) {
      return;
    }
    const line = live.partialLineBuffer;
    live.partialLineBuffer = "";
    const logLine: ManagedRunLogLine = {
      timestamp: nowIso(),
      stream: "pty",
      line,
    };
    yield* Effect.tryPromise({
      try: () => appendNdjsonLine(logsDir, live.projectId, live.runId, logLine),
      catch: (cause) => toManagedRunOperationError("managedRuns.flushPartialBuffer", cause),
    }).pipe(Effect.catch(() => Effect.void));
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
      yield* Effect.tryPromise({
        try: () =>
          appendNdjsonLine(logsDir, live.projectId, runId, {
            timestamp: nowIso(),
            stream: "pty",
            line,
          }),
        catch: (cause) => toManagedRunOperationError("managedRuns.appendLogLine", cause),
      }).pipe(Effect.catch(() => Effect.void));
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
      stopHealthPollFiber(runId),
      stopInferenceFiber(runId),
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
    const completedAt = nowIso();

    if (live.intentionalStop) {
      yield* updateRun(runId, (current) => ({
        ...current,
        status: "stopped",
        updatedAt: completedAt,
        completedAt,
        lastExitCode: exitCode,
        lastExitSignal: exitSignal,
        logsExpireAt: logsExpiryIso(),
      })).pipe(Effect.catch(() => Effect.void));
      yield* unregisterLiveRun(runId, live.terminalThreadId, live.terminalId);
      return;
    }

    if (exitCode !== 0) {
      yield* updateRun(runId, (current) => ({
        ...current,
        status: "failed",
        updatedAt: completedAt,
        completedAt,
        lastExitCode: exitCode,
        lastExitSignal: exitSignal,
        logsExpireAt: logsExpiryIso(),
      })).pipe(Effect.catch(() => Effect.void));
      yield* unregisterLiveRun(runId, live.terminalThreadId, live.terminalId);
      return;
    }

    const detail = yield* readRunDetail(runId).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!detail) {
      yield* unregisterLiveRun(runId, live.terminalThreadId, live.terminalId);
      return;
    }

    if (detail.inferenceStatus === "pending") {
      yield* runInferenceForRun(runId).pipe(Effect.catch(() => Effect.void));
    }

    const refreshed = yield* readRunDetail(runId).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!refreshed) {
      yield* unregisterLiveRun(runId, live.terminalThreadId, live.terminalId);
      return;
    }

    if (refreshed.runtimeServices.length === 0) {
      yield* updateRun(runId, (current) => ({
        ...current,
        status: "completed",
        updatedAt: completedAt,
        completedAt,
        lastExitCode: exitCode,
        lastExitSignal: exitSignal,
        logsExpireAt: logsExpiryIso(),
      })).pipe(Effect.catch(() => Effect.void));
      yield* unregisterLiveRun(runId, live.terminalThreadId, live.terminalId);
      return;
    }

    const validated = yield* validateRuntimeServices(runId).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    const anyHealthy =
      validated?.runtimeServices.some((service) => service.validationStatus === "healthy") ?? false;

    // After a clean exit, only stay "running" if there are genuinely independent
    // background services (url/port/docker). Command-type health checks alone
    // (e.g. `test -f artifact`) are one-shot validations — the process is done.
    const hasLiveService =
      validated?.runtimeServices.some(
        (service) =>
          service.validationStatus === "healthy" &&
          service.canonicalHealthCheck !== null &&
          service.canonicalHealthCheck.type !== "command",
      ) ?? false;

    if (anyHealthy && hasLiveService) {
      yield* updateRun(runId, (current) => ({
        ...current,
        status: "running",
        updatedAt: nowIso(),
        lastExitCode: exitCode,
        lastExitSignal: exitSignal,
      })).pipe(Effect.catch(() => Effect.void));
      yield* startHealthPollFiber(runId);
    } else if (anyHealthy) {
      yield* updateRun(runId, (current) => ({
        ...current,
        status: "completed",
        updatedAt: completedAt,
        completedAt,
        lastExitCode: exitCode,
        lastExitSignal: exitSignal,
        logsExpireAt: logsExpiryIso(),
      })).pipe(Effect.catch(() => Effect.void));
    } else {
      yield* updateRun(runId, (current) => ({
        ...current,
        status: "stopped",
        updatedAt: completedAt,
        completedAt,
        lastExitCode: exitCode,
        lastExitSignal: exitSignal,
        logsExpireAt: logsExpiryIso(),
      })).pipe(Effect.catch(() => Effect.void));
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
    })).pipe(Effect.catch(() => Effect.void));

    if (live) {
      yield* unregisterLiveRun(runId, live.terminalThreadId, live.terminalId);
    }
  });

  const onTerminalEvent = (
    event: Parameters<Parameters<typeof terminalManager.subscribe>[0]>[0],
  ): Effect.Effect<void, never, never> => {
    if (event.type === "output") {
      return handleTerminalOutput(event.threadId, event.terminalId, event.data).pipe(
        Effect.catch(() => Effect.void),
      ) as Effect.Effect<void, never, never>;
    }
    if (event.type === "exited") {
      return handleTerminalExit(
        event.threadId,
        event.terminalId,
        event.exitCode,
        event.exitSignal,
      ) as Effect.Effect<void, never, never>;
    }
    if (event.type === "error") {
      return handleTerminalError(event.threadId, event.terminalId, event.message) as Effect.Effect<
        void,
        never,
        never
      >;
    }
    return Effect.void as Effect.Effect<void, never, never>;
  };

  const unsubscribeTerminalEvents = yield* terminalManager.subscribe(onTerminalEvent);
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribeTerminalEvents));

  const cleanupExpiredLogs = Effect.fn("managedRuns.cleanupExpiredLogs")(function* () {
    const rows = yield* repository
      .listByStatuses({ statuses: ["completed", "failed", "stopped", "lost"] })
      .pipe(Effect.catch(() => Effect.succeed([] as const)));
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
        }).pipe(Effect.catch(() => Effect.void));
      },
      { discard: true },
    );
  });

  const reconcileRun = Effect.fn("managedRuns.reconcileRun")(function* (run: ManagedRunDetail) {
    if (!isActiveStatus(run.status)) {
      return;
    }

    if (run.runtimeServices.length === 0) {
      yield* repository
        .update({
          ...summarize(run),
          status: "lost",
          updatedAt: nowIso(),
          lastError: run.lastError,
          logsExpireAt: run.logsExpireAt ?? logsExpiryIso(),
        })
        .pipe(Effect.catch(() => Effect.void));
      return;
    }

    const validated = yield* validateRuntimeServices(run.runId).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    const anyHealthy =
      validated?.runtimeServices.some((service) => service.validationStatus === "healthy") ?? false;
    if (!validated) {
      return;
    }

    const hasLiveService = validated.runtimeServices.some(
      (service) =>
        service.validationStatus === "healthy" &&
        service.canonicalHealthCheck !== null &&
        service.canonicalHealthCheck.type !== "command",
    );

    yield* repository
      .update({
        ...summarize(validated),
        status: anyHealthy && hasLiveService ? "running" : "lost",
        updatedAt: nowIso(),
        lastError: validated.lastError,
        logsExpireAt:
          validated.logsExpireAt ?? (anyHealthy && hasLiveService ? null : logsExpiryIso()),
      })
      .pipe(Effect.catch(() => Effect.void));

    if (anyHealthy && hasLiveService) {
      yield* startHealthPollFiber(run.runId);
    }
  });

  const recoverActiveRuns = Effect.gen(function* () {
    const recoverableRows = yield* repository
      .listByStatuses({ statuses: ["starting", "running"] })
      .pipe(Effect.catch(() => Effect.succeed([] as const)));

    yield* Effect.forEach(
      recoverableRows,
      (row) =>
        readRunDetail(row.runId).pipe(
          Effect.flatMap(reconcileRun),
          Effect.catch(() => Effect.void),
        ),
      { discard: true },
    );
  });

  const cleanupOrphanedRuns = Effect.fn("managedRuns.cleanupOrphanedRuns")(function* () {
    const allRuns = yield* repository
      .listByStatuses({
        statuses: ["starting", "running", "completed", "failed", "stopped", "lost"],
      })
      .pipe(Effect.catch(() => Effect.succeed([] as const)));
    if (allRuns.length === 0) {
      return;
    }

    const readModel = yield* snapshotQuery
      .getSnapshot()
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!readModel) {
      return;
    }

    for (const run of allRuns) {
      const project =
        readModel.projects.find((candidate) => candidate.id === run.projectId) ?? null;
      const scriptExists = project?.scripts.some((script) => script.id === run.scriptId) ?? false;
      if (scriptExists) {
        continue;
      }

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

      yield* repository.deleteById({ runId: run.runId }).pipe(Effect.catch(() => Effect.void));
      yield* Effect.tryPromise({
        try: () => deleteNdjsonLines(logsDir, run.projectId, run.runId),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.void));
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
            yield* stopInferenceFiber(live.runId);
            yield* flushPartialBuffer(live);
            yield* terminalManager
              .close({ threadId: live.terminalThreadId, terminalId: live.terminalId })
              .pipe(Effect.catch(() => Effect.void));
          }),
        { discard: true },
      );
    }),
  );

  const launchProjectScript = Effect.fn("managedRuns.launchProjectScript")(function* (
    input: ManagedRunLaunchProjectScriptInput,
  ) {
    const readModel = yield* snapshotQuery
      .getSnapshot()
      .pipe(
        Effect.mapError((cause) => toManagedRunOperationError("managedRuns.getSnapshot", cause)),
      );
    const project =
      readModel.projects.find((candidate) => candidate.id === input.projectId) ?? null;
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
      declaredServices: (script.services ?? []).map(
        (service) =>
          ({
            name: service.name,
            healthCheck: service.healthCheck,
          }) satisfies ManagedRunDeclaredServiceSnapshot,
      ),
      runtimeServices: [],
      inferenceStatus: "pending",
      inferenceUpdatedAt: null,
      inferenceError: null,
      lastError: null,
      logsExpireAt: null,
      evidence: [],
      latestInference: null,
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
      }).pipe(Effect.catch(() => Effect.void));
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
        data: `${script.command}; exit $?\r`,
      })
      .pipe(
        Effect.mapError((cause) => toManagedRunOperationError("managedRuns.writeTerminal", cause)),
      );

    yield* scheduleInference(runId);
    yield* Effect.sleep(STARTUP_GRACE_MS).pipe(
      Effect.andThen(() => ensureRunning(runId)),
      Effect.catch(() => Effect.void),
      Effect.forkIn(workerScope),
    );

    return {
      run: summarize(detailAfterTerminal),
      terminal,
    } satisfies ManagedRunLaunchProjectScriptResult;
  });

  const list = (input: ManagedRunListInput) =>
    repository.listByProject(input).pipe(
      Effect.map((rows) =>
        rows.map((row) => summarize({ ...row, evidence: [], latestInference: null })),
      ),
      Effect.mapError((cause) => toManagedRunOperationError("managedRuns.list", cause)),
    );

  const get = (input: ManagedRunGetInput) => readRunDetail(input.runId);

  const getLogs = Effect.fn("managedRuns.getLogs")(function* (input: ManagedRunGetLogsInput) {
    const detail = yield* readRunDetail(input.runId);
    let lines = yield* Effect.tryPromise({
      try: () => readNdjsonLines(logsDir, detail.projectId, detail.runId),
      catch: (cause) => toManagedRunOperationError("managedRuns.getLogs", cause),
    });
    if (input.stream && input.stream !== "pty") {
      lines = lines.filter((line) => line.stream === input.stream);
    }
    if (input.tailLines) {
      lines = lines.slice(-input.tailLines);
    }
    return lines;
  });

  const listInferenceRecords = (input: ManagedRunListInferenceRecordsInput) =>
    repository
      .listInferenceRecords(input)
      .pipe(
        Effect.mapError((cause) =>
          toManagedRunOperationError("managedRuns.listInferenceRecords", cause),
        ),
      );

  const getInferenceRecord = (input: ManagedRunGetInferenceRecordInput) =>
    repository.getInferenceRecordById(input).pipe(
      Effect.flatMap((record) =>
        Option.isSome(record)
          ? Effect.succeed(record.value)
          : Effect.fail(
              new ManagedRunInferenceRecordNotFoundError({ inferenceId: input.inferenceId }),
            ),
      ),
      Effect.mapError((cause) =>
        Schema.is(ManagedRunInferenceRecordNotFoundError)(cause)
          ? cause
          : toManagedRunOperationError("managedRuns.getInferenceRecord", cause),
      ),
    );

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
      .close({ threadId: live.terminalThreadId, terminalId: live.terminalId })
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
    listInferenceRecords,
    getInferenceRecord,
    stop,
    streamEvents,
    issueMcpAccess,
    resolveContextForToken,
  };
});

export const ManagedRunServiceLive = Layer.effect(ManagedRunService, makeManagedRunService);
