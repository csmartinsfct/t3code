/**
 * Fetches Gemini Code Assist per-model quota usage using the Gemini CLI's
 * cached Google OAuth credentials.
 *
 * The Code Assist quota API reports `remainingFraction`; T3 stores provider
 * usage as consumed fraction, so parsing normalizes each bucket as
 * `1 - remainingFraction`.
 *
 * @module geminiOAuthUsage
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { OAuthUsageTier } from "@t3tools/contracts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CODE_ASSIST_API_VERSION = "v1internal";
const OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CACHE_TTL_MS = 55_000; // 55 seconds (just under the 60s poll interval)
const TOKEN_CACHE_TTL_MS = 60_000; // 1 minute
const PROJECT_CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const TOKEN_EXPIRY_SKEW_MS = 30_000;
const BACKOFF_INCREMENT_MS = 60_000; // 1 minute additive backoff per consecutive 429
const GEMINI_CLI_HOME_DIRNAME = ".gemini";
const OAUTH_CREDS_FILE = "oauth_creds.json";

// Public OAuth client used by the upstream Gemini CLI installed-app flow.
const GEMINI_CLI_OAUTH_CLIENT_ID =
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const GEMINI_CLI_OAUTH_CLIENT_SECRET = "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";

// ---------------------------------------------------------------------------
// Per-home cache state
// ---------------------------------------------------------------------------

interface CachedToken {
  readonly value: string | null;
  readonly expiresAt: number;
  readonly resolvedAt: number;
}

interface CachedProject {
  readonly value: string | null;
  readonly fetchedAt: number;
}

interface PerHomeCacheEntry {
  token: CachedToken;
  project: CachedProject;
  response: { tiers: ReadonlyArray<OAuthUsageTier>; fetchedAt: number };
  consecutive429Count: number;
  backoffUntil: number;
}

const perHomeCache = new Map<string, PerHomeCacheEntry>();

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolveGeminiHomePath(homePath?: string): string {
  return path.resolve(
    expandHome(
      homePath?.trim() ||
        process.env.GEMINI_CLI_HOME ||
        path.join(os.homedir(), GEMINI_CLI_HOME_DIRNAME),
    ),
  );
}

function getOrCreateEntry(resolvedHome: string): PerHomeCacheEntry {
  let entry = perHomeCache.get(resolvedHome);
  if (!entry) {
    entry = {
      token: { value: null, expiresAt: 0, resolvedAt: 0 },
      project: { value: null, fetchedAt: 0 },
      response: { tiers: [], fetchedAt: 0 },
      consecutive429Count: 0,
      backoffUntil: 0,
    };
    perHomeCache.set(resolvedHome, entry);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

interface GeminiOAuthCredentials {
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  readonly expiresAt: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeExpiryDate(value: number | null): number | null {
  if (value === null) return null;
  // Gemini/Google libraries store milliseconds, but accept seconds defensively.
  return value > 1_000_000_000_000 ? value : value * 1_000;
}

function readCredentialsFile(homePath: string): GeminiOAuthCredentials | null {
  try {
    const raw = fs.readFileSync(path.join(homePath, OAUTH_CREDS_FILE), "utf-8");
    const data = asRecord(JSON.parse(raw) as unknown);
    if (!data) return null;

    return {
      accessToken: pickString(data, "access_token", "accessToken", "token"),
      refreshToken: pickString(data, "refresh_token", "refreshToken"),
      expiresAt: normalizeExpiryDate(pickNumber(data, "expiry_date", "expiryDate", "expiresAt")),
    };
  } catch {
    return null;
  }
}

function tokenIsUsable(token: CachedToken, now: number): boolean {
  return (
    token.value !== null &&
    now - token.resolvedAt < TOKEN_CACHE_TTL_MS &&
    now < token.expiresAt - TOKEN_EXPIRY_SKEW_MS
  );
}

function credentialAccessTokenIsUsable(
  credentials: GeminiOAuthCredentials,
  now: number,
): credentials is GeminiOAuthCredentials & { accessToken: string } {
  if (!credentials.accessToken) return false;
  if (credentials.expiresAt === null) return true;
  return now < credentials.expiresAt - TOKEN_EXPIRY_SKEW_MS;
}

async function refreshAccessToken(refreshToken: string): Promise<CachedToken | null> {
  try {
    const body = new URLSearchParams({
      client_id: GEMINI_CLI_OAUTH_CLIENT_ID,
      client_secret: GEMINI_CLI_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const res = await fetch(OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;
    const data = asRecord((await res.json()) as unknown);
    const accessToken = data ? pickString(data, "access_token", "accessToken") : null;
    const expiresIn = data ? pickNumber(data, "expires_in", "expiresIn") : null;
    if (!accessToken) return null;

    const now = Date.now();
    return {
      value: accessToken,
      expiresAt: now + (expiresIn ?? 3_600) * 1_000,
      resolvedAt: now,
    };
  } catch {
    return null;
  }
}

async function resolveGeminiOAuthToken(homePath?: string): Promise<string | null> {
  if (process.env.GOOGLE_CLOUD_ACCESS_TOKEN) {
    return process.env.GOOGLE_CLOUD_ACCESS_TOKEN;
  }

  const resolvedHome = resolveGeminiHomePath(homePath);
  const entry = getOrCreateEntry(resolvedHome);
  const now = Date.now();

  if (tokenIsUsable(entry.token, now)) {
    return entry.token.value;
  }

  const credentials = readCredentialsFile(resolvedHome);
  if (!credentials) {
    entry.token = { value: null, expiresAt: 0, resolvedAt: now };
    return null;
  }

  if (credentialAccessTokenIsUsable(credentials, now)) {
    entry.token = {
      value: credentials.accessToken,
      expiresAt: credentials.expiresAt ?? now + TOKEN_CACHE_TTL_MS,
      resolvedAt: now,
    };
    return credentials.accessToken;
  }

  if (!credentials.refreshToken) {
    entry.token = { value: null, expiresAt: 0, resolvedAt: now };
    return null;
  }

  const refreshed = await refreshAccessToken(credentials.refreshToken);
  entry.token = refreshed ?? { value: null, expiresAt: 0, resolvedAt: now };
  return entry.token.value;
}

// ---------------------------------------------------------------------------
// Code Assist API helpers
// ---------------------------------------------------------------------------

class GeminiQuotaHttpError extends Error {
  constructor(readonly status: number) {
    super(`Gemini quota API request failed with HTTP ${status}`);
  }
}

function codeAssistUrl(method: string): string {
  const endpoint = process.env.CODE_ASSIST_ENDPOINT ?? CODE_ASSIST_ENDPOINT;
  const version = process.env.CODE_ASSIST_API_VERSION ?? CODE_ASSIST_API_VERSION;
  return `${endpoint}/${version}:${method}`;
}

async function postCodeAssist(
  method: "loadCodeAssist" | "retrieveUserQuota",
  token: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(codeAssistUrl(method), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new GeminiQuotaHttpError(res.status);
  }

  return res.json() as Promise<unknown>;
}

function projectFromLoadCodeAssistResponse(data: unknown): string | null {
  const record = asRecord(data);
  if (!record) return null;

  const direct = record.cloudaicompanionProject;
  if (typeof direct === "string" && direct.trim().length > 0) return direct;
  const projectRecord = asRecord(direct);
  const id = projectRecord ? pickString(projectRecord, "id", "projectId") : null;
  return id;
}

async function resolveCodeAssistProject(
  entry: PerHomeCacheEntry,
  token: string,
): Promise<string | null> {
  const envProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (envProject) return envProject;

  const now = Date.now();
  if (entry.project.value && now - entry.project.fetchedAt < PROJECT_CACHE_TTL_MS) {
    return entry.project.value;
  }

  const data = await postCodeAssist("loadCodeAssist", token, {
    metadata: {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    },
  });
  const project = projectFromLoadCodeAssistResponse(data);
  entry.project = { value: project, fetchedAt: now };
  return project;
}

function markBackoff(entry: PerHomeCacheEntry, now: number): void {
  entry.consecutive429Count++;
  entry.backoffUntil = now + entry.consecutive429Count * BACKOFF_INCREMENT_MS;
  entry.response = { ...entry.response, fetchedAt: now };
}

function clearBackoff(entry: PerHomeCacheEntry): void {
  entry.consecutive429Count = 0;
  entry.backoffUntil = 0;
}

// ---------------------------------------------------------------------------
// API response parsing
// ---------------------------------------------------------------------------

function bucketsFromQuotaResponse(data: unknown): ReadonlyArray<unknown> {
  const record = asRecord(data);
  if (!record) return [];

  for (const value of [
    record.buckets,
    record.quotaBuckets,
    record.quota_buckets,
    asRecord(record.quota)?.buckets,
    asRecord(record.quota)?.quotaBuckets,
    asRecord(record.userQuota)?.buckets,
  ]) {
    if (Array.isArray(value)) return value;
  }

  return [];
}

function clampUtilization(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function parseGeminiQuotaResponse(data: unknown): ReadonlyArray<OAuthUsageTier> {
  const tiers: OAuthUsageTier[] = [];

  for (const bucket of bucketsFromQuotaResponse(data)) {
    const record = asRecord(bucket);
    if (!record) continue;

    const modelId = pickString(record, "modelId", "model_id");
    const remainingFraction = pickNumber(record, "remainingFraction", "remaining_fraction");
    if (!modelId || remainingFraction === null) continue;

    tiers.push({
      tier: modelId,
      utilization: clampUtilization(1 - remainingFraction),
      resetsAt: pickString(record, "resetTime", "reset_time"),
    });
  }

  tiers.sort((a, b) => b.utilization - a.utilization || a.tier.localeCompare(b.tier));
  return tiers;
}

// ---------------------------------------------------------------------------
// Fetch usage with cache
// ---------------------------------------------------------------------------

export async function fetchGeminiOAuthUsage(
  homePath?: string,
): Promise<ReadonlyArray<OAuthUsageTier>> {
  const resolvedHome = resolveGeminiHomePath(homePath);
  const entry = getOrCreateEntry(resolvedHome);
  const now = Date.now();

  if (now < entry.backoffUntil) {
    return entry.response.tiers;
  }

  if (now - entry.response.fetchedAt < CACHE_TTL_MS) {
    return entry.response.tiers;
  }

  const token = await resolveGeminiOAuthToken(homePath);
  if (!token) {
    return entry.response.tiers;
  }

  try {
    const project = await resolveCodeAssistProject(entry, token);
    if (!project) return entry.response.tiers;

    const json = await postCodeAssist("retrieveUserQuota", token, { project });
    const tiers = parseGeminiQuotaResponse(json);
    clearBackoff(entry);
    entry.response = { tiers, fetchedAt: now };
    return tiers;
  } catch (error) {
    if (error instanceof GeminiQuotaHttpError) {
      if (error.status === 429) {
        markBackoff(entry, now);
      }
      if (error.status === 401 || error.status === 403) {
        entry.token = { value: null, expiresAt: 0, resolvedAt: 0 };
      }
    }
    return entry.response.tiers;
  }
}

/**
 * Returns the current backoff state for a Gemini home path, or `null` when idle.
 */
export function getGeminiQuotaBackoffState(
  homePath?: string,
): { inBackoff: boolean; backoffUntil: number } | null {
  const resolvedHome = resolveGeminiHomePath(homePath);
  const entry = perHomeCache.get(resolvedHome);
  if (!entry || entry.backoffUntil <= Date.now()) return null;
  return { inBackoff: true, backoffUntil: entry.backoffUntil };
}

/**
 * Reset internal caches (for testing).
 */
export function resetGeminiOAuthUsageCache(): void {
  perHomeCache.clear();
}
