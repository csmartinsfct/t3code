import { Cause, Effect, Result } from "effect";
import { HttpServerResponse } from "effect/unstable/http";

import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { ManagedRunService } from "./managedRuns/Services/ManagedRuns";

// Dev-only bypass token for direct REST testing.
const DEV_BYPASS_TOKEN = process.env.NODE_ENV === "production" ? null : "t3-dev-bypass";

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

export function respondOk<T>(data: T, message = "OK") {
  return HttpServerResponse.jsonUnsafe({ data: { message, data }, error: null });
}

export function respondError(error: string, status = 400) {
  return HttpServerResponse.jsonUnsafe({ data: null, error }, { status });
}

/**
 * Build a 500 JSON error response from an Effect Cause, unwrapping tagged
 * errors so nested causes survive the round-trip.
 *
 * `Data.TaggedError` is an Error subclass with an empty `.message`, so the
 * naive `error.message` fallback serialized them as `""` and swallowed every
 * diagnostic. This formatter walks failures → defects → `.cause` chains so
 * the client sees something useful.
 */
export function respondErrorFromCause(cause: Cause.Cause<unknown>, status = 500) {
  return respondError(formatCause(cause), status);
}

function formatCause(cause: Cause.Cause<unknown>): string {
  const failure = Cause.findErrorOption(cause);
  if (failure._tag === "Some") return formatThrown(failure.value);
  const defect = Result.getSuccess(Cause.findDefect(cause));
  if (defect._tag === "Some") return formatThrown(defect.value);
  return Cause.pretty(cause);
}

function formatThrown(err: unknown): string {
  if (err === null || err === undefined) return String(err);
  if (!(err instanceof Error)) return String(err);
  const tag = (err as { _tag?: string })._tag ?? err.name;
  const head = err.message ? `${tag}: ${err.message}` : tag;
  const nested = (err as { cause?: unknown }).cause;
  if (nested === undefined || nested === null) return head;
  return `${head} → ${formatThrown(nested)}`;
}

// ---------------------------------------------------------------------------
// Tool definition (used by discovery GET endpoints)
// ---------------------------------------------------------------------------

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export type ServiceAuthContext = {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
};

/**
 * Extract Bearer token from the Authorization header.
 * Returns null if no valid token is present.
 */
export function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  return token || null;
}

/**
 * Resolve auth context from a Bearer token.
 * Tries the dev bypass token first, then the managed run token store.
 * Accepts an already-converted Web Request so callers can reuse it for body
 * parsing without consuming the stream twice.
 * Returns the context or null.
 */
export const resolveAuth = (webRequest: Request) =>
  Effect.gen(function* () {
    const managedRuns = yield* ManagedRunService;

    const token = extractBearerToken(webRequest);
    if (!token) return null;

    // Dev bypass
    if (DEV_BYPASS_TOKEN && token === DEV_BYPASS_TOKEN) {
      const url = new URL(webRequest.url, "http://localhost");
      const projectId = url.searchParams.get("projectId");
      const threadId = url.searchParams.get("threadId") ?? "dev-test-thread";
      if (projectId) {
        return { projectId: projectId as ProjectId, threadId: threadId as ThreadId };
      }
    }

    // Token-based resolution
    const context = yield* managedRuns.resolveContextForToken(token);
    return context;
  });

// ---------------------------------------------------------------------------
// Request body parsing
// ---------------------------------------------------------------------------

export type ToolCallBody = {
  tool: string;
  input: Record<string, unknown>;
};

/**
 * Parse and validate the POST body for a tool call.
 * Returns the parsed body or null if invalid.
 */
export async function parseToolCallBody(request: Request): Promise<ToolCallBody | null> {
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null) return null;
    const { tool, input } = body as Record<string, unknown>;
    if (typeof tool !== "string" || !tool) return null;
    return {
      tool,
      input: (input && typeof input === "object" ? input : {}) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}
