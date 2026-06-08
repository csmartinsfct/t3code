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

type ToolFieldSchema = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getProperties(schema: unknown): Record<string, unknown> | null {
  if (!isRecord(schema)) return null;
  const properties = schema.properties;
  return isRecord(properties) ? properties : null;
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + substitutionCost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j]!;
    }
  }

  return previous[b.length]!;
}

function suggestFieldName(unknownField: string, allowedFields: ReadonlyArray<string>) {
  const normalizedUnknown = unknownField.toLowerCase();
  let best: { field: string; distance: number } | null = null;
  for (const field of allowedFields) {
    const distance = levenshteinDistance(normalizedUnknown, field.toLowerCase());
    if (!best || distance < best.distance) {
      best = { field, distance };
    }
  }
  if (!best) return null;
  const threshold = Math.max(2, Math.ceil(Math.max(unknownField.length, best.field.length) / 3));
  return best.distance <= threshold ? best.field : null;
}

function formatAllowedFields(allowedFields: ReadonlyArray<string>): string {
  if (allowedFields.length === 0) return "No input fields are accepted.";
  return `Allowed fields: ${allowedFields.map((field) => `'${field}'`).join(", ")}.`;
}

function formatUnknownFieldError(input: {
  readonly toolName: string;
  readonly fieldPath: string;
  readonly unknownField: string;
  readonly allowedFields: ReadonlyArray<string>;
}): string {
  const suggestion = suggestFieldName(input.unknownField, input.allowedFields);
  return [
    `Unknown input field '${input.fieldPath}' for tool '${input.toolName}'.`,
    suggestion ? `Did you mean '${suggestion}'?` : "",
    formatAllowedFields(input.allowedFields),
    "Call GET on this endpoint to inspect the current inputSchema before retrying.",
  ]
    .filter(Boolean)
    .join(" ");
}

function validateInputObject(input: {
  readonly toolName: string;
  readonly value: Record<string, unknown>;
  readonly schema: Record<string, unknown>;
  readonly path: string;
}): string | null {
  const allowedFields = Object.keys(input.schema);
  const allowedFieldSet = new Set(allowedFields);
  for (const key of Object.keys(input.value)) {
    if (!allowedFieldSet.has(key)) {
      const fieldPath = input.path ? `${input.path}.${key}` : key;
      return formatUnknownFieldError({
        toolName: input.toolName,
        fieldPath,
        unknownField: key,
        allowedFields,
      });
    }
  }

  for (const [key, fieldSchema] of Object.entries(input.schema) as Array<
    [string, ToolFieldSchema]
  >) {
    const value = input.value[key];
    if (value === undefined || value === null) continue;

    const nestedProperties = getProperties(fieldSchema);
    if (nestedProperties && isRecord(value)) {
      const nestedError = validateInputObject({
        toolName: input.toolName,
        value,
        schema: nestedProperties,
        path: input.path ? `${input.path}.${key}` : key,
      });
      if (nestedError) return nestedError;
    }

    const items = isRecord(fieldSchema) ? fieldSchema.items : null;
    const itemProperties = getProperties(items);
    if (itemProperties && Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const item = value[index];
        if (!isRecord(item)) continue;
        const nestedError = validateInputObject({
          toolName: input.toolName,
          value: item,
          schema: itemProperties,
          path: `${input.path ? `${input.path}.` : ""}${key}[${index}]`,
        });
        if (nestedError) return nestedError;
      }
    }
  }

  return null;
}

export function validateToolInput(
  toolDefinitions: ReadonlyArray<ToolDefinition>,
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  const definition = toolDefinitions.find((tool) => tool.name === toolName);
  if (!definition) return null;
  return validateInputObject({
    toolName,
    value: input,
    schema: definition.inputSchema,
    path: "",
  });
}

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
    if (!isRecord(body)) return null;
    const { tool, input } = body as Record<string, unknown>;
    if (typeof tool !== "string" || !tool) return null;
    if (input !== undefined && !isRecord(input)) return null;
    return {
      tool,
      input: input ?? {},
    };
  } catch {
    return null;
  }
}
