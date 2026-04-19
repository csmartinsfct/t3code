import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import {
  parseToolCallBody,
  resolveAuth,
  respondError,
  respondErrorFromCause,
  respondOk,
} from "../restResponse";
import { buildCommandHandlers, toolDefinitions } from "./handlers";
import { BrowserManagerService, type BrowserInstance } from "./Services/BrowserManager";

const API_ROUTE = "/api/browser";

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------
//
// `GET /api/browser` returns the tool registry.
// `POST /api/browser` accepts `{ tool: string, input: object }` and dispatches
// through `buildCommandHandlers(ctx)` (see ./handlers.ts).
//
// Auth: `resolveAuth()` from ../restResponse — dev bypass (`t3-dev-bypass`
// with `?projectId=<uuid>&threadId=<uuid>`) in non-production, minted bearer
// tokens in production (via `managedRunService.issueMcpAccess`).
//
// Response envelope: standard T3 `{ data: { message, data }, error }`. For
// successful command calls the inner `data` is `{ output: string }` —
// plaintext per gstack's contract, wrapped so the outer envelope stays
// consistent with the other REST services.
// ---------------------------------------------------------------------------

const handleGet = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const auth = yield* resolveAuth(webRequest);
  if (!auth) return respondError("Unauthorized", 401);
  return respondOk(toolDefinitions, "Available tools");
});

const handlePost = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const auth = yield* resolveAuth(webRequest);
  if (!auth) return respondError("Unauthorized", 401);

  const body = yield* Effect.promise(() => parseToolCallBody(webRequest));
  if (!body) return respondError("Invalid request body. Expected: { tool: string, input: object }");

  const browser = yield* BrowserManagerService;
  const handlers = buildCommandHandlers({
    browser,
    projectId: auth.projectId,
    threadId: auth.threadId,
  });

  const handler = handlers[body.tool];
  if (!handler) return respondError(`Unknown tool: ${body.tool}`);

  return yield* handler(body.input).pipe(
    Effect.catchCause((cause) => Effect.succeed(respondErrorFromCause(cause))),
  );
});

// ---------------------------------------------------------------------------
// Route layer
// ---------------------------------------------------------------------------

export const browserRouteLayer = Layer.mergeAll(
  HttpRouter.add("GET", API_ROUTE, handleGet),
  HttpRouter.add("POST", API_ROUTE, handlePost),
);

// Re-export so downstream helpers can build on the typed instance shape
// without a deep import path.
export type { BrowserInstance };

// Silence unused-import diagnostics — we re-export this above so the ambient
// symbol stays reachable without adding a dead-looking import.
void HttpServerResponse;
