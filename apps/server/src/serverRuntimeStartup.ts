import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  type ModelSelection,
  type OrchestrationRunId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import {
  Data,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Path,
  Queue,
  Ref,
  Scope,
  ServiceMap,
} from "effect";
import { formatTimelineLog } from "@t3tools/shared/timeline";

import { ServerConfig } from "./config";
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

function compareActivityOrder(
  left: { readonly sequence?: number | undefined; readonly createdAt: string; readonly id: string },
  right: {
    readonly sequence?: number | undefined;
    readonly createdAt: string;
    readonly id: string;
  },
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function readActivityRequestId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const requestId = "requestId" in payload ? payload.requestId : undefined;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : null;
}

function hasOpenBlockingActivity(
  activities: ReadonlyArray<{
    readonly kind: string;
    readonly payload: unknown;
    readonly sequence?: number | undefined;
    readonly createdAt: string;
    readonly id: string;
  }>,
): boolean {
  const openApprovals = new Set<string>();
  const openUserInput = new Set<string>();

  for (const activity of [...activities].toSorted(compareActivityOrder)) {
    const requestId = readActivityRequestId(activity.payload);
    if (!requestId) {
      continue;
    }

    switch (activity.kind) {
      case "approval.requested":
        openApprovals.add(requestId);
        break;
      case "approval.resolved":
        openApprovals.delete(requestId);
        break;
      case "user-input.requested":
        openUserInput.add(requestId);
        break;
      case "user-input.resolved":
        openUserInput.delete(requestId);
        break;
      default:
        break;
    }
  }

  return openApprovals.size > 0 || openUserInput.size > 0;
}

const runStartupRecovery = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const checkpointDiffQuery = yield* CheckpointDiffQuery;
  const ticketing = yield* TicketingService;
  const orchestrationRunRepo = yield* OrchestrationRunRepository;
  const projectionThreadRepo = yield* ProjectionThreadRepository;
  const serverSettings = yield* ServerSettingsService;
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
      (orchestrationThread ? hasOpenBlockingActivity(orchestrationThread.activities) : false) ||
      childThreads.some((thread) => hasOpenBlockingActivity(thread.activities));
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
      !hasOpenBlockingActivity(thread.activities),
  );

  const initialWasWorkingThreadIds = new Set<ThreadId>(runningOrchestrationThreadIds);
  for (const thread of threadCandidates) {
    initialWasWorkingThreadIds.add(thread.id);
  }

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
    yield* Effect.logInfo(
      formatTimelineLog("server.startup", "resume-orchestration.start", {
        orchestrationThreadId: candidate.threadId,
        runId: candidate.runId,
      }),
    );
    yield* orchestrationRunRunner.resumeRun({ runId: candidate.runId }).pipe(
      Effect.tap(() => {
        resumedOrchestrationThreadIds.add(candidate.threadId);
        return Effect.logInfo(
          formatTimelineLog("server.startup", "resume-orchestration.success", {
            orchestrationThreadId: candidate.threadId,
            runId: candidate.runId,
          }),
        );
      }),
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to auto-resume orchestration run on startup", {
          orchestrationThreadId: candidate.threadId,
          runId: candidate.runId,
          cause,
        }),
      ),
    );
  }

  for (const thread of threadCandidates) {
    if (thread.isOrchestrationThread || thread.parentThreadId !== null) {
      continue;
    }
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
          return Effect.logInfo(
            formatTimelineLog("server.startup", "resume-thread.success", {
              threadId: thread.id,
            }),
          );
        }),
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to auto-resume thread on startup", {
            threadId: thread.id,
            cause,
          }),
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

const autoBootstrapWelcome = (input?: {
  readonly startupWasWorkingThreadIds?: readonly ThreadId[];
}) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    const projectionReadModelQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const path = yield* Path.Path;

    let bootstrapProjectId: ProjectId | undefined;
    let bootstrapThreadId: ThreadId | undefined;

    if (serverConfig.autoBootstrapProjectFromCwd) {
      yield* Effect.gen(function* () {
        const existingProject = yield* projectionReadModelQuery.getActiveProjectByWorkspaceRoot(
          serverConfig.cwd,
        );
        let nextProjectId: ProjectId;
        let nextProjectDefaultModelSelection: ModelSelection;

        if (Option.isNone(existingProject)) {
          const createdAt = new Date().toISOString();
          nextProjectId = ProjectId.makeUnsafe(crypto.randomUUID());
          const bootstrapProjectTitle = path.basename(serverConfig.cwd) || "project";
          nextProjectDefaultModelSelection = {
            provider: "codex",
            model: "gpt-5-codex",
          };
          yield* orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe(crypto.randomUUID()),
            projectId: nextProjectId,
            title: bootstrapProjectTitle,
            workspaceRoot: serverConfig.cwd,
            defaultModelSelection: nextProjectDefaultModelSelection,
            createdAt,
          });
        } else {
          nextProjectId = existingProject.value.id;
          nextProjectDefaultModelSelection = existingProject.value.defaultModelSelection ?? {
            provider: "codex",
            model: "gpt-5-codex",
          };
        }

        const existingThreadId =
          yield* projectionReadModelQuery.getFirstActiveThreadIdByProjectId(nextProjectId);
        if (Option.isNone(existingThreadId)) {
          const createdAt = new Date().toISOString();
          const createdThreadId = ThreadId.makeUnsafe(crypto.randomUUID());
          yield* orchestrationEngine.dispatch({
            type: "thread.create",
            commandId: CommandId.makeUnsafe(crypto.randomUUID()),
            threadId: createdThreadId,
            projectId: nextProjectId,
            title: "New thread",
            modelSelection: nextProjectDefaultModelSelection,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt,
          });
          bootstrapProjectId = nextProjectId;
          bootstrapThreadId = createdThreadId;
        } else {
          bootstrapProjectId = nextProjectId;
          bootstrapThreadId = existingThreadId.value;
        }
      });
    }

    const segments = serverConfig.cwd.split(/[/\\]/).filter(Boolean);
    const projectName = segments[segments.length - 1] ?? "project";

    return {
      cwd: serverConfig.cwd,
      projectName,
      ...(bootstrapProjectId ? { bootstrapProjectId } : {}),
      ...(bootstrapThreadId ? { bootstrapThreadId } : {}),
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
      autoBootstrapWelcome({
        startupWasWorkingThreadIds: startupRecovery.wasWorkingThreadIds,
      }),
    );
    yield* Effect.logDebug("startup phase: publishing welcome event", {
      cwd: welcome.cwd,
      projectName: welcome.projectName,
      bootstrapProjectId: welcome.bootstrapProjectId,
      bootstrapThreadId: welcome.bootstrapThreadId,
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
