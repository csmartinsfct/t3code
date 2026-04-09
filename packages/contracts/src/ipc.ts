import type {
  GitCheckoutInput,
  GitCreateBranchInput,
  GitDiscoverReposInput,
  GitDiscoverReposResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPullInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitStatusInput,
  GitStatusResult,
} from "./git";
import type {
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import type { EnhanceSystemPromptInput, EnhanceSystemPromptResult } from "./rpc";
import type {
  ServerConfig,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingResult,
  ResolveMcpServersInput,
  ResolveMcpServersResult,
  ResolveCodexProjectTrustInput,
  ResolveCodexProjectTrustResult,
  ResolveSkillsInput,
  ResolveSkillsResult,
  TrustCodexProjectInput,
  TrustCodexProjectResult,
} from "./server";
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskDeleteInput,
  ScheduledTaskGetInput,
  ScheduledTaskListRunsInput,
  ScheduledTaskRunNowInput,
  ScheduledTaskStreamEvent,
  ScheduledTaskToggleInput,
  ScheduledTaskUpdateInput,
  ScheduledTaskRun,
} from "./scheduledTasks";
import type {
  Artifact,
  ArtifactCreateInput,
  ArtifactDeleteInput,
  ArtifactListInput,
  Comment,
  CommentCreateInput,
  CommentDeleteInput,
  CommentListInput,
  CommentUpdateInput,
  DependencyInput,
  Label,
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
  TicketingStreamEvent,
  TicketLabelInput,
  TicketListInput,
  TicketReorderInput,
  TicketSearchInput,
  TicketSummary,
  TicketTreeInput,
  TicketTreeNode,
  UpdateCriterionStatusInput,
} from "./ticketing";
import type {
  ManagedRunDetail,
  ManagedRunGetInferenceRecordInput,
  ManagedRunGetInput,
  ManagedRunGetLogsInput,
  ManagedRunInferenceRecordDetail,
  ManagedRunInferenceRecordSummary,
  ManagedRunLaunchProjectScriptInput,
  ManagedRunLaunchProjectScriptResult,
  ManagedRunListInferenceRecordsInput,
  ManagedRunListInput,
  ManagedRunLogLine,
  ManagedRunStreamEvent,
  ManagedRunStopInput,
  ManagedRunSummary,
} from "./managedRuns";
import type {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";
import type { ServerUpsertKeybindingInput } from "./server";
import type {
  ClientOrchestrationCommand,
  OrchestrationCreateRunInput,
  OrchestrationCreateRunResult,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "./orchestration";
import { EditorId } from "./editor";
import { ServerSettings, ServerSettingsPatch } from "./settings";

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  children?: readonly ContextMenuItem<T>[];
}

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
}

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export interface DesktopBridge {
  getWsUrl: () => string | null;
  pickFolder: () => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
}

export interface NativeApi {
  dialogs: {
    pickFolder: () => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  terminal: {
    open: (input: typeof TerminalOpenInput.Encoded) => Promise<TerminalSessionSnapshot>;
    write: (input: typeof TerminalWriteInput.Encoded) => Promise<void>;
    resize: (input: typeof TerminalResizeInput.Encoded) => Promise<void>;
    clear: (input: typeof TerminalClearInput.Encoded) => Promise<void>;
    restart: (input: typeof TerminalRestartInput.Encoded) => Promise<TerminalSessionSnapshot>;
    close: (input: typeof TerminalCloseInput.Encoded) => Promise<void>;
    onEvent: (callback: (event: TerminalEvent) => void) => () => void;
  };
  projects: {
    enhanceSystemPrompt: (input: EnhanceSystemPromptInput) => Promise<EnhanceSystemPromptResult>;
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
    listDirectory: (input: ProjectListDirectoryInput) => Promise<ProjectListDirectoryResult>;
    readFile: (input: ProjectReadFileInput) => Promise<ProjectReadFileResult>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
  };
  git: {
    // Existing branch/worktree API
    listBranches: (input: GitListBranchesInput) => Promise<GitListBranchesResult>;
    createWorktree: (input: GitCreateWorktreeInput) => Promise<GitCreateWorktreeResult>;
    removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>;
    createBranch: (input: GitCreateBranchInput) => Promise<void>;
    checkout: (input: GitCheckoutInput) => Promise<void>;
    init: (input: GitInitInput) => Promise<void>;
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
    // Stacked action API
    pull: (input: GitPullInput) => Promise<GitPullResult>;
    status: (input: GitStatusInput) => Promise<GitStatusResult>;
    discoverRepos: (input: GitDiscoverReposInput) => Promise<GitDiscoverReposResult>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  server: {
    getConfig: () => Promise<ServerConfig>;
    refreshProviders: () => Promise<ServerProviderUpdatedPayload>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
    getSettings: () => Promise<ServerSettings>;
    updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
    resolveMcpServers: (input: ResolveMcpServersInput) => Promise<ResolveMcpServersResult>;
    resolveCodexProjectTrust: (
      input: ResolveCodexProjectTrustInput,
    ) => Promise<ResolveCodexProjectTrustResult>;
    trustCodexProject: (input: TrustCodexProjectInput) => Promise<TrustCodexProjectResult>;
    resolveSkills: (input: ResolveSkillsInput) => Promise<ResolveSkillsResult>;
  };
  managedRuns: {
    launchProjectScript: (
      input: ManagedRunLaunchProjectScriptInput,
    ) => Promise<ManagedRunLaunchProjectScriptResult>;
    list: (input: ManagedRunListInput) => Promise<ReadonlyArray<ManagedRunSummary>>;
    get: (input: ManagedRunGetInput) => Promise<ManagedRunDetail>;
    getLogs: (input: ManagedRunGetLogsInput) => Promise<ReadonlyArray<ManagedRunLogLine>>;
    listInferenceRecords: (
      input: ManagedRunListInferenceRecordsInput,
    ) => Promise<ReadonlyArray<ManagedRunInferenceRecordSummary>>;
    getInferenceRecord: (
      input: ManagedRunGetInferenceRecordInput,
    ) => Promise<ManagedRunInferenceRecordDetail>;
    stop: (input: ManagedRunStopInput) => Promise<void>;
    onEvent: (projectId: string, callback: (event: ManagedRunStreamEvent) => void) => () => void;
  };
  scheduledTasks: {
    list: () => Promise<ReadonlyArray<ScheduledTask>>;
    get: (input: ScheduledTaskGetInput) => Promise<ScheduledTask>;
    create: (input: ScheduledTaskCreateInput) => Promise<ScheduledTask>;
    update: (input: ScheduledTaskUpdateInput) => Promise<ScheduledTask>;
    delete: (input: ScheduledTaskDeleteInput) => Promise<void>;
    toggle: (input: ScheduledTaskToggleInput) => Promise<ScheduledTask>;
    runNow: (input: ScheduledTaskRunNowInput) => Promise<ScheduledTaskRun>;
    listRuns: (input: ScheduledTaskListRunsInput) => Promise<ReadonlyArray<ScheduledTaskRun>>;
    onEvent: (callback: (event: ScheduledTaskStreamEvent) => void) => () => void;
  };
  ticketing: {
    list: (input: TicketListInput) => Promise<ReadonlyArray<TicketSummary>>;
    getById: (input: TicketGetByIdInput) => Promise<Ticket>;
    getByIdentifier: (input: TicketGetByIdentifierInput) => Promise<Ticket>;
    create: (input: TicketCreateInput) => Promise<Ticket>;
    update: (input: TicketUpdateInput) => Promise<Ticket>;
    delete: (input: TicketDeleteInput) => Promise<void>;
    reorder: (input: TicketReorderInput) => Promise<void>;
    search: (input: TicketSearchInput) => Promise<ReadonlyArray<TicketSummary>>;
    getTree: (input: TicketTreeInput) => Promise<ReadonlyArray<TicketTreeNode>>;
    setDependencies: (input: SetDependenciesInput) => Promise<void>;
    addDependency: (input: DependencyInput) => Promise<void>;
    removeDependency: (input: DependencyInput) => Promise<void>;
    updateCriterionStatus: (input: UpdateCriterionStatusInput) => Promise<Ticket>;
    getHistory: (input: TicketHistoryInput) => Promise<ReadonlyArray<TicketHistoryEntry>>;
    listLabels: (input: LabelListInput) => Promise<ReadonlyArray<Label>>;
    createLabel: (input: LabelCreateInput) => Promise<Label>;
    updateLabel: (input: LabelUpdateInput) => Promise<Label>;
    deleteLabel: (input: LabelDeleteInput) => Promise<void>;
    addTicketLabel: (input: TicketLabelInput) => Promise<void>;
    removeTicketLabel: (input: TicketLabelInput) => Promise<void>;
    listComments: (input: CommentListInput) => Promise<ReadonlyArray<Comment>>;
    createComment: (input: CommentCreateInput) => Promise<Comment>;
    updateComment: (input: CommentUpdateInput) => Promise<Comment>;
    deleteComment: (input: CommentDeleteInput) => Promise<void>;
    listArtifacts: (input: ArtifactListInput) => Promise<ReadonlyArray<Artifact>>;
    createArtifact: (input: ArtifactCreateInput) => Promise<Artifact>;
    deleteArtifact: (input: ArtifactDeleteInput) => Promise<void>;
    onEvent: (callback: (event: TicketingStreamEvent) => void) => () => void;
  };
  orchestration: {
    getSnapshot: () => Promise<OrchestrationReadModel>;
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    replayEvents: (fromSequenceExclusive: number) => Promise<OrchestrationEvent[]>;
    onDomainEvent: (callback: (event: OrchestrationEvent) => void) => () => void;
    createRun: (input: OrchestrationCreateRunInput) => Promise<OrchestrationCreateRunResult>;
  };
}
