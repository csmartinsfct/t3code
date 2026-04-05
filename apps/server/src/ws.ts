import {
  Cause,
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
  CommandId,
  EventId,
  type OrchestrationCommand,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  ProjectListDirectoryError,
  ProjectReadFileError,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  OrchestrationReplayEventsError,
  ResolveMcpServersError,
  ResolveSkillsError,
  ThreadId,
  type TerminalEvent,
  WS_METHODS,
  WsRpcGroup,
  baseProviderKind,
  providerProfileId,
} from "@t3tools/contracts";
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

import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "./observability/RpcInstrumentation";
import { ProviderRateLimitsCache } from "./provider/Services/ProviderRateLimitsCache";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import { ServerRuntimeStartup } from "./serverRuntimeStartup";
import { ServerSettingsService } from "./serverSettings";
import { ManagedRunService } from "./managedRuns/Services/ManagedRuns";
import { CronJobService } from "./cronJobs/Services/CronJobs";
import { TerminalManager } from "./terminal/Services/Manager";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths";
import { resolveClaudeMcpServerNames, resolveCodexMcpServerNames } from "./mcpConfigReader";
import { resolveSkills } from "./skillsReader";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner";
import * as os from "node:os";
import * as nodePath from "node:path";

const WsRpcLayer = WsRpcGroup.toLayer(
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const checkpointDiffQuery = yield* CheckpointDiffQuery;
    const keybindings = yield* Keybindings;
    const open = yield* Open;
    const gitManager = yield* GitManager;
    const git = yield* GitCore;
    const terminalManager = yield* TerminalManager;
    const providerRegistry = yield* ProviderRegistry;
    const rateLimitsCache = yield* ProviderRateLimitsCache;
    const config = yield* ServerConfig;
    const lifecycleEvents = yield* ServerLifecycleEvents;
    const serverSettings = yield* ServerSettingsService;
    const startup = yield* ServerRuntimeStartup;
    const managedRuns = yield* ManagedRunService;
    const cronJobs = yield* CronJobService;
    const workspaceEntries = yield* WorkspaceEntries;
    const workspaceFileSystem = yield* WorkspaceFileSystem;
    const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;

    const serverCommandId = (tag: string) =>
      CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

    const appendSetupScriptActivity = (input: {
      readonly threadId: ThreadId;
      readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
      readonly summary: string;
      readonly createdAt: string;
      readonly payload: Record<string, unknown>;
      readonly tone: "info" | "error";
    }) =>
      orchestrationEngine.dispatch({
        type: "thread.activity.append",
        commandId: serverCommandId("setup-script-activity"),
        threadId: input.threadId,
        activity: {
          id: EventId.makeUnsafe(crypto.randomUUID()),
          tone: input.tone,
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          turnId: null,
          createdAt: input.createdAt,
        },
        createdAt: input.createdAt,
      });

    const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
      Schema.is(OrchestrationDispatchCommandError)(cause)
        ? cause
        : new OrchestrationDispatchCommandError({
            message: cause instanceof Error ? cause.message : fallbackMessage,
            cause,
          });

    const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
      const error = Cause.squash(cause);
      return Schema.is(OrchestrationDispatchCommandError)(error)
        ? error
        : new OrchestrationDispatchCommandError({
            message:
              error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
            cause,
          });
    };

    const dispatchBootstrapTurnStart = (
      command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
    ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
      Effect.gen(function* () {
        const bootstrap = command.bootstrap;
        const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
        let createdThread = false;
        let targetProjectId = bootstrap?.createThread?.projectId;
        let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
        let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

        const cleanupCreatedThread = () =>
          createdThread
            ? orchestrationEngine
                .dispatch({
                  type: "thread.delete",
                  commandId: serverCommandId("bootstrap-thread-delete"),
                  threadId: command.threadId,
                })
                .pipe(Effect.ignoreCause({ log: true }))
            : Effect.void;

        const recordSetupScriptLaunchFailure = (input: {
          readonly error: unknown;
          readonly requestedAt: string;
          readonly worktreePath: string;
        }) => {
          const detail =
            input.error instanceof Error ? input.error.message : "Unknown setup failure.";
          return appendSetupScriptActivity({
            threadId: command.threadId,
            kind: "setup-script.failed",
            summary: "Setup script failed to start",
            createdAt: input.requestedAt,
            payload: {
              detail,
              worktreePath: input.worktreePath,
            },
            tone: "error",
          }).pipe(
            Effect.ignoreCause({ log: false }),
            Effect.flatMap(() =>
              Effect.logWarning("bootstrap turn start failed to launch setup script", {
                threadId: command.threadId,
                worktreePath: input.worktreePath,
                detail,
              }),
            ),
          );
        };

        const recordSetupScriptStarted = (input: {
          readonly requestedAt: string;
          readonly worktreePath: string;
          readonly scriptId: string;
          readonly scriptName: string;
          readonly terminalId: string;
        }) => {
          const payload = {
            scriptId: input.scriptId,
            scriptName: input.scriptName,
            terminalId: input.terminalId,
            worktreePath: input.worktreePath,
          };
          return Effect.all([
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.requested",
              summary: "Starting setup script",
              createdAt: input.requestedAt,
              payload,
              tone: "info",
            }),
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.started",
              summary: "Setup script started",
              createdAt: new Date().toISOString(),
              payload,
              tone: "info",
            }),
          ]).pipe(
            Effect.asVoid,
            Effect.catch((error) =>
              Effect.logWarning(
                "bootstrap turn start launched setup script but failed to record setup activity",
                {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  scriptId: input.scriptId,
                  terminalId: input.terminalId,
                  detail:
                    error instanceof Error
                      ? error.message
                      : "Unknown setup activity dispatch failure.",
                },
              ),
            ),
          );
        };

        const runSetupProgram = () =>
          bootstrap?.runSetupScript && targetWorktreePath
            ? (() => {
                const worktreePath = targetWorktreePath;
                const requestedAt = new Date().toISOString();
                return projectSetupScriptRunner
                  .runForThread({
                    threadId: command.threadId,
                    ...(targetProjectId ? { projectId: targetProjectId } : {}),
                    ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                    worktreePath,
                  })
                  .pipe(
                    Effect.matchEffect({
                      onFailure: (error) =>
                        recordSetupScriptLaunchFailure({
                          error,
                          requestedAt,
                          worktreePath,
                        }),
                      onSuccess: (setupResult) => {
                        if (setupResult.status !== "started") {
                          return Effect.void;
                        }
                        return recordSetupScriptStarted({
                          requestedAt,
                          worktreePath,
                          scriptId: setupResult.scriptId,
                          scriptName: setupResult.scriptName,
                          terminalId: setupResult.terminalId,
                        });
                      },
                    }),
                  );
              })()
            : Effect.void;

        const bootstrapProgram = Effect.gen(function* () {
          if (bootstrap?.createThread) {
            yield* orchestrationEngine.dispatch({
              type: "thread.create",
              commandId: serverCommandId("bootstrap-thread-create"),
              threadId: command.threadId,
              projectId: bootstrap.createThread.projectId,
              title: bootstrap.createThread.title,
              modelSelection: bootstrap.createThread.modelSelection,
              runtimeMode: bootstrap.createThread.runtimeMode,
              interactionMode: bootstrap.createThread.interactionMode,
              branch: bootstrap.createThread.branch,
              worktreePath: bootstrap.createThread.worktreePath,
              createdAt: bootstrap.createThread.createdAt,
            });
            createdThread = true;
          }

          if (bootstrap?.prepareWorktree) {
            const worktree = yield* git.createWorktree({
              cwd: bootstrap.prepareWorktree.projectCwd,
              branch: bootstrap.prepareWorktree.baseBranch,
              newBranch: bootstrap.prepareWorktree.branch,
              path: null,
            });
            targetWorktreePath = worktree.worktree.path;
            yield* orchestrationEngine.dispatch({
              type: "thread.meta.update",
              commandId: serverCommandId("bootstrap-thread-meta-update"),
              threadId: command.threadId,
              branch: worktree.worktree.branch,
              worktreePath: targetWorktreePath,
            });
          }

          yield* runSetupProgram();

          return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
        });

        return yield* bootstrapProgram.pipe(
          Effect.catchCause((cause) => {
            const dispatchError = toBootstrapDispatchCommandCauseError(cause);
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.fail(dispatchError);
            }
            return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
          }),
        );
      });

    const dispatchNormalizedCommand = (
      normalizedCommand: OrchestrationCommand,
    ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
      const dispatchEffect =
        normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
          ? dispatchBootstrapTurnStart(normalizedCommand)
          : orchestrationEngine
              .dispatch(normalizedCommand)
              .pipe(
                Effect.mapError((cause) =>
                  toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                ),
              );

      return startup
        .enqueueCommand(dispatchEffect)
        .pipe(
          Effect.mapError((cause) =>
            toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
          ),
        );
    };

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

    const watchDirForFile = (dir: string, targetFile: string) =>
      Effect.gen(function* () {
        const dirExists = yield* fs.exists(dir);
        if (!dirExists) return;

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
          Effect.asVoid,
        );
      }).pipe(Effect.ignoreCause({ log: true }));

    // Watch ~/.claude/ for .claude.json
    const home = os.homedir();
    yield* watchDirForFile(nodePath.join(home, ".claude"), ".claude.json");

    // Watch ~/.codex/ for config.toml
    const currentSettings = yield* serverSettings.getSettings;
    const codexHome =
      currentSettings.providers.codex.homePath ||
      process.env.CODEX_HOME ||
      nodePath.join(home, ".codex");
    yield* watchDirForFile(codexHome, "config.toml");

    // Watch each ~/.claude-{profile}/ dir for .claude.json
    const homeEntries = yield* fs
      .readDirectory(home)
      .pipe(Effect.orElseSucceed(() => [] as string[]));
    for (const entry of homeEntries) {
      if (!entry.startsWith(".claude-")) continue;
      const profileDir = nodePath.join(home, entry);
      const stat = yield* fs.stat(profileDir).pipe(Effect.orElseSucceed(() => undefined));
      if (stat?.type === "Directory") {
        yield* watchDirForFile(profileDir, ".claude.json");
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
        observeRpcEffect(ORCHESTRATION_WS_METHODS.getSnapshot, orchestrationEngine.getReadModel(), {
          "rpc.aggregate": "orchestration",
        }),
      [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.dispatchCommand,
          Effect.gen(function* () {
            const normalizedCommand = yield* normalizeDispatchCommand(command);
            const result = yield* dispatchNormalizedCommand(normalizedCommand);
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
      [WS_METHODS.subscribeOrchestrationDomainEvents]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeOrchestrationDomainEvents,
          Effect.gen(function* () {
            const snapshot = yield* orchestrationEngine.getReadModel();
            const fromSequenceExclusive = snapshot.snapshotSequence;
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
              const settings = yield* serverSettings.getSettings;
              const codexHome =
                settings.providers.codex.homePath ||
                process.env.CODEX_HOME ||
                nodePath.join(os.homedir(), ".codex");
              const serverNames = yield* resolveCodexMcpServerNames(codexHome);
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
      [WS_METHODS.managedRunsStop]: (input) =>
        observeRpcEffect(WS_METHODS.managedRunsStop, managedRuns.stop(input), {
          "rpc.aggregate": "managed-runs",
        }),
      [WS_METHODS.cronJobsList]: () =>
        observeRpcEffect(WS_METHODS.cronJobsList, cronJobs.list(), {
          "rpc.aggregate": "cron-jobs",
        }),
      [WS_METHODS.cronJobsGet]: (input) =>
        observeRpcEffect(WS_METHODS.cronJobsGet, cronJobs.get(input), {
          "rpc.aggregate": "cron-jobs",
        }),
      [WS_METHODS.cronJobsCreate]: (input) =>
        observeRpcEffect(WS_METHODS.cronJobsCreate, cronJobs.create(input), {
          "rpc.aggregate": "cron-jobs",
        }),
      [WS_METHODS.cronJobsUpdate]: (input) =>
        observeRpcEffect(WS_METHODS.cronJobsUpdate, cronJobs.update(input), {
          "rpc.aggregate": "cron-jobs",
        }),
      [WS_METHODS.cronJobsDelete]: (input) =>
        observeRpcEffect(WS_METHODS.cronJobsDelete, cronJobs.delete(input), {
          "rpc.aggregate": "cron-jobs",
        }),
      [WS_METHODS.cronJobsToggle]: (input) =>
        observeRpcEffect(WS_METHODS.cronJobsToggle, cronJobs.toggle(input), {
          "rpc.aggregate": "cron-jobs",
        }),
      [WS_METHODS.cronJobsRunNow]: (input) =>
        observeRpcEffect(WS_METHODS.cronJobsRunNow, cronJobs.runNow(input), {
          "rpc.aggregate": "cron-jobs",
        }),
      [WS_METHODS.cronJobsListRuns]: (input) =>
        observeRpcEffect(WS_METHODS.cronJobsListRuns, cronJobs.listRuns(input), {
          "rpc.aggregate": "cron-jobs",
        }),
      [WS_METHODS.subscribeCronJobEvents]: () =>
        observeRpcStream(WS_METHODS.subscribeCronJobEvents, cronJobs.streamEvents, {
          "rpc.aggregate": "cron-jobs",
        }),
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
