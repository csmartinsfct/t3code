/**
 * Fetches multi-tier rate-limit usage from the Anthropic OAuth usage API.
 *
 * Token resolution: reads from `~/.claude/.credentials.json` (Linux/all)
 * or macOS Keychain (`security find-generic-password`) as a fallback.
 *
 * Responses are cached for `CACHE_TTL_MS` to respect endpoint rate limits.
 *
 * @module claudeOAuthUsage
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { OAuthUsageTier } from "@t3tools/contracts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const ANTHROPIC_BETA_HEADER = "oauth-2025-04-20";
const CACHE_TTL_MS = 55_000; // 55 seconds (just under the 60s poll interval)
const BACKOFF_INCREMENT_MS = 60_000; // 1 minute additive backoff per consecutive 429
const TOKEN_CACHE_TTL_MS = 60_000; // 1 minute
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const CREDENTIALS_FILE = ".credentials.json";

// ---------------------------------------------------------------------------
// Internal cache state
// ---------------------------------------------------------------------------

let cachedToken: { value: string | null; resolvedAt: number } = { value: null, resolvedAt: 0 };
let cachedResponse: { tiers: ReadonlyArray<OAuthUsageTier>; fetchedAt: number } = {
  tiers: [],
  fetchedAt: 0,
};
/** Additive backoff: each consecutive 429 adds another BACKOFF_INCREMENT_MS. */
let consecutive429Count = 0;
let backoffUntil = 0;

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

function readCredentialsFile(configDir: string): string | null {
  try {
    const filePath = path.join(configDir, CREDENTIALS_FILE);
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const oauth = data.claudeAiOauth as Record<string, unknown> | undefined;
    const token = oauth?.accessToken;
    if (typeof token === "string" && token.length > 0) {
      return token;
    }
  } catch {
    // File doesn't exist or is invalid — expected on macOS when using Keychain.
  }
  return null;
}

function readKeychainMacOS(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const raw = execSync(`security find-generic-password -s "${KEYCHAIN_SERVICE}" -w`, {
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const data = JSON.parse(raw) as Record<string, unknown>;
    const oauth = data.claudeAiOauth as Record<string, unknown> | undefined;
    const token = oauth?.accessToken;
    if (typeof token === "string" && token.length > 0) {
      return token;
    }
  } catch {
    // Keychain not available or entry not found.
  }
  return null;
}

export function resolveOAuthToken(configDir?: string): string | null {
  const now = Date.now();
  if (cachedToken.value && now - cachedToken.resolvedAt < TOKEN_CACHE_TTL_MS) {
    return cachedToken.value;
  }

  const dir = configDir || path.join(os.homedir(), ".claude");
  const token = readCredentialsFile(dir) ?? readKeychainMacOS();
  cachedToken = { value: token, resolvedAt: now };
  return token;
}

// ---------------------------------------------------------------------------
// API response parsing
// ---------------------------------------------------------------------------

/** Keys that should be skipped — they don't represent rate-limit tiers. */
const SKIP_KEYS = new Set(["extra_usage"]);

/** Preferred display order for known tiers; unknown tiers sort to the end. */
const TIER_ORDER: Record<string, number> = {
  five_hour: 0,
  seven_day: 1,
  seven_day_opus: 2,
  seven_day_sonnet: 3,
  seven_day_oauth_apps: 4,
  seven_day_cowork: 5,
};

function isTierPayload(
  value: unknown,
): value is { utilization: number; resets_at?: string | null } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.utilization === "number" && Number.isFinite(record.utilization);
}

function parseOAuthUsageResponse(data: unknown): ReadonlyArray<OAuthUsageTier> {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const tiers: OAuthUsageTier[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (SKIP_KEYS.has(key)) continue;
    if (!isTierPayload(value)) continue;

    tiers.push({
      tier: key,
      // API returns 0-100; we store as 0-1 fraction.
      utilization: value.utilization / 100,
      resetsAt:
        typeof value.resets_at === "string" && value.resets_at.length > 0 ? value.resets_at : null,
    });
  }

  // Stable sort by known tier order.
  tiers.sort((a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99));
  return tiers;
}

// ---------------------------------------------------------------------------
// Fetch usage with cache
// ---------------------------------------------------------------------------

export async function fetchClaudeOAuthUsage(
  configDir?: string,
): Promise<ReadonlyArray<OAuthUsageTier>> {
  const now = Date.now();

  // Respect additive backoff after 429s.
  if (now < backoffUntil) {
    return cachedResponse.tiers;
  }

  // Return cached data if still fresh.
  if (now - cachedResponse.fetchedAt < CACHE_TTL_MS) {
    return cachedResponse.tiers;
  }

  const token = resolveOAuthToken(configDir);
  if (!token) {
    return cachedResponse.tiers; // Return stale data or empty.
  }

  try {
    const res = await fetch(USAGE_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": ANTHROPIC_BETA_HEADER,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 429) {
      // Additive backoff: 1m, 2m, 3m, ...
      consecutive429Count++;
      const backoffMs = consecutive429Count * BACKOFF_INCREMENT_MS;
      backoffUntil = now + backoffMs;
      cachedResponse = { ...cachedResponse, fetchedAt: now };
      return cachedResponse.tiers;
    }

    // Any non-429 response resets the backoff counter.
    consecutive429Count = 0;

    if (res.status === 401 || res.status === 403) {
      cachedToken = { value: null, resolvedAt: 0 };
      return cachedResponse.tiers;
    }

    if (!res.ok) {
      return cachedResponse.tiers;
    }

    const json: unknown = await res.json();
    const tiers = parseOAuthUsageResponse(json);
    cachedResponse = { tiers, fetchedAt: now };
    return tiers;
  } catch {
    // Network error, timeout, etc.
    return cachedResponse.tiers;
  }
}

/**
 * Reset internal caches (for testing).
 */
export function resetOAuthUsageCache(): void {
  cachedToken = { value: null, resolvedAt: 0 };
  cachedResponse = { tiers: [], fetchedAt: 0 };
  consecutive429Count = 0;
  backoffUntil = 0;
}
