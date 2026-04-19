import {
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  PubSub,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import {
  type GitActionProgressEvent,
  GitCommandError,
  type GitManagerServiceError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetStartupSnapshotError,
  OrchestrationGetThreadContentError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  OrchestrationRunError,
  PromptManagementError,
  ProjectListDirectoryError,
  ProjectReadFileError,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  OrchestrationReplayEventsError,
  ResolveCodexProjectTrustError,
  ResolveMcpServersError,
  ResolveSkillsError,
  TextGenerationError,
  type TerminalEvent,
  TrustCodexProjectError,
  WS_METHODS,
  WsRpcGroup,
  baseProviderKind,
  providerProfileId,
  type ProviderKind,
} from "@t3tools/contracts";
import { formatTimelineLog, summarizeTimelineText } from "@t3tools/shared/timeline";
import { clamp } from "effect/Number";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig } from "./config";
import { GitCore } from "./git/Services/GitCore";
import { GitManager } from "./git/Services/GitManager";
import { Keybindings } from "./keybindings";
import { Open, resolveAvailableEditors } from "./open";
import { normalizeDispatchCommand } from "./orchestration/Normalizer";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";

import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "./observability/RpcInstrumentation";
import { ProviderRateLimitsCache } from "./provider/Services/ProviderRateLimitsCache";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry";
import { ProviderService } from "./provider/Services/ProviderService";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import { ServerRuntimeStartup } from "./serverRuntimeStartup";
import { ServerSettingsService } from "./serverSettings";
import { ManagedRunService } from "./managedRuns/Services/ManagedRuns";
import { PromptManagementService } from "./prompts/Services/PromptManagement";
import { ScheduledTaskService } from "./scheduledTasks/Services/ScheduledTasks";
import { TicketingService } from "./ticketing/Services/Ticketing";
import { TerminalManager } from "./terminal/Services/Manager";
import { RepoDiscovery } from "./workspace/Services/RepoDiscovery";
import { TextGeneration } from "./git/Services/TextGeneration";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths";
import { OrchestrationRunRepository } from "./persistence/Services/OrchestrationRuns";
import { ProjectionThreadRepository } from "./persistence/Services/ProjectionThreads";
import { makeOrchestrationRunServiceFromDeps } from "./orchestrationRuns/Layers/OrchestrationRuns";
import { makeOrchestrationRunRunnerFromDeps } from "./orchestrationRuns/Layers/OrchestrationRunRunner";
import {
  resolveClaudeMcpServerNames,
  resolveCodexMcpServerNames,
  resolveCodexProjectTrusted,
  resolveCodexProjectConfigPaths,
  resolveGeminiMcpServerNames,
  resolveGeminiSettingsPaths,
  trustCodexProject,
} from "./mcpConfigReader";
import {
  resolveCodexHomePath,
  resolveCodexHomePathForProvider,
} from "./provider/codexProfileDiscovery";
import { resolveSkills } from "./skillsReader";
import * as os from "node:os";
import * as nodePath from "node:path";

const WsRpcLayer = WsRpcGroup.toLayer(
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const checkpointDiffQuery = yield* CheckpointDiffQuery;
    const keybindings = yield* Keybindings;
    const open = yield* Open;
    const gitManager = yield* GitManager;
    const git = yield* GitCore;
    const terminalManager = yield* TerminalManager;
    const providerRegistry = yield* ProviderRegistry;
    const providerService = yield* ProviderService;
    const rateLimitsCache = yield* ProviderRateLimitsCache;
    const config = yield* ServerConfig;
    const lifecycleEvents = yield* ServerLifecycleEvents;
    const serverSettings = yield* ServerSettingsService;
    const startup = yield* ServerRuntimeStartup;
    const managedRuns = yield* ManagedRunService;
    const promptManagement = yield* PromptManagementService;
    const scheduledTasks = yield* ScheduledTaskService;
    const ticketing = yield* TicketingService;
    const repoDiscovery = yield* RepoDiscovery;
    const textGeneration = yield* TextGeneration;
    const workspaceEntries = yield* WorkspaceEntries;
    const workspaceFileSystem = yield* WorkspaceFileSystem;
    const orchestrationRunRepo = yield* OrchestrationRunRepository;
    const projectionThreadRepo = yield* ProjectionThreadRepository;
    const orchestrationRuns = yield* makeOrchestrationRunServiceFromDeps({
      repo: orchestrationRunRepo,
      orchestrationEngine,
      projectionSnapshotQuery,
      projectionThreadRepo,
      ticketing,
      startup,
      serverSettings,
    });
    const orchestrationRunRunner = yield* makeOrchestrationRunRunnerFromDeps({
      runService: orchestrationRuns,
      orchestrationEngine,
      providerService,
      checkpointDiffQuery,
      projectionSnapshotQuery,
      ticketing,
      startup,
      serverSettings,
    });

    const loadServerConfig = Effect.gen(function* () {
      const keybindingsConfig = yield* keybindings.loadConfigState;
      const providers = yield* providerRegistry.getProviders;
      const settings = yield* serverSettings.getSettings;

      return {
        cwd: config.cwd,
        keybindingsConfigPath: config.keybindingsConfigPath,
        keybindings: keybindingsConfig.keybindings,
        issues: keybindingsConfig.issues,
        providers,
        availableEditors: resolveAvailableEditors(),
        observability: {
          logsDirectoryPath: config.logsDir,
          localTracingEnabled: true,
          ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
          otlpTracesEnabled: config.otlpTracesUrl !== undefined,
          ...(config.otlpMetricsUrl !== undefined ? { otlpMetricsUrl: config.otlpMetricsUrl } : {}),
          otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
        },
        settings,
      };
    });

    // -----------------------------------------------------------------------
    // MCP config file watchers
    // -----------------------------------------------------------------------
    const fs = yield* FileSystem.FileSystem;
    const mcpConfigChangedPubSub = yield* PubSub.unbounded<void>();
    const watchedMcpConfigTargets = new Set<string>();

    const watchDirForFile = (dir: string, targetFile: string) =>
      Effect.gen(function* () {
        const dirExists = yield* fs.exists(dir);
        if (!dirExists) return false;

        yield* fs.watch(dir).pipe(
          Stream.filter(
            (event) =>
              event.path === targetFile ||
              event.path === nodePath.join(dir, targetFile) ||
              nodePath.basename(event.path) === targetFile,
          ),
          Stream.debounce(Duration.millis(150)),
          Stream.runForEach(() => PubSub.publish(mcpConfigChangedPubSub, undefined)),
          Effect.ignoreCause({ log: true }),
          Effect.forkScoped,
          Effect.as(true),
        );
      }).pipe(Effect.catchCause(() => Effect.succeed(false)));

    const ensureWatchDirForFile = (dir: string, targetFile: string) => {
      const watchKey = nodePath.join(dir, targetFile);
      if (watchedMcpConfigTargets.has(watchKey)) {
        return Effect.void;
      }
      return watchDirForFile(dir, targetFile).pipe(
        Effect.tap((started) =>
          started
            ? Effect.sync(() => {
                watchedMcpConfigTargets.add(watchKey);
              })
            : Effect.void,
        ),
        Effect.asVoid,
      );
    };

    // Watch ~/.claude/ for .claude.json
    const home = os.homedir();
    yield* ensureWatchDirForFile(nodePath.join(home, ".claude"), ".claude.json");

    // Watch ~/.codex/ for config.toml
    const currentSettings = yield* serverSettings.getSettings;
    const codexHome = resolveCodexHomePath(currentSettings);
    const resolveCodexHome = serverSettings.getSettings.pipe(
      Effect.map((settings) => resolveCodexHomePath(settings)),
    );
    const resolveCodexHomeForProvider = (provider: ProviderKind) =>
      serverSettings.getSettings.pipe(
        Effect.map((settings) => resolveCodexHomePathForProvider(settings, provider)),
      );
    yield* ensureWatchDirForFile(codexHome, "config.toml");

    // Watch each ~/.codex-{profile}/ and ~/.claude-{profile}/ directory
    const homeEntries = yield* fs
      .readDirectory(home)
      .pipe(Effect.orElseSucceed(() => [] as string[]));
    for (const entry of homeEntries) {
      if (entry.startsWith(".codex-")) {
        const profileDir = nodePath.join(home, entry);
        const stat = yield* fs.stat(profileDir).pipe(Effect.orElseSucceed(() => undefined));
        if (stat?.type === "Directory") {
          yield* ensureWatchDirForFile(profileDir, "config.toml");
        }
        continue;
      }
      if (!entry.startsWith(".claude-")) continue;
      const profileDir = nodePath.join(home, entry);
      const stat = yield* fs.stat(profileDir).pipe(Effect.orElseSucceed(() => undefined));
      if (stat?.type === "Directory") {
        yield* ensureWatchDirForFile(profileDir, ".claude.json");
      }
    }

    const mcpConfigChangedStream = Stream.fromPubSub(mcpConfigChangedPubSub).pipe(
      Stream.map(() => ({
        version: 1 as const,
        type: "mcpConfigChanged" as const,
      })),
    );

    return WsRpcGroup.of({
      [ORCHESTRATION_WS_METHODS.getSnapshot]: (_input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getSnapshot,
          projectionSnapshotQuery.getSnapshot().pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load orchestration snapshot",
                  cause,
                }),
            ),
          ),
          {
            "rpc.aggregate": "orchestration",
          },
        ),
      [ORCHESTRATION_WS_METHODS.getStartupSnapshot]: (_input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getStartupSnapshot,
          projectionSnapshotQuery.getStartupSnapshot().pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetStartupSnapshotError({
                  message: "Failed to load orchestration startup snapshot",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getThreadContent]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getThreadContent,
          projectionSnapshotQuery.getThreadContent(input.threadId).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetThreadContentError({
                  message: "Failed to load orchestration thread content",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.dispatchCommand,
          Effect.gen(function* () {
            const normalizedCommand = yield* normalizeDispatchCommand(command);
            yield* Effect.logInfo(
              formatTimelineLog("server.ws", "orchestration.dispatch.received", {
                type: normalizedCommand.type,
                commandId: normalizedCommand.commandId,
                ...(Object.hasOwn(normalizedCommand, "threadId")
                  ? { threadId: (normalizedCommand as { threadId?: string }).threadId ?? null }
                  : {}),
                ...(Object.hasOwn(normalizedCommand, "projectId")
                  ? { projectId: (normalizedCommand as { projectId?: string }).projectId ?? null }
                  : {}),
                ...(Object.hasOwn(normalizedCommand, "message") &&
                typeof (normalizedCommand as { message?: { text?: string } }).message?.text ===
                  "string"
                  ? summarizeTimelineText(
                      (normalizedCommand as { message: { text: string } }).message.text,
                    )
                  : {}),
              }),
            );
            const result = yield* startup.enqueueCommand(
              orchestrationEngine.dispatch(normalizedCommand),
            );
            yield* Effect.logInfo(
              formatTimelineLog("server.ws", "orchestration.dispatch.completed", {
                type: normalizedCommand.type,
                commandId: normalizedCommand.commandId,
                sequence: result.sequence,
              }),
            );
            if (normalizedCommand.type === "thread.archive") {
              yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("failed to close thread terminals after archive", {
                    threadId: normalizedCommand.threadId,
                    error: error.message,
                  }),
                ),
              );
            }
            return result;
          }).pipe(
            Effect.mapError((cause) =>
              Schema.is(OrchestrationDispatchCommandError)(cause)
                ? cause
                : new OrchestrationDispatchCommandError({
                    message: "Failed to dispatch orchestration command",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getTurnDiff,
          checkpointDiffQuery.getTurnDiff(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetTurnDiffError({
                  message: "Failed to load turn diff",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getFullThreadDiff,
          checkpointDiffQuery.getFullThreadDiff(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetFullThreadDiffError({
                  message: "Failed to load full thread diff",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.replayEvents,
          Stream.runCollect(
            orchestrationEngine.readEvents(
              clamp(input.fromSequenceExclusive, { maximum: Number.MAX_SAFE_INTEGER, minimum: 0 }),
            ),
          ).pipe(
            Effect.map((events) => Array.from(events)),
            Effect.mapError(
              (cause) =>
                new OrchestrationReplayEventsError({
                  message: "Failed to replay orchestration events",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),

      // Orchestration Runs
      [ORCHESTRATION_WS_METHODS.createRun]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.createRun,
          orchestrationRuns.create(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(OrchestrationRunError)(cause)
                ? cause
                : new OrchestrationRunError({
                    message: "Failed to create orchestration run",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getRun]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getRun,
          orchestrationRuns.get(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(OrchestrationRunError)(cause)
                ? cause
                : new OrchestrationRunError({
                    message: "Failed to get orchestration run",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.listRuns]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.listRuns,
          orchestrationRuns.list(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(OrchestrationRunError)(cause)
                ? cause
                : new OrchestrationRunError({
                    message: "Failed to list orchestration runs",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getChildThreads]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getChildThreads,
          orchestrationRuns
            .getChildThreads(input)
            .pipe(
              Effect.mapError((cause) =>
                Schema.is(OrchestrationRunError)(cause)
                  ? cause
                  : new OrchestrationRunError({ message: "Failed to get child threads", cause }),
              ),
            ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getChildThreadIds]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getChildThreadIds,
          orchestrationRuns.getChildThreadIds(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(OrchestrationRunError)(cause)
                ? cause
                : new OrchestrationRunError({
                    message: "Failed to get child thread IDs",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.pauseRun]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.pauseRun,
          orchestrationRunRunner.pauseRun(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(OrchestrationRunError)(cause)
                ? cause
                : new OrchestrationRunError({
                    message: "Failed to pause orchestration run",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.resumeRun]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.resumeRun,
          orchestrationRunRunner.resumeRun(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(OrchestrationRunError)(cause)
                ? cause
                : new OrchestrationRunError({
                    message: "Failed to resume orchestration run",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.cancelRun]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.cancelRun,
          orchestrationRunRunner.cancelRun(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(OrchestrationRunError)(cause)
                ? cause
                : new OrchestrationRunError({
                    message: "Failed to cancel orchestration run",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.startRun]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.startRun,
          orchestrationRunRunner.startRun(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(OrchestrationRunError)(cause)
                ? cause
                : new OrchestrationRunError({
                    message: "Failed to start orchestration run",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),

      [WS_METHODS.subscribeOrchestrationDomainEvents]: (input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeOrchestrationDomainEvents,
          Effect.gen(function* () {
            const snapshot = yield* orchestrationEngine.getReadModel();
            const fromSequenceExclusive = input.fromSequenceExclusive ?? snapshot.snapshotSequence;
            yield* Effect.logInfo(
              formatTimelineLog("server.ws", "orchestration.domain-events.subscribe", {
                fromSequenceExclusive,
                snapshotSequence: snapshot.snapshotSequence,
              }),
            );
            const replayEvents: Array<OrchestrationEvent> = yield* Stream.runCollect(
              orchestrationEngine.readEvents(fromSequenceExclusive),
            ).pipe(
              Effect.map((events) => Array.from(events)),
              Effect.catch(() => Effect.succeed([] as Array<OrchestrationEvent>)),
            );
            const replayStream = Stream.fromIterable(replayEvents);
            const source = Stream.merge(replayStream, orchestrationEngine.streamDomainEvents);
            type SequenceState = {
              readonly nextSequence: number;
              readonly pendingBySequence: Map<number, OrchestrationEvent>;
            };
            const state = yield* Ref.make<SequenceState>({
              nextSequence: fromSequenceExclusive + 1,
              pendingBySequence: new Map<number, OrchestrationEvent>(),
            });

            return source.pipe(
              Stream.mapEffect((event) =>
                Ref.modify(
                  state,
                  ({
                    nextSequence,
                    pendingBySequence,
                  }): [Array<OrchestrationEvent>, SequenceState] => {
                    if (event.sequence < nextSequence || pendingBySequence.has(event.sequence)) {
                      return [[], { nextSequence, pendingBySequence }];
                    }

                    const updatedPending = new Map(pendingBySequence);
                    updatedPending.set(event.sequence, event);

                    const emit: Array<OrchestrationEvent> = [];
                    let expected = nextSequence;
                    for (;;) {
                      const expectedEvent = updatedPending.get(expected);
                      if (!expectedEvent) {
                        break;
                      }
                      emit.push(expectedEvent);
                      updatedPending.delete(expected);
                      expected += 1;
                    }

                    return [emit, { nextSequence: expected, pendingBySequence: updatedPending }];
                  },
                ),
              ),
              Stream.flatMap((events) => Stream.fromIterable(events)),
            );
          }),
          { "rpc.aggregate": "orchestration" },
        ),
      [WS_METHODS.serverGetConfig]: (_input) =>
        observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
          "rpc.aggregate": "server",
        }),
      [WS_METHODS.serverRefreshProviders]: (_input) =>
        observeRpcEffect(
          WS_METHODS.serverRefreshProviders,
          providerRegistry.refresh().pipe(Effect.map((providers) => ({ providers }))),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverUpsertKeybinding]: (rule) =>
        observeRpcEffect(
          WS_METHODS.serverUpsertKeybinding,
          Effect.gen(function* () {
            const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
            return { keybindings: keybindingsConfig, issues: [] };
          }),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverGetSettings]: (_input) =>
        observeRpcEffect(WS_METHODS.serverGetSettings, serverSettings.getSettings, {
          "rpc.aggregate": "server",
        }),
      [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
        observeRpcEffect(WS_METHODS.serverUpdateSettings, serverSettings.updateSettings(patch), {
          "rpc.aggregate": "server",
        }),
      [WS_METHODS.serverResolveMcpServers]: (input) =>
        observeRpcEffect(
          WS_METHODS.serverResolveMcpServers,
          Effect.gen(function* () {
            const base = baseProviderKind(input.provider);
            if (base === "codex") {
              const codexHome = yield* resolveCodexHomeForProvider(input.provider);
              yield* ensureWatchDirForFile(codexHome, "config.toml");
              if (input.cwd) {
                yield* trustCodexProject(codexHome, input.cwd);
                for (const configPath of resolveCodexProjectConfigPaths(input.cwd)) {
                  yield* ensureWatchDirForFile(nodePath.dirname(configPath), "config.toml");
                }
              }
              const serverNames = yield* resolveCodexMcpServerNames(codexHome, input.cwd);
              return { serverNames };
            }
            if (base === "gemini") {
              const settings = yield* serverSettings.getSettings;
              const geminiHome =
                settings.providers.gemini.homePath.trim() ||
                process.env.GEMINI_CLI_HOME ||
                nodePath.join(os.homedir(), ".gemini");
              for (const configPath of resolveGeminiSettingsPaths(geminiHome, input.cwd)) {
                yield* ensureWatchDirForFile(nodePath.dirname(configPath), "settings.json");
              }
              const serverNames = yield* resolveGeminiMcpServerNames(geminiHome, input.cwd);
              return { serverNames };
            }
            // Claude (default or profile)
            const profileId = providerProfileId(input.provider);
            const settings = yield* serverSettings.getSettings;
            let configDir: string | undefined;
            if (profileId) {
              const configured = settings.providers.claudeProfiles.find(
                (p) => p.profileId === profileId,
              );
              configDir = configured?.configDir;
              if (!configDir) {
                configDir = nodePath.join(os.homedir(), `.claude-${profileId}`);
              }
            } else {
              configDir = settings.providers.claudeAgent.configDir || undefined;
            }
            if (!configDir) {
              configDir = nodePath.join(os.homedir(), ".claude");
            }
            if (input.cwd) {
              yield* ensureWatchDirForFile(input.cwd, ".mcp.json");
            }
            const serverNames = yield* resolveClaudeMcpServerNames(configDir, input.cwd);
            return { serverNames };
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ResolveMcpServersError({
                  message: `Failed to resolve MCP servers: ${String(cause)}`,
                }),
            ),
          ),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverResolveCodexProjectTrust]: (input) =>
        observeRpcEffect(
          WS_METHODS.serverResolveCodexProjectTrust,
          Effect.gen(function* () {
            const codexHome = yield* resolveCodexHome;
            const trusted = yield* resolveCodexProjectTrusted(codexHome, input.cwd);
            return { trusted };
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ResolveCodexProjectTrustError({
                  message: `Failed to resolve Codex project trust: ${String(cause)}`,
                }),
            ),
          ),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverTrustCodexProject]: (input) =>
        observeRpcEffect(
          WS_METHODS.serverTrustCodexProject,
          Effect.gen(function* () {
            const codexHome = yield* resolveCodexHome;
            const result = yield* trustCodexProject(codexHome, input.cwd);
            yield* ensureWatchDirForFile(codexHome, "config.toml");
            yield* PubSub.publish(mcpConfigChangedPubSub, undefined);
            return result;
          }).pipe(
            Effect.mapError(
              (cause) =>
                new TrustCodexProjectError({
                  message: `Failed to trust Codex project: ${String(cause)}`,
                }),
            ),
          ),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverResolveSkills]: (input) =>
        observeRpcEffect(
          WS_METHODS.serverResolveSkills,
          resolveSkills(input.cwd).pipe(
            Effect.map((skills) => ({ skills })),
            Effect.mapError(
              (cause) =>
                new ResolveSkillsError({
                  message: `Failed to resolve skills: ${String(cause)}`,
                }),
            ),
          ),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.projectsEnhanceSystemPrompt]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsEnhanceSystemPrompt,
          Effect.gen(function* () {
            const settings = yield* serverSettings.getSettings.pipe(
              Effect.mapError(
                (cause) =>
                  new TextGenerationError({
                    operation: "enhanceSystemPrompt",
                    detail: `Failed to read settings: ${cause.message}`,
                  }),
              ),
            );
            const modelSelection = settings.textGenerationModelSelection;
            const readModel = yield* orchestrationEngine.getReadModel().pipe(
              Effect.mapError(
                (cause) =>
                  new TextGenerationError({
                    operation: "enhanceSystemPrompt",
                    detail: `Failed to read project: ${String(cause)}`,
                  }),
              ),
            );
            const project = readModel.projects.find((p) => p.id === input.projectId);
            if (!project) {
              return yield* new TextGenerationError({
                operation: "enhanceSystemPrompt",
                detail: "Project not found.",
              });
            }
            return yield* textGeneration.enhanceSystemPrompt({
              cwd: project.workspaceRoot,
              currentPrompt: input.currentPrompt,
              modelSelection,
            });
          }),
          { "rpc.aggregate": "projects" },
        ),
      [WS_METHODS.projectsSearchEntries]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsSearchEntries,
          workspaceEntries.search(input).pipe(
            Effect.mapError(
              (cause) =>
                new ProjectSearchEntriesError({
                  message: `Failed to search workspace entries: ${cause.detail}`,
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.projectsWriteFile]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsWriteFile,
          workspaceFileSystem.writeFile(input).pipe(
            Effect.mapError((cause) => {
              const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                ? "Workspace file path must stay within the project root."
                : "Failed to write workspace file";
              return new ProjectWriteFileError({
                message,
                cause,
              });
            }),
          ),
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.projectsListDirectory]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsListDirectory,
          workspaceEntries.listDirectory(input).pipe(
            Effect.mapError(
              (cause) =>
                new ProjectListDirectoryError({
                  message: `Failed to list directory: ${cause.detail}`,
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.projectsReadFile]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsReadFile,
          workspaceFileSystem.readFile(input).pipe(
            Effect.mapError((cause) => {
              const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                ? "Workspace file path must stay within the project root."
                : cause.detail.includes("too large")
                  ? cause.detail
                  : "Failed to read workspace file";
              return new ProjectReadFileError({ message, cause });
            }),
          ),
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.promptsListDefinitions]: (input) =>
        observeRpcEffect(
          WS_METHODS.promptsListDefinitions,
          promptManagement.listPromptDefinitions(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(PromptManagementError)(cause)
                ? cause
                : new PromptManagementError({
                    code: "operation_failed",
                    message: "Failed to list prompt definitions",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "prompts" },
        ),
      [WS_METHODS.promptsGetDocument]: (input) =>
        observeRpcEffect(
          WS_METHODS.promptsGetDocument,
          promptManagement.getPromptDocument(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(PromptManagementError)(cause)
                ? cause
                : new PromptManagementError({
                    code: "operation_failed",
                    message: "Failed to load prompt document",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "prompts" },
        ),
      [WS_METHODS.promptsValidateDocument]: (input) =>
        observeRpcEffect(
          WS_METHODS.promptsValidateDocument,
          promptManagement.validatePromptDocument(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(PromptManagementError)(cause)
                ? cause
                : new PromptManagementError({
                    code: "operation_failed",
                    message: "Failed to validate prompt document",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "prompts" },
        ),
      [WS_METHODS.promptsPreviewDocument]: (input) =>
        observeRpcEffect(
          WS_METHODS.promptsPreviewDocument,
          promptManagement.previewPromptDocument(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(PromptManagementError)(cause)
                ? cause
                : new PromptManagementError({
                    code: "operation_failed",
                    message: "Failed to preview prompt document",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "prompts" },
        ),
      [WS_METHODS.promptsUpdateDocument]: (input) =>
        observeRpcEffect(
          WS_METHODS.promptsUpdateDocument,
          promptManagement.updatePromptDocument(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(PromptManagementError)(cause)
                ? cause
                : new PromptManagementError({
                    code: "operation_failed",
                    message: "Failed to update prompt document",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "prompts" },
        ),
      [WS_METHODS.shellOpenInEditor]: (input) =>
        observeRpcEffect(WS_METHODS.shellOpenInEditor, open.openInEditor(input), {
          "rpc.aggregate": "workspace",
        }),
      [WS_METHODS.gitStatus]: (input) =>
        observeRpcEffect(WS_METHODS.gitStatus, gitManager.status(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitPull]: (input) =>
        observeRpcEffect(WS_METHODS.gitPull, git.pullCurrentBranch(input.cwd), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitRunStackedAction]: (input) =>
        observeRpcStream(
          WS_METHODS.gitRunStackedAction,
          Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
            gitManager
              .runStackedAction(input, {
                actionId: input.actionId,
                progressReporter: {
                  publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                },
              })
              .pipe(
                Effect.matchCauseEffect({
                  onFailure: (cause) => Queue.failCause(queue, cause),
                  onSuccess: () => Queue.end(queue).pipe(Effect.asVoid),
                }),
              ),
          ),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitResolvePullRequest]: (input) =>
        observeRpcEffect(WS_METHODS.gitResolvePullRequest, gitManager.resolvePullRequest(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitPreparePullRequestThread]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitPreparePullRequestThread,
          gitManager.preparePullRequestThread(input),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitListBranches]: (input) =>
        observeRpcEffect(WS_METHODS.gitListBranches, git.listBranches(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitCreateWorktree]: (input) =>
        observeRpcEffect(WS_METHODS.gitCreateWorktree, git.createWorktree(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitRemoveWorktree]: (input) =>
        observeRpcEffect(WS_METHODS.gitRemoveWorktree, git.removeWorktree(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitCreateBranch]: (input) =>
        observeRpcEffect(WS_METHODS.gitCreateBranch, git.createBranch(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitCheckout]: (input) =>
        observeRpcEffect(WS_METHODS.gitCheckout, Effect.scoped(git.checkoutBranch(input)), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitInit]: (input) =>
        observeRpcEffect(WS_METHODS.gitInit, git.initRepo(input), { "rpc.aggregate": "git" }),
      [WS_METHODS.managedRunsLaunchProjectScript]: (input) =>
        observeRpcEffect(
          WS_METHODS.managedRunsLaunchProjectScript,
          managedRuns.launchProjectScript(input),
          { "rpc.aggregate": "managed-runs" },
        ),
      [WS_METHODS.managedRunsList]: (input) =>
        observeRpcEffect(WS_METHODS.managedRunsList, managedRuns.list(input), {
          "rpc.aggregate": "managed-runs",
        }),
      [WS_METHODS.managedRunsGet]: (input) =>
        observeRpcEffect(WS_METHODS.managedRunsGet, managedRuns.get(input), {
          "rpc.aggregate": "managed-runs",
        }),
      [WS_METHODS.managedRunsGetLogs]: (input) =>
        observeRpcEffect(WS_METHODS.managedRunsGetLogs, managedRuns.getLogs(input), {
          "rpc.aggregate": "managed-runs",
        }),
      [WS_METHODS.managedRunsListInferenceRecords]: (input) =>
        observeRpcEffect(
          WS_METHODS.managedRunsListInferenceRecords,
          managedRuns.listInferenceRecords(input),
          { "rpc.aggregate": "managed-runs" },
        ),
      [WS_METHODS.managedRunsGetInferenceRecord]: (input) =>
        observeRpcEffect(
          WS_METHODS.managedRunsGetInferenceRecord,
          managedRuns.getInferenceRecord(input),
          { "rpc.aggregate": "managed-runs" },
        ),
      [WS_METHODS.managedRunsStop]: (input) =>
        observeRpcEffect(WS_METHODS.managedRunsStop, managedRuns.stop(input), {
          "rpc.aggregate": "managed-runs",
        }),
      [WS_METHODS.scheduledTasksList]: () =>
        observeRpcEffect(WS_METHODS.scheduledTasksList, scheduledTasks.list(), {
          "rpc.aggregate": "scheduled-tasks",
        }),
      [WS_METHODS.scheduledTasksGet]: (input) =>
        observeRpcEffect(WS_METHODS.scheduledTasksGet, scheduledTasks.get(input), {
          "rpc.aggregate": "scheduled-tasks",
        }),
      [WS_METHODS.scheduledTasksCreate]: (input) =>
        observeRpcEffect(WS_METHODS.scheduledTasksCreate, scheduledTasks.create(input), {
          "rpc.aggregate": "scheduled-tasks",
        }),
      [WS_METHODS.scheduledTasksUpdate]: (input) =>
        observeRpcEffect(WS_METHODS.scheduledTasksUpdate, scheduledTasks.update(input), {
          "rpc.aggregate": "scheduled-tasks",
        }),
      [WS_METHODS.scheduledTasksDelete]: (input) =>
        observeRpcEffect(WS_METHODS.scheduledTasksDelete, scheduledTasks.delete(input), {
          "rpc.aggregate": "scheduled-tasks",
        }),
      [WS_METHODS.scheduledTasksToggle]: (input) =>
        observeRpcEffect(WS_METHODS.scheduledTasksToggle, scheduledTasks.toggle(input), {
          "rpc.aggregate": "scheduled-tasks",
        }),
      [WS_METHODS.scheduledTasksRunNow]: (input) =>
        observeRpcEffect(WS_METHODS.scheduledTasksRunNow, scheduledTasks.runNow(input), {
          "rpc.aggregate": "scheduled-tasks",
        }),
      [WS_METHODS.scheduledTasksListRuns]: (input) =>
        observeRpcEffect(WS_METHODS.scheduledTasksListRuns, scheduledTasks.listRuns(input), {
          "rpc.aggregate": "scheduled-tasks",
        }),
      [WS_METHODS.subscribeScheduledTaskEvents]: () =>
        observeRpcStream(WS_METHODS.subscribeScheduledTaskEvents, scheduledTasks.streamEvents, {
          "rpc.aggregate": "scheduled-tasks",
        }),
      [WS_METHODS.ticketingList]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingList, ticketing.list(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingGetById]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingGetById, ticketing.getById(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingGetByIdentifier]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingGetByIdentifier, ticketing.getByIdentifier(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingGetThreadLinks]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingGetThreadLinks, ticketing.getThreadLinks(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingCreate]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingCreate, ticketing.create(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingUpdate]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingUpdate, ticketing.update(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingDelete]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingDelete, ticketing.delete(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingReorder]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingReorder, ticketing.reorder(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingSearch]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingSearch, ticketing.search(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingGetTree]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingGetTree, ticketing.getTree(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingSetDependencies]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingSetDependencies, ticketing.setDependencies(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingAddDependency]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingAddDependency, ticketing.addDependency(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingRemoveDependency]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingRemoveDependency, ticketing.removeDependency(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingUpdateCriterionStatus]: (input) =>
        observeRpcEffect(
          WS_METHODS.ticketingUpdateCriterionStatus,
          ticketing.updateCriterionStatus(input),
          { "rpc.aggregate": "ticketing" },
        ),
      [WS_METHODS.ticketingGetHistory]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingGetHistory, ticketing.getHistory(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingListLabels]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingListLabels, ticketing.listLabels(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingCreateLabel]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingCreateLabel, ticketing.createLabel(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingUpdateLabel]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingUpdateLabel, ticketing.updateLabel(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingDeleteLabel]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingDeleteLabel, ticketing.deleteLabel(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingAddTicketLabel]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingAddTicketLabel, ticketing.addTicketLabel(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingRemoveTicketLabel]: (input) =>
        observeRpcEffect(
          WS_METHODS.ticketingRemoveTicketLabel,
          ticketing.removeTicketLabel(input),
          { "rpc.aggregate": "ticketing" },
        ),
      [WS_METHODS.ticketingListComments]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingListComments, ticketing.listComments(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingCreateComment]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingCreateComment, ticketing.createComment(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingUpdateComment]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingUpdateComment, ticketing.updateComment(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingDeleteComment]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingDeleteComment, ticketing.deleteComment(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingListArtifacts]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingListArtifacts, ticketing.listArtifacts(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingCreateArtifact]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingCreateArtifact, ticketing.createArtifact(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingDeleteArtifact]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingDeleteArtifact, ticketing.deleteArtifact(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingListTemplates]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingListTemplates, ticketing.listTemplates(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingGetTemplate]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingGetTemplate, ticketing.getTemplate(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingCreateTemplate]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingCreateTemplate, ticketing.createTemplate(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingUpdateTemplate]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingUpdateTemplate, ticketing.updateTemplate(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.ticketingDeleteTemplate]: (input) =>
        observeRpcEffect(WS_METHODS.ticketingDeleteTemplate, ticketing.deleteTemplate(input), {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.subscribeTicketingEvents]: () =>
        observeRpcStream(WS_METHODS.subscribeTicketingEvents, ticketing.streamEvents, {
          "rpc.aggregate": "ticketing",
        }),
      [WS_METHODS.gitDiscoverRepos]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitDiscoverRepos,
          repoDiscovery.getRepos(input.cwd).pipe(
            Effect.map((repos) => ({ repos: [...repos] })),
            Effect.mapError(
              (cause) =>
                new GitCommandError({
                  operation: "discoverRepos",
                  command: "scan",
                  cwd: input.cwd,
                  detail: cause.detail,
                }),
            ),
          ),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.terminalOpen]: (input) =>
        observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalWrite]: (input) =>
        observeRpcEffect(WS_METHODS.terminalWrite, terminalManager.write(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalResize]: (input) =>
        observeRpcEffect(WS_METHODS.terminalResize, terminalManager.resize(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalClear]: (input) =>
        observeRpcEffect(WS_METHODS.terminalClear, terminalManager.clear(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalRestart]: (input) =>
        observeRpcEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalClose]: (input) =>
        observeRpcEffect(WS_METHODS.terminalClose, terminalManager.close(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.subscribeTerminalEvents]: (_input) =>
        observeRpcStream(
          WS_METHODS.subscribeTerminalEvents,
          Stream.callback<TerminalEvent>((queue) =>
            Effect.acquireRelease(
              terminalManager.subscribe((event) => Queue.offer(queue, event)),
              (unsubscribe) => Effect.sync(unsubscribe),
            ),
          ),
          { "rpc.aggregate": "terminal" },
        ),
      [WS_METHODS.subscribeOrchestrationRunEvents]: ({ projectId }) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeOrchestrationRunEvents,
          Effect.gen(function* () {
            const snapshotRuns = yield* orchestrationRuns
              .list({ projectId })
              .pipe(
                Effect.catch(() =>
                  Effect.succeed(
                    [] as ReadonlyArray<import("@t3tools/contracts").OrchestrationRunSummary>,
                  ),
                ),
              );
            return Stream.concat(
              Stream.make({
                type: "snapshot" as const,
                projectId,
                runs: Array.from(snapshotRuns),
              }),
              orchestrationRuns.streamEvents(projectId),
            );
          }),
          { "rpc.aggregate": "orchestration" },
        ),
      [WS_METHODS.subscribeManagedRunEvents]: ({ projectId }) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeManagedRunEvents,
          Effect.gen(function* () {
            const snapshotRuns = yield* managedRuns
              .list({ projectId })
              .pipe(Effect.catch(() => Effect.succeed([])));
            return Stream.concat(
              Stream.make({
                type: "snapshot" as const,
                projectId,
                runs: Array.from(snapshotRuns),
              }),
              managedRuns.streamEvents(projectId),
            );
          }),
          { "rpc.aggregate": "managed-runs" },
        ),
      [WS_METHODS.subscribeServerConfig]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeServerConfig,
          Effect.gen(function* () {
            const keybindingsUpdates = keybindings.streamChanges.pipe(
              Stream.map((event) => ({
                version: 1 as const,
                type: "keybindingsUpdated" as const,
                payload: {
                  issues: event.issues,
                },
              })),
            );
            const providerStatuses = providerRegistry.streamChanges.pipe(
              Stream.map((providers) => ({
                version: 1 as const,
                type: "providerStatuses" as const,
                payload: { providers },
              })),
            );
            const settingsUpdates = serverSettings.streamChanges.pipe(
              Stream.map((settings) => ({
                version: 1 as const,
                type: "settingsUpdated" as const,
                payload: { settings },
              })),
            );
            const rateLimitsUpdates = rateLimitsCache.streamChanges.pipe(
              Stream.map((rateLimits) => ({
                version: 1 as const,
                type: "rateLimitsUpdated" as const,
                payload: { rateLimits },
              })),
            );

            // Emit the cached rate-limits snapshot right after the config
            // snapshot so that new connections see the latest data immediately.
            const initialRateLimits = Stream.fromEffect(
              rateLimitsCache.getAll.pipe(
                Effect.map((rateLimits) =>
                  rateLimits.length > 0
                    ? [
                        {
                          version: 1 as const,
                          type: "rateLimitsUpdated" as const,
                          payload: { rateLimits },
                        },
                      ]
                    : [],
                ),
              ),
            ).pipe(Stream.flatMap(Stream.fromIterable));

            return Stream.concat(
              Stream.make({
                version: 1 as const,
                type: "snapshot" as const,
                config: yield* loadServerConfig,
              }),
              Stream.concat(
                initialRateLimits,
                Stream.merge(
                  mcpConfigChangedStream,
                  Stream.merge(
                    rateLimitsUpdates,
                    Stream.merge(
                      keybindingsUpdates,
                      Stream.merge(providerStatuses, settingsUpdates),
                    ),
                  ),
                ),
              ),
            );
          }),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.subscribeServerLifecycle]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeServerLifecycle,
          Effect.gen(function* () {
            const snapshot = yield* lifecycleEvents.snapshot;
            const snapshotEvents = Array.from(snapshot.events).toSorted(
              (left, right) => left.sequence - right.sequence,
            );
            const liveEvents = lifecycleEvents.stream.pipe(
              Stream.filter((event) => event.sequence > snapshot.sequence),
            );
            return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
          }),
          { "rpc.aggregate": "server" },
        ),
    });
  }),
);

const WsRpcRuntimeLayer = WsRpcLayer.pipe(Layer.provideMerge(RpcSerialization.layerJson));

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
      spanPrefix: "ws.rpc",
      spanAttributes: {
        "rpc.transport": "websocket",
        "rpc.system": "effect-rpc",
      },
    }).pipe(Effect.provide(WsRpcRuntimeLayer));
    return HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const config = yield* ServerConfig;
        if (config.authToken) {
          const url = HttpServerRequest.toURL(request);
          if (Option.isNone(url)) {
            return HttpServerResponse.text("Invalid WebSocket URL", { status: 400 });
          }
          const token = url.value.searchParams.get("token");
          if (token !== config.authToken) {
            return HttpServerResponse.text("Unauthorized WebSocket connection", { status: 401 });
          }
        }
        return yield* rpcWebSocketHttpEffect;
      }),
    );
  }),
);
