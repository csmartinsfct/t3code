import type {
  OAuthUsageTier,
  ProviderRateLimitInfo,
  ProviderRateLimitsSnapshot,
} from "@t3tools/contracts";

// ---------------------------------------------------------------------------
// Derived snapshot for UI consumption
// ---------------------------------------------------------------------------

export interface OAuthTierSnapshot {
  readonly tier: string;
  /** Human-readable label, e.g. "5 hour", "7 day (Sonnet)". */
  readonly tierLabel: string;
  /** 0–1 fraction. */
  readonly utilization: number;
  /** 0–100 percentage. */
  readonly usedPercentage: number;
  /** When this tier resets. */
  readonly resetsAt: Date | null;
}

export interface RateLimitSnapshot {
  readonly status: ProviderRateLimitInfo["status"];
  /** 0-100 percentage of the rate-limit window consumed. `null` when unknown. */
  readonly usedPercentage: number | null;
  /** Original utilization value (0-1 fraction) from the provider. */
  readonly utilization: number | null;
  /** Human-readable rate-limit type, e.g. "5 hour". */
  readonly rateLimitTypeLabel: string | null;
  /** Raw rate-limit type key from the provider. */
  readonly rateLimitType: string | null;
  /** When this rate-limit window resets. `null` when unknown. */
  readonly resetsAt: Date | null;
  /** Whether overage billing is active. */
  readonly isUsingOverage: boolean;
  /** Overage status if applicable. */
  readonly overageStatus: ProviderRateLimitInfo["status"] | null;
  /** When overage resets. */
  readonly overageResetsAt: Date | null;
  /** Reason overage is disabled, if any. */
  readonly overageDisabledReason: string | null;
  /** ISO timestamp of last update from the server. */
  readonly updatedAt: string;
  /** Provider this snapshot belongs to. */
  readonly provider: string;
  /** All OAuth usage tiers when available. */
  readonly oauthTiers: ReadonlyArray<OAuthTierSnapshot>;
  /** The highest-utilization tier, used for the circle display. */
  readonly primaryTier: OAuthTierSnapshot | null;
  /** Warning when the usage-data fetch is degraded (e.g. API 429 backoff). */
  readonly fetchWarning: string | null;
}

const RATE_LIMIT_TYPE_LABELS: Record<string, string> = {
  five_hour: "5h",
  seven_day: "Weekly",
  seven_day_opus: "Weekly (Opus)",
  seven_day_sonnet: "Weekly (Sonnet)",
  seven_day_oauth_apps: "Weekly (OAuth apps)",
  seven_day_cowork: "Weekly (Cowork)",
  seven_day_omelette: "Claude Design",
  "gemini-2.5-flash": "2.5 Flash",
  "gemini-2.5-flash-lite": "2.5 Flash-Lite",
  "gemini-2.5-pro": "2.5 Pro",
  "gemini-3-flash-preview": "3 Flash",
  "gemini-3-pro-preview": "3 Pro",
  "gemini-3.1-flash-lite-preview": "3.1 Flash-Lite",
  "gemini-3.1-pro-preview": "3.1 Pro",
  overage: "Overage",
  extra_usage: "Extra usage",
};

function toDate(value: number | undefined): Date | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  // The SDK sends seconds-since-epoch
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateFromIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function deriveOAuthTierSnapshot(raw: OAuthUsageTier): OAuthTierSnapshot {
  const usedPercentage = Math.min(100, raw.utilization * 100);
  return {
    tier: raw.tier,
    tierLabel: RATE_LIMIT_TYPE_LABELS[raw.tier] ?? raw.tier,
    utilization: raw.utilization,
    usedPercentage,
    resetsAt: toDateFromIso(raw.resetsAt),
  };
}

export function deriveRateLimitSnapshot(entry: ProviderRateLimitsSnapshot): RateLimitSnapshot {
  const info = entry.rateLimitInfo;
  const utilization =
    info.utilization !== undefined && Number.isFinite(info.utilization) ? info.utilization : null;
  const sdkUsedPercentage = utilization !== null ? Math.min(100, utilization * 100) : null;
  const rateLimitType = info.rateLimitType ?? null;

  const oauthTiers = (entry.oauthUsageTiers ?? []).map(deriveOAuthTierSnapshot);
  // The first tier (typically `five_hour`) is the most actionable short-term
  // limit and should be highlighted as primary in the UI.
  const primaryTier = oauthTiers.length > 0 ? oauthTiers[0]! : null;

  // When OAuth tiers are available, use the primary tier's percentage for the circle.
  const usedPercentage = primaryTier !== null ? primaryTier.usedPercentage : sdkUsedPercentage;

  return {
    status: info.status,
    usedPercentage,
    utilization: primaryTier?.utilization ?? utilization,
    rateLimitType,
    rateLimitTypeLabel: rateLimitType
      ? (RATE_LIMIT_TYPE_LABELS[rateLimitType] ?? rateLimitType)
      : null,
    resetsAt: toDate(info.resetsAt),
    isUsingOverage: info.isUsingOverage ?? false,
    overageStatus: info.overageStatus ?? null,
    overageResetsAt: toDate(info.overageResetsAt),
    overageDisabledReason: info.overageDisabledReason ?? null,
    updatedAt: entry.updatedAt,
    provider: entry.provider,
    oauthTiers,
    primaryTier,
    fetchWarning: entry.fetchWarning ?? null,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value < 10) return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(value)}%`;
}

export function formatResetsAt(resetsAt: Date | null): string | null {
  if (!resetsAt) return null;
  const now = Date.now();
  const diffMs = resetsAt.getTime() - now;
  if (diffMs <= 0) return "Resetting now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `Resets in ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0
      ? `Resets in ${hours}h ${remainingMinutes}m`
      : `Resets in ${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `Resets in ${days}d ${remainingHours}h` : `Resets in ${days}d`;
}

export function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "Just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
