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
  ProjectEntry,
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import type {
  ListPromptDefinitionsInput,
  ListPromptDefinitionsResult,
  PreviewPromptDocumentInput,
  PreviewPromptDocumentResult,
  PromptDocumentQueryInput,
  PromptDocumentState,
  PromptDocumentValidationResult,
  UpdatePromptDocumentInput,
  ValidatePromptDocumentInput,
} from "./promptManagement";
import type { EnhanceSystemPromptInput, EnhanceSystemPromptResult } from "./rpc";
import type {
  ServerConfig,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingResult,
  ResolveMcpServersInput,
  ResolveMcpServersResult,
  ManageMcpServerInput,
  ManageMcpServerResult,
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
  ArtifactUpdateInput,
  Template,
  TemplateCreateInput,
  TemplateDeleteInput,
  TemplateGetInput,
  TemplateListInput,
  TemplateUpdateInput,
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
  TicketingStreamEvent,
  TicketLabelInput,
  TicketListInput,
  TicketReorderInput,
  TicketSearchInput,
  TicketThreadLinks,
  TicketThreadLinksInput,
  TicketSummary,
  TicketTreeInput,
  TicketTreeResult,
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
  ManagedRunLogStreamEvent,
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
  OrchestrationGetStartupSnapshotResult,
  OrchestrationGetThreadContentInput,
  OrchestrationGetThreadContentResult,
  OrchestrationGetRunInput,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationEvent,
  OrchestrationProject,
  OrchestrationListRunsInput,
  OrchestrationReadModel,
  OrchestrationRun,
  OrchestrationRunSummary,
  OrchestrationStartRunInput,
  ProviderKind,
} from "./orchestration";
import type { ProjectId, ThreadId } from "./baseSchemas";
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

export interface BrowserViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserTabSummary {
  id: number;
  url: string;
  title: string;
  favicon: string | null;
  active: boolean;
}

export interface BrowserTabListing {
  tabs: readonly BrowserTabSummary[];
  activeTabId: number;
}

// Per-tab device emulation parameters dispatched to the embedded browser via
// CDP `Emulation.setDeviceMetricsOverride` + `setTouchEmulationEnabled` +
// `setUserAgentOverride`. Passing `null` to `setViewport` clears all three.
// `scale` is the visual zoom applied to the rendered viewport (1 = 100%,
// 0.5 = 50%, etc.) — matches Chrome DevTools' zoom dropdown. See T3CO-423.
export interface ViewportEmulationParams {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly mobile: boolean;
  readonly userAgent: string;
  readonly scale: number;
}

export interface DesktopBrowserBridge {
  mount: (projectId: string, bounds: BrowserViewBounds) => Promise<string>;
  setBounds: (projectId: string, bounds: BrowserViewBounds) => Promise<void>;
  unmount: (projectId: string) => Promise<void>;
  suspendForModal: () => Promise<void>;
  resumeFromModal: () => Promise<void>;
  navigate: (projectId: string, url: string) => Promise<void>;
  goBack: (projectId: string) => Promise<void>;
  goForward: (projectId: string) => Promise<void>;
  reload: (projectId: string) => Promise<void>;
  getUrl: (projectId: string) => Promise<string>;
  listTabs: (projectId: string) => Promise<BrowserTabListing>;
  newTab: (projectId: string, url?: string) => Promise<number>;
  switchTab: (projectId: string, tabId: number) => Promise<void>;
  closeTab: (projectId: string, tabId: number) => Promise<number>;
  setViewport: (
    projectId: string,
    tabId: number,
    params: ViewportEmulationParams | null,
  ) => Promise<void>;
  popoutOpen: (projectId: string) => Promise<void>;
  popoutClose: (projectId: string) => Promise<void>;
  onTabsChanged: (
    listener: (payload: {
      projectId: string;
      tabs: readonly BrowserTabSummary[];
      activeTabId: number;
    }) => void,
  ) => () => void;
  onPopoutStateChanged: (
    listener: (payload: { projectId: string; isOpen: boolean }) => void,
  ) => () => void;
}

// ---------------------------------------------------------------------------
// Overlay view types — used by the native-overlay-views system that renders
// menus, selects, and other floating UI in a transparent WebContentsView
// positioned above the embedded Chromium browser.
// ---------------------------------------------------------------------------

export interface OverlayAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayMenuItem {
  id: string;
  label: string;
  icon?: string | undefined;
  iconClassName?: string | undefined;
  description?: string | undefined;
  badge?: string | undefined;
  statusTone?: "success" | "warning" | "danger" | "muted" | undefined;
  shortcut?: string | undefined;
  disabled?: boolean | undefined;
  selectDisabled?: boolean | undefined;
  destructive?: boolean | undefined;
  separator?: boolean | undefined;
  labelOnly?: boolean | undefined;
  checked?: boolean | undefined;
  actions?: OverlayMenuAction[] | undefined;
  secondaryAction?: OverlayMenuAction | undefined;
  children?: OverlayMenuItem[] | undefined;
}

export interface OverlayMenuAction {
  id: string;
  label?: string | undefined;
  ariaLabel?: string | undefined;
  icon?: string | undefined;
  iconClassName?: string | undefined;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  /** Defaults to false so menu-local buttons can behave like DOM buttons that
   * stop propagation and keep the menu open while the host refreshes state. */
  dismissOnAction?: boolean | undefined;
}

export interface OverlaySelectItem {
  value: string;
  label: string;
  icon?: string | undefined;
  iconClassName?: string | undefined;
  disabled?: boolean;
  separator?: boolean;
  hideIndicator?: boolean;
}

export interface OverlayComboboxItem {
  value: string;
  label: string;
  description?: string | undefined;
  badge?: string | undefined;
  disabled?: boolean;
}

export interface OverlayImageItem {
  src: string;
  name: string;
}

export interface OverlayContextMenuMessage {
  type: "context-menu";
  anchor: OverlayAnchorRect;
  items: readonly OverlayMenuItem[];
}

export interface OverlayMenuMessage {
  type: "menu";
  anchor: OverlayAnchorRect;
  items: readonly OverlayMenuItem[];
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}

export interface OverlaySelectMessage {
  type: "select";
  anchor: OverlayAnchorRect;
  items: readonly OverlaySelectItem[];
  value: string;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  alignItemWithTrigger?: boolean;
}

export interface OverlayComboboxMessage {
  type: "combobox";
  anchor: OverlayAnchorRect;
  items: readonly OverlayComboboxItem[];
  value: string;
  inputValue: string;
  multiple: boolean;
  selectedValues?: string[];
  placeholder?: string | undefined;
  emptyText?: string | undefined;
  statusText?: string | undefined;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
}

export interface OverlayAutocompleteMessage {
  type: "autocomplete";
  anchor: OverlayAnchorRect;
  items: readonly OverlayComboboxItem[];
  value: string;
  placeholder?: string | undefined;
  emptyText?: string | undefined;
  statusText?: string | undefined;
  inputSize?: "sm" | "default" | "lg" | undefined;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
}

export type OverlayComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: "model" | "plan" | "plan-accept" | "default";
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "model";
      provider: ProviderKind;
      model: string;
      label: string;
      description: string;
    };

export interface OverlayComposerCommandMessage {
  type: "composer-command";
  anchor: OverlayAnchorRect;
  items: readonly OverlayComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: "path" | "slash-command" | "slash-model" | null;
  activeItemId: string | null;
}

export interface OverlayAlertDialogMessage {
  type: "alert-dialog";
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface OverlayImagePreviewMessage {
  type: "image-preview";
  images: OverlayImageItem[];
  initialIndex: number;
}

export interface OverlayRouteContext {
  projectId?: ProjectId | undefined;
  threadId?: ThreadId | undefined;
  cwd?: string | undefined;
}

export type OverlayRoutePresentation =
  | {
      kind: "dialog" | "alert-dialog" | "command-dialog";
    }
  | {
      kind: "sheet";
      side: "left" | "right" | "top" | "bottom";
    }
  | {
      kind: "popover" | "menu";
      anchor: OverlayAnchorRect;
      side?: "top" | "bottom" | "left" | "right" | undefined;
      align?: "start" | "center" | "end" | undefined;
      interaction?: "click" | "hover" | undefined;
    };

export interface OverlayRouteMessage {
  type: "route";
  routeKey: string;
  params: Record<string, unknown>;
  context?: OverlayRouteContext | undefined;
  presentation: OverlayRoutePresentation;
}

// Legacy Phase 2 placeholders. New arbitrary-content work should prefer the
// generic `route` message so all routed overlays share one lifecycle/result
// protocol, regardless of whether they present as a dialog, sheet, command
// dialog, popover, or rich menu.
export interface OverlayDialogMessage {
  type: "dialog";
  dialogKey: string;
  params: Record<string, unknown>;
}

export interface OverlaySheetMessage {
  type: "sheet";
  side: "left" | "right" | "top" | "bottom";
  sheetKey: string;
  params: Record<string, unknown>;
}

export interface OverlayCommandMessage {
  type: "command";
  commandKey: string;
  params: Record<string, unknown>;
}

export type OverlayRenderMessage =
  | OverlayContextMenuMessage
  | OverlayMenuMessage
  | OverlaySelectMessage
  | OverlayComboboxMessage
  | OverlayAutocompleteMessage
  | OverlayComposerCommandMessage
  | OverlayAlertDialogMessage
  | OverlayImagePreviewMessage
  | OverlayRouteMessage
  | OverlayDialogMessage
  | OverlaySheetMessage
  | OverlayCommandMessage;

export interface DesktopOverlayBridge {
  acquire(): Promise<string>;
  release(id: string): Promise<void>;
  render(id: string, message: OverlayRenderMessage): Promise<void>;
  onEvent(id: string, handler: (type: string, payload: unknown) => void): () => void;
  onDismiss(id: string, handler: () => void): () => void;
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
  browser: DesktopBrowserBridge;
  overlay: DesktopOverlayBridge;
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
  prompts: {
    listDefinitions: (input: ListPromptDefinitionsInput) => Promise<ListPromptDefinitionsResult>;
    getDocument: (input: PromptDocumentQueryInput) => Promise<PromptDocumentState>;
    validateDocument: (
      input: ValidatePromptDocumentInput,
    ) => Promise<PromptDocumentValidationResult>;
    previewDocument: (input: PreviewPromptDocumentInput) => Promise<PreviewPromptDocumentResult>;
    updateDocument: (input: UpdatePromptDocumentInput) => Promise<PromptDocumentState>;
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
    manageMcpServer: (input: ManageMcpServerInput) => Promise<ManageMcpServerResult>;
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
    subscribeLogs: (
      input: { readonly runId: string; readonly serviceId?: string },
      callback: (event: ManagedRunLogStreamEvent) => void,
    ) => () => void;
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
    getThreadLinks: (input: TicketThreadLinksInput) => Promise<TicketThreadLinks>;
    getBody: (input: TicketBodyGetInput) => Promise<TicketBodyReadResult>;
    searchBody: (input: TicketBodySearchInput) => Promise<TicketBodySearchResult>;
    getBodySections: (input: TicketBodySectionsInput) => Promise<TicketBodySectionsResult>;
    editBody: (input: TicketBodyEditInput) => Promise<TicketBodyEditResult>;
    listCriteria: (input: TicketCriteriaListInput) => Promise<TicketCriteriaListResult>;
    editCriteria: (input: TicketCriteriaEditInput) => Promise<TicketCriteriaListResult>;
    create: (input: TicketCreateInput) => Promise<Ticket>;
    update: (input: TicketUpdateInput) => Promise<Ticket>;
    delete: (input: TicketDeleteInput) => Promise<void>;
    archive: (input: TicketArchiveInput) => Promise<Ticket>;
    unarchive: (input: TicketUnarchiveInput) => Promise<Ticket>;
    reorder: (input: TicketReorderInput) => Promise<void>;
    search: (input: TicketSearchInput) => Promise<ReadonlyArray<TicketSummary>>;
    getTree: (input: TicketTreeInput) => Promise<TicketTreeResult>;
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
    updateArtifact: (input: ArtifactUpdateInput) => Promise<Artifact>;
    deleteArtifact: (input: ArtifactDeleteInput) => Promise<void>;
    listTemplates: (input: TemplateListInput) => Promise<ReadonlyArray<Template>>;
    getTemplate: (input: TemplateGetInput) => Promise<Template>;
    createTemplate: (input: TemplateCreateInput) => Promise<Template>;
    updateTemplate: (input: TemplateUpdateInput) => Promise<Template>;
    deleteTemplate: (input: TemplateDeleteInput) => Promise<void>;
    onEvent: (callback: (event: TicketingStreamEvent) => void) => () => void;
  };
  orchestration: {
    getSnapshot: () => Promise<OrchestrationReadModel>;
    getStartupSnapshot: () => Promise<OrchestrationGetStartupSnapshotResult>;
    listProjects: () => Promise<OrchestrationProject[]>;
    getThreadContent: (
      input: OrchestrationGetThreadContentInput,
    ) => Promise<OrchestrationGetThreadContentResult>;
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    replayEvents: (fromSequenceExclusive: number) => Promise<OrchestrationEvent[]>;
    onDomainEvent: (callback: (event: OrchestrationEvent) => void) => () => void;
    createRun: (input: OrchestrationCreateRunInput) => Promise<OrchestrationCreateRunResult>;
    startRun: (input: OrchestrationStartRunInput) => Promise<OrchestrationRun>;
    listRuns: (input: OrchestrationListRunsInput) => Promise<OrchestrationRunSummary[]>;
    getRun: (input: OrchestrationGetRunInput) => Promise<OrchestrationRun>;
  };
}
