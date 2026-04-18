import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import { resolveAuth, respondError, respondOk, type ToolDefinition } from "../restResponse";
import { SessionRestartService } from "./Services/SessionRestart";

const API_ROUTE = "/api/session-restart";

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "restart_session",
    title: "Restart Session",
    description:
      "Stop and resume the current agent session (Codex, Claude SDK, etc.). " +
      "Use this after installing a new MCP server that needs a fresh process, or when a " +
      "tool call (commonly chrome-devtools) has deadlocked. " +
      "The tool returns immediately. Your turn will end, the session will be stopped, then " +
      "resumed with the full prior conversation context preserved. The resumed session will " +
      "receive a short continuation prompt telling it to continue. Do not call this casually.",
    inputSchema: {},
  },
];

const handleGet = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const auth = yield* resolveAuth(webRequest);
  if (!auth) return respondError("Unauthorized", 401);
  return respondOk(TOOL_DEFINITIONS, "Available tools");
});

const handlePost = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const auth = yield* resolveAuth(webRequest);
  if (!auth) return respondError("Unauthorized", 401);

  const body = (yield* Effect.promise(() => webRequest.json().catch(() => null))) as {
    tool?: unknown;
  } | null;
  if (!body || body.tool !== "restart_session") {
    return respondError(
      'Invalid request body. Expected: { "tool": "restart_session", "input": {} }',
    );
  }

  const sessionRestart = yield* SessionRestartService;
  yield* sessionRestart.scheduleRestart({ threadId: auth.threadId });

  return respondOk({
    scheduled: true,
    followUpMessage:
      "Your turn will end, the underlying agent process will be stopped, and a fresh " +
      "process will resume with full prior context. You will receive a short continuation " +
      "prompt as the first message of the resumed session.",
  });
});

export const sessionRestartRouteLayer = Layer.mergeAll(
  HttpRouter.add("GET", API_ROUTE, handleGet),
  HttpRouter.add("POST", API_ROUTE, handlePost),
);
