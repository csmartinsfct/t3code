import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { NonNegativeInt, ProjectId } from "./baseSchemas";
import { OpenError, OpenInEditorInput } from "./editor";
import {
  GitActionProgressEvent,
  GitCheckoutInput,
  GitCommandError,
  GitCreateBranchInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitDiscoverReposInput,
  GitDiscoverReposResult,
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
  TextGenerationError,
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
  OrchestrationRunError,
  OrchestrationRunStreamEvent,
} from "./orchestration";
import {
  ManagedRunError,
  ManagedRunGetInferenceRecordInput,
  ManagedRunGetInput,
  ManagedRunGetLogsInput,
  ManagedRunDetail,
  ManagedRunInferenceRecordDetail,
  ManagedRunInferenceRecordSummary,
  ManagedRunLaunchProjectScriptInput,
  ManagedRunLaunchProjectScriptResult,
  ManagedRunListInferenceRecordsInput,
  ManagedRunListInput,
  ManagedRunLogLine,
  ManagedRunStopInput,
  ManagedRunStreamEvent,
  ManagedRunSummary,
} from "./managedRuns";
import {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskDeleteInput,
  ScheduledTaskError,
  ScheduledTaskGetInput,
  ScheduledTaskListRunsInput,
  ScheduledTaskRunNowInput,
  ScheduledTaskStreamEvent,
  ScheduledTaskToggleInput,
  ScheduledTaskUpdateInput,
  ScheduledTaskRun,
} from "./scheduledTasks";
import {
  ArtifactCreateInput,
  ArtifactDeleteInput,
  ArtifactListInput,
  CommentCreateInput,
  CommentDeleteInput,
  CommentListInput,
  CommentUpdateInput,
  DependencyInput,
  LabelCreateInput,
  LabelDeleteInput,
  LabelListInput,
  LabelUpdateInput,
  SetDependenciesInput,
  Ticket,
  TicketCreateInput,
  TicketUpdateInput,
  TicketDeleteInput,
  TicketGetByIdInput,
  TicketGetByIdentifierInput,
  TicketHistoryEntry,
  TicketHistoryInput,
  TicketingError,
  TicketingStreamEvent,
  TicketLabelInput,
  TicketListInput,
  TicketReorderInput,
  TicketSearchInput,
  TicketSummary,
  TicketTreeInput,
  UpdateCriterionStatusInput,
  Artifact,
  Comment,
  Label,
} from "./ticketing";
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
  ResolveCodexProjectTrustInput,
  ResolveCodexProjectTrustResult,
  ResolveCodexProjectTrustError,
  ResolveSkillsInput,
  ResolveSkillsResult,
  ResolveSkillsError,
  TrustCodexProjectInput,
  TrustCodexProjectResult,
  TrustCodexProjectError,
} from "./server";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsEnhanceSystemPrompt: "projects.enhanceSystemPrompt",
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
  gitDiscoverRepos: "git.discoverRepos",

  // Managed run methods
  managedRunsLaunchProjectScript: "managedRuns.launchProjectScript",
  managedRunsList: "managedRuns.list",
  managedRunsGet: "managedRuns.get",
  managedRunsGetLogs: "managedRuns.getLogs",
  managedRunsListInferenceRecords: "managedRuns.listInferenceRecords",
  managedRunsGetInferenceRecord: "managedRuns.getInferenceRecord",
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
  serverResolveCodexProjectTrust: "server.resolveCodexProjectTrust",
  serverTrustCodexProject: "server.trustCodexProject",
  serverResolveSkills: "server.resolveSkills",

  // Scheduled task methods
  scheduledTasksList: "scheduledTasks.list",
  scheduledTasksGet: "scheduledTasks.get",
  scheduledTasksCreate: "scheduledTasks.create",
  scheduledTasksUpdate: "scheduledTasks.update",
  scheduledTasksDelete: "scheduledTasks.delete",
  scheduledTasksToggle: "scheduledTasks.toggle",
  scheduledTasksRunNow: "scheduledTasks.runNow",
  scheduledTasksListRuns: "scheduledTasks.listRuns",

  // Ticketing methods
  ticketingList: "ticketing.list",
  ticketingGetById: "ticketing.getById",
  ticketingGetByIdentifier: "ticketing.getByIdentifier",
  ticketingCreate: "ticketing.create",
  ticketingUpdate: "ticketing.update",
  ticketingDelete: "ticketing.delete",
  ticketingReorder: "ticketing.reorder",
  ticketingSearch: "ticketing.search",
  ticketingGetTree: "ticketing.getTree",
  ticketingSetDependencies: "ticketing.setDependencies",
  ticketingAddDependency: "ticketing.addDependency",
  ticketingRemoveDependency: "ticketing.removeDependency",
  ticketingUpdateCriterionStatus: "ticketing.updateCriterionStatus",
  ticketingGetHistory: "ticketing.getHistory",
  ticketingListLabels: "ticketing.listLabels",
  ticketingCreateLabel: "ticketing.createLabel",
  ticketingUpdateLabel: "ticketing.updateLabel",
  ticketingDeleteLabel: "ticketing.deleteLabel",
  ticketingAddTicketLabel: "ticketing.addTicketLabel",
  ticketingRemoveTicketLabel: "ticketing.removeTicketLabel",
  ticketingListComments: "ticketing.listComments",
  ticketingCreateComment: "ticketing.createComment",
  ticketingUpdateComment: "ticketing.updateComment",
  ticketingDeleteComment: "ticketing.deleteComment",
  ticketingListArtifacts: "ticketing.listArtifacts",
  ticketingCreateArtifact: "ticketing.createArtifact",
  ticketingDeleteArtifact: "ticketing.deleteArtifact",

  // Streaming subscriptions
  subscribeOrchestrationDomainEvents: "subscribeOrchestrationDomainEvents",
  subscribeOrchestrationRunEvents: "subscribeOrchestrationRunEvents",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeManagedRunEvents: "subscribeManagedRunEvents",
  subscribeScheduledTaskEvents: "subscribeScheduledTaskEvents",
  subscribeTicketingEvents: "subscribeTicketingEvents",
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

export const WsServerResolveCodexProjectTrustRpc = Rpc.make(
  WS_METHODS.serverResolveCodexProjectTrust,
  {
    payload: ResolveCodexProjectTrustInput,
    success: ResolveCodexProjectTrustResult,
    error: ResolveCodexProjectTrustError,
  },
);

export const WsServerTrustCodexProjectRpc = Rpc.make(WS_METHODS.serverTrustCodexProject, {
  payload: TrustCodexProjectInput,
  success: TrustCodexProjectResult,
  error: TrustCodexProjectError,
});

export const WsServerResolveSkillsRpc = Rpc.make(WS_METHODS.serverResolveSkills, {
  payload: ResolveSkillsInput,
  success: ResolveSkillsResult,
  error: ResolveSkillsError,
});

export const EnhanceSystemPromptInput = Schema.Struct({
  projectId: ProjectId,
  currentPrompt: Schema.String,
});
export type EnhanceSystemPromptInput = typeof EnhanceSystemPromptInput.Type;

export const EnhanceSystemPromptResult = Schema.Struct({
  enhancedPrompt: Schema.String,
});
export type EnhanceSystemPromptResult = typeof EnhanceSystemPromptResult.Type;

export const WsProjectsEnhanceSystemPromptRpc = Rpc.make(WS_METHODS.projectsEnhanceSystemPrompt, {
  payload: EnhanceSystemPromptInput,
  success: EnhanceSystemPromptResult,
  error: TextGenerationError,
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

export const WsGitDiscoverReposRpc = Rpc.make(WS_METHODS.gitDiscoverRepos, {
  payload: GitDiscoverReposInput,
  success: GitDiscoverReposResult,
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

export const WsManagedRunsListInferenceRecordsRpc = Rpc.make(
  WS_METHODS.managedRunsListInferenceRecords,
  {
    payload: ManagedRunListInferenceRecordsInput,
    success: Schema.Array(ManagedRunInferenceRecordSummary),
    error: ManagedRunError,
  },
);

export const WsManagedRunsGetInferenceRecordRpc = Rpc.make(
  WS_METHODS.managedRunsGetInferenceRecord,
  {
    payload: ManagedRunGetInferenceRecordInput,
    success: ManagedRunInferenceRecordDetail,
    error: ManagedRunError,
  },
);

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

export const WsOrchestrationCreateRunRpc = Rpc.make(ORCHESTRATION_WS_METHODS.createRun, {
  payload: OrchestrationRpcSchemas.createRun.input,
  success: OrchestrationRpcSchemas.createRun.output,
  error: OrchestrationRunError,
});

export const WsOrchestrationGetRunRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getRun, {
  payload: OrchestrationRpcSchemas.getRun.input,
  success: OrchestrationRpcSchemas.getRun.output,
  error: OrchestrationRunError,
});

export const WsOrchestrationListRunsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.listRuns, {
  payload: OrchestrationRpcSchemas.listRuns.input,
  success: OrchestrationRpcSchemas.listRuns.output,
  error: OrchestrationRunError,
});

export const WsOrchestrationGetChildThreadsRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getChildThreads,
  {
    payload: OrchestrationRpcSchemas.getChildThreads.input,
    success: OrchestrationRpcSchemas.getChildThreads.output,
    error: OrchestrationRunError,
  },
);

export const WsOrchestrationPauseRunRpc = Rpc.make(ORCHESTRATION_WS_METHODS.pauseRun, {
  payload: OrchestrationRpcSchemas.pauseRun.input,
  success: OrchestrationRpcSchemas.pauseRun.output,
  error: OrchestrationRunError,
});

export const WsOrchestrationResumeRunRpc = Rpc.make(ORCHESTRATION_WS_METHODS.resumeRun, {
  payload: OrchestrationRpcSchemas.resumeRun.input,
  success: OrchestrationRpcSchemas.resumeRun.output,
  error: OrchestrationRunError,
});

export const WsOrchestrationCancelRunRpc = Rpc.make(ORCHESTRATION_WS_METHODS.cancelRun, {
  payload: OrchestrationRpcSchemas.cancelRun.input,
  success: OrchestrationRpcSchemas.cancelRun.output,
  error: OrchestrationRunError,
});

export const WsOrchestrationStartRunRpc = Rpc.make(ORCHESTRATION_WS_METHODS.startRun, {
  payload: OrchestrationRpcSchemas.startRun.input,
  success: OrchestrationRpcSchemas.startRun.output,
  error: OrchestrationRunError,
});

export const WsSubscribeOrchestrationDomainEventsRpc = Rpc.make(
  WS_METHODS.subscribeOrchestrationDomainEvents,
  {
    payload: Schema.Struct({
      fromSequenceExclusive: Schema.optional(NonNegativeInt),
    }),
    success: OrchestrationEvent,
    stream: true,
  },
);

export const WsSubscribeOrchestrationRunEventsRpc = Rpc.make(
  WS_METHODS.subscribeOrchestrationRunEvents,
  {
    payload: Schema.Struct({
      projectId: ProjectId,
    }),
    success: OrchestrationRunStreamEvent,
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

export const WsScheduledTasksListRpc = Rpc.make(WS_METHODS.scheduledTasksList, {
  payload: Schema.Struct({}),
  success: Schema.Array(ScheduledTask),
  error: ScheduledTaskError,
});

export const WsScheduledTasksGetRpc = Rpc.make(WS_METHODS.scheduledTasksGet, {
  payload: ScheduledTaskGetInput,
  success: ScheduledTask,
  error: ScheduledTaskError,
});

export const WsScheduledTasksCreateRpc = Rpc.make(WS_METHODS.scheduledTasksCreate, {
  payload: ScheduledTaskCreateInput,
  success: ScheduledTask,
  error: ScheduledTaskError,
});

export const WsScheduledTasksUpdateRpc = Rpc.make(WS_METHODS.scheduledTasksUpdate, {
  payload: ScheduledTaskUpdateInput,
  success: ScheduledTask,
  error: ScheduledTaskError,
});

export const WsScheduledTasksDeleteRpc = Rpc.make(WS_METHODS.scheduledTasksDelete, {
  payload: ScheduledTaskDeleteInput,
  error: ScheduledTaskError,
});

export const WsScheduledTasksToggleRpc = Rpc.make(WS_METHODS.scheduledTasksToggle, {
  payload: ScheduledTaskToggleInput,
  success: ScheduledTask,
  error: ScheduledTaskError,
});

export const WsScheduledTasksRunNowRpc = Rpc.make(WS_METHODS.scheduledTasksRunNow, {
  payload: ScheduledTaskRunNowInput,
  success: ScheduledTaskRun,
  error: ScheduledTaskError,
});

export const WsScheduledTasksListRunsRpc = Rpc.make(WS_METHODS.scheduledTasksListRuns, {
  payload: ScheduledTaskListRunsInput,
  success: Schema.Array(ScheduledTaskRun),
  error: ScheduledTaskError,
});

export const WsSubscribeScheduledTaskEventsRpc = Rpc.make(WS_METHODS.subscribeScheduledTaskEvents, {
  payload: Schema.Struct({}),
  success: ScheduledTaskStreamEvent,
  stream: true,
});

// Ticketing RPCs

export const WsTicketingListRpc = Rpc.make(WS_METHODS.ticketingList, {
  payload: TicketListInput,
  success: Schema.Array(TicketSummary),
  error: TicketingError,
});

export const WsTicketingGetByIdRpc = Rpc.make(WS_METHODS.ticketingGetById, {
  payload: TicketGetByIdInput,
  success: Ticket,
  error: TicketingError,
});

export const WsTicketingGetByIdentifierRpc = Rpc.make(WS_METHODS.ticketingGetByIdentifier, {
  payload: TicketGetByIdentifierInput,
  success: Ticket,
  error: TicketingError,
});

export const WsTicketingCreateRpc = Rpc.make(WS_METHODS.ticketingCreate, {
  payload: TicketCreateInput,
  success: Ticket,
  error: TicketingError,
});

export const WsTicketingUpdateRpc = Rpc.make(WS_METHODS.ticketingUpdate, {
  payload: TicketUpdateInput,
  success: Ticket,
  error: TicketingError,
});

export const WsTicketingDeleteRpc = Rpc.make(WS_METHODS.ticketingDelete, {
  payload: TicketDeleteInput,
  error: TicketingError,
});

export const WsTicketingReorderRpc = Rpc.make(WS_METHODS.ticketingReorder, {
  payload: TicketReorderInput,
  error: TicketingError,
});

export const WsTicketingSearchRpc = Rpc.make(WS_METHODS.ticketingSearch, {
  payload: TicketSearchInput,
  success: Schema.Array(TicketSummary),
  error: TicketingError,
});

export const WsTicketingGetTreeRpc = Rpc.make(WS_METHODS.ticketingGetTree, {
  payload: TicketTreeInput,
  success: Schema.Array(Schema.Struct({ ticket: TicketSummary })),
  error: TicketingError,
});

export const WsTicketingSetDependenciesRpc = Rpc.make(WS_METHODS.ticketingSetDependencies, {
  payload: SetDependenciesInput,
  error: TicketingError,
});

export const WsTicketingAddDependencyRpc = Rpc.make(WS_METHODS.ticketingAddDependency, {
  payload: DependencyInput,
  error: TicketingError,
});

export const WsTicketingRemoveDependencyRpc = Rpc.make(WS_METHODS.ticketingRemoveDependency, {
  payload: DependencyInput,
  error: TicketingError,
});

export const WsTicketingUpdateCriterionStatusRpc = Rpc.make(
  WS_METHODS.ticketingUpdateCriterionStatus,
  {
    payload: UpdateCriterionStatusInput,
    success: Ticket,
    error: TicketingError,
  },
);

export const WsTicketingGetHistoryRpc = Rpc.make(WS_METHODS.ticketingGetHistory, {
  payload: TicketHistoryInput,
  success: Schema.Array(TicketHistoryEntry),
  error: TicketingError,
});

export const WsTicketingListLabelsRpc = Rpc.make(WS_METHODS.ticketingListLabels, {
  payload: LabelListInput,
  success: Schema.Array(Label),
  error: TicketingError,
});

export const WsTicketingCreateLabelRpc = Rpc.make(WS_METHODS.ticketingCreateLabel, {
  payload: LabelCreateInput,
  success: Label,
  error: TicketingError,
});

export const WsTicketingUpdateLabelRpc = Rpc.make(WS_METHODS.ticketingUpdateLabel, {
  payload: LabelUpdateInput,
  success: Label,
  error: TicketingError,
});

export const WsTicketingDeleteLabelRpc = Rpc.make(WS_METHODS.ticketingDeleteLabel, {
  payload: LabelDeleteInput,
  error: TicketingError,
});

export const WsTicketingAddTicketLabelRpc = Rpc.make(WS_METHODS.ticketingAddTicketLabel, {
  payload: TicketLabelInput,
  error: TicketingError,
});

export const WsTicketingRemoveTicketLabelRpc = Rpc.make(WS_METHODS.ticketingRemoveTicketLabel, {
  payload: TicketLabelInput,
  error: TicketingError,
});

export const WsTicketingListCommentsRpc = Rpc.make(WS_METHODS.ticketingListComments, {
  payload: CommentListInput,
  success: Schema.Array(Comment),
  error: TicketingError,
});

export const WsTicketingCreateCommentRpc = Rpc.make(WS_METHODS.ticketingCreateComment, {
  payload: CommentCreateInput,
  success: Comment,
  error: TicketingError,
});

export const WsTicketingUpdateCommentRpc = Rpc.make(WS_METHODS.ticketingUpdateComment, {
  payload: CommentUpdateInput,
  success: Comment,
  error: TicketingError,
});

export const WsTicketingDeleteCommentRpc = Rpc.make(WS_METHODS.ticketingDeleteComment, {
  payload: CommentDeleteInput,
  error: TicketingError,
});

export const WsTicketingListArtifactsRpc = Rpc.make(WS_METHODS.ticketingListArtifacts, {
  payload: ArtifactListInput,
  success: Schema.Array(Artifact),
  error: TicketingError,
});

export const WsTicketingCreateArtifactRpc = Rpc.make(WS_METHODS.ticketingCreateArtifact, {
  payload: ArtifactCreateInput,
  success: Artifact,
  error: TicketingError,
});

export const WsTicketingDeleteArtifactRpc = Rpc.make(WS_METHODS.ticketingDeleteArtifact, {
  payload: ArtifactDeleteInput,
  error: TicketingError,
});

export const WsSubscribeTicketingEventsRpc = Rpc.make(WS_METHODS.subscribeTicketingEvents, {
  payload: Schema.Struct({}),
  success: TicketingStreamEvent,
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpsertKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerResolveMcpServersRpc,
  WsServerResolveCodexProjectTrustRpc,
  WsServerTrustCodexProjectRpc,
  WsServerResolveSkillsRpc,
  WsProjectsEnhanceSystemPromptRpc,
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
  WsManagedRunsListInferenceRecordsRpc,
  WsManagedRunsGetInferenceRecordRpc,
  WsManagedRunsStopRpc,
  WsGitDiscoverReposRpc,
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
  WsScheduledTasksListRpc,
  WsScheduledTasksGetRpc,
  WsScheduledTasksCreateRpc,
  WsScheduledTasksUpdateRpc,
  WsScheduledTasksDeleteRpc,
  WsScheduledTasksToggleRpc,
  WsScheduledTasksRunNowRpc,
  WsScheduledTasksListRunsRpc,
  WsSubscribeScheduledTaskEventsRpc,
  WsTicketingListRpc,
  WsTicketingGetByIdRpc,
  WsTicketingGetByIdentifierRpc,
  WsTicketingCreateRpc,
  WsTicketingUpdateRpc,
  WsTicketingDeleteRpc,
  WsTicketingReorderRpc,
  WsTicketingSearchRpc,
  WsTicketingGetTreeRpc,
  WsTicketingSetDependenciesRpc,
  WsTicketingAddDependencyRpc,
  WsTicketingRemoveDependencyRpc,
  WsTicketingUpdateCriterionStatusRpc,
  WsTicketingGetHistoryRpc,
  WsTicketingListLabelsRpc,
  WsTicketingCreateLabelRpc,
  WsTicketingUpdateLabelRpc,
  WsTicketingDeleteLabelRpc,
  WsTicketingAddTicketLabelRpc,
  WsTicketingRemoveTicketLabelRpc,
  WsTicketingListCommentsRpc,
  WsTicketingCreateCommentRpc,
  WsTicketingUpdateCommentRpc,
  WsTicketingDeleteCommentRpc,
  WsTicketingListArtifactsRpc,
  WsTicketingCreateArtifactRpc,
  WsTicketingDeleteArtifactRpc,
  WsSubscribeTicketingEventsRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationCreateRunRpc,
  WsOrchestrationGetRunRpc,
  WsOrchestrationListRunsRpc,
  WsOrchestrationGetChildThreadsRpc,
  WsOrchestrationPauseRunRpc,
  WsOrchestrationResumeRunRpc,
  WsOrchestrationCancelRunRpc,
  WsOrchestrationStartRunRpc,
  WsSubscribeOrchestrationRunEventsRpc,
);
