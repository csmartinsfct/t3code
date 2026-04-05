import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { ProjectId } from "./baseSchemas";
import { OpenError, OpenInEditorInput } from "./editor";
import {
  GitActionProgressEvent,
  GitCheckoutInput,
  GitCommandError,
  GitCreateBranchInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitStatusInput,
  GitStatusResult,
} from "./git";
import { KeybindingsConfigError } from "./keybindings";
import {
  ClientOrchestrationCommand,
  OrchestrationEvent,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationGetSnapshotInput,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
} from "./orchestration";
import {
  ManagedRunError,
  ManagedRunGetInput,
  ManagedRunGetLogsInput,
  ManagedRunDetail,
  ManagedRunLaunchProjectScriptInput,
  ManagedRunLaunchProjectScriptResult,
  ManagedRunListInput,
  ManagedRunLogLine,
  ManagedRunStopInput,
  ManagedRunStreamEvent,
  ManagedRunSummary,
} from "./managedRuns";
import {
  CronJob,
  CronJobCreateInput,
  CronJobDeleteInput,
  CronJobError,
  CronJobGetInput,
  CronJobListRunsInput,
  CronJobRunNowInput,
  CronJobStreamEvent,
  CronJobToggleInput,
  CronJobUpdateInput,
  CronThreadRun,
} from "./cronJobs";
import {
  ProjectListDirectoryError,
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerLifecycleStreamEvent,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
  ResolveMcpServersInput,
  ResolveMcpServersResult,
  ResolveMcpServersError,
  ResolveSkillsInput,
  ResolveSkillsResult,
  ResolveSkillsError,
} from "./server";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",
  projectsListDirectory: "projects.listDirectory",
  projectsReadFile: "projects.readFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Git methods
  gitPull: "git.pull",
  gitStatus: "git.status",
  gitRunStackedAction: "git.runStackedAction",
  gitListBranches: "git.listBranches",
  gitCreateWorktree: "git.createWorktree",
  gitRemoveWorktree: "git.removeWorktree",
  gitCreateBranch: "git.createBranch",
  gitCheckout: "git.checkout",
  gitInit: "git.init",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Managed run methods
  managedRunsLaunchProjectScript: "managedRuns.launchProjectScript",
  managedRunsList: "managedRuns.list",
  managedRunsGet: "managedRuns.get",
  managedRunsGetLogs: "managedRuns.getLogs",
  managedRunsStop: "managedRuns.stop",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverResolveMcpServers: "server.resolveMcpServers",
  serverResolveSkills: "server.resolveSkills",

  // Cron job methods
  cronJobsList: "cronJobs.list",
  cronJobsGet: "cronJobs.get",
  cronJobsCreate: "cronJobs.create",
  cronJobsUpdate: "cronJobs.update",
  cronJobsDelete: "cronJobs.delete",
  cronJobsToggle: "cronJobs.toggle",
  cronJobsRunNow: "cronJobs.runNow",
  cronJobsListRuns: "cronJobs.listRuns",

  // Streaming subscriptions
  subscribeOrchestrationDomainEvents: "subscribeOrchestrationDomainEvents",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeManagedRunEvents: "subscribeManagedRunEvents",
  subscribeCronJobEvents: "subscribeCronJobEvents",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
} as const;

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({}),
  success: ServerProviderUpdatedPayload,
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerResolveMcpServersRpc = Rpc.make(WS_METHODS.serverResolveMcpServers, {
  payload: ResolveMcpServersInput,
  success: ResolveMcpServersResult,
  error: ResolveMcpServersError,
});

export const WsServerResolveSkillsRpc = Rpc.make(WS_METHODS.serverResolveSkills, {
  payload: ResolveSkillsInput,
  success: ResolveSkillsResult,
  error: ResolveSkillsError,
});

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: ProjectSearchEntriesError,
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: ProjectWriteFileError,
});

export const WsProjectsListDirectoryRpc = Rpc.make(WS_METHODS.projectsListDirectory, {
  payload: ProjectListDirectoryInput,
  success: ProjectListDirectoryResult,
  error: ProjectListDirectoryError,
});

export const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: ProjectReadFileError,
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  error: OpenError,
});

export const WsGitStatusRpc = Rpc.make(WS_METHODS.gitStatus, {
  payload: GitStatusInput,
  success: GitStatusResult,
  error: GitManagerServiceError,
});

export const WsGitPullRpc = Rpc.make(WS_METHODS.gitPull, {
  payload: GitPullInput,
  success: GitPullResult,
  error: GitCommandError,
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: GitManagerServiceError,
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: GitManagerServiceError,
});

export const WsGitListBranchesRpc = Rpc.make(WS_METHODS.gitListBranches, {
  payload: GitListBranchesInput,
  success: GitListBranchesResult,
  error: GitCommandError,
});

export const WsGitCreateWorktreeRpc = Rpc.make(WS_METHODS.gitCreateWorktree, {
  payload: GitCreateWorktreeInput,
  success: GitCreateWorktreeResult,
  error: GitCommandError,
});

export const WsGitRemoveWorktreeRpc = Rpc.make(WS_METHODS.gitRemoveWorktree, {
  payload: GitRemoveWorktreeInput,
  error: GitCommandError,
});

export const WsGitCreateBranchRpc = Rpc.make(WS_METHODS.gitCreateBranch, {
  payload: GitCreateBranchInput,
  error: GitCommandError,
});

export const WsGitCheckoutRpc = Rpc.make(WS_METHODS.gitCheckout, {
  payload: GitCheckoutInput,
  error: GitCommandError,
});

export const WsGitInitRpc = Rpc.make(WS_METHODS.gitInit, {
  payload: GitInitInput,
  error: GitCommandError,
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: TerminalError,
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: TerminalError,
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: TerminalError,
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: TerminalError,
});

export const WsManagedRunsLaunchProjectScriptRpc = Rpc.make(
  WS_METHODS.managedRunsLaunchProjectScript,
  {
    payload: ManagedRunLaunchProjectScriptInput,
    success: ManagedRunLaunchProjectScriptResult,
    error: ManagedRunError,
  },
);

export const WsManagedRunsListRpc = Rpc.make(WS_METHODS.managedRunsList, {
  payload: ManagedRunListInput,
  success: Schema.Array(ManagedRunSummary),
  error: ManagedRunError,
});

export const WsManagedRunsGetRpc = Rpc.make(WS_METHODS.managedRunsGet, {
  payload: ManagedRunGetInput,
  success: ManagedRunDetail,
  error: ManagedRunError,
});

export const WsManagedRunsGetLogsRpc = Rpc.make(WS_METHODS.managedRunsGetLogs, {
  payload: ManagedRunGetLogsInput,
  success: Schema.Array(ManagedRunLogLine),
  error: ManagedRunError,
});

export const WsManagedRunsStopRpc = Rpc.make(WS_METHODS.managedRunsStop, {
  payload: ManagedRunStopInput,
  error: ManagedRunError,
});

export const WsOrchestrationGetSnapshotRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getSnapshot, {
  payload: OrchestrationGetSnapshotInput,
  success: OrchestrationRpcSchemas.getSnapshot.output,
  error: OrchestrationGetSnapshotError,
});

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: OrchestrationGetTurnDiffError,
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationGetFullThreadDiffInput,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: OrchestrationGetFullThreadDiffError,
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationReplayEventsInput,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: OrchestrationReplayEventsError,
});

export const WsSubscribeOrchestrationDomainEventsRpc = Rpc.make(
  WS_METHODS.subscribeOrchestrationDomainEvents,
  {
    payload: Schema.Struct({}),
    success: OrchestrationEvent,
    stream: true,
  },
);

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  stream: true,
});

export const WsSubscribeManagedRunEventsRpc = Rpc.make(WS_METHODS.subscribeManagedRunEvents, {
  payload: Schema.Struct({
    projectId: ProjectId,
  }),
  success: ManagedRunStreamEvent,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  stream: true,
});

export const WsCronJobsListRpc = Rpc.make(WS_METHODS.cronJobsList, {
  payload: Schema.Struct({}),
  success: Schema.Array(CronJob),
  error: CronJobError,
});

export const WsCronJobsGetRpc = Rpc.make(WS_METHODS.cronJobsGet, {
  payload: CronJobGetInput,
  success: CronJob,
  error: CronJobError,
});

export const WsCronJobsCreateRpc = Rpc.make(WS_METHODS.cronJobsCreate, {
  payload: CronJobCreateInput,
  success: CronJob,
  error: CronJobError,
});

export const WsCronJobsUpdateRpc = Rpc.make(WS_METHODS.cronJobsUpdate, {
  payload: CronJobUpdateInput,
  success: CronJob,
  error: CronJobError,
});

export const WsCronJobsDeleteRpc = Rpc.make(WS_METHODS.cronJobsDelete, {
  payload: CronJobDeleteInput,
  error: CronJobError,
});

export const WsCronJobsToggleRpc = Rpc.make(WS_METHODS.cronJobsToggle, {
  payload: CronJobToggleInput,
  success: CronJob,
  error: CronJobError,
});

export const WsCronJobsRunNowRpc = Rpc.make(WS_METHODS.cronJobsRunNow, {
  payload: CronJobRunNowInput,
  success: CronThreadRun,
  error: CronJobError,
});

export const WsCronJobsListRunsRpc = Rpc.make(WS_METHODS.cronJobsListRuns, {
  payload: CronJobListRunsInput,
  success: Schema.Array(CronThreadRun),
  error: CronJobError,
});

export const WsSubscribeCronJobEventsRpc = Rpc.make(WS_METHODS.subscribeCronJobEvents, {
  payload: Schema.Struct({}),
  success: CronJobStreamEvent,
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpsertKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerResolveMcpServersRpc,
  WsServerResolveSkillsRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsProjectsListDirectoryRpc,
  WsProjectsReadFileRpc,
  WsShellOpenInEditorRpc,
  WsGitStatusRpc,
  WsGitPullRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsGitListBranchesRpc,
  WsGitCreateWorktreeRpc,
  WsGitRemoveWorktreeRpc,
  WsGitCreateBranchRpc,
  WsGitCheckoutRpc,
  WsGitInitRpc,
  WsManagedRunsLaunchProjectScriptRpc,
  WsManagedRunsListRpc,
  WsManagedRunsGetRpc,
  WsManagedRunsGetLogsRpc,
  WsManagedRunsStopRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeOrchestrationDomainEventsRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeManagedRunEventsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsCronJobsListRpc,
  WsCronJobsGetRpc,
  WsCronJobsCreateRpc,
  WsCronJobsUpdateRpc,
  WsCronJobsDeleteRpc,
  WsCronJobsToggleRpc,
  WsCronJobsRunNowRpc,
  WsCronJobsListRunsRpc,
  WsSubscribeCronJobEventsRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
);
