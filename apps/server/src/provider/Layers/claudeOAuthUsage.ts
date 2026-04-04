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
import { createHash } from "node:crypto";
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
// Per-configDir cache state
// ---------------------------------------------------------------------------

interface PerDirCacheEntry {
  token: { value: string | null; resolvedAt: number };
  response: { tiers: ReadonlyArray<OAuthUsageTier>; fetchedAt: number };
  /** Additive backoff: each consecutive 429 adds another BACKOFF_INCREMENT_MS. */
  consecutive429Count: number;
  backoffUntil: number;
}

const perDirCache = new Map<string, PerDirCacheEntry>();

function resolveConfigDir(configDir?: string): string {
  return path.resolve(configDir || path.join(os.homedir(), ".claude"));
}

function getOrCreateEntry(resolvedDir: string): PerDirCacheEntry {
  let entry = perDirCache.get(resolvedDir);
  if (!entry) {
    entry = {
      token: { value: null, resolvedAt: 0 },
      response: { tiers: [], fetchedAt: 0 },
      consecutive429Count: 0,
      backoffUntil: 0,
    };
    perDirCache.set(resolvedDir, entry);
  }
  return entry;
}

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

/**
 * Derive the macOS Keychain service name for a given configDir.
 *
 * Claude Code stores per-profile credentials under service names like
 * `"Claude Code-credentials-<sha256(configDir)[0:8]>"`.  The base
 * `~/.claude` profile uses the unsuffixed `"Claude Code-credentials"`.
 */
function keychainServiceName(configDir: string): string {
  const defaultDir = path.join(os.homedir(), ".claude");
  if (path.resolve(configDir) === path.resolve(defaultDir)) {
    return KEYCHAIN_SERVICE;
  }
  const hash = createHash("sha256").update(configDir).digest("hex").slice(0, 8);
  return `${KEYCHAIN_SERVICE}-${hash}`;
}

function readKeychainMacOS(configDir: string): string | null {
  if (process.platform !== "darwin") return null;
  const service = keychainServiceName(configDir);
  try {
    const raw = execSync(`security find-generic-password -s "${service}" -w`, {
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
  const dir = resolveConfigDir(configDir);
  const entry = getOrCreateEntry(dir);
  const now = Date.now();

  if (entry.token.value && now - entry.token.resolvedAt < TOKEN_CACHE_TTL_MS) {
    return entry.token.value;
  }

  const fileToken = readCredentialsFile(dir);
  const keychainToken = fileToken ? null : readKeychainMacOS(dir);
  const token = fileToken ?? keychainToken;
  entry.token = { value: token, resolvedAt: now };
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
  const dir = resolveConfigDir(configDir);
  const entry = getOrCreateEntry(dir);
  const now = Date.now();

  // Respect additive backoff after 429s.
  if (now < entry.backoffUntil) {
    return entry.response.tiers;
  }

  // Return cached data if still fresh.
  if (now - entry.response.fetchedAt < CACHE_TTL_MS) {
    return entry.response.tiers;
  }

  const token = resolveOAuthToken(configDir);
  if (!token) {
    return entry.response.tiers; // Return stale data or empty.
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
      entry.consecutive429Count++;
      const backoffMs = entry.consecutive429Count * BACKOFF_INCREMENT_MS;
      entry.backoffUntil = now + backoffMs;
      entry.response = { ...entry.response, fetchedAt: now };
      return entry.response.tiers;
    }

    // Any non-429 response resets the backoff counter.
    entry.consecutive429Count = 0;

    if (res.status === 401 || res.status === 403) {
      entry.token = { value: null, resolvedAt: 0 };
      return entry.response.tiers;
    }

    if (!res.ok) {
      return entry.response.tiers;
    }

    const json: unknown = await res.json();
    const tiers = parseOAuthUsageResponse(json);
    entry.response = { tiers, fetchedAt: now };
    return tiers;
  } catch {
    // Network error, timeout, etc.
    return entry.response.tiers;
  }
}

/**
 * Returns the current backoff state for a configDir, or `null` when idle.
 */
export function getBackoffState(
  configDir?: string,
): { inBackoff: boolean; backoffUntil: number } | null {
  const dir = resolveConfigDir(configDir);
  const entry = perDirCache.get(dir);
  if (!entry || entry.backoffUntil <= Date.now()) return null;
  return { inBackoff: true, backoffUntil: entry.backoffUntil };
}

/**
 * Reset internal caches (for testing).
 */
export function resetOAuthUsageCache(): void {
  perDirCache.clear();
}
