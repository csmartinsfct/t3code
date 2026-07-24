import type {
  AccountRateLimitsUpdatedPayload,
  OAuthUsageTier,
  ProviderRateLimitInfo,
  ProviderRateLimitResetCredit,
  ProviderRateLimitResetCreditsSummary,
} from "@t3tools/contracts";

export interface NormalizedRateLimitResult {
  /**
   * Usage details are absent when a payload only updates reset credits. This
   * prevents a reset-only read from replacing cached warning/rejection state
   * with a fabricated `allowed` status.
   */
  readonly info?: ProviderRateLimitInfo;
  /** Additional tiers extracted from Codex primary/secondary windows. */
  readonly tiers: ReadonlyArray<OAuthUsageTier>;
  /**
   * `undefined` means the payload did not mention reset credits and the cache
   * must preserve its prior value. `null` is an authoritative clear.
   */
  readonly resetCredits?: ProviderRateLimitResetCreditsSummary | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const VALID_RATE_LIMIT_STATUSES = new Set(["allowed", "allowed_warning", "rejected"]);
const VALID_RESET_CREDIT_STATUSES = new Set(["available", "redeeming", "redeemed", "unknown"]);
const VALID_RESET_CREDIT_TYPES = new Set(["codexRateLimits", "unknown"]);

/** Pick the first defined string from camelCase / snake_case variants. */
function pickString(rec: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** Pick the first defined finite number from camelCase / snake_case variants. */
function pickNumber(rec: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function pickSafeNonNegativeInt(
  rec: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  const value = pickNumber(rec, ...keys);
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Pick the first defined boolean from camelCase / snake_case variants. */
function pickBoolean(rec: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function pickRateLimitStatus(
  rec: Record<string, unknown>,
  ...keys: string[]
): ProviderRateLimitInfo["status"] | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "string" && VALID_RATE_LIMIT_STATUSES.has(value)) {
      return value as ProviderRateLimitInfo["status"];
    }
  }
  return undefined;
}

function codexWindowTierKey(windowMinutes: number | undefined): string {
  if (windowMinutes !== undefined && windowMinutes <= 360) return "five_hour";
  return "seven_day";
}

interface CodexWindowData {
  readonly usedPercent: number;
  readonly windowMinutes?: number;
  /** Absolute Unix timestamp (seconds) when this window resets. */
  readonly resetsAtEpoch?: number;
}

function asCodexWindow(value: unknown): CodexWindowData | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const pct = pickNumber(rec, "used_percent", "usedPercent");
  if (pct === undefined) return null;
  const windowMinutes = pickNumber(
    rec,
    "window_minutes",
    "windowMinutes",
    "window_duration_mins",
    "windowDurationMins",
  );
  const resetsAtRaw = pickNumber(rec, "resets_at", "resetsAt");
  const resetsInSeconds = pickNumber(rec, "resets_in_seconds", "resetsInSeconds");
  const resetsAtEpoch =
    resetsAtRaw !== undefined
      ? resetsAtRaw
      : resetsInSeconds !== undefined
        ? Math.floor(Date.now() / 1000) + resetsInSeconds
        : undefined;
  return {
    usedPercent: pct,
    ...(windowMinutes !== undefined ? { windowMinutes } : {}),
    ...(resetsAtEpoch !== undefined ? { resetsAtEpoch } : {}),
  };
}

function codexWindowToTier(win: CodexWindowData): OAuthUsageTier {
  const resetsAt =
    win.resetsAtEpoch !== undefined ? new Date(win.resetsAtEpoch * 1000).toISOString() : null;
  return {
    tier: codexWindowTierKey(win.windowMinutes),
    utilization: win.usedPercent / 100,
    resetsAt,
  };
}

function readNullableString(
  rec: Record<string, unknown>,
  ...keys: string[]
): string | null | undefined {
  for (const key of keys) {
    if (!(key in rec)) continue;
    const value = rec[key];
    if (value === null || typeof value === "string") return value;
    return undefined;
  }
  return null;
}

function normalizeResetCredit(value: unknown): ProviderRateLimitResetCredit | null {
  const credit = asRecord(value);
  if (!credit) return null;

  const id = pickString(credit, "id");
  const resetType = pickString(credit, "resetType", "reset_type");
  const status = pickString(credit, "status");
  const grantedAt = pickSafeNonNegativeInt(credit, "grantedAt", "granted_at");
  const hasExpiresAt = "expiresAt" in credit || "expires_at" in credit;
  const expiresAtRaw = credit.expiresAt ?? credit.expires_at;
  const expiresAt =
    !hasExpiresAt || expiresAtRaw === null
      ? null
      : pickSafeNonNegativeInt(credit, "expiresAt", "expires_at");
  const title = readNullableString(credit, "title");
  const description = readNullableString(credit, "description");

  if (
    !id ||
    !resetType ||
    !VALID_RESET_CREDIT_TYPES.has(resetType) ||
    !status ||
    !VALID_RESET_CREDIT_STATUSES.has(status) ||
    grantedAt === undefined ||
    expiresAt === undefined ||
    title === undefined ||
    description === undefined
  ) {
    return null;
  }

  return {
    id,
    resetType: resetType as ProviderRateLimitResetCredit["resetType"],
    status: status as ProviderRateLimitResetCredit["status"],
    grantedAt,
    expiresAt,
    title,
    description,
  };
}

function normalizeResetCredits(
  outer: Record<string, unknown>,
): ProviderRateLimitResetCreditsSummary | null | undefined {
  const key =
    "rateLimitResetCredits" in outer
      ? "rateLimitResetCredits"
      : "rate_limit_reset_credits" in outer
        ? "rate_limit_reset_credits"
        : undefined;
  if (!key) return undefined;

  const raw = outer[key];
  if (raw === null) return null;
  const summary = asRecord(raw);
  if (!summary) return undefined;

  const availableCount = pickSafeNonNegativeInt(summary, "availableCount", "available_count");
  if (availableCount === undefined) return undefined;

  const rawCredits = summary.credits;
  const credits =
    rawCredits === null
      ? null
      : Array.isArray(rawCredits)
        ? rawCredits
            .map(normalizeResetCredit)
            .filter((credit): credit is ProviderRateLimitResetCredit => credit !== null)
        : null;

  return { availableCount, credits };
}

/**
 * Normalize a provider `account.rate-limits.updated` payload or a Codex
 * `account/rateLimits/read` result.
 */
export function normalizeRateLimitPayload(
  payload: AccountRateLimitsUpdatedPayload,
): NormalizedRateLimitResult | null {
  const outer = asRecord(payload.rateLimits);
  if (!outer) return null;
  const resetCredits = normalizeResetCredits(outer);

  const inner = asRecord(outer.rate_limit_info) ?? outer;
  const status = pickRateLimitStatus(inner, "status");
  if (status) {
    return {
      info: {
        status,
        rateLimitType: pickString(inner, "rateLimitType", "rate_limit_type"),
        utilization: pickNumber(inner, "utilization"),
        resetsAt: pickNumber(inner, "resetsAt", "resets_at"),
        isUsingOverage: pickBoolean(inner, "isUsingOverage", "is_using_overage"),
        overageStatus: pickRateLimitStatus(inner, "overageStatus", "overage_status"),
        overageResetsAt: pickNumber(inner, "overageResetsAt", "overage_resets_at"),
        overageDisabledReason: pickString(
          inner,
          "overageDisabledReason",
          "overage_disabled_reason",
        ),
        surpassedThreshold: pickNumber(inner, "surpassedThreshold", "surpassed_threshold"),
      },
      tiers: [],
      ...(resetCredits !== undefined ? { resetCredits } : {}),
    };
  }

  const codexData =
    outer.primary || outer.secondary ? outer : (asRecord(outer.rateLimits) ?? outer);
  const primary = asCodexWindow(codexData.primary);
  const secondary = asCodexWindow(codexData.secondary);
  if (!primary && !secondary) {
    return resetCredits === undefined
      ? null
      : {
          tiers: [],
          resetCredits,
        };
  }

  const tiers: OAuthUsageTier[] = [];
  if (primary) tiers.push(codexWindowToTier(primary));
  if (secondary) tiers.push(codexWindowToTier(secondary));

  const highestPct = Math.max(primary?.usedPercent ?? 0, secondary?.usedPercent ?? 0);
  const highestWindow =
    primary && primary.usedPercent >= (secondary?.usedPercent ?? 0) ? primary : secondary;

  return {
    info: {
      status: highestPct >= 80 ? "allowed_warning" : "allowed",
      utilization: highestPct / 100,
      rateLimitType: highestWindow ? codexWindowTierKey(highestWindow.windowMinutes) : undefined,
      resetsAt: highestWindow?.resetsAtEpoch,
    },
    tiers,
    ...(resetCredits !== undefined ? { resetCredits } : {}),
  };
}
