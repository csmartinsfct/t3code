import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as nodePath from "node:path";

import { Effect, Exit, Fiber, Layer, Option, PubSub, Ref, Schema, Scope, Stream } from "effect";

import {
  isCompositeProjectScript,
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
  type ManagedRunLogStreamEvent,
  ManagedRunNotFoundError,
  ManagedRunOperationError,
  ManagedRunProjectLookupError,
  ManagedRunScriptLookupError,
  ManagedRunStatus,
  ManagedRunStopInput,
  ManagedRunSummary,
  ProjectId,
  validateProjectScriptShape,
  type ManagedRunDeclaredServiceSnapshot,
  type ManagedRunRuntimeService,
  type ManagedRunStreamEvent,
  type OrchestrationProject,
  type ThreadId,
} from "@t3tools/contracts";

import { checkService } from "../healthCheck";
import { slugifyServiceName, splitCompleteLines } from "../utils";

import { ServerConfig } from "../../config";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ManagedRunRepository } from "../../persistence/Services/ManagedRuns";
import { TerminalManager } from "../../terminal/Services/Manager";
import { ManagedRunInference, type ManagedRunInferenceResult } from "../Services/Inference.ts";
import { ManagedRunService, type ManagedRunMcpAccess } from "../Services/ManagedRuns";

const MANAGED_RUN_TERMINAL_COLS = 120;
const MANAGED_RUN_TERMINAL_ROWS = 30;
const STARTUP_GRACE_MS = 1_500;
const HEALTH_POLL_INTERVAL_MS = 12_000;
const LOG_RETENTION_MS = 2 * 24 * 60 * 60 * 1_000;
const LOG_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

/**
 * Synthetic serviceId for legacy single-process runs. Stored in our in-memory
 * service map and used as the per-service PubSub key, but never serialised to
 * disk in legacy log records (those keep `serviceId: null` for backward
 * compatibility on the on-disk file format).
 */
const LEGACY_SERVICE_ID = "main";

type LiveServiceState = {
  readonly serviceId: string;
  readonly terminalId: string;
  /** Composite: the service's display name from the script. Legacy: null. */
  readonly declaredName: string | null;
  partialLineBuffer: string;
  status: "starting" | "running" | "exited";
  exitCode: number | null;
  exitSignal: number | null;
};

type LiveRunState = {
  readonly runId: ManagedRunId;
  readonly projectId: ProjectId;
  readonly terminalThreadId: string;
  /** True for composite runs (one PTY per declared service); false for legacy. */
  readonly composite: boolean;
  intentionalStop: boolean;
  /**
   * Set true the moment {@link removeRunAndPublish} starts tearing down. Output
   * events that race with PTY close (already buffered by node-pty) skip
   * NDJSON append + PubSub publish so they can't recreate the log directory
   * after `fs.rm` deletes it.
   */
  removing: boolean;
  /** Keyed by `serviceId`. Always non-empty (legacy runs hold one entry under {@link LEGACY_SERVICE_ID}). */
  readonly services: Map<string, LiveServiceState>;
};

type RunServiceRef = { readonly runId: ManagedRunId; readonly serviceId: string };

function deriveServiceId(name: string, existing: ReadonlySet<string>): string {
  const base = slugifyServiceName(name);
  // Reserve LEGACY_SERVICE_ID so a composite service that slugs to "main" can't
  // alias the synthetic id used for legacy single-process runs.
  const taken = (candidate: string) => existing.has(candidate) || candidate === LEGACY_SERVICE_ID;
  if (!taken(base)) return base;
  let suffix = 2;
  while (taken(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function toManagedRunId(value: string) {
  return ManagedRunId.makeUnsafe(value);
}

function toTerminalKey(threadId: string, terminalId: string) {
  return `${threadId}\u0000${terminalId}`;
}

function toLogPubSubKey(runId: ManagedRunId, serviceId: string): string {
  return `${runId}/${serviceId}`;
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

/** Legacy single-file path: `<projectId>/<runId>.ndjson`. */
function legacyLogPath(baseDir: string, projectId: ProjectId, runId: ManagedRunId): string {
  return nodePath.join(baseDir, projectId, `${runId}.ndjson`);
}

/** Composite per-run directory: `<projectId>/<runId>/`. */
function compositeLogDir(baseDir: string, projectId: ProjectId, runId: ManagedRunId): string {
  return nodePath.join(baseDir, projectId, runId);
}

/** Composite per-service file: `<projectId>/<runId>/<serviceId>.ndjson`. */
function compositeLogPath(
  baseDir: string,
  projectId: ProjectId,
  runId: ManagedRunId,
  serviceId: string,
): string {
  return nodePath.join(compositeLogDir(baseDir, projectId, runId), `${serviceId}.ndjson`);
}

async function appendNdjsonLine(
  baseDir: string,
  projectId: ProjectId,
  runId: ManagedRunId,
  composite: boolean,
  serviceId: string,
  line: ManagedRunLogLine,
) {
  const filePath = composite
    ? compositeLogPath(baseDir, projectId, runId, serviceId)
    : legacyLogPath(baseDir, projectId, runId);
  await fs.mkdir(nodePath.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(line)}\n`, "utf8");
}

async function readNdjsonFile(filePath: string): Promise<ReadonlyArray<ManagedRunLogLine>> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .filter((entry) => entry.trim().length > 0)
      .map((entry) => {
        const parsed = JSON.parse(entry) as Partial<ManagedRunLogLine> & {
          timestamp: string;
          stream: ManagedRunLogLine["stream"];
          line: string;
        };
        return {
          timestamp: parsed.timestamp,
          stream: parsed.stream,
          line: parsed.line,
          serviceId: parsed.serviceId ?? null,
        } satisfies ManagedRunLogLine;
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Read historical log lines for a run. If `serviceId` is given, returns only
 * that service's file (composite). If omitted, tries the composite directory
 * first (merged + sorted by timestamp), then falls back to the legacy file.
 */
async function readNdjsonLines(
  baseDir: string,
  projectId: ProjectId,
  runId: ManagedRunId,
  serviceId?: string,
): Promise<ReadonlyArray<ManagedRunLogLine>> {
  if (serviceId !== undefined) {
    const composite = await readNdjsonFile(compositeLogPath(baseDir, projectId, runId, serviceId));
    if (composite.length > 0) return composite;
    const legacy = await readNdjsonFile(legacyLogPath(baseDir, projectId, runId));
    return legacy.filter((line) => line.serviceId === serviceId);
  }

  const dir = compositeLogDir(baseDir, projectId, runId);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }
  if (entries.length > 0) {
    const perFile = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".ndjson"))
        .map((entry) => readNdjsonFile(nodePath.join(dir, entry))),
    );
    const merged = perFile.flat();
    merged.sort((a, b) => (a.timestamp === b.timestamp ? 0 : a.timestamp < b.timestamp ? -1 : 1));
    return merged;
  }

  return readNdjsonFile(legacyLogPath(baseDir, projectId, runId));
}

async function deleteNdjsonLines(baseDir: string, projectId: ProjectId, runId: ManagedRunId) {
  try {
    await fs.rm(compositeLogDir(baseDir, projectId, runId), { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  try {
    await fs.rm(legacyLogPath(baseDir, projectId, runId), { force: true });
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
  /**
   * Run IDs that have a DB row created but have not yet been registered in
   * `liveRunsRef`. Cleanup paths skip these runs to avoid a race where
   * `cleanupOrphansForProject` deletes a row out from under a launch that's
   * still spawning terminals.
   */
  const launchingRunsRef = yield* Ref.make(new Set<string>());
  const terminalKeyToRunServiceRef = yield* Ref.make(new Map<string, RunServiceRef>());
  const mcpAccessRef = yield* Ref.make(
    new Map<string, { projectId: ProjectId; threadId: ThreadId; createdAt: number }>(),
  );
  const MCP_ACCESS_TTL_MS = 24 * 60 * 60 * 1_000;
  const healthPollFibersRef = yield* Ref.make(new Map<string, Fiber.Fiber<void>>());
  const inferenceFibersRef = yield* Ref.make(new Map<string, Fiber.Fiber<void>>());
  const eventsPubSub = yield* PubSub.unbounded<ManagedRunStreamEvent>();
  /**
   * One PubSub per `(runId, serviceId)` pair, lazily created on first publisher
   * or subscriber. Composite runs publish to one of N keyed PubSubs; legacy runs
   * publish to a single key under {@link LEGACY_SERVICE_ID}. Subscribers without
   * a `serviceId` filter merge across all known keys for the run.
   */
  const logPubSubsRef = yield* Ref.make(new Map<string, PubSub.PubSub<ManagedRunLogStreamEvent>>());

  const getOrCreateLogPubSub = Effect.fn("managedRuns.getOrCreateLogPubSub")(function* (
    runId: ManagedRunId,
    serviceId: string,
  ) {
    const key = toLogPubSubKey(runId, serviceId);
    const existing = yield* Ref.get(logPubSubsRef).pipe(Effect.map((map) => map.get(key) ?? null));
    if (existing !== null) {
      return existing;
    }
    const next = yield* PubSub.sliding<ManagedRunLogStreamEvent>(1024);
    yield* Ref.update(logPubSubsRef, (current) => {
      if (current.has(key)) {
        return current;
      }
      const updated = new Map(current);
      updated.set(key, next);
      return updated;
    });
    return next;
  });

  const releaseLogPubSubsForRun = (runId: ManagedRunId): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      const removed: Array<PubSub.PubSub<ManagedRunLogStreamEvent>> = [];
      yield* Ref.update(logPubSubsRef, (current) => {
        const next = new Map(current);
        for (const [key, pubsub] of current.entries()) {
          if (key.startsWith(`${runId}/`)) {
            next.delete(key);
            removed.push(pubsub);
          }
        }
        return removed.length > 0 ? next : current;
      });
      // Shut down each pubsub so subscribers see end-of-stream and any queued
      // events are released — otherwise lingering subscribers keep the sliding
      // queue alive long after the run is gone.
      for (const pubsub of removed) {
        yield* PubSub.shutdown(pubsub);
      }
    });

  /**
   * Publish a log line to its per-service PubSub. The published event's
   * `serviceId` is null for legacy runs (matches the on-disk record format)
   * even though we route via the synthetic `LEGACY_SERVICE_ID` PubSub key.
   */
  const publishLogLine = (
    runId: ManagedRunId,
    serviceId: string,
    publishedServiceId: string | null,
    line: ManagedRunLogLine,
  ) =>
    Effect.gen(function* () {
      const key = toLogPubSubKey(runId, serviceId);
      const pubsub = yield* Ref.get(logPubSubsRef).pipe(Effect.map((map) => map.get(key) ?? null));
      if (pubsub === null) {
        return;
      }
      yield* PubSub.publish(pubsub, { runId, serviceId: publishedServiceId, line });
    });

  const resolveScript = Effect.fn("managedRuns.resolveScript")(function* (
    projectId: ProjectId,
    scriptId: string,
  ) {
    const project = Option.getOrNull(yield* snapshotQuery.getProjectById(projectId));
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
    const live = yield* Ref.get(liveRunsRef).pipe(Effect.map((runs) => runs.get(runId) ?? null));

    if (live?.composite) {
      // Composite: one inference call per service, each fed only that service's
      // own NDJSON tail. Runs in parallel and produces one inference record per
      // service. The matched composite serviceId overrides whatever slug the
      // LLM proposed so runtimeServices line up with the per-service tabs.
      const serviceStates = Array.from(live.services.values());
      const declaredByName = new Map(
        detail.declaredServices.map((entry) => [entry.name, entry] as const),
      );

      type PerService = {
        readonly serviceId: string;
        readonly declaredName: string;
        readonly result: ManagedRunInferenceResult;
        readonly inferenceId: string;
        readonly createdAt: string;
        readonly runtimeServices: ReadonlyArray<ManagedRunRuntimeService>;
      };
      const perServiceResults: ReadonlyArray<PerService> = yield* Effect.forEach(
        serviceStates,
        (svc) =>
          Effect.gen(function* () {
            const declaredName = svc.declaredName ?? svc.serviceId;
            const declared = declaredByName.get(declaredName) ?? {
              name: declaredName,
            };
            const serviceLogs = yield* Effect.tryPromise({
              try: () => readNdjsonLines(logsDir, detail.projectId, detail.runId, svc.serviceId),
              catch: (cause) =>
                toManagedRunOperationError("managedRuns.readLogsForInference", cause),
            }).pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<ManagedRunLogLine>)));

            const builtInput = yield* inference.buildInferenceInput({
              runId: detail.runId,
              cwd: detail.cwd,
              command: script?.command ?? detail.scriptId,
              declaredServices: [declared],
              detectedUrl: null,
              detectedPort: null,
              logs: serviceLogs,
            });
            const result = yield* inference.inferRunServices(builtInput);

            // Override the LLM's auto-slug serviceId with the authoritative
            // composite serviceId so the UI can route each runtime entry back
            // to its tab.
            const runtimeServices: ReadonlyArray<ManagedRunRuntimeService> =
              result.runtimeServices.map((entry) => ({
                ...entry,
                serviceId: svc.serviceId,
                declaredServiceName: declaredName,
              }));

            return {
              serviceId: svc.serviceId,
              declaredName,
              result,
              inferenceId: randomUUID(),
              createdAt: nowIso(),
              runtimeServices,
            } satisfies PerService;
          }),
        { concurrency: "unbounded" },
      );

      // Persist one record per service so the audit trail captures each call.
      yield* Effect.forEach(
        perServiceResults,
        (entry) =>
          repository
            .createInferenceRecord({
              inferenceId: entry.inferenceId,
              runId: detail.runId,
              projectId: detail.projectId,
              scriptId: detail.scriptId,
              scriptName: entry.declaredName,
              cwd: detail.cwd,
              provider: entry.result.provider,
              model: entry.result.model,
              status: entry.result.status,
              createdAt: entry.createdAt,
              runtimeServiceCount: entry.runtimeServices.length,
              declaredServices: [
                {
                  name: entry.declaredName,
                  ...(declaredByName.get(entry.declaredName)?.healthCheck
                    ? { healthCheck: declaredByName.get(entry.declaredName)!.healthCheck! }
                    : {}),
                },
              ],
              normalizedPayload: entry.result.normalizedPayload,
              rawPayload: entry.result.rawPayload,
              inferenceError: entry.result.inferenceError,
              groundingFailures: [...entry.result.groundingFailures],
              evidenceExcerpt: [...entry.result.evidenceExcerpt],
            })
            .pipe(Effect.catch(() => Effect.void)),
        { discard: true },
      );

      // Inference is an ENRICHMENT pass for composite runs — it does not
      // create services (those exist deterministically from the script's
      // declarations and were pre-populated as stubs at launch). For each
      // service the LLM grounded successfully, replace the stub entry with the
      // enriched runtime service. For services it didn't ground, keep the stub
      // intact so the per-service tab still renders.
      const enrichedByServiceId = new Map<string, ManagedRunRuntimeService>();
      for (const entry of perServiceResults) {
        const enriched = entry.runtimeServices[0];
        if (enriched) {
          enrichedByServiceId.set(entry.serviceId, enriched);
        }
      }
      const mergedRuntimeServices: ReadonlyArray<ManagedRunRuntimeService> =
        detail.runtimeServices.map(
          (existing) => enrichedByServiceId.get(existing.serviceId) ?? existing,
        );

      const anyGrounded = enrichedByServiceId.size > 0;
      const allFailed =
        perServiceResults.length > 0 &&
        perServiceResults.every((entry) => entry.result.status === "failed");
      const aggregatedStatus: ManagedRunInferenceResult["status"] = anyGrounded
        ? "ready"
        : allFailed
          ? "failed"
          : "ungrounded";
      const lastEntry = perServiceResults.at(-1);
      const inferenceUpdatedAt = lastEntry?.createdAt ?? nowIso();

      const updated = yield* updateRun(runId, (current) => ({
        ...current,
        runtimeServices: mergedRuntimeServices,
        inferenceStatus: aggregatedStatus,
        inferenceUpdatedAt,
        inferenceError:
          perServiceResults
            .map((entry) => entry.result.inferenceError)
            .filter((value): value is string => value !== null)
            .join("; ") || null,
        detectedUrl: deriveDetectedUrl(mergedRuntimeServices),
        detectedPort: deriveDetectedPort(mergedRuntimeServices),
        updatedAt: inferenceUpdatedAt,
        latestInference: lastEntry
          ? {
              inferenceId: lastEntry.inferenceId,
              provider: lastEntry.result.provider,
              model: lastEntry.result.model,
              rawPayload: lastEntry.result.rawPayload,
              normalizedPayload: lastEntry.result.normalizedPayload,
              createdAt: lastEntry.createdAt,
            }
          : null,
      }));

      if (updated.runtimeServices.length === 0) {
        return updated;
      }

      const validated = yield* validateRuntimeServices(runId);
      if (validated.status === "running" || validated.status === "starting") {
        yield* startHealthPollFiber(runId);
      }
      return validated;
    }

    // Legacy single-process inference: one call against merged logs.
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
    serviceState: LiveServiceState,
  ) {
    if (live.removing) {
      // Run is being torn down; the trailing partial line is dropped on the
      // floor rather than racing the upcoming `fs.rm`.
      serviceState.partialLineBuffer = "";
      return;
    }
    if (serviceState.partialLineBuffer.length === 0) {
      return;
    }
    const line = serviceState.partialLineBuffer;
    serviceState.partialLineBuffer = "";
    // Legacy runs persist `serviceId: null` on-disk for backward compat with
    // older readers. Composite runs persist the real serviceId.
    const persistedServiceId = live.composite ? serviceState.serviceId : null;
    const logLine: ManagedRunLogLine = {
      timestamp: nowIso(),
      stream: "pty",
      line,
      serviceId: persistedServiceId,
    };
    yield* Effect.tryPromise({
      try: () =>
        appendNdjsonLine(
          logsDir,
          live.projectId,
          live.runId,
          live.composite,
          serviceState.serviceId,
          logLine,
        ),
      catch: (cause) => toManagedRunOperationError("managedRuns.flushPartialBuffer", cause),
    }).pipe(Effect.catch(() => Effect.void));
    yield* publishLogLine(live.runId, serviceState.serviceId, persistedServiceId, logLine);
  });

  const handleTerminalOutput = Effect.fn("managedRuns.handleTerminalOutput")(function* (
    threadId: string,
    terminalId: string,
    data: string,
  ) {
    const terminalKey = toTerminalKey(threadId, terminalId);
    const ref = yield* Ref.get(terminalKeyToRunServiceRef).pipe(
      Effect.map((mapping) => mapping.get(terminalKey) ?? null),
    );
    if (ref === null) {
      return;
    }

    const live = yield* Ref.get(liveRunsRef).pipe(
      Effect.map((runs) => runs.get(ref.runId) ?? null),
    );
    if (live === null || live.removing) {
      return;
    }
    const serviceState = live.services.get(ref.serviceId);
    if (!serviceState) {
      return;
    }

    const split = splitCompleteLines(serviceState.partialLineBuffer, data);
    serviceState.partialLineBuffer = split.remainder;
    if (split.lines.length > 0) {
      yield* ensureRunning(ref.runId);
    }

    const persistedServiceId = live.composite ? serviceState.serviceId : null;
    for (const line of split.lines) {
      const logLine: ManagedRunLogLine = {
        timestamp: nowIso(),
        stream: "pty",
        line,
        serviceId: persistedServiceId,
      };
      yield* Effect.tryPromise({
        try: () =>
          appendNdjsonLine(
            logsDir,
            live.projectId,
            ref.runId,
            live.composite,
            serviceState.serviceId,
            logLine,
          ),
        catch: (cause) => toManagedRunOperationError("managedRuns.appendLogLine", cause),
      }).pipe(Effect.catch(() => Effect.void));
      yield* publishLogLine(ref.runId, serviceState.serviceId, persistedServiceId, logLine);
    }
  });

  const unregisterServiceTerminalKey = (
    terminalThreadId: string,
    terminalId: string,
  ): Effect.Effect<void, never, never> =>
    Ref.update(terminalKeyToRunServiceRef, (current) => {
      const next = new Map(current);
      next.delete(toTerminalKey(terminalThreadId, terminalId));
      return next;
    });

  /**
   * Removes the run entirely from in-memory state. Call only after every live
   * service has exited (or for legacy runs after the single PTY exits).
   */
  const unregisterLiveRun = (runId: ManagedRunId): Effect.Effect<void, never, never> =>
    Effect.all([
      Ref.update(liveRunsRef, (current) => {
        const next = new Map(current);
        next.delete(runId);
        return next;
      }),
      stopHealthPollFiber(runId),
      stopInferenceFiber(runId),
      releaseLogPubSubsForRun(runId),
    ]).pipe(Effect.asVoid);

  const allServicesExited = (live: LiveRunState): boolean => {
    for (const service of live.services.values()) {
      if (service.status !== "exited") return false;
    }
    return true;
  };

  /**
   * Aggregates exit codes/signals across all services in a (presumably exited)
   * run. The first non-zero exit wins for the run-level `lastExitCode`. If
   * every service exited cleanly with code 0, the run reports 0.
   */
  const aggregateExit = (
    live: LiveRunState,
  ): { exitCode: number | null; exitSignal: number | null; failed: boolean } => {
    let exitCode: number | null = 0;
    let exitSignal: number | null = null;
    let failed = false;
    let sawAnyExited = false;
    for (const service of live.services.values()) {
      if (service.status !== "exited") continue;
      sawAnyExited = true;
      if (service.exitCode !== null && service.exitCode !== 0) {
        exitCode = service.exitCode;
        failed = true;
      }
      if (service.exitSignal !== null) {
        exitSignal = service.exitSignal;
        failed = true;
      }
    }
    if (!sawAnyExited) {
      return { exitCode: null, exitSignal: null, failed: false };
    }
    return { exitCode, exitSignal, failed };
  };

  const handleTerminalExit = Effect.fn("managedRuns.handleTerminalExit")(function* (
    threadId: string,
    terminalId: string,
    exitCode: number | null,
    exitSignal: number | null,
  ) {
    const terminalKey = toTerminalKey(threadId, terminalId);
    const ref = yield* Ref.get(terminalKeyToRunServiceRef).pipe(
      Effect.map((mapping) => mapping.get(terminalKey) ?? null),
    );
    if (ref === null) {
      return;
    }

    const live = yield* Ref.get(liveRunsRef).pipe(
      Effect.map((runs) => runs.get(ref.runId) ?? null),
    );
    if (live === null) {
      yield* unregisterServiceTerminalKey(threadId, terminalId);
      return;
    }
    const serviceState = live.services.get(ref.serviceId);
    if (!serviceState) {
      yield* unregisterServiceTerminalKey(threadId, terminalId);
      return;
    }

    yield* flushPartialBuffer(live, serviceState);
    serviceState.status = "exited";
    serviceState.exitCode = exitCode;
    serviceState.exitSignal = exitSignal;
    yield* unregisterServiceTerminalKey(threadId, terminalId);

    // For composite runs, do not finalise the run-level status until every
    // sibling service has exited too. We mark this service exited above and
    // wait for the rest. (We could also surface a partial-failure status, but
    // that's a richer UX than v1 needs.)
    if (live.composite && !allServicesExited(live)) {
      return;
    }

    const completedAt = nowIso();
    const aggregated = aggregateExit(live);

    if (live.intentionalStop) {
      // Preserve any non-zero exits as `lastError` so an intentional stop
      // that masked a real crash isn't indistinguishable from a clean stop.
      const failedDuringStop = aggregated.failed
        ? Array.from(live.services.values())
            .filter(
              (svc) =>
                svc.status === "exited" &&
                ((svc.exitCode !== null && svc.exitCode !== 0) || svc.exitSignal !== null),
            )
            .map((svc) =>
              svc.exitSignal !== null
                ? `${svc.serviceId} terminated by signal ${svc.exitSignal}`
                : `${svc.serviceId} exited with code ${svc.exitCode}`,
            )
            .join("; ")
        : null;
      yield* updateRun(ref.runId, (current) => ({
        ...current,
        status: "stopped",
        updatedAt: completedAt,
        completedAt,
        lastExitCode: aggregated.exitCode,
        lastExitSignal: aggregated.exitSignal,
        lastError: failedDuringStop ?? current.lastError,
        logsExpireAt: logsExpiryIso(),
      })).pipe(Effect.catch(() => Effect.void));
      yield* unregisterLiveRun(ref.runId);
      return;
    }

    if (aggregated.failed) {
      yield* updateRun(ref.runId, (current) => ({
        ...current,
        status: "failed",
        updatedAt: completedAt,
        completedAt,
        lastExitCode: aggregated.exitCode,
        lastExitSignal: aggregated.exitSignal,
        logsExpireAt: logsExpiryIso(),
      })).pipe(Effect.catch(() => Effect.void));
      yield* unregisterLiveRun(ref.runId);
      return;
    }

    const detail = yield* readRunDetail(ref.runId).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!detail) {
      yield* unregisterLiveRun(ref.runId);
      return;
    }

    if (detail.inferenceStatus === "pending") {
      yield* runInferenceForRun(ref.runId).pipe(Effect.catch(() => Effect.void));
    }

    const refreshed = yield* readRunDetail(ref.runId).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (!refreshed) {
      yield* unregisterLiveRun(ref.runId);
      return;
    }

    if (refreshed.runtimeServices.length === 0) {
      yield* updateRun(ref.runId, (current) => ({
        ...current,
        status: "completed",
        updatedAt: completedAt,
        completedAt,
        lastExitCode: aggregated.exitCode,
        lastExitSignal: aggregated.exitSignal,
        logsExpireAt: logsExpiryIso(),
      })).pipe(Effect.catch(() => Effect.void));
      yield* unregisterLiveRun(ref.runId);
      return;
    }

    const validated = yield* validateRuntimeServices(ref.runId).pipe(
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
      yield* updateRun(ref.runId, (current) => ({
        ...current,
        status: "running",
        updatedAt: nowIso(),
        lastExitCode: aggregated.exitCode,
        lastExitSignal: aggregated.exitSignal,
      })).pipe(Effect.catch(() => Effect.void));
      yield* startHealthPollFiber(ref.runId);
    } else if (anyHealthy) {
      yield* updateRun(ref.runId, (current) => ({
        ...current,
        status: "completed",
        updatedAt: completedAt,
        completedAt,
        lastExitCode: aggregated.exitCode,
        lastExitSignal: aggregated.exitSignal,
        logsExpireAt: logsExpiryIso(),
      })).pipe(Effect.catch(() => Effect.void));
    } else {
      yield* updateRun(ref.runId, (current) => ({
        ...current,
        status: "stopped",
        updatedAt: completedAt,
        completedAt,
        lastExitCode: aggregated.exitCode,
        lastExitSignal: aggregated.exitSignal,
        logsExpireAt: logsExpiryIso(),
      })).pipe(Effect.catch(() => Effect.void));
    }

    yield* unregisterLiveRun(ref.runId);
  });

  const handleTerminalError = Effect.fn("managedRuns.handleTerminalError")(function* (
    threadId: string,
    terminalId: string,
    message: string,
  ) {
    const terminalKey = toTerminalKey(threadId, terminalId);
    const ref = yield* Ref.get(terminalKeyToRunServiceRef).pipe(
      Effect.map((mapping) => mapping.get(terminalKey) ?? null),
    );
    if (ref === null) {
      return;
    }

    const live = yield* Ref.get(liveRunsRef).pipe(
      Effect.map((runs) => runs.get(ref.runId) ?? null),
    );
    if (live) {
      const serviceState = live.services.get(ref.serviceId);
      if (serviceState) {
        // Flush any trailing partial line BEFORE marking the service exited so
        // the last line of output isn't dropped. The exit path also calls
        // flushPartialBuffer but in error scenarios we may not see a follow-up
        // exit event.
        yield* flushPartialBuffer(live, serviceState);
        if (serviceState.status !== "exited") {
          serviceState.status = "exited";
        }
      }
      // For composite runs, only fail the whole run if every service is gone.
      // Otherwise leave siblings running and just record this service's failure
      // via the terminal exit path.
      if (live.composite && !allServicesExited(live)) {
        yield* unregisterServiceTerminalKey(threadId, terminalId);
        yield* updateRun(ref.runId, (current) => ({
          ...current,
          lastError: `${ref.serviceId}: ${message}`,
          updatedAt: nowIso(),
        })).pipe(Effect.catch(() => Effect.void));
        return;
      }
    }
    yield* unregisterServiceTerminalKey(threadId, terminalId);

    yield* updateRun(ref.runId, (current) => ({
      ...current,
      status: "failed",
      updatedAt: nowIso(),
      completedAt: nowIso(),
      lastError: message,
      logsExpireAt: logsExpiryIso(),
    })).pipe(Effect.catch(() => Effect.void));

    if (live) {
      yield* unregisterLiveRun(ref.runId);
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

  /**
   * Tear-down for a single run: closes any live PTYs, unregisters in-memory
   * state, deletes the DB row + NDJSON, and publishes a `removed` stream
   * event so the UI drops its tab immediately.
   */
  const removeRunAndPublish = (
    runId: ManagedRunId,
    projectId: ProjectId,
  ): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      const live = yield* Ref.get(liveRunsRef).pipe(Effect.map((runs) => runs.get(runId) ?? null));
      if (live) {
        // Mark the run as removing BEFORE close so any output events buffered
        // by node-pty that fire after this point skip NDJSON append + publish.
        live.removing = true;
        live.intentionalStop = true;
        yield* Effect.forEach(
          Array.from(live.services.values()),
          (service) =>
            terminalManager
              .close({ threadId: live.terminalThreadId, terminalId: service.terminalId })
              .pipe(Effect.catch(() => Effect.void)),
          { concurrency: "unbounded", discard: true },
        );
        for (const service of live.services.values()) {
          yield* unregisterServiceTerminalKey(live.terminalThreadId, service.terminalId);
        }
        yield* unregisterLiveRun(runId);
      }
      yield* repository.deleteById({ runId }).pipe(Effect.catch(() => Effect.void));
      yield* Effect.tryPromise({
        try: () => deleteNdjsonLines(logsDir, projectId, runId),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.void));
      yield* PubSub.publish(eventsPubSub, {
        type: "removed" as const,
        projectId,
        runId,
      }).pipe(Effect.asVoid);
    });

  /**
   * Reconcile every run whose script is no longer present in its project.
   * Called once at startup to handle anything left behind across restarts.
   */
  const cleanupOrphanedRuns = Effect.fn("managedRuns.cleanupOrphanedRuns")(function* () {
    const allRuns = yield* repository
      .listByStatuses({
        statuses: ["starting", "running", "completed", "failed", "stopped", "lost"],
      })
      .pipe(Effect.catch(() => Effect.succeed([] as const)));
    if (allRuns.length === 0) {
      return;
    }

    const uniqueProjectIds = [...new Set(allRuns.map((run) => run.projectId))];
    const projectMap = new Map<string, OrchestrationProject>();
    for (const pid of uniqueProjectIds) {
      const projectOption = yield* snapshotQuery
        .getProjectById(pid)
        .pipe(Effect.catch(() => Effect.succeed(Option.none<OrchestrationProject>())));
      if (Option.isSome(projectOption)) {
        projectMap.set(pid, projectOption.value);
      }
    }

    const launching = yield* Ref.get(launchingRunsRef);
    for (const run of allRuns) {
      // A run that is still mid-launch might have a DB row but no live state
      // yet; skip so the launcher doesn't observe the row vanishing under it.
      if (launching.has(run.runId)) continue;
      const project = projectMap.get(run.projectId) ?? null;
      const scriptExists = project?.scripts.some((script) => script.id === run.scriptId) ?? false;
      if (scriptExists) continue;
      yield* removeRunAndPublish(run.runId, run.projectId);
    }
  });

  /**
   * Project-scoped orphan cleanup. Called reactively by the OrphanRunsReactor
   * when a `project.meta-updated` event lands — the reactor passes the new
   * scripts list so we don't need to hit the projection cache (which may not
   * have processed the same event yet, racing).
   */
  const cleanupOrphansForProject = (projectId: ProjectId): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      const allRuns = yield* repository
        .listByStatuses({
          statuses: ["starting", "running", "completed", "failed", "stopped", "lost"],
        })
        .pipe(Effect.catch(() => Effect.succeed([] as const)));

      const projectOption = yield* snapshotQuery
        .getProjectById(projectId)
        .pipe(Effect.catch(() => Effect.succeed(Option.none<OrchestrationProject>())));
      const project = Option.getOrNull(projectOption);
      const scriptIds = new Set(project?.scripts.map((script) => script.id) ?? []);

      const launching = yield* Ref.get(launchingRunsRef);
      for (const run of allRuns) {
        if (run.projectId !== projectId) continue;
        if (scriptIds.has(run.scriptId)) continue;
        // Avoid racing a still-launching run whose row exists but whose live
        // state hasn't been registered yet.
        if (launching.has(run.runId)) continue;
        yield* removeRunAndPublish(run.runId, run.projectId);
      }
    });

  yield* recoverActiveRuns.pipe(Effect.forkIn(workerScope));
  // One-shot orphan sweep on startup as a safety net for runs left behind
  // across restarts. Steady-state cleanup is event-driven (see
  // `OrphanRunsReactorLive`) — no polling.
  yield* cleanupOrphanedRuns().pipe(Effect.forkIn(workerScope));
  yield* Effect.forever(
    Effect.gen(function* () {
      yield* cleanupExpiredLogs();
      yield* sweepExpiredMcpTokens();
    }).pipe(Effect.delay(LOG_CLEANUP_INTERVAL_MS)),
  ).pipe(Effect.forkIn(workerScope));

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
            for (const service of live.services.values()) {
              yield* flushPartialBuffer(live, service);
              yield* terminalManager
                .close({ threadId: live.terminalThreadId, terminalId: service.terminalId })
                .pipe(Effect.catch(() => Effect.void));
            }
          }),
        { discard: true },
      );
    }),
  );

  const launchProjectScript = Effect.fn("managedRuns.launchProjectScript")(function* (
    input: ManagedRunLaunchProjectScriptInput,
  ) {
    const projectOption = yield* snapshotQuery
      .getProjectById(input.projectId)
      .pipe(
        Effect.mapError((cause) => toManagedRunOperationError("managedRuns.getProjectById", cause)),
      );
    const project = Option.getOrNull(projectOption);
    if (!project) {
      return yield* new ManagedRunProjectLookupError({
        projectId: input.projectId,
        message: `Unable to find project '${input.projectId}'.`,
      });
    }

    const thread = Option.getOrNull(
      yield* snapshotQuery
        .getThreadById(input.threadId)
        .pipe(
          Effect.mapError((cause) =>
            toManagedRunOperationError("managedRuns.getThreadById", cause),
          ),
        ),
    );
    const script = project.scripts.find((candidate) => candidate.id === input.scriptId) ?? null;
    if (!script) {
      return yield* new ManagedRunScriptLookupError({
        projectId: input.projectId,
        scriptId: input.scriptId,
      });
    }

    const composite = isCompositeProjectScript(script);
    const shapeError = validateProjectScriptShape(script);
    if (shapeError !== null) {
      return yield* new ManagedRunOperationError({
        operation: "managedRuns.launchProjectScript",
        message: shapeError,
      });
    }

    const runId = toManagedRunId(randomUUID());
    const createdAt = nowIso();
    const cwd = input.cwd ?? input.worktreePath ?? thread?.worktreePath ?? project.workspaceRoot;
    const terminalThreadId = `managed-run:${runId}`;

    type PlannedService = {
      readonly serviceId: string;
      readonly terminalId: string;
      readonly command: string;
      readonly cwd: string;
      readonly env: Record<string, string>;
      readonly declaredServiceName: string | null;
      readonly healthCheck: ManagedRunDeclaredServiceSnapshot["healthCheck"] | null;
    };

    const declaredServiceSnapshots: ManagedRunDeclaredServiceSnapshot[] = (
      script.services ?? []
    ).map((service) => ({
      name: service.name,
      ...(service.healthCheck ? { healthCheck: service.healthCheck } : {}),
    }));

    const runtimeEnv = projectScriptRuntimeEnv({
      projectRoot: project.workspaceRoot,
      worktreePath: input.worktreePath ?? thread?.worktreePath ?? null,
      ...(input.env ? { extraEnv: input.env } : {}),
    });

    // Plan the per-service launches. Composite runs get one entry per declared
    // service; legacy runs get a single entry under LEGACY_SERVICE_ID.
    const planned: PlannedService[] = [];
    if (composite) {
      const usedIds = new Set<string>();
      for (const service of script.services ?? []) {
        if (!service.command) continue;
        const serviceId = deriveServiceId(service.name, usedIds);
        usedIds.add(serviceId);
        planned.push({
          serviceId,
          terminalId: `managed-run-${runId}-${serviceId}`,
          command: service.command,
          cwd: service.cwd ?? cwd,
          env: { ...runtimeEnv, ...(service.env ?? {}) },
          declaredServiceName: service.name,
          healthCheck: service.healthCheck,
        });
      }
    } else {
      planned.push({
        serviceId: LEGACY_SERVICE_ID,
        terminalId: `managed-run-${runId}`,
        // Legacy mode requires script.command per validateProjectScriptShape.
        command: script.command as string,
        cwd,
        env: runtimeEnv,
        declaredServiceName: null,
        healthCheck: null,
      });
    }

    // For composite runs, expose stub `runtimeServices` upfront — one entry per
    // planned service. The drawer's per-service tab strip is structural and
    // should not depend on inference completing or grounding successfully.
    // Inference (when it runs) ENRICHES these entries with role / health-check
    // metadata; if it can't ground a service the stub stays as-is and the tab
    // still appears with `validationStatus: "unknown"`.
    const initialRuntimeServices: ReadonlyArray<ManagedRunRuntimeService> = composite
      ? planned.map((entry) => ({
          serviceId: entry.serviceId,
          declaredServiceName: entry.declaredServiceName,
          resolvedName: entry.declaredServiceName ?? entry.serviceId,
          role: "unknown" as const,
          canonicalHealthCheck: entry.healthCheck ?? null,
          validationStatus: "unknown" as const,
          inferenceConfidence: "low" as const,
          inferenceSource: "declared" as const,
          groundedBy: ["declared"] as const,
          evidenceLines: [],
          lastCheckedAt: null,
        }))
      : [];

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
      // Run summary keeps a single terminalId for backward compat (consumers
      // like the UI use this to address one PTY). For composite runs we point
      // it at the first service's terminal, but per-service ids live on
      // `runtimeServices[*].serviceId`.
      terminalId: planned[0]?.terminalId ?? `managed-run-${runId}`,
      terminalPid: null,
      createdAt,
      updatedAt: createdAt,
      startedAt: createdAt,
      completedAt: null,
      lastExitCode: null,
      lastExitSignal: null,
      declaredServices: declaredServiceSnapshots,
      runtimeServices: initialRuntimeServices,
      inferenceStatus: "pending",
      inferenceUpdatedAt: null,
      inferenceError: null,
      lastError: null,
      logsExpireAt: null,
      evidence: [],
      latestInference: null,
    };

    // Mark the run as launching BEFORE the row is created so cleanup paths
    // can't delete the row between create() and the liveRunsRef registration.
    yield* Ref.update(launchingRunsRef, (current) => {
      const next = new Set(current);
      next.add(runId);
      return next;
    });
    const clearLaunching = Ref.update(launchingRunsRef, (current) => {
      if (!current.has(runId)) return current;
      const next = new Set(current);
      next.delete(runId);
      return next;
    });

    yield* repository
      .create({
        ...summarize(baseDetail),
        lastError: baseDetail.lastError,
        logsExpireAt: baseDetail.logsExpireAt,
      })
      .pipe(
        Effect.mapError((cause) => toManagedRunOperationError("managedRuns.create", cause)),
        Effect.tapError(() => clearLaunching),
      );

    // Track every successful open so we can release them all if a sibling
    // open fails (Effect.forEach short-circuits but does not roll back the
    // opens that already succeeded).
    const openedTerminals: Array<{ threadId: string; terminalId: string }> = [];
    const releaseOpenedTerminals = Effect.forEach(
      openedTerminals,
      (handle) =>
        terminalManager
          .close({ threadId: handle.threadId, terminalId: handle.terminalId })
          .pipe(Effect.catch(() => Effect.void)),
      { concurrency: "unbounded", discard: true },
    );

    const terminals: ReadonlyArray<{
      readonly entry: PlannedService;
      readonly snapshot: Awaited<
        ReturnType<typeof terminalManager.open> extends Effect.Effect<infer A, any, any> ? A : never
      >;
    }> = yield* Effect.forEach(
      planned,
      (entry) =>
        terminalManager
          .open({
            threadId: terminalThreadId,
            terminalId: entry.terminalId,
            cwd: entry.cwd,
            env: entry.env,
            cols: MANAGED_RUN_TERMINAL_COLS,
            rows: MANAGED_RUN_TERMINAL_ROWS,
          })
          .pipe(
            Effect.mapError((cause) =>
              toManagedRunOperationError("managedRuns.openTerminal", cause),
            ),
            Effect.tap((snapshot) =>
              Effect.sync(() => {
                openedTerminals.push({ threadId: terminalThreadId, terminalId: entry.terminalId });
                void snapshot;
              }),
            ),
            Effect.map((snapshot) => ({ entry, snapshot })),
          ),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.tapError(() =>
        Effect.gen(function* () {
          yield* releaseOpenedTerminals;
          yield* repository.deleteById({ runId }).pipe(Effect.catch(() => Effect.void));
          yield* clearLaunching;
        }),
      ),
    );

    const services = new Map<string, LiveServiceState>();
    for (const { entry } of terminals) {
      services.set(entry.serviceId, {
        serviceId: entry.serviceId,
        terminalId: entry.terminalId,
        declaredName: entry.declaredServiceName,
        partialLineBuffer: "",
        status: "starting",
        exitCode: null,
        exitSignal: null,
      });
    }

    const live: LiveRunState = {
      runId,
      projectId: input.projectId,
      terminalThreadId,
      composite,
      intentionalStop: false,
      removing: false,
      services,
    };

    yield* Ref.update(liveRunsRef, (current) => {
      const next = new Map(current);
      next.set(runId, live);
      return next;
    });
    yield* Ref.update(terminalKeyToRunServiceRef, (current) => {
      const next = new Map(current);
      for (const { entry } of terminals) {
        next.set(toTerminalKey(terminalThreadId, entry.terminalId), {
          runId,
          serviceId: entry.serviceId,
        });
      }
      return next;
    });
    // Run is fully registered; cleanup paths may now act on it.
    yield* clearLaunching;

    // Pre-create per-service log PubSubs so subscribers that arrive before the
    // first published line still see live events.
    for (const { entry } of terminals) {
      yield* getOrCreateLogPubSub(runId, entry.serviceId);
    }

    // Record process evidence for every spawned service.
    for (const { entry, snapshot } of terminals) {
      if (snapshot.pid !== null) {
        yield* addEvidence(runId, {
          type: "process",
          source: "inferred",
          createdAt,
          value: {
            pid: snapshot.pid,
            command: entry.command,
            cwd: entry.cwd,
            startedAt: createdAt,
          },
        }).pipe(Effect.catch(() => Effect.void));
      }
    }

    const firstTerminalPid = terminals[0]?.snapshot.pid ?? null;
    const detailAfterTerminal = yield* updateRun(runId, (current) => ({
      ...current,
      terminalPid: firstTerminalPid,
      updatedAt: nowIso(),
    }));

    // Drive each PTY with `command; exit $?\r` so that when the command ends,
    // the shell exits with the command's status — letting handleTerminalExit
    // see a meaningful exit code.
    yield* Effect.forEach(
      terminals,
      ({ entry }) =>
        terminalManager
          .write({
            threadId: terminalThreadId,
            terminalId: entry.terminalId,
            data: `${entry.command}; exit $?\r`,
          })
          .pipe(Effect.catch(() => Effect.void)),
      { concurrency: "unbounded", discard: true },
    );

    yield* scheduleInference(runId);

    yield* Effect.sleep(STARTUP_GRACE_MS).pipe(
      Effect.andThen(() => ensureRunning(runId)),
      Effect.catch(() => Effect.void),
      Effect.forkIn(workerScope),
    );

    return {
      run: summarize(detailAfterTerminal),
      // The legacy contract returns one terminal snapshot. We hand back the
      // first service's snapshot — composite consumers that care about
      // per-service terminals will need to inspect runtimeServices.
      terminal: terminals[0]!.snapshot,
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
      try: () => readNdjsonLines(logsDir, detail.projectId, detail.runId, input.serviceId),
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
    // Close every per-service PTY in parallel. Each will deliver a terminal
    // exit event that handleTerminalExit collapses into the run-level
    // "stopped" status once all services are gone.
    yield* Effect.forEach(
      Array.from(live.services.values()),
      (service) =>
        terminalManager
          .close({ threadId: live.terminalThreadId, terminalId: service.terminalId })
          .pipe(Effect.mapError((cause) => toManagedRunOperationError("managedRuns.stop", cause))),
      { concurrency: "unbounded", discard: true },
    );
  });

  const streamEvents = (projectId: ProjectId) =>
    Stream.fromPubSub(eventsPubSub).pipe(Stream.filter((event) => event.projectId === projectId));

  /**
   * Subscribe to log lines for a run. With `serviceId` given, returns just
   * that service's PubSub. Without, merges every per-service PubSub for the
   * run; events are tagged with `serviceId` so the client can route them.
   *
   * For runs that haven't been started yet (or no longer have a live entry),
   * a single-service legacy PubSub is created lazily — historical readers can
   * still see the empty stream and fall back to `getLogs`.
   */
  const streamLogs = (
    runId: ManagedRunId,
    serviceId?: string,
  ): Stream.Stream<ManagedRunLogStreamEvent, never> =>
    Stream.unwrap(
      Effect.gen(function* () {
        if (serviceId !== undefined) {
          const pubsub = yield* getOrCreateLogPubSub(runId, serviceId);
          return Stream.fromPubSub(pubsub);
        }
        const live = yield* Ref.get(liveRunsRef).pipe(
          Effect.map((runs) => runs.get(runId) ?? null),
        );
        let ids: string[];
        if (live) {
          ids = Array.from(live.services.keys());
        } else {
          // Run is no longer live — fall back to the persisted runtimeServices
          // so a subscriber tailing a completed composite run sees the right
          // per-service streams instead of a stale legacy fallback.
          const row = yield* repository
            .getById({ runId })
            .pipe(Effect.catch(() => Effect.succeed(Option.none<ManagedRunSummary>())));
          const persistedServiceIds = Option.isSome(row)
            ? row.value.runtimeServices.map((service) => service.serviceId)
            : [];
          ids = persistedServiceIds.length > 0 ? persistedServiceIds : [LEGACY_SERVICE_ID];
        }
        const pubsubs = yield* Effect.forEach(ids, (sid) => getOrCreateLogPubSub(runId, sid), {
          concurrency: "unbounded",
        });
        if (pubsubs.length === 0) {
          return Stream.empty;
        }
        if (pubsubs.length === 1) {
          return Stream.fromPubSub(pubsubs[0]!);
        }
        return Stream.mergeAll(
          pubsubs.map((pubsub) => Stream.fromPubSub(pubsub)),
          { concurrency: "unbounded" },
        );
      }),
    );

  const issueMcpAccess = (projectId: ProjectId, threadId: ThreadId) =>
    Effect.gen(function* () {
      const token = randomUUID();
      yield* Ref.update(mcpAccessRef, (current) => {
        const next = new Map(current);
        next.set(token, { projectId, threadId, createdAt: Date.now() });
        return next;
      });
      return { token, projectId, threadId } satisfies ManagedRunMcpAccess;
    });

  const resolveContextForToken = (token: string) =>
    Ref.get(mcpAccessRef).pipe(
      Effect.map((tokens) => {
        const entry = tokens.get(token);
        if (!entry) return null;
        if (Date.now() - entry.createdAt > MCP_ACCESS_TTL_MS) return null;
        return { projectId: entry.projectId, threadId: entry.threadId };
      }),
    );

  const sweepExpiredMcpTokens = (): Effect.Effect<void, never, never> =>
    Ref.update(mcpAccessRef, (current) => {
      const cutoff = Date.now() - MCP_ACCESS_TTL_MS;
      let changed = false;
      const next = new Map(current);
      for (const [token, entry] of current.entries()) {
        if (entry.createdAt < cutoff) {
          next.delete(token);
          changed = true;
        }
      }
      return changed ? next : current;
    });

  return {
    launchProjectScript,
    list,
    get,
    getLogs,
    listInferenceRecords,
    getInferenceRecord,
    stop,
    streamEvents,
    streamLogs,
    cleanupOrphansForProject,
    issueMcpAccess,
    resolveContextForToken,
  };
});

export const ManagedRunServiceLive = Layer.effect(ManagedRunService, makeManagedRunService);
