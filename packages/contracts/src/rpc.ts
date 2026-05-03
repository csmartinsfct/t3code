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
  OrchestrationGetStartupSnapshotError,
  OrchestrationGetStartupSnapshotInput,
  OrchestrationListProjectsError,
  OrchestrationListProjectsInput,
  OrchestrationGetThreadContentError,
  OrchestrationGetThreadContentInput,
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
  ManagedRunLogStreamEvent,
  ManagedRunStopInput,
  ManagedRunStreamEvent,
  ManagedRunSubscribeLogsInput,
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
  ArtifactUpdateInput,
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
  TicketArchiveInput,
  TicketBodyEditInput,
  TicketBodyEditResult,
  TicketBodyGetInput,
  TicketBodyReadResult,
  TicketBodySearchInput,
  TicketBodySearchResult,
  TicketBodySectionsInput,
  TicketBodySectionsResult,
  TicketCreateInput,
  TicketCriteriaEditInput,
  TicketCriteriaListInput,
  TicketCriteriaListResult,
  TicketUpdateInput,
  TicketDeleteInput,
  TicketUnarchiveInput,
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
  TicketThreadLinks,
  TicketThreadLinksInput,
  TicketTreeInput,
  TicketTreeResultWire,
  UpdateCriterionStatusInput,
  Artifact,
  Comment,
  Label,
  Template,
  TemplateCreateInput,
  TemplateDeleteInput,
  TemplateGetInput,
  TemplateListInput,
  TemplateUpdateInput,
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
  ListPromptDefinitionsInput,
  ListPromptDefinitionsResult,
  PreviewPromptDocumentInput,
  PreviewPromptDocumentResult,
  PromptDocumentQueryInput,
  PromptDocumentState,
  PromptDocumentValidationResult,
  PromptManagementError,
  UpdatePromptDocumentInput,
  ValidatePromptDocumentInput,
} from "./promptManagement";
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
  ManageMcpServerInput,
  ManageMcpServerResult,
  ManageMcpServerError,
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

  // Prompt management methods
  promptsListDefinitions: "prompts.listDefinitions",
  promptsGetDocument: "prompts.getDocument",
  promptsValidateDocument: "prompts.validateDocument",
  promptsPreviewDocument: "prompts.previewDocument",
  promptsUpdateDocument: "prompts.updateDocument",

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
  serverManageMcpServer: "server.manageMcpServer",
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
  ticketingGetThreadLinks: "ticketing.getThreadLinks",
  ticketingGetBody: "ticketing.getBody",
  ticketingSearchBody: "ticketing.searchBody",
  ticketingGetBodySections: "ticketing.getBodySections",
  ticketingEditBody: "ticketing.editBody",
  ticketingListCriteria: "ticketing.listCriteria",
  ticketingEditCriteria: "ticketing.editCriteria",
  ticketingCreate: "ticketing.create",
  ticketingUpdate: "ticketing.update",
  ticketingDelete: "ticketing.delete",
  ticketingArchive: "ticketing.archive",
  ticketingUnarchive: "ticketing.unarchive",
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
  ticketingUpdateArtifact: "ticketing.updateArtifact",
  ticketingDeleteArtifact: "ticketing.deleteArtifact",
  ticketingListTemplates: "ticketing.listTemplates",
  ticketingGetTemplate: "ticketing.getTemplate",
  ticketingCreateTemplate: "ticketing.createTemplate",
  ticketingUpdateTemplate: "ticketing.updateTemplate",
  ticketingDeleteTemplate: "ticketing.deleteTemplate",

  // Streaming subscriptions
  subscribeOrchestrationDomainEvents: "subscribeOrchestrationDomainEvents",
  subscribeOrchestrationRunEvents: "subscribeOrchestrationRunEvents",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeManagedRunEvents: "subscribeManagedRunEvents",
  subscribeManagedRunLogs: "subscribeManagedRunLogs",
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

export const WsServerManageMcpServerRpc = Rpc.make(WS_METHODS.serverManageMcpServer, {
  payload: ManageMcpServerInput,
  success: ManageMcpServerResult,
  error: ManageMcpServerError,
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

export const WsPromptsListDefinitionsRpc = Rpc.make(WS_METHODS.promptsListDefinitions, {
  payload: ListPromptDefinitionsInput,
  success: ListPromptDefinitionsResult,
  error: PromptManagementError,
});

export const WsPromptsGetDocumentRpc = Rpc.make(WS_METHODS.promptsGetDocument, {
  payload: PromptDocumentQueryInput,
  success: PromptDocumentState,
  error: PromptManagementError,
});

export const WsPromptsValidateDocumentRpc = Rpc.make(WS_METHODS.promptsValidateDocument, {
  payload: ValidatePromptDocumentInput,
  success: PromptDocumentValidationResult,
  error: PromptManagementError,
});

export const WsPromptsPreviewDocumentRpc = Rpc.make(WS_METHODS.promptsPreviewDocument, {
  payload: PreviewPromptDocumentInput,
  success: PreviewPromptDocumentResult,
  error: PromptManagementError,
});

export const WsPromptsUpdateDocumentRpc = Rpc.make(WS_METHODS.promptsUpdateDocument, {
  payload: UpdatePromptDocumentInput,
  success: PromptDocumentState,
  error: PromptManagementError,
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

export const WsOrchestrationGetStartupSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getStartupSnapshot,
  {
    payload: OrchestrationGetStartupSnapshotInput,
    success: OrchestrationRpcSchemas.getStartupSnapshot.output,
    error: OrchestrationGetStartupSnapshotError,
  },
);

export const WsOrchestrationListProjectsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.listProjects, {
  payload: OrchestrationListProjectsInput,
  success: OrchestrationRpcSchemas.listProjects.output,
  error: OrchestrationListProjectsError,
});

export const WsOrchestrationGetThreadContentRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getThreadContent,
  {
    payload: OrchestrationGetThreadContentInput,
    success: OrchestrationRpcSchemas.getThreadContent.output,
    error: OrchestrationGetThreadContentError,
  },
);

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

export const WsOrchestrationGetChildThreadIdsRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getChildThreadIds,
  {
    payload: OrchestrationRpcSchemas.getChildThreadIds.input,
    success: OrchestrationRpcSchemas.getChildThreadIds.output,
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

export const WsSubscribeManagedRunLogsRpc = Rpc.make(WS_METHODS.subscribeManagedRunLogs, {
  payload: ManagedRunSubscribeLogsInput,
  success: ManagedRunLogStreamEvent,
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

export const WsTicketingGetThreadLinksRpc = Rpc.make(WS_METHODS.ticketingGetThreadLinks, {
  payload: TicketThreadLinksInput,
  success: TicketThreadLinks,
  error: TicketingError,
});

export const WsTicketingGetBodyRpc = Rpc.make(WS_METHODS.ticketingGetBody, {
  payload: TicketBodyGetInput,
  success: TicketBodyReadResult,
  error: TicketingError,
});

export const WsTicketingSearchBodyRpc = Rpc.make(WS_METHODS.ticketingSearchBody, {
  payload: TicketBodySearchInput,
  success: TicketBodySearchResult,
  error: TicketingError,
});

export const WsTicketingGetBodySectionsRpc = Rpc.make(WS_METHODS.ticketingGetBodySections, {
  payload: TicketBodySectionsInput,
  success: TicketBodySectionsResult,
  error: TicketingError,
});

export const WsTicketingEditBodyRpc = Rpc.make(WS_METHODS.ticketingEditBody, {
  payload: TicketBodyEditInput,
  success: TicketBodyEditResult,
  error: TicketingError,
});

export const WsTicketingListCriteriaRpc = Rpc.make(WS_METHODS.ticketingListCriteria, {
  payload: TicketCriteriaListInput,
  success: TicketCriteriaListResult,
  error: TicketingError,
});

export const WsTicketingEditCriteriaRpc = Rpc.make(WS_METHODS.ticketingEditCriteria, {
  payload: TicketCriteriaEditInput,
  success: TicketCriteriaListResult,
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

export const WsTicketingArchiveRpc = Rpc.make(WS_METHODS.ticketingArchive, {
  payload: TicketArchiveInput,
  success: Ticket,
  error: TicketingError,
});

export const WsTicketingUnarchiveRpc = Rpc.make(WS_METHODS.ticketingUnarchive, {
  payload: TicketUnarchiveInput,
  success: Ticket,
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
  success: TicketTreeResultWire,
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

export const WsTicketingUpdateArtifactRpc = Rpc.make(WS_METHODS.ticketingUpdateArtifact, {
  payload: ArtifactUpdateInput,
  success: Artifact,
  error: TicketingError,
});

export const WsTicketingDeleteArtifactRpc = Rpc.make(WS_METHODS.ticketingDeleteArtifact, {
  payload: ArtifactDeleteInput,
  error: TicketingError,
});

export const WsTicketingListTemplatesRpc = Rpc.make(WS_METHODS.ticketingListTemplates, {
  payload: TemplateListInput,
  success: Schema.Array(Template),
  error: TicketingError,
});

export const WsTicketingGetTemplateRpc = Rpc.make(WS_METHODS.ticketingGetTemplate, {
  payload: TemplateGetInput,
  success: Template,
  error: TicketingError,
});

export const WsTicketingCreateTemplateRpc = Rpc.make(WS_METHODS.ticketingCreateTemplate, {
  payload: TemplateCreateInput,
  success: Template,
  error: TicketingError,
});

export const WsTicketingUpdateTemplateRpc = Rpc.make(WS_METHODS.ticketingUpdateTemplate, {
  payload: TemplateUpdateInput,
  success: Template,
  error: TicketingError,
});

export const WsTicketingDeleteTemplateRpc = Rpc.make(WS_METHODS.ticketingDeleteTemplate, {
  payload: TemplateDeleteInput,
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
  WsServerManageMcpServerRpc,
  WsServerResolveCodexProjectTrustRpc,
  WsServerTrustCodexProjectRpc,
  WsServerResolveSkillsRpc,
  WsProjectsEnhanceSystemPromptRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsProjectsListDirectoryRpc,
  WsProjectsReadFileRpc,
  WsPromptsListDefinitionsRpc,
  WsPromptsGetDocumentRpc,
  WsPromptsValidateDocumentRpc,
  WsPromptsPreviewDocumentRpc,
  WsPromptsUpdateDocumentRpc,
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
  WsSubscribeManagedRunLogsRpc,
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
  WsTicketingGetThreadLinksRpc,
  WsTicketingGetBodyRpc,
  WsTicketingSearchBodyRpc,
  WsTicketingGetBodySectionsRpc,
  WsTicketingEditBodyRpc,
  WsTicketingListCriteriaRpc,
  WsTicketingEditCriteriaRpc,
  WsTicketingCreateRpc,
  WsTicketingUpdateRpc,
  WsTicketingDeleteRpc,
  WsTicketingArchiveRpc,
  WsTicketingUnarchiveRpc,
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
  WsTicketingUpdateArtifactRpc,
  WsTicketingDeleteArtifactRpc,
  WsTicketingListTemplatesRpc,
  WsTicketingGetTemplateRpc,
  WsTicketingCreateTemplateRpc,
  WsTicketingUpdateTemplateRpc,
  WsTicketingDeleteTemplateRpc,
  WsSubscribeTicketingEventsRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationGetStartupSnapshotRpc,
  WsOrchestrationListProjectsRpc,
  WsOrchestrationGetThreadContentRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationCreateRunRpc,
  WsOrchestrationGetRunRpc,
  WsOrchestrationListRunsRpc,
  WsOrchestrationGetChildThreadsRpc,
  WsOrchestrationGetChildThreadIdsRpc,
  WsOrchestrationPauseRunRpc,
  WsOrchestrationResumeRunRpc,
  WsOrchestrationCancelRunRpc,
  WsOrchestrationStartRunRpc,
  WsSubscribeOrchestrationRunEventsRpc,
);
