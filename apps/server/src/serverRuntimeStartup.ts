import { CommandId, MessageId, type OrchestrationRunId, ThreadId } from "@t3tools/contracts";
import { Data, Deferred, Effect, Exit, Layer, Option, Queue, Ref, Scope, ServiceMap } from "effect";
import { formatTimelineLog } from "@t3tools/shared/timeline";

import { ServerConfig } from "./config";
import {
  ProviderLifecycleLogger,
  type LifecycleEntry,
} from "./provider/Services/ProviderLifecycleLogger.ts";
import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery.ts";
import { Keybindings } from "./keybindings";
import { Open } from "./open";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { OrchestrationReactor } from "./orchestration/Services/OrchestrationReactor";
import { makeOrchestrationRunRunnerFromDeps } from "./orchestrationRuns/Layers/OrchestrationRunRunner.ts";
import { makeOrchestrationRunServiceFromDeps } from "./orchestrationRuns/Layers/OrchestrationRuns.ts";
import { OrchestrationRunRepository } from "./persistence/Services/OrchestrationRuns.ts";
import { ProjectionThreadRepository } from "./persistence/Services/ProjectionThreads.ts";
import { ProviderService } from "./provider/Services/ProviderService.ts";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import { ServerSettingsService } from "./serverSettings";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService";
import { TicketingService } from "./ticketing/Services/Ticketing.ts";

const isWildcardHost = (host: string | undefined): boolean =>
  host === "0.0.0.0" || host === "::" || host === "[::]";

const formatHostForUrl = (host: string): string =>
  host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

export class ServerRuntimeStartupError extends Data.TaggedError("ServerRuntimeStartupError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ServerRuntimeStartupShape {
  readonly awaitCommandReady: Effect.Effect<void, ServerRuntimeStartupError>;
  readonly markHttpListening: Effect.Effect<void>;
  readonly enqueueCommand: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ServerRuntimeStartupError>;
}

export class ServerRuntimeStartup extends ServiceMap.Service<
  ServerRuntimeStartup,
  ServerRuntimeStartupShape
>()("t3/serverRuntimeStartup") {}

interface QueuedCommand {
  readonly run: Effect.Effect<void, never>;
}

type CommandReadinessState = "pending" | "ready" | ServerRuntimeStartupError;

interface CommandGate {
  readonly awaitCommandReady: Effect.Effect<void, ServerRuntimeStartupError>;
  readonly signalCommandReady: Effect.Effect<void>;
  readonly failCommandReady: (error: ServerRuntimeStartupError) => Effect.Effect<void>;
  readonly enqueueCommand: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ServerRuntimeStartupError>;
}

interface StartupRecoveryResult {
  readonly wasWorkingThreadIds: readonly ThreadId[];
}

interface StartupOrchestrationResumeCandidate {
  readonly threadId: ThreadId;
  readonly runId: OrchestrationRunId;
}

const settleQueuedCommand = <A, E>(deferred: Deferred.Deferred<A, E>, exit: Exit.Exit<A, E>) =>
  Exit.isSuccess(exit)
    ? Deferred.succeed(deferred, exit.value)
    : Deferred.failCause(deferred, exit.cause);

export const makeCommandGate = Effect.gen(function* () {
  const commandReady = yield* Deferred.make<void, ServerRuntimeStartupError>();
  const commandQueue = yield* Queue.unbounded<QueuedCommand>();
  const commandReadinessState = yield* Ref.make<CommandReadinessState>("pending");

  const commandWorker = Effect.forever(
    Queue.take(commandQueue).pipe(Effect.flatMap((command) => command.run)),
  );
  yield* Effect.forkScoped(commandWorker);

  return {
    awaitCommandReady: Deferred.await(commandReady),
    signalCommandReady: Effect.gen(function* () {
      yield* Ref.set(commandReadinessState, "ready");
      yield* Deferred.succeed(commandReady, undefined).pipe(Effect.orDie);
    }),
    failCommandReady: (error) =>
      Effect.gen(function* () {
        yield* Ref.set(commandReadinessState, error);
        yield* Deferred.fail(commandReady, error).pipe(Effect.orDie);
      }),
    enqueueCommand: <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const readinessState = yield* Ref.get(commandReadinessState);
        if (readinessState === "ready") {
          return yield* effect;
        }
        if (readinessState !== "pending") {
          return yield* readinessState;
        }

        const result = yield* Deferred.make<A, E | ServerRuntimeStartupError>();
        yield* Queue.offer(commandQueue, {
          run: Deferred.await(commandReady).pipe(
            Effect.flatMap(() => effect),
            Effect.exit,
            Effect.flatMap((exit) => settleQueuedCommand(result, exit)),
          ),
        });
        return yield* Deferred.await(result);
      }),
  } satisfies CommandGate;
});

export const recordStartupHeartbeat = Effect.gen(function* () {
  const analytics = yield* AnalyticsService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const { threadCount, projectCount } = yield* projectionSnapshotQuery.getCounts().pipe(
    Effect.catch((cause) =>
      Effect.logWarning("failed to gather startup projection counts for telemetry", {
        cause,
      }).pipe(
        Effect.as({
          threadCount: 0,
          projectCount: 0,
        }),
      ),
    ),
  );

  yield* analytics.record("server.boot.heartbeat", {
    threadCount,
    projectCount,
  });
});

const runStartupRecovery = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const checkpointDiffQuery = yield* CheckpointDiffQuery;
  const ticketing = yield* TicketingService;
  const orchestrationRunRepo = yield* OrchestrationRunRepository;
  const projectionThreadRepo = yield* ProjectionThreadRepository;
  const serverSettings = yield* ServerSettingsService;
  const lifecycle = yield* ProviderLifecycleLogger;
  const lfcyl = (threadId: ThreadId | null, entry: LifecycleEntry) =>
    lifecycle.log(threadId, entry).pipe(Effect.ignoreCause({ log: true }));
  const settings = yield* serverSettings.getSettings;
  const readModel = yield* orchestrationEngine.getReadModel();
  const threadsById = new Map(readModel.threads.map((thread) => [thread.id, thread] as const));

  const inlineStartup: ServerRuntimeStartupShape = {
    awaitCommandReady: Effect.void,
    markHttpListening: Effect.void,
    enqueueCommand: <A, E>(effect: Effect.Effect<A, E>) => effect,
  };

  const orchestrationRuns = yield* makeOrchestrationRunServiceFromDeps({
    repo: orchestrationRunRepo,
    orchestrationEngine,
    projectionSnapshotQuery,
    projectionThreadRepo,
    ticketing,
    startup: inlineStartup,
    serverSettings,
  });
  const orchestrationRunRunner = yield* makeOrchestrationRunRunnerFromDeps({
    runService: orchestrationRuns,
    orchestrationEngine,
    providerService,
    checkpointDiffQuery,
    projectionSnapshotQuery,
    ticketing,
    startup: inlineStartup,
    serverSettings,
  });

  const childThreadIdsByParent = new Map<ThreadId, ThreadId[]>();
  for (const thread of readModel.threads) {
    if (!thread.parentThreadId) {
      continue;
    }
    const existing = childThreadIdsByParent.get(thread.parentThreadId) ?? [];
    existing.push(thread.id);
    childThreadIdsByParent.set(thread.parentThreadId, existing);
  }

  const runningOrchestrationResumeCandidates: StartupOrchestrationResumeCandidate[] = [];
  for (const thread of readModel.threads) {
    if (!thread.isOrchestrationThread) {
      continue;
    }
    const runOption = yield* orchestrationRunRepo
      .getByOrchestrationThreadId({
        orchestrationThreadId: thread.id,
      })
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isSome(runOption) && runOption.value.status === "running") {
      runningOrchestrationResumeCandidates.push({
        threadId: thread.id,
        runId: runOption.value.id,
      });
    }
  }

  const blockedRunningOrchestrationThreadIds = new Set<ThreadId>();
  for (const candidate of runningOrchestrationResumeCandidates) {
    const orchestrationThread = threadsById.get(candidate.threadId);
    const childThreads = (childThreadIdsByParent.get(candidate.threadId) ?? [])
      .map((threadId) => threadsById.get(threadId))
      .filter((thread): thread is NonNullable<typeof thread> => thread !== undefined);
    const hasBlockingActivity =
      (orchestrationThread
        ? orchestrationThread.pendingApprovalCount > 0 ||
          orchestrationThread.pendingUserInputCount > 0
        : false) ||
      childThreads.some(
        (thread) => thread.pendingApprovalCount > 0 || thread.pendingUserInputCount > 0,
      );
    if (hasBlockingActivity) {
      blockedRunningOrchestrationThreadIds.add(candidate.threadId);
    }
  }

  const runningOrchestrationResumeCandidatesWithoutBlocking =
    runningOrchestrationResumeCandidates.filter(
      (candidate) => !blockedRunningOrchestrationThreadIds.has(candidate.threadId),
    );
  const runningOrchestrationThreadIds = runningOrchestrationResumeCandidatesWithoutBlocking.map(
    (candidate) => candidate.threadId,
  );

  const threadCandidates = readModel.threads.filter(
    (thread) =>
      thread.session?.status === "running" &&
      thread.session.activeTurnId !== null &&
      thread.pendingApprovalCount === 0 &&
      thread.pendingUserInputCount === 0,
  );

  const initialWasWorkingThreadIds = new Set<ThreadId>(runningOrchestrationThreadIds);
  for (const thread of threadCandidates) {
    initialWasWorkingThreadIds.add(thread.id);
  }

  yield* lfcyl(null, {
    scope: "startup",
    event: "recovery.begin",
    details: {
      totalThreads: readModel.threads.length,
      wasWorkingCount: initialWasWorkingThreadIds.size,
      resumeEnabled: settings.resumeAgentsOnStartup === true,
    },
  });

  if (!settings.resumeAgentsOnStartup) {
    return {
      wasWorkingThreadIds: readModel.threads
        .map((thread) => thread.id)
        .filter((threadId) => initialWasWorkingThreadIds.has(threadId)),
    } satisfies StartupRecoveryResult;
  }

  const resumedStandaloneThreadIds = new Set<ThreadId>();
  const resumedOrchestrationThreadIds = new Set<ThreadId>();

  for (const candidate of runningOrchestrationResumeCandidatesWithoutBlocking) {
    const orchThread = threadsById.get(candidate.threadId);
    yield* lfcyl(candidate.threadId, {
      scope: "startup",
      event: "recovery.thread.attempt",
      details: {
        type: "orchestration",
        sessionStatus: orchThread?.session?.status ?? null,
        activeTurnId: orchThread?.session?.activeTurnId ?? null,
      },
    });
    yield* Effect.logInfo(
      formatTimelineLog("server.startup", "resume-orchestration.start", {
        orchestrationThreadId: candidate.threadId,
        runId: candidate.runId,
      }),
    );
    yield* orchestrationRunRunner.resumeRun({ runId: candidate.runId }).pipe(
      Effect.tap(() => {
        resumedOrchestrationThreadIds.add(candidate.threadId);
        return Effect.all([
          lfcyl(candidate.threadId, {
            scope: "startup",
            event: "recovery.thread.result",
            details: { success: true },
          }),
          Effect.logInfo(
            formatTimelineLog("server.startup", "resume-orchestration.success", {
              orchestrationThreadId: candidate.threadId,
              runId: candidate.runId,
            }),
          ),
        ]);
      }),
      Effect.catchCause((cause) =>
        Effect.all([
          lfcyl(candidate.threadId, {
            scope: "startup",
            event: "recovery.thread.result",
            details: { success: false, error: String(cause).slice(0, 200) },
          }),
          Effect.logWarning("failed to auto-resume orchestration run on startup", {
            orchestrationThreadId: candidate.threadId,
            runId: candidate.runId,
            cause,
          }),
        ]),
      ),
    );
  }

  for (const thread of threadCandidates) {
    if (thread.isOrchestrationThread || thread.parentThreadId !== null) {
      continue;
    }
    yield* lfcyl(thread.id, {
      scope: "startup",
      event: "recovery.thread.attempt",
      details: {
        type: "standalone",
        sessionStatus: thread.session?.status ?? null,
        activeTurnId: thread.session?.activeTurnId ?? null,
      },
    });
    yield* Effect.logInfo(
      formatTimelineLog("server.startup", "resume-thread.start", {
        threadId: thread.id,
      }),
    );
    yield* orchestrationEngine
      .dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe(crypto.randomUUID()),
        threadId: thread.id,
        message: {
          messageId: MessageId.makeUnsafe(crypto.randomUUID()),
          role: "user",
          text: "Resume",
          attachments: [],
        },
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        createdAt: new Date().toISOString(),
      })
      .pipe(
        Effect.tap(() => {
          resumedStandaloneThreadIds.add(thread.id);
          return Effect.all([
            lfcyl(thread.id, {
              scope: "startup",
              event: "recovery.thread.result",
              details: { success: true },
            }),
            Effect.logInfo(
              formatTimelineLog("server.startup", "resume-thread.success", {
                threadId: thread.id,
              }),
            ),
          ]);
        }),
        Effect.catchCause((cause) =>
          Effect.all([
            lfcyl(thread.id, {
              scope: "startup",
              event: "recovery.thread.result",
              details: { success: false, error: String(cause).slice(0, 200) },
            }),
            Effect.logWarning("failed to auto-resume thread on startup", {
              threadId: thread.id,
              cause,
            }),
          ]),
        ),
      );
  }

  const wasWorkingThreadIds = readModel.threads
    .map((thread) => thread.id)
    .filter((threadId) => {
      if (!initialWasWorkingThreadIds.has(threadId)) {
        return false;
      }
      if (resumedStandaloneThreadIds.has(threadId)) {
        return false;
      }
      if (resumedOrchestrationThreadIds.has(threadId)) {
        return false;
      }
      for (const orchestrationThreadId of resumedOrchestrationThreadIds) {
        if ((childThreadIdsByParent.get(orchestrationThreadId) ?? []).includes(threadId)) {
          return false;
        }
      }
      return true;
    });

  yield* lfcyl(null, {
    scope: "startup",
    event: "recovery.complete",
    details: {
      wasWorkingIds: wasWorkingThreadIds,
    },
  });

  return {
    wasWorkingThreadIds,
  } satisfies StartupRecoveryResult;
});

export const launchStartupHeartbeat = recordStartupHeartbeat.pipe(
  Effect.annotateSpans({ "startup.phase": "heartbeat.record" }),
  Effect.withSpan("server.startup.heartbeat.record"),
  Effect.ignoreCause({ log: true }),
  Effect.forkScoped,
  Effect.asVoid,
);

const computeStartupWelcome = (input?: {
  readonly startupWasWorkingThreadIds?: readonly ThreadId[];
}) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    const segments = serverConfig.cwd.split(/[/\\]/).filter(Boolean);
    const projectName = segments[segments.length - 1] ?? "project";

    return {
      cwd: serverConfig.cwd,
      projectName,
      ...(input?.startupWasWorkingThreadIds && input.startupWasWorkingThreadIds.length > 0
        ? { startupWasWorkingThreadIds: input.startupWasWorkingThreadIds }
        : {}),
    } as const;
  });

const maybeOpenBrowser = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  if (serverConfig.noBrowser) {
    return;
  }
  const { openBrowser } = yield* Open;
  const localUrl = `http://localhost:${serverConfig.port}`;
  const bindUrl =
    serverConfig.host && !isWildcardHost(serverConfig.host)
      ? `http://${formatHostForUrl(serverConfig.host)}:${serverConfig.port}`
      : localUrl;
  const target = serverConfig.devUrl?.toString() ?? bindUrl;

  yield* openBrowser(target).pipe(
    Effect.catch(() =>
      Effect.logInfo("browser auto-open unavailable", {
        hint: `Open ${target} in your browser.`,
      }),
    ),
  );
});

const runStartupPhase = <A, E, R>(phase: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.annotateSpans({ "startup.phase": phase }),
    Effect.withSpan(`server.startup.${phase}`),
  );

const makeServerRuntimeStartup = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const keybindings = yield* Keybindings;
  const orchestrationReactor = yield* OrchestrationReactor;
  const lifecycleEvents = yield* ServerLifecycleEvents;
  const serverSettings = yield* ServerSettingsService;

  const commandGate = yield* makeCommandGate;
  const httpListening = yield* Deferred.make<void>();
  const reactorScope = yield* Scope.make("sequential");

  yield* Effect.addFinalizer(() => Scope.close(reactorScope, Exit.void));

  const startup = Effect.gen(function* () {
    yield* Effect.logDebug("startup phase: starting keybindings runtime");
    yield* runStartupPhase(
      "keybindings.start",
      keybindings.start.pipe(
        Effect.catch((error) =>
          Effect.logWarning("failed to start keybindings runtime", {
            path: error.configPath,
            detail: error.detail,
            cause: error.cause,
          }),
        ),
        Effect.forkScoped,
      ),
    );

    yield* Effect.logDebug("startup phase: starting server settings runtime");
    yield* runStartupPhase(
      "settings.start",
      serverSettings.start.pipe(
        Effect.catch((error) =>
          Effect.logWarning("failed to start server settings runtime", {
            path: error.settingsPath,
            detail: error.detail,
            cause: error.cause,
          }),
        ),
        Effect.forkScoped,
      ),
    );

    yield* Effect.logDebug("startup phase: starting orchestration reactors");
    yield* runStartupPhase(
      "reactors.start",
      orchestrationReactor.start().pipe(Scope.provide(reactorScope)),
    );

    yield* Effect.logDebug("startup phase: reconciling stale working sessions");
    const startupRecovery = yield* runStartupPhase("recovery.resume", runStartupRecovery);

    yield* Effect.logDebug("startup phase: preparing welcome payload");
    const welcome = yield* runStartupPhase(
      "welcome.prepare",
      computeStartupWelcome({
        startupWasWorkingThreadIds: startupRecovery.wasWorkingThreadIds,
      }),
    );
    yield* Effect.logDebug("startup phase: publishing welcome event", {
      cwd: welcome.cwd,
      projectName: welcome.projectName,
      startupWasWorkingThreadCount: welcome.startupWasWorkingThreadIds?.length ?? 0,
    });
    yield* runStartupPhase(
      "welcome.publish",
      lifecycleEvents.publish({
        version: 1,
        type: "welcome",
        payload: welcome,
      }),
    );
  }).pipe(
    Effect.annotateSpans({
      "server.mode": serverConfig.mode,
      "server.port": serverConfig.port,
      "server.host": serverConfig.host ?? "default",
    }),
    Effect.withSpan("server.startup", { kind: "server", root: true }),
  );

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      const startupExit = yield* Effect.exit(startup);
      if (Exit.isFailure(startupExit)) {
        const error = new ServerRuntimeStartupError({
          message: "Server runtime startup failed before command readiness.",
          cause: startupExit.cause,
        });
        yield* Effect.logError("server runtime startup failed", { cause: startupExit.cause });
        yield* commandGate.failCommandReady(error);
        return;
      }

      yield* Effect.logDebug("Accepting commands");
      yield* commandGate.signalCommandReady;
      yield* Effect.logDebug("startup phase: waiting for http listener");
      yield* runStartupPhase("http.wait", Deferred.await(httpListening));
      yield* Effect.logDebug("startup phase: publishing ready event");
      yield* runStartupPhase(
        "ready.publish",
        lifecycleEvents.publish({
          version: 1,
          type: "ready",
          payload: { at: new Date().toISOString() },
        }),
      );

      yield* Effect.logDebug("startup phase: recording startup heartbeat");
      yield* launchStartupHeartbeat;
      yield* Effect.logDebug("startup phase: browser open check");
      yield* runStartupPhase("browser.open", maybeOpenBrowser);
      yield* Effect.logDebug("startup phase: complete");
    }),
  );

  return {
    awaitCommandReady: commandGate.awaitCommandReady,
    markHttpListening: Deferred.succeed(httpListening, undefined),
    enqueueCommand: commandGate.enqueueCommand,
  } satisfies ServerRuntimeStartupShape;
});

export const ServerRuntimeStartupLive = Layer.effect(
  ServerRuntimeStartup,
  makeServerRuntimeStartup,
);
