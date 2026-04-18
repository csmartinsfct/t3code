import { Option, Schema, SchemaIssue, Struct } from "effect";
import { ClaudeModelOptions, CodexModelOptions, GeminiModelOptions } from "./model";
import {
  OrchestrationPromptId,
  OrchestrationPromptOverrides,
  OrchestrationPromptOverridesPatch,
} from "./promptTemplates";
import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationRunId,
  PositiveInt,
  ProjectId,
  ProviderItemId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas";
import { TicketId } from "./ticketing";

export const ORCHESTRATION_WS_METHODS = {
  getSnapshot: "orchestration.getSnapshot",
  getStartupSnapshot: "orchestration.getStartupSnapshot",
  getThreadContent: "orchestration.getThreadContent",
  dispatchCommand: "orchestration.dispatchCommand",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  replayEvents: "orchestration.replayEvents",
  createRun: "orchestration.createRun",
  getRun: "orchestration.getRun",
  listRuns: "orchestration.listRuns",
  getChildThreads: "orchestration.getChildThreads",
  getChildThreadIds: "orchestration.getChildThreadIds",
  pauseRun: "orchestration.pauseRun",
  resumeRun: "orchestration.resumeRun",
  cancelRun: "orchestration.cancelRun",
  startRun: "orchestration.startRun",
} as const;

export const BASE_PROVIDER_KINDS = ["codex", "claudeAgent", "gemini"] as const;
export type BaseProviderKind = (typeof BASE_PROVIDER_KINDS)[number];
export const BaseProviderKind = Schema.Literals(BASE_PROVIDER_KINDS);

/**
 * Runtime Schema that validates profiled provider kinds like "claudeAgent:zbd".
 *
 * IMPORTANT: The runtime regex accepts profiled variants ("claudeAgent:zbd"),
 * but the TS type is narrowed to base kinds for struct-field compatibility.
 * Use {@link asProviderInput} at call sites that need to pass profiled kinds
 * through schema-validated boundaries.
 */
export const ProviderKind = Schema.String.check(
  Schema.isPattern(/^(codex|claudeAgent|gemini)(:[a-zA-Z0-9_-]+)?$/),
) as unknown as typeof BaseProviderKind;
export type ProviderKind =
  | BaseProviderKind
  | `codex:${string}`
  | `claudeAgent:${string}`
  | `gemini:${string}`;

/**
 * Safely narrow a full ProviderKind (possibly profiled) for use as a
 * schema-validated provider input field. The runtime schema accepts profiled
 * kinds; this is a compile-time bridge to satisfy the narrow TS type.
 */
export function asProviderInput(kind: ProviderKind): BaseProviderKind {
  return kind as BaseProviderKind;
}

/** Extract the base provider kind from a (possibly profiled) ProviderKind. */
export function baseProviderKind(kind: ProviderKind): BaseProviderKind {
  const idx = kind.indexOf(":");
  return (idx === -1 ? kind : kind.slice(0, idx)) as BaseProviderKind;
}

/** Extract the profile id suffix, if any. */
export function providerProfileId(kind: ProviderKind): string | undefined {
  const idx = kind.indexOf(":");
  return idx === -1 ? undefined : kind.slice(idx + 1);
}

/** Construct a ProviderKind from a base kind and optional profile id. */
export function makeProviderKind(base: BaseProviderKind, profileId?: string): ProviderKind {
  return profileId ? `${base}:${profileId}` : base;
}

/** Type guard for ProviderKind (accepts profiled variants). */
export function isValidProviderKind(value: string): value is ProviderKind {
  return (
    value === "codex" ||
    value === "claudeAgent" ||
    value === "gemini" ||
    value.startsWith("codex:") ||
    value.startsWith("claudeAgent:") ||
    value.startsWith("gemini:")
  );
}

export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;
export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

export const DEFAULT_PROVIDER_KIND: BaseProviderKind = "codex";

export const CodexModelSelection = Schema.Struct({
  provider: Schema.Literal("codex"),
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(CodexModelOptions),
});
export type CodexModelSelection = typeof CodexModelSelection.Type;

export const ClaudeModelSelection = Schema.Struct({
  provider: Schema.Literal("claudeAgent"),
  profileId: Schema.optionalKey(Schema.String),
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ClaudeModelOptions),
});
export type ClaudeModelSelection = typeof ClaudeModelSelection.Type;

export const GeminiModelSelection = Schema.Struct({
  provider: Schema.Literal("gemini"),
  profileId: Schema.optionalKey(Schema.String),
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(GeminiModelOptions),
});
export type GeminiModelSelection = typeof GeminiModelSelection.Type;

export const ModelSelection = Schema.Union([
  CodexModelSelection,
  ClaudeModelSelection,
  GeminiModelSelection,
]);
export type ModelSelection = typeof ModelSelection.Type;

/** Get the full ProviderKind (including profile) from a ModelSelection. */
export function modelSelectionProviderKind(sel: ModelSelection): ProviderKind {
  if (
    (sel.provider === "claudeAgent" || sel.provider === "gemini") &&
    "profileId" in sel &&
    sel.profileId
  ) {
    return makeProviderKind(sel.provider, sel.profileId);
  }
  return sel.provider;
}

export const RuntimeMode = Schema.Literals(["approval-required", "full-access"]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
export const ProviderInteractionMode = Schema.Literals(["default", "plan", "plan-accept"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";
export const ProviderRequestKind = Schema.Literals(["command", "file-read", "file-change"]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;
export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;
export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;
export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
// Correlation id is command id by design in this model.
export const CorrelationId = CommandId;
export type CorrelationId = typeof CorrelationId.Type;

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const ChatAttachment = Schema.Union([ChatImageAttachment]);
export type ChatAttachment = typeof ChatAttachment.Type;
const UploadChatAttachment = Schema.Union([UploadChatImageAttachment]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ServiceHealthCheck = Schema.Union([
  Schema.Struct({ type: Schema.Literal("url"), url: TrimmedNonEmptyString }),
  Schema.Struct({ type: Schema.Literal("docker"), container: TrimmedNonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("port"),
    port: Schema.Int.check(Schema.isGreaterThan(0)).check(Schema.isLessThanOrEqualTo(65_535)),
    host: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    type: Schema.Literal("command"),
    command: TrimmedNonEmptyString,
    cwd: Schema.optional(TrimmedNonEmptyString),
  }),
]);
export type ServiceHealthCheck = typeof ServiceHealthCheck.Type;

export const DeclaredService = Schema.Struct({
  name: TrimmedNonEmptyString,
  healthCheck: ServiceHealthCheck,
});
export type DeclaredService = typeof DeclaredService.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
  services: Schema.optional(Schema.Array(DeclaredService)),
});
export type ProjectScript = typeof ProjectScript.Type;

export const ProjectPromptOverrides = Schema.Struct({
  orchestration: OrchestrationPromptOverrides.pipe(Schema.withDecodingDefault(() => ({}))),
}).pipe(Schema.withDecodingDefault(() => ({})));
export type ProjectPromptOverrides = typeof ProjectPromptOverrides.Type;

export const ProjectPromptOverridesPatch = Schema.Struct({
  orchestration: Schema.optionalKey(OrchestrationPromptOverridesPatch),
}).pipe(Schema.withDecodingDefault(() => ({})));
export type ProjectPromptOverridesPatch = typeof ProjectPromptOverridesPatch.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  systemPrompt: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  promptOverrides: ProjectPromptOverrides.pipe(Schema.withDecodingDefault(() => ({}))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system"]);
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type;

export const OrchestrationPromptMessagePhase = Schema.Literals(["working", "reviewing"]);
export type OrchestrationPromptMessagePhase = typeof OrchestrationPromptMessagePhase.Type;

export const OrchestrationPromptDispatchMode = Schema.Literals([
  "start",
  "resume",
  "resumeFreshAgent",
  "feedback",
  "review",
  "reReview",
]);
export type OrchestrationPromptDispatchMode = typeof OrchestrationPromptDispatchMode.Type;

export const OrchestrationPromptMessageOrigin = Schema.Struct({
  kind: Schema.Literal("orchestration-prompt"),
  promptId: OrchestrationPromptId,
  phase: OrchestrationPromptMessagePhase,
  dispatchMode: OrchestrationPromptDispatchMode,
});
export type OrchestrationPromptMessageOrigin = typeof OrchestrationPromptMessageOrigin.Type;

export const OrchestrationMessageMetadata = Schema.Struct({
  origin: Schema.optionalKey(OrchestrationPromptMessageOrigin),
});
export type OrchestrationMessageMetadata = typeof OrchestrationMessageMetadata.Type;

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  metadata: Schema.optionalKey(OrchestrationMessageMetadata),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationMessage = typeof OrchestrationMessage.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});

export const OrchestrationSessionStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type;

export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type OrchestrationSession = typeof OrchestrationSession.Type;

export const OrchestrationCheckpointFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  repoRelativePath: Schema.optionalKey(TrimmedNonEmptyString),
});
export type OrchestrationCheckpointFile = typeof OrchestrationCheckpointFile.Type;

export const OrchestrationCheckpointStatus = Schema.Literals(["ready", "missing", "error"]);
export type OrchestrationCheckpointStatus = typeof OrchestrationCheckpointStatus.Type;

export const OrchestrationCheckpointSummary = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type OrchestrationCheckpointSummary = typeof OrchestrationCheckpointSummary.Type;

export const OrchestrationThreadActivityTone = Schema.Literals([
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type;

export const OrchestrationThreadActivity = Schema.Struct({
  id: EventId,
  tone: OrchestrationThreadActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type;

const OrchestrationLatestTurnState = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
});
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type;

export const ThreadInitialDraft = Schema.Struct({
  prompt: Schema.optional(Schema.String),
  skillIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  autoSend: Schema.optional(Schema.Boolean),
});
export type ThreadInitialDraft = typeof ThreadInitialDraft.Type;

export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  parentThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(() => null)),
  isOrchestrationThread: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  ticketId: Schema.NullOr(TicketId).pipe(Schema.withDecodingDefault(() => null)),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  initialDraft: Schema.optional(ThreadInitialDraft),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(Schema.withDecodingDefault(() => [])),
  activities: Schema.Array(OrchestrationThreadActivity),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  session: Schema.NullOr(OrchestrationSession),
});
export type OrchestrationThread = typeof OrchestrationThread.Type;

export const OrchestrationActionablePlanState = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationActionablePlanState = typeof OrchestrationActionablePlanState.Type;

export const OrchestrationLatestUserActivity = Schema.Struct({
  messageId: MessageId,
  createdAt: IsoDateTime,
});
export type OrchestrationLatestUserActivity = typeof OrchestrationLatestUserActivity.Type;

export const OrchestrationThreadMetadata = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  parentThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(() => null)),
  isOrchestrationThread: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  ticketId: Schema.NullOr(TicketId).pipe(Schema.withDecodingDefault(() => null)),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  latestTurnStatus: Schema.NullOr(OrchestrationLatestTurnState),
  latestSessionStatus: Schema.NullOr(OrchestrationSessionStatus),
  session: Schema.NullOr(OrchestrationSession),
  latestUserActivity: Schema.NullOr(OrchestrationLatestUserActivity),
  pendingApprovalCount: NonNegativeInt,
  pendingUserInputCount: NonNegativeInt,
  actionablePlanState: Schema.NullOr(OrchestrationActionablePlanState),
  lastActivitySummary: Schema.NullOr(Schema.String),
  initialDraft: Schema.optional(ThreadInitialDraft),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationThreadMetadata = typeof OrchestrationThreadMetadata.Type;

export const OrchestrationThreadContent = Schema.Struct({
  threadId: ThreadId,
  sequence: NonNegativeInt,
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan),
  activities: Schema.Array(OrchestrationThreadActivity),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
});
export type OrchestrationThreadContent = typeof OrchestrationThreadContent.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationStartupSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThreadMetadata),
  updatedAt: IsoDateTime,
});
export type OrchestrationStartupSnapshot = typeof OrchestrationStartupSnapshot.Type;

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  createdAt: IsoDateTime,
});

const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  systemPrompt: Schema.optional(Schema.NullOr(Schema.String)),
  promptOverrides: Schema.optional(ProjectPromptOverridesPatch),
});

const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
});

const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.create"),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  isOrchestrationThread: Schema.optional(Schema.Boolean),
  ticketId: Schema.optional(Schema.NullOr(TicketId)),
  initialDraft: Schema.optional(ThreadInitialDraft),
  createdAt: IsoDateTime,
});

const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadMessagesDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.messages.delete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageIds: Schema.Array(MessageId),
});

const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.unarchive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.meta.update"),
  commandId: CommandId,
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

const ThreadMoveCommand = Schema.Struct({
  type: Schema.Literal("thread.move"),
  commandId: CommandId,
  threadId: ThreadId,
  targetProjectId: ProjectId,
});

const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.runtime-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

const ThreadInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.interaction-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
    metadata: Schema.optionalKey(OrchestrationMessageMetadata),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(UploadChatAttachment),
    metadata: Schema.optionalKey(OrchestrationMessageMetadata),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.interrupt"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.approval.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.user-input.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

const ThreadCheckpointRevertCommand = Schema.Struct({
  type: Schema.Literal("thread.checkpoint.revert"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal("thread.session.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

const ThreadForkCommand = Schema.Struct({
  type: Schema.Literal("thread.fork"),
  commandId: CommandId,
  threadId: ThreadId,
  sourceThreadId: ThreadId,
  modelSelection: ModelSelection,
  createdAt: IsoDateTime,
});

const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadMessagesDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadMoveCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  ThreadForkCommand,
]);
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadMessagesDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadMoveCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  ThreadForkCommand,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.delta"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.diff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.revert.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadRevertCompleteCommand,
]);
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "thread.created",
  "thread.deleted",
  "thread.messages-deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.meta-updated",
  "thread.moved",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.turn-start-requested",
  "thread.turn-interrupt-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals(["project", "thread"]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  systemPrompt: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  promptOverrides: ProjectPromptOverrides.pipe(Schema.withDecodingDefault(() => ({}))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  systemPrompt: Schema.optional(Schema.NullOr(Schema.String)),
  promptOverrides: Schema.optional(ProjectPromptOverrides),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  isOrchestrationThread: Schema.optional(Schema.Boolean),
  ticketId: Schema.optional(Schema.NullOr(TicketId)),
  sourceThreadId: Schema.optional(ThreadId),
  initialDraft: Schema.optional(ThreadInitialDraft),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadMessagesDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  messageIds: Schema.Array(MessageId),
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: IsoDateTime,
});

export const ThreadMovedPayload = Schema.Struct({
  threadId: ThreadId,
  sourceProjectId: ProjectId,
  targetProjectId: ProjectId,
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  metadata: Schema.optionalKey(OrchestrationMessageMetadata),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
});

export const ThreadTurnDiffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
});

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([ProjectId, ThreadId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.created"),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.deleted"),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.messages-deleted"),
    payload: ThreadMessagesDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.archived"),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unarchived"),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.meta-updated"),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.moved"),
    payload: ThreadMovedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.runtime-mode-set"),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.interaction-mode-set"),
    payload: ThreadInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-sent"),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-start-requested"),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-interrupt-requested"),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.approval-response-requested"),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.user-input-response-requested"),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.checkpoint-revert-requested"),
    payload: ThreadCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.reverted"),
    payload: ThreadRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-stop-requested"),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-set"),
    payload: ThreadSessionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.proposed-plan-upserted"),
    payload: ThreadProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-diff-completed"),
    payload: ThreadTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.activity-appended"),
    payload: ThreadActivityAppendedPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

export const TurnCountRange = Schema.Struct({
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (input) =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), {
        message: "fromTurnCount must be less than or equal to toTurnCount",
      }),
    { identifier: "OrchestrationTurnDiffRange" },
  ),
);

export const RepoTurnDiff = Schema.Struct({
  repoRoot: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  diff: Schema.String,
});
export type RepoTurnDiff = typeof RepoTurnDiff.Type;

export const ThreadTurnDiff = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    diff: Schema.String,
    repoDiffs: Schema.optionalKey(Schema.Array(RepoTurnDiff)),
  }),
  { unsafePreserveChecks: true },
);

export const ProviderSessionRuntimeStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "error",
]);
export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type;

const ProjectionThreadTurnStatus = Schema.Literals([
  "running",
  "completed",
  "interrupted",
  "error",
]);
export type ProjectionThreadTurnStatus = typeof ProjectionThreadTurnStatus.Type;

const ProjectionCheckpointRow = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type;

export const ProjectionPendingApprovalStatus = Schema.Literals(["pending", "resolved"]);
export type ProjectionPendingApprovalStatus = typeof ProjectionPendingApprovalStatus.Type;

export const ProjectionPendingApprovalDecision = Schema.NullOr(ProviderApprovalDecision);
export type ProjectionPendingApprovalDecision = typeof ProjectionPendingApprovalDecision.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationGetSnapshotInput = Schema.Struct({});
export type OrchestrationGetSnapshotInput = typeof OrchestrationGetSnapshotInput.Type;
const OrchestrationGetSnapshotResult = OrchestrationReadModel;
export type OrchestrationGetSnapshotResult = typeof OrchestrationGetSnapshotResult.Type;

export const OrchestrationGetStartupSnapshotInput = Schema.Struct({});
export type OrchestrationGetStartupSnapshotInput = typeof OrchestrationGetStartupSnapshotInput.Type;
const OrchestrationGetStartupSnapshotResult = OrchestrationStartupSnapshot;
export type OrchestrationGetStartupSnapshotResult =
  typeof OrchestrationGetStartupSnapshotResult.Type;

export const OrchestrationGetThreadContentInput = Schema.Struct({
  threadId: ThreadId,
});
export type OrchestrationGetThreadContentInput = typeof OrchestrationGetThreadContentInput.Type;
const OrchestrationGetThreadContentResult = OrchestrationThreadContent;
export type OrchestrationGetThreadContentResult = typeof OrchestrationGetThreadContentResult.Type;

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({ threadId: ThreadId }),
  { unsafePreserveChecks: true },
);
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff;
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
});
export type OrchestrationGetFullThreadDiffInput = typeof OrchestrationGetFullThreadDiffInput.Type;

export const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff;
export type OrchestrationGetFullThreadDiffResult = typeof OrchestrationGetFullThreadDiffResult.Type;

export const OrchestrationReplayEventsInput = Schema.Struct({
  fromSequenceExclusive: NonNegativeInt,
});
export type OrchestrationReplayEventsInput = typeof OrchestrationReplayEventsInput.Type;

const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent);
export type OrchestrationReplayEventsResult = typeof OrchestrationReplayEventsResult.Type;

// ---------------------------------------------------------------------------
// Automated Review
// ---------------------------------------------------------------------------

export const ReviewCommentSeverity = Schema.Literals(["critical", "suggestion", "nit"]);
export type ReviewCommentSeverity = typeof ReviewCommentSeverity.Type;

export const ReviewComment = Schema.Struct({
  file: Schema.NullOr(Schema.String),
  line: Schema.NullOr(PositiveInt),
  severity: ReviewCommentSeverity,
  body: Schema.String,
});
export type ReviewComment = typeof ReviewComment.Type;

export const ReviewOutput = Schema.Struct({
  changesNeeded: Schema.Boolean,
  summary: Schema.String,
  comments: Schema.Array(ReviewComment),
});
export type ReviewOutput = typeof ReviewOutput.Type;

export const ReviewResult = Schema.Struct({
  ticketIdentifier: TrimmedNonEmptyString,
  reviewThreadId: ThreadId,
  iteration: PositiveInt,
  output: ReviewOutput,
});
export type ReviewResult = typeof ReviewResult.Type;

// ---------------------------------------------------------------------------
// Orchestration Runs
// ---------------------------------------------------------------------------

export const ORCHESTRATION_RUN_STATUSES = [
  "pending",
  "running",
  "paused",
  "completed",
  "canceled",
  "failed",
] as const;
export const OrchestrationRunStatus = Schema.Literals(ORCHESTRATION_RUN_STATUSES);
export type OrchestrationRunStatus = typeof OrchestrationRunStatus.Type;

export const ORCHESTRATION_RUN_PHASES = ["working", "reviewing"] as const;
export const OrchestrationRunPhase = Schema.Literals(ORCHESTRATION_RUN_PHASES);
export type OrchestrationRunPhase = typeof OrchestrationRunPhase.Type;

export const OrchestrationTicketEntry = Schema.Struct({
  ticketId: TicketId,
  selectedTicketId: Schema.optionalKey(TicketId),
  workingThreadId: ThreadId,
  reviewThreadId: Schema.optionalKey(ThreadId),
});
export type OrchestrationTicketEntry = typeof OrchestrationTicketEntry.Type;

export const OrchestrationRun = Schema.Struct({
  id: OrchestrationRunId,
  orchestrationThreadId: ThreadId,
  projectId: ProjectId,
  status: OrchestrationRunStatus,
  ticketOrder: Schema.Array(OrchestrationTicketEntry),
  currentTicketIndex: Schema.Int,
  currentPhase: OrchestrationRunPhase,
  reviewIteration: NonNegativeInt,
  maxReviewIterations: NonNegativeInt,
  promptOverrides: OrchestrationPromptOverrides,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationRun = typeof OrchestrationRun.Type;

export const OrchestrationRunSummary = Schema.Struct({
  id: OrchestrationRunId,
  orchestrationThreadId: ThreadId,
  projectId: ProjectId,
  status: OrchestrationRunStatus,
  currentTicketIndex: Schema.Int,
  ticketCount: NonNegativeInt,
  currentPhase: OrchestrationRunPhase,
  promptOverrides: OrchestrationPromptOverrides,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationRunSummary = typeof OrchestrationRunSummary.Type;

export const OrchestrationRunStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    projectId: ProjectId,
    runs: Schema.Array(OrchestrationRunSummary),
  }),
  Schema.Struct({
    type: Schema.Literal("run.created"),
    projectId: ProjectId,
    run: OrchestrationRun,
  }),
  Schema.Struct({
    type: Schema.Literal("run.updated"),
    projectId: ProjectId,
    run: OrchestrationRun,
  }),
]);
export type OrchestrationRunStreamEvent = typeof OrchestrationRunStreamEvent.Type;

export const OrchestrationCreateRunInput = Schema.Struct({
  projectId: ProjectId,
  selectedTicketIdentifiers: Schema.Array(TrimmedNonEmptyString),
  implementerModelSelection: ModelSelection,
  reviewerModelSelection: ModelSelection,
  runtimeMode: Schema.optional(RuntimeMode),
  maxReviewIterations: Schema.optional(NonNegativeInt),
  promptOverrides: Schema.optional(OrchestrationPromptOverrides),
});
export type OrchestrationCreateRunInput = typeof OrchestrationCreateRunInput.Type;

export const OrchestrationCreateRunResult = Schema.Struct({
  runId: OrchestrationRunId,
  orchestrationThreadId: ThreadId,
  workingThreadIds: Schema.Array(ThreadId),
});
export type OrchestrationCreateRunResult = typeof OrchestrationCreateRunResult.Type;

export const OrchestrationGetRunInput = Schema.Struct({
  runId: OrchestrationRunId,
});
export type OrchestrationGetRunInput = typeof OrchestrationGetRunInput.Type;

export const OrchestrationListRunsInput = Schema.Struct({
  projectId: ProjectId,
  status: Schema.optionalKey(Schema.Array(OrchestrationRunStatus)),
});
export type OrchestrationListRunsInput = typeof OrchestrationListRunsInput.Type;

export const OrchestrationGetChildThreadsInput = Schema.Struct({
  parentThreadId: ThreadId,
});
export type OrchestrationGetChildThreadsInput = typeof OrchestrationGetChildThreadsInput.Type;

export const OrchestrationGetChildThreadIdsInput = Schema.Struct({
  parentThreadId: ThreadId,
});
export type OrchestrationGetChildThreadIdsInput = typeof OrchestrationGetChildThreadIdsInput.Type;

export const OrchestrationGetChildThreadIdsResult = Schema.Struct({
  threadIds: Schema.Array(ThreadId),
});
export type OrchestrationGetChildThreadIdsResult = typeof OrchestrationGetChildThreadIdsResult.Type;

export const OrchestrationPauseRunInput = Schema.Struct({
  runId: OrchestrationRunId,
});
export type OrchestrationPauseRunInput = typeof OrchestrationPauseRunInput.Type;

export const ORCHESTRATION_RESUME_RUN_MODES = ["default", "fresh-agent"] as const;
export const OrchestrationResumeRunMode = Schema.Literals(ORCHESTRATION_RESUME_RUN_MODES);
export type OrchestrationResumeRunMode = typeof OrchestrationResumeRunMode.Type;

export const OrchestrationResumeRunInput = Schema.Struct({
  runId: OrchestrationRunId,
  mode: Schema.optional(OrchestrationResumeRunMode),
});
export type OrchestrationResumeRunInput = typeof OrchestrationResumeRunInput.Type;

export const OrchestrationCancelRunInput = Schema.Struct({
  runId: OrchestrationRunId,
});
export type OrchestrationCancelRunInput = typeof OrchestrationCancelRunInput.Type;

export const OrchestrationStartRunInput = Schema.Struct({
  runId: OrchestrationRunId,
});
export type OrchestrationStartRunInput = typeof OrchestrationStartRunInput.Type;

export class OrchestrationRunError extends Schema.TaggedErrorClass<OrchestrationRunError>()(
  "OrchestrationRunError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

// ---------------------------------------------------------------------------
// RPC Schemas
// ---------------------------------------------------------------------------

export const OrchestrationRpcSchemas = {
  getSnapshot: {
    input: OrchestrationGetSnapshotInput,
    output: OrchestrationGetSnapshotResult,
  },
  getStartupSnapshot: {
    input: OrchestrationGetStartupSnapshotInput,
    output: OrchestrationGetStartupSnapshotResult,
  },
  getThreadContent: {
    input: OrchestrationGetThreadContentInput,
    output: OrchestrationGetThreadContentResult,
  },
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  replayEvents: {
    input: OrchestrationReplayEventsInput,
    output: OrchestrationReplayEventsResult,
  },
  createRun: {
    input: OrchestrationCreateRunInput,
    output: OrchestrationCreateRunResult,
  },
  getRun: {
    input: OrchestrationGetRunInput,
    output: OrchestrationRun,
  },
  listRuns: {
    input: OrchestrationListRunsInput,
    output: Schema.Array(OrchestrationRunSummary),
  },
  getChildThreads: {
    input: OrchestrationGetChildThreadsInput,
    output: Schema.Array(OrchestrationThread),
  },
  getChildThreadIds: {
    input: OrchestrationGetChildThreadIdsInput,
    output: OrchestrationGetChildThreadIdsResult,
  },
  pauseRun: {
    input: OrchestrationPauseRunInput,
    output: OrchestrationRun,
  },
  resumeRun: {
    input: OrchestrationResumeRunInput,
    output: OrchestrationRun,
  },
  cancelRun: {
    input: OrchestrationCancelRunInput,
    output: OrchestrationRun,
  },
  startRun: {
    input: OrchestrationStartRunInput,
    output: OrchestrationRun,
  },
} as const;

export class OrchestrationGetSnapshotError extends Schema.TaggedErrorClass<OrchestrationGetSnapshotError>()(
  "OrchestrationGetSnapshotError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetStartupSnapshotError extends Schema.TaggedErrorClass<OrchestrationGetStartupSnapshotError>()(
  "OrchestrationGetStartupSnapshotError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetThreadContentError extends Schema.TaggedErrorClass<OrchestrationGetThreadContentError>()(
  "OrchestrationGetThreadContentError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationDispatchCommandError extends Schema.TaggedErrorClass<OrchestrationDispatchCommandError>()(
  "OrchestrationDispatchCommandError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetTurnDiffError extends Schema.TaggedErrorClass<OrchestrationGetTurnDiffError>()(
  "OrchestrationGetTurnDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetFullThreadDiffError extends Schema.TaggedErrorClass<OrchestrationGetFullThreadDiffError>()(
  "OrchestrationGetFullThreadDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationReplayEventsError extends Schema.TaggedErrorClass<OrchestrationReplayEventsError>()(
  "OrchestrationReplayEventsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
