import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  type ProjectId as ProjectIdType,
} from "./baseSchemas";
import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings";
import { EditorId } from "./editor";
import { ModelCapabilities } from "./model";
import { ProviderKind, type ProviderKind as ProviderKindType } from "./orchestration";
import {
  ProviderCapabilityEntry,
  ResolveProviderCapabilitiesInput,
  ResolveProviderCapabilitiesResult,
} from "./providerCapabilities";
import { ProviderRateLimitInfo } from "./providerRuntime";
import { ServerSettings } from "./settings";

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderState = Schema.Literals(["ready", "warning", "error", "disabled"]);
export type ServerProviderState = typeof ServerProviderState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderAuth = Schema.Struct({
  status: ServerProviderAuthStatus,
  type: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderAuth = typeof ServerProviderAuth.Type;

export const ServerProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  isCustom: Schema.Boolean,
  capabilities: Schema.NullOr(ModelCapabilities),
});
export type ServerProviderModel = typeof ServerProviderModel.Type;

export const ServerProvider = Schema.Struct({
  provider: ProviderKind,
  displayName: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  version: Schema.NullOr(TrimmedNonEmptyString),
  status: ServerProviderState,
  auth: ServerProviderAuth,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
  models: Schema.Array(ServerProviderModel),
});
export type ServerProvider = typeof ServerProvider.Type;

export const ServerProviders = Schema.Array(ServerProvider);
export type ServerProviders = typeof ServerProviders.Type;

export const ServerObservability = Schema.Struct({
  logsDirectoryPath: TrimmedNonEmptyString,
  localTracingEnabled: Schema.Boolean,
  otlpTracesUrl: Schema.optional(TrimmedNonEmptyString),
  otlpTracesEnabled: Schema.Boolean,
  otlpMetricsUrl: Schema.optional(TrimmedNonEmptyString),
  otlpMetricsEnabled: Schema.Boolean,
});
export type ServerObservability = typeof ServerObservability.Type;

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviders,
  availableEditors: Schema.Array(EditorId),
  observability: ServerObservability,
  settings: ServerSettings,
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerUpsertKeybindingInput = KeybindingRule;
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  providers: ServerProviders,
  settings: Schema.optional(ServerSettings),
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;

export const ServerConfigKeybindingsUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
});
export type ServerConfigKeybindingsUpdatedPayload =
  typeof ServerConfigKeybindingsUpdatedPayload.Type;

export const ServerConfigProviderStatusesPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerConfigProviderStatusesPayload = typeof ServerConfigProviderStatusesPayload.Type;

export const ServerConfigSettingsUpdatedPayload = Schema.Struct({
  settings: ServerSettings,
});
export type ServerConfigSettingsUpdatedPayload = typeof ServerConfigSettingsUpdatedPayload.Type;

export const ServerConfigStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  config: ServerConfig,
});
export type ServerConfigStreamSnapshotEvent = typeof ServerConfigStreamSnapshotEvent.Type;

export const ServerConfigStreamKeybindingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("keybindingsUpdated"),
  payload: ServerConfigKeybindingsUpdatedPayload,
});
export type ServerConfigStreamKeybindingsUpdatedEvent =
  typeof ServerConfigStreamKeybindingsUpdatedEvent.Type;

export const ServerConfigStreamProviderStatusesEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("providerStatuses"),
  payload: ServerConfigProviderStatusesPayload,
});
export type ServerConfigStreamProviderStatusesEvent =
  typeof ServerConfigStreamProviderStatusesEvent.Type;

export const ServerConfigStreamSettingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("settingsUpdated"),
  payload: ServerConfigSettingsUpdatedPayload,
});
export type ServerConfigStreamSettingsUpdatedEvent =
  typeof ServerConfigStreamSettingsUpdatedEvent.Type;

export const ServerConfigStreamMcpConfigChangedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("mcpConfigChanged"),
});
export type ServerConfigStreamMcpConfigChangedEvent =
  typeof ServerConfigStreamMcpConfigChangedEvent.Type;

export const ServerLifecycleReadyPayload = Schema.Struct({
  at: IsoDateTime,
});
export type ServerLifecycleReadyPayload = typeof ServerLifecycleReadyPayload.Type;

export const ServerLifecycleWelcomePayload = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  projectName: TrimmedNonEmptyString,
  startupWasWorkingThreadIds: Schema.optional(Schema.Array(ThreadId)),
});
export type ServerLifecycleWelcomePayload = typeof ServerLifecycleWelcomePayload.Type;

export const ServerLifecycleStreamWelcomeEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("welcome"),
  payload: ServerLifecycleWelcomePayload,
});
export type ServerLifecycleStreamWelcomeEvent = typeof ServerLifecycleStreamWelcomeEvent.Type;

export const ServerLifecycleStreamReadyEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("ready"),
  payload: ServerLifecycleReadyPayload,
});
export type ServerLifecycleStreamReadyEvent = typeof ServerLifecycleStreamReadyEvent.Type;

export const ServerLifecycleStreamEvent = Schema.Union([
  ServerLifecycleStreamWelcomeEvent,
  ServerLifecycleStreamReadyEvent,
]);
export type ServerLifecycleStreamEvent = typeof ServerLifecycleStreamEvent.Type;

export const ServerProviderUpdatedPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerProviderUpdatedPayload = typeof ServerProviderUpdatedPayload.Type;

// ---------------------------------------------------------------------------
// MCP server resolution
// ---------------------------------------------------------------------------

export const ResolveMcpServersInput = Schema.Struct({
  provider: ProviderKind,
  projectId: Schema.optional(ProjectId),
  cwd: Schema.optional(TrimmedNonEmptyString),
  forceRefresh: Schema.optional(Schema.Boolean),
});
export interface ResolveMcpServersInput {
  readonly provider: ProviderKindType;
  readonly projectId?: ProjectIdType;
  readonly cwd?: string;
  readonly forceRefresh?: boolean;
}

export const ResolvedMcpServerTool = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  annotations: Schema.optional(Schema.Unknown),
});
export type ResolvedMcpServerTool = typeof ResolvedMcpServerTool.Type;

export const ResolvedMcpServer = Schema.Struct({
  name: TrimmedNonEmptyString,
  status: Schema.optional(TrimmedNonEmptyString),
  scope: Schema.optional(TrimmedNonEmptyString),
  error: Schema.optional(Schema.String),
  toolCount: Schema.optional(NonNegativeInt),
  serverInfo: Schema.optional(Schema.Unknown),
  config: Schema.optional(Schema.Unknown),
  tools: Schema.optional(Schema.Array(ResolvedMcpServerTool)),
});
export type ResolvedMcpServer = typeof ResolvedMcpServer.Type;

export const ResolvedMcpServersStatus = Schema.Literals(["loading", "ready", "error"]);
export type ResolvedMcpServersStatus = typeof ResolvedMcpServersStatus.Type;

export const ResolvedMcpProviderSnapshot = Schema.Struct({
  provider: ProviderKind,
  projectId: Schema.optional(ProjectId),
  cwd: Schema.optional(TrimmedNonEmptyString),
  status: ResolvedMcpServersStatus,
  refreshing: Schema.optional(Schema.Boolean),
  serverNames: Schema.Array(TrimmedNonEmptyString),
  servers: Schema.optional(Schema.Array(ResolvedMcpServer)),
  updatedAt: Schema.optional(IsoDateTime),
  error: Schema.optional(Schema.String),
});
export interface ResolvedMcpProviderSnapshot {
  readonly provider: ProviderKindType;
  readonly projectId?: ProjectIdType;
  readonly cwd?: string;
  readonly status: ResolvedMcpServersStatus;
  readonly refreshing?: boolean;
  readonly serverNames: readonly string[];
  readonly servers?: readonly ResolvedMcpServer[];
  readonly updatedAt?: string;
  readonly error?: string;
}

export const ResolveMcpServersResult = Schema.Struct({
  status: ResolvedMcpServersStatus,
  refreshing: Schema.optional(Schema.Boolean),
  serverNames: Schema.Array(TrimmedNonEmptyString),
  servers: Schema.optional(Schema.Array(ResolvedMcpServer)),
  updatedAt: Schema.optional(IsoDateTime),
  error: Schema.optional(Schema.String),
  profiles: Schema.optional(Schema.Array(ResolvedMcpProviderSnapshot)),
});
export interface ResolveMcpServersResult {
  readonly status: ResolvedMcpServersStatus;
  readonly refreshing?: boolean;
  readonly serverNames: readonly string[];
  readonly servers?: readonly ResolvedMcpServer[];
  readonly updatedAt?: string;
  readonly error?: string;
  readonly profiles?: readonly ResolvedMcpProviderSnapshot[];
}

export const ServerConfigStreamMcpStatusUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("mcpStatusUpdated"),
  payload: Schema.Struct({
    snapshots: Schema.Array(ResolvedMcpProviderSnapshot),
  }),
});
export type ServerConfigStreamMcpStatusUpdatedEvent = {
  readonly version: 1;
  readonly type: "mcpStatusUpdated";
  readonly payload: {
    readonly snapshots: readonly ResolvedMcpProviderSnapshot[];
  };
};

// ---------------------------------------------------------------------------
// Provider rate-limits – account-level, not thread-level.
// ---------------------------------------------------------------------------

/** A single account-usage tier returned by provider OAuth/quota APIs. */
export const OAuthUsageTier = Schema.Struct({
  /** Tier key, e.g. "five_hour", "seven_day_sonnet", or a model id. */
  tier: TrimmedNonEmptyString,
  /** Utilization as 0–1 fraction. */
  utilization: Schema.Number,
  /** ISO 8601 UTC reset timestamp. `null` when unknown. */
  resetsAt: Schema.NullOr(IsoDateTime),
});
export type OAuthUsageTier = typeof OAuthUsageTier.Type;

export const ProviderRateLimitResetCreditStatus = Schema.Literals([
  "available",
  "redeeming",
  "redeemed",
  "unknown",
]);
export type ProviderRateLimitResetCreditStatus = typeof ProviderRateLimitResetCreditStatus.Type;

export const ProviderRateLimitResetCreditType = Schema.Literals(["codexRateLimits", "unknown"]);
export type ProviderRateLimitResetCreditType = typeof ProviderRateLimitResetCreditType.Type;

export const ProviderRateLimitResetCredit = Schema.Struct({
  id: TrimmedNonEmptyString,
  resetType: ProviderRateLimitResetCreditType,
  status: ProviderRateLimitResetCreditStatus,
  /** Unix timestamp in seconds. */
  grantedAt: NonNegativeInt,
  /** Unix timestamp in seconds, or `null` when the provider omits an expiry. */
  expiresAt: Schema.NullOr(NonNegativeInt),
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
});
export type ProviderRateLimitResetCredit = typeof ProviderRateLimitResetCredit.Type;

export const ProviderRateLimitResetCreditsSummary = Schema.Struct({
  /** Authoritative count; providers may cap or omit the detailed credit rows. */
  availableCount: NonNegativeInt,
  credits: Schema.NullOr(Schema.Array(ProviderRateLimitResetCredit)),
});
export type ProviderRateLimitResetCreditsSummary = typeof ProviderRateLimitResetCreditsSummary.Type;

export const ProviderRateLimitsSnapshot = Schema.Struct({
  provider: ProviderKind,
  rateLimitInfo: ProviderRateLimitInfo,
  updatedAt: IsoDateTime,
  /** Multi-tier OAuth/quota usage data (5h, 7d, model-specific). Absent when unavailable. */
  oauthUsageTiers: Schema.optional(Schema.Array(OAuthUsageTier)),
  /** Earned provider reset credits. Absent until the provider returns an authoritative read. */
  resetCredits: Schema.optional(ProviderRateLimitResetCreditsSummary),
  /** Warning message when the usage-data fetch is degraded (e.g. API 429 backoff). */
  fetchWarning: Schema.optional(Schema.String),
});
export type ProviderRateLimitsSnapshot = typeof ProviderRateLimitsSnapshot.Type;

export const ConsumeCodexRateLimitResetCreditInput = Schema.Struct({
  provider: ProviderKind,
  idempotencyKey: TrimmedNonEmptyString,
  creditId: Schema.optional(TrimmedNonEmptyString),
});
export type ConsumeCodexRateLimitResetCreditInput =
  typeof ConsumeCodexRateLimitResetCreditInput.Type;

export const ConsumeCodexRateLimitResetCreditOutcome = Schema.Literals([
  "reset",
  "nothingToReset",
  "noCredit",
  "alreadyRedeemed",
]);
export type ConsumeCodexRateLimitResetCreditOutcome =
  typeof ConsumeCodexRateLimitResetCreditOutcome.Type;

export const ConsumeCodexRateLimitResetCreditResult = Schema.Struct({
  outcome: ConsumeCodexRateLimitResetCreditOutcome,
});
export type ConsumeCodexRateLimitResetCreditResult =
  typeof ConsumeCodexRateLimitResetCreditResult.Type;

export class ConsumeCodexRateLimitResetCreditError extends Schema.TaggedErrorClass<ConsumeCodexRateLimitResetCreditError>()(
  "ConsumeCodexRateLimitResetCreditError",
  { message: TrimmedNonEmptyString },
) {}

export const ServerConfigStreamRateLimitsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("rateLimitsUpdated"),
  payload: Schema.Struct({
    rateLimits: Schema.Array(ProviderRateLimitsSnapshot),
  }),
});
export type ServerConfigStreamRateLimitsUpdatedEvent =
  typeof ServerConfigStreamRateLimitsUpdatedEvent.Type;

export const ServerConfigStreamEvent = Schema.Union([
  ServerConfigStreamSnapshotEvent,
  ServerConfigStreamKeybindingsUpdatedEvent,
  ServerConfigStreamProviderStatusesEvent,
  ServerConfigStreamSettingsUpdatedEvent,
  ServerConfigStreamMcpConfigChangedEvent,
  ServerConfigStreamMcpStatusUpdatedEvent,
  ServerConfigStreamRateLimitsUpdatedEvent,
]);
export type ServerConfigStreamEvent = typeof ServerConfigStreamEvent.Type;

export class ResolveMcpServersError extends Schema.TaggedErrorClass<ResolveMcpServersError>()(
  "ResolveMcpServersError",
  { message: TrimmedNonEmptyString },
) {}

export const ManageMcpServerAction = Schema.Literals(["approve", "login", "disable"]);
export type ManageMcpServerAction = typeof ManageMcpServerAction.Type;

export const ManageMcpServerInput = Schema.Struct({
  provider: ProviderKind,
  cwd: Schema.optional(TrimmedNonEmptyString),
  serverName: TrimmedNonEmptyString,
  action: ManageMcpServerAction,
});
export interface ManageMcpServerInput {
  readonly provider: ProviderKindType;
  readonly cwd?: string;
  readonly serverName: string;
  readonly action: ManageMcpServerAction;
}

export const ManageMcpServerResult = Schema.Struct({
  provider: ProviderKind,
  serverName: TrimmedNonEmptyString,
  action: ManageMcpServerAction,
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
});
export interface ManageMcpServerResult {
  readonly provider: ProviderKindType;
  readonly serverName: string;
  readonly action: ManageMcpServerAction;
  readonly stdout?: string;
  readonly stderr?: string;
}

export class ManageMcpServerError extends Schema.TaggedErrorClass<ManageMcpServerError>()(
  "ManageMcpServerError",
  { message: TrimmedNonEmptyString },
) {}

export const ResolveCodexProjectTrustInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ResolveCodexProjectTrustInput = typeof ResolveCodexProjectTrustInput.Type;

export const ResolveCodexProjectTrustResult = Schema.Struct({
  trusted: Schema.Boolean,
});
export type ResolveCodexProjectTrustResult = typeof ResolveCodexProjectTrustResult.Type;

export class ResolveCodexProjectTrustError extends Schema.TaggedErrorClass<ResolveCodexProjectTrustError>()(
  "ResolveCodexProjectTrustError",
  { message: TrimmedNonEmptyString },
) {}

export const TrustCodexProjectInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type TrustCodexProjectInput = typeof TrustCodexProjectInput.Type;

export const TrustCodexProjectResult = Schema.Struct({
  trusted: Schema.Boolean,
});
export type TrustCodexProjectResult = typeof TrustCodexProjectResult.Type;

export class TrustCodexProjectError extends Schema.TaggedErrorClass<TrustCodexProjectError>()(
  "TrustCodexProjectError",
  { message: TrimmedNonEmptyString },
) {}

// ---------------------------------------------------------------------------
// Skills resolution
// ---------------------------------------------------------------------------

export const SkillEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  source: TrimmedNonEmptyString,
  absolutePath: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
  content: Schema.String,
  /** Sub-package name for monorepo grouping. `null` for top-level skills. */
  group: Schema.NullOr(Schema.String),
});
export type SkillEntry = typeof SkillEntry.Type;

export const ResolveSkillsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ResolveSkillsInput = typeof ResolveSkillsInput.Type;

export const ResolveSkillsResult = Schema.Struct({
  skills: Schema.Array(SkillEntry),
});
export type ResolveSkillsResult = typeof ResolveSkillsResult.Type;

export class ResolveSkillsError extends Schema.TaggedErrorClass<ResolveSkillsError>()(
  "ResolveSkillsError",
  { message: TrimmedNonEmptyString },
) {}

export {
  ProviderCapabilityEntry,
  ResolveProviderCapabilitiesInput,
  ResolveProviderCapabilitiesResult,
};

export class ResolveProviderCapabilitiesError extends Schema.TaggedErrorClass<ResolveProviderCapabilitiesError>()(
  "ResolveProviderCapabilitiesError",
  { message: TrimmedNonEmptyString },
) {}
