import { mkdir, writeFile } from "node:fs/promises";

import { it, assert, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Option, Stream } from "effect";
import { ApprovalRequestId, ThreadId } from "@t3tools/contracts";

import { ServerConfig, type ServerConfigShape } from "../../config";
import { ManagedRunService } from "../../managedRuns/Services/ManagedRuns";
import {
  ProjectionSnapshotQuery,
  type ProjectionThreadCheckpointContext,
} from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ServerSettingsService } from "../../serverSettings";
import { GeminiAdapter } from "../Services/GeminiAdapter";
import type {
  GeminiAcpConnection,
  GeminiAcpConnectionOptions,
} from "../gemini/GeminiAcpConnection";
import {
  canonicalPermissionRequestType,
  flushGeminiSanitizeTail,
  makeGeminiAdapterLive,
  sanitizeGeminiStreamChunk,
} from "./GeminiAdapter";

const serverConfigTestLayer = Layer.succeed(ServerConfig, {
  logLevel: "Error",
  traceMinLevel: "Info",
  traceTimingEnabled: true,
  traceBatchWindowMs: 200,
  traceMaxBytes: 10 * 1024 * 1024,
  traceMaxFiles: 10,
  otlpTracesUrl: undefined,
  otlpMetricsUrl: undefined,
  otlpExportIntervalMs: 10_000,
  otlpServiceName: "t3-server",
  cwd: "/tmp/project",
  baseDir: "/tmp/t3",
  stateDir: "/tmp/t3/dev",
  dbPath: "/tmp/t3/dev/state.sqlite",
  keybindingsConfigPath: "/tmp/t3/dev/keybindings.json",
  settingsPath: "/tmp/t3/dev/settings.json",
  worktreesDir: "/tmp/t3/worktrees",
  attachmentsDir: "/tmp/t3/dev/attachments",
  logsDir: "/tmp/t3/dev/logs",
  serverLogPath: "/tmp/t3/dev/logs/server.log",
  serverTracePath: "/tmp/t3/dev/logs/server.trace.ndjson",
  providerLogsDir: "/tmp/t3/dev/logs/provider",
  providerEventLogPath: "/tmp/t3/dev/logs/provider/events.log",
  terminalLogsDir: "/tmp/t3/dev/logs/terminals",
  anonymousIdPath: "/tmp/t3/dev/anonymous-id",
  mode: "web",
  logWebSocketEvents: false,
  port: 3773,
  host: undefined,
  authToken: undefined,
  staticDir: undefined,
  devUrl: new URL("http://localhost:5733"),
  noBrowser: false,
} satisfies ServerConfigShape);

const managedRunServiceTestLayer = Layer.succeed(ManagedRunService, {
  launchProjectScript: () => Effect.die(new Error("not mocked")),
  list: () => Effect.succeed([]),
  get: () => Effect.die(new Error("not mocked")),
  getLogs: () => Effect.succeed([]),
  listInferenceRecords: () => Effect.succeed([]),
  getInferenceRecord: () => Effect.die(new Error("not mocked")),
  stop: () => Effect.void,
  streamEvents: () => Stream.empty,
  streamLogs: () => Stream.empty,
  cleanupOrphansForProject: () => Effect.void,
  issueMcpAccess: (projectId, threadId) =>
    Effect.succeed({ token: "test-token", projectId, threadId }),
  resolveContextForToken: () => Effect.succeed(null),
});

function makeProjectionSnapshotQueryTestLayer(
  context: ProjectionThreadCheckpointContext | null = null,
) {
  return Layer.succeed(ProjectionSnapshotQuery, {
    getSnapshot: () => Effect.die(new Error("not mocked")),
    getStartupSnapshot: () => Effect.die(new Error("not mocked")),
    listProjects: () => Effect.die(new Error("not mocked")),
    getThreadContent: () => Effect.die(new Error("not mocked")),
    getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
    getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
    getProjectById: () => Effect.succeed(Option.none()),
    getThreadById: () => Effect.succeed(Option.none()),
    hasThreadUserMessages: () => Effect.succeed(Option.none()),
    getThreadCheckpointContext: () =>
      context === null ? Effect.succeed(Option.none()) : Effect.succeed(Option.some(context)),
  });
}

function makeGeminiTestLayer(
  createConnection: (options: GeminiAcpConnectionOptions) => GeminiAcpConnection,
  context: ProjectionThreadCheckpointContext | null = null,
) {
  return makeGeminiAdapterLive({ createConnection }).pipe(
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(serverConfigTestLayer),
    Layer.provideMerge(managedRunServiceTestLayer),
    Layer.provideMerge(makeProjectionSnapshotQueryTestLayer(context)),
    Layer.provideMerge(NodeServices.layer),
  );
}

function makeCheckpointContext(
  threadId: ThreadId = ThreadId.makeUnsafe("thread-gemini-context"),
): ProjectionThreadCheckpointContext {
  return {
    threadId,
    projectId: "project-gemini" as ProjectionThreadCheckpointContext["projectId"],
    projectTitle: "Gemini Project",
    workspaceRoot: "/workspace/gemini",
    worktreePath: "/workspace/gemini-worktree",
    systemPrompt: "Always follow the Gemini project prompt.",
    checkpoints: [],
  };
}

function makeFakeConnection(options: GeminiAcpConnectionOptions): GeminiAcpConnection {
  return {
    childPid: 123,
    initialize: vi.fn(async () => ({ protocolVersion: 1 })),
    newSession: vi.fn(async () => ({
      sessionId: "gemini-session-1",
      result: { sessionId: "gemini-session-1" },
    })),
    loadSession: vi.fn(async () => null),
    forkSession: vi.fn(async () => ({
      sessionId: "gemini-session-forked",
      result: { sessionId: "gemini-session-forked" },
    })),
    setModel: vi.fn(async () => undefined),
    setMode: vi.fn(async () => undefined),
    prompt: vi.fn(async (input) => {
      options.onNotification?.({
        method: "session/update",
        params: {
          sessionId: input.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Hello from Gemini" },
          },
        },
      });
      return {
        stopReason: "end_turn",
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          thoughtTokens: 2,
          totalTokens: 22,
        },
      };
    }),
    respond: vi.fn(),
    cancel: vi.fn(async () => undefined),
    close: vi.fn(),
  };
}

it.effect("GeminiAdapterLive starts an ACP session and sends a text turn", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;
    const threadId = ThreadId.makeUnsafe("thread-gemini");

    const session = yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      modelSelection: { provider: "gemini", model: "gemini-3.1-pro-preview" },
      runtimeMode: "full-access",
    });

    assert.equal(session.provider, "gemini");
    assert.deepEqual(session.resumeCursor, {
      sessionId: "gemini-session-1",
      cwd: "/tmp/project",
    });

    const turn = yield* adapter.sendTurn({
      threadId,
      input: "Say hello",
      modelSelection: { provider: "gemini", model: "gemini-3.1-pro-preview" },
    });
    const events = yield* Stream.take(adapter.streamEvents, 12).pipe(Stream.runCollect);
    const eventTypes = Array.from(events).map((event) => event.type);

    assert.equal(turn.threadId, threadId);
    assert.ok(turn.turnId.startsWith("gemini-turn-"));
    assert.deepEqual(eventTypes, [
      "session.started",
      "thread.started",
      "session.state.changed",
      "account.rate-limits.updated",
      "session.state.changed",
      "turn.started",
      "item.started",
      "content.delta",
      "thread.token-usage.updated",
      "item.completed",
      "turn.completed",
      "session.state.changed",
    ]);
    const usageEvent = Array.from(events).find(
      (event) => event.type === "thread.token-usage.updated",
    );
    assert.equal(usageEvent?.type, "thread.token-usage.updated");
    if (usageEvent?.type === "thread.token-usage.updated") {
      assert.deepEqual(usageEvent.payload.usage, {
        usedTokens: 22,
        totalProcessedTokens: 22,
        lastUsedTokens: 22,
        inputTokens: 12,
        lastInputTokens: 12,
        outputTokens: 8,
        lastOutputTokens: 8,
        reasoningOutputTokens: 2,
        lastReasoningOutputTokens: 2,
        compactsAutomatically: true,
      });
    }
    assert.equal(createdConnections.length, 1);
    assert.deepEqual(vi.mocked(createdConnections[0]!.setModel).mock.calls[0]?.[0], {
      sessionId: "gemini-session-1",
      modelId: "gemini-3.1-pro-preview",
    });
    assert.equal(vi.mocked(createdConnections[0]!.prompt).mock.calls[0]?.[0].text, "Say hello");
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        const connection = makeFakeConnection(options);
        createdConnections.push(connection);
        return connection;
      }),
    ),
  );
});

it.effect("GeminiAdapterLive maps ACP quota token counts to token usage", () => {
  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;
    const threadId = ThreadId.makeUnsafe("thread-gemini-quota-usage");

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      modelSelection: { provider: "gemini", model: "gemini-2.5-flash" },
      runtimeMode: "full-access",
    });

    yield* adapter.sendTurn({
      threadId,
      input: "Say hello",
      modelSelection: { provider: "gemini", model: "gemini-2.5-flash" },
    });
    const events = yield* Stream.take(adapter.streamEvents, 12).pipe(Stream.runCollect);
    const usageEvent = Array.from(events).find(
      (event) => event.type === "thread.token-usage.updated",
    );

    assert.equal(usageEvent?.type, "thread.token-usage.updated");
    if (usageEvent?.type === "thread.token-usage.updated") {
      assert.deepEqual(usageEvent.payload.usage, {
        usedTokens: 20,
        totalProcessedTokens: 20,
        lastUsedTokens: 20,
        inputTokens: 14,
        lastInputTokens: 14,
        outputTokens: 6,
        lastOutputTokens: 6,
        compactsAutomatically: true,
      });
    }
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        const connection = {
          ...makeFakeConnection(options),
          prompt: vi.fn(async (input) => {
            options.onNotification?.({
              method: "session/update",
              params: {
                sessionId: input.sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "Hello from Gemini" },
                },
              },
            });
            return {
              stopReason: "end_turn",
              _meta: {
                quota: {
                  token_count: {
                    input_tokens: 14,
                    output_tokens: 6,
                  },
                  model_usage: [
                    {
                      model: "gemini-2.5-flash",
                      token_count: {
                        input_tokens: 14,
                        output_tokens: 6,
                      },
                    },
                  ],
                },
              },
            };
          }),
        };
        return connection;
      }),
    ),
  );
});

it.effect("GeminiAdapterLive maps ACP usage update size to max tokens", () => {
  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;
    const threadId = ThreadId.makeUnsafe("thread-gemini-usage-update-size");

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      modelSelection: { provider: "gemini", model: "gemini-2.5-flash" },
      runtimeMode: "full-access",
    });

    yield* adapter.sendTurn({
      threadId,
      input: "Say hello",
      modelSelection: { provider: "gemini", model: "gemini-2.5-flash" },
    });
    const events = yield* Stream.take(adapter.streamEvents, 9).pipe(Stream.runCollect);
    const usageEvent = Array.from(events).find(
      (event) => event.type === "thread.token-usage.updated",
    );

    assert.equal(usageEvent?.type, "thread.token-usage.updated");
    if (usageEvent?.type === "thread.token-usage.updated") {
      assert.deepEqual(usageEvent.payload.usage, {
        usedTokens: 42_000,
        maxTokens: 128_000,
        compactsAutomatically: true,
      });
    }
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        const connection = {
          ...makeFakeConnection(options),
          prompt: vi.fn(async (input) => {
            options.onNotification?.({
              method: "session/update",
              params: {
                sessionId: input.sessionId,
                update: {
                  sessionUpdate: "usage_update",
                  used: 42_000,
                  size: 128_000,
                },
              },
            });
            return { stopReason: "end_turn" };
          }),
        };
        return connection;
      }),
    ),
  );
});

it.effect("GeminiAdapterLive maps runtime mode to Gemini approval and sandbox options", () => {
  const createdOptions: GeminiAcpConnectionOptions[] = [];
  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;

    yield* adapter.startSession({
      threadId: ThreadId.makeUnsafe("thread-gemini-full-access"),
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    yield* adapter.startSession({
      threadId: ThreadId.makeUnsafe("thread-gemini-supervised"),
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "approval-required",
    });

    assert.equal(createdOptions[0]?.approvalMode, "yolo");
    assert.equal(createdOptions[0]?.sandbox, false);
    assert.equal(createdOptions[1]?.approvalMode, "default");
    assert.equal(createdOptions[1]?.sandbox, undefined);
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        createdOptions.push(options);
        return makeFakeConnection(options);
      }),
    ),
  );
});

it.effect("GeminiAdapterLive restores yolo mode for full-access default turns", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;
    const threadId = ThreadId.makeUnsafe("thread-gemini-full-access-default-mode");

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    yield* adapter.sendTurn({
      threadId,
      input: "Use default chat behavior.",
      interactionMode: "default",
    });

    assert.deepEqual(vi.mocked(createdConnections[0]!.setMode).mock.calls[0]?.[0], {
      sessionId: "gemini-session-1",
      modeId: "yolo",
    });
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        const connection = makeFakeConnection(options);
        createdConnections.push(connection);
        return connection;
      }),
    ),
  );
});

it.effect("GeminiAdapterLive restores default mode for supervised default turns", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;
    const threadId = ThreadId.makeUnsafe("thread-gemini-supervised-default-mode");

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "approval-required",
    });
    yield* adapter.sendTurn({
      threadId,
      input: "Use supervised chat behavior.",
      interactionMode: "default",
    });

    assert.deepEqual(vi.mocked(createdConnections[0]!.setMode).mock.calls[0]?.[0], {
      sessionId: "gemini-session-1",
      modeId: "default",
    });
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        const connection = makeFakeConnection(options);
        createdConnections.push(connection);
        return connection;
      }),
    ),
  );
});

it.effect("GeminiAdapterLive keeps Gemini plan mode above full-access turns", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;
    const threadId = ThreadId.makeUnsafe("thread-gemini-full-access-plan-mode");

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    yield* adapter.sendTurn({
      threadId,
      input: "Plan this change first.",
      interactionMode: "plan",
    });

    assert.deepEqual(vi.mocked(createdConnections[0]!.setMode).mock.calls[0]?.[0], {
      sessionId: "gemini-session-1",
      modeId: "plan",
    });
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        const connection = makeFakeConnection(options);
        createdConnections.push(connection);
        return connection;
      }),
    ),
  );
});

it.effect("GeminiAdapterLive injects T3 session context on the first prompt", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-context");
  const checkpointContext = makeCheckpointContext(threadId);

  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;

    const session = yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/workspace/gemini-worktree",
      runtimeMode: "full-access",
    });

    const startCursor = session.resumeCursor as {
      contextPromptHash?: string;
      contextPromptInjected?: boolean;
    };
    assert.equal(typeof startCursor.contextPromptHash, "string");
    assert.equal(startCursor.contextPromptInjected, false);

    const turn = yield* adapter.sendTurn({
      threadId,
      input: "Inspect the project.",
    });
    yield* Stream.take(adapter.streamEvents, 12).pipe(Stream.runCollect);

    const promptInput = vi.mocked(createdConnections[0]!.prompt).mock.calls[0]?.[0];
    assert.ok(promptInput);
    assert.match(promptInput.text ?? "", /Use the referenced T3 session context/);
    assert.match(promptInput.text ?? "", /Do not cite, quote, link, or mention/);
    assert.match(promptInput.text ?? "", /User request:\nInspect the project\./);
    assert.equal(promptInput.embeddedContext?.uri, "t3://session/context");
    assert.equal(promptInput.embeddedContext?.mimeType, "text/markdown");
    assert.match(promptInput.embeddedContext?.text ?? "", /## T3 Project Context/);
    assert.match(promptInput.embeddedContext?.text ?? "", /Gemini Project/);
    // All providers now receive the same REST-via-curl guidance.
    assert.match(promptInput.embeddedContext?.text ?? "", /no dedicated tools are registered/);
    assert.notMatch(
      promptInput.embeddedContext?.text ?? "",
      /Dedicated T3 MCP tools may be registered/,
    );
    assert.match(promptInput.embeddedContext?.text ?? "", /Authorization: Bearer test-token/);
    assert.match(
      promptInput.embeddedContext?.text ?? "",
      /Always follow the Gemini project prompt\./,
    );

    const turnCursor = turn.resumeCursor as { contextPromptInjected?: boolean };
    assert.equal(turnCursor.contextPromptInjected, true);
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        const connection = makeFakeConnection(options);
        createdConnections.push(connection);
        return connection;
      }, checkpointContext),
    ),
  );
});

it.effect("GeminiAdapterLive removes internal context references from assistant output", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-context-leak");
  const checkpointContext = makeCheckpointContext(threadId);

  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/workspace/gemini-worktree",
      runtimeMode: "full-access",
    });

    yield* adapter.sendTurn({
      threadId,
      input: "reply with ok",
    });
    const events = yield* Stream.take(adapter.streamEvents, 11).pipe(Stream.runCollect);

    const promptInput = vi.mocked(createdConnections[0]!.prompt).mock.calls[0]?.[0];
    assert.equal(promptInput?.embeddedContext?.uri, "t3://session/context");

    const deltaEvent = Array.from(events).find((event) => event.type === "content.delta");
    assert.equal(deltaEvent?.type, "content.delta");
    if (deltaEvent?.type === "content.delta") {
      assert.equal(deltaEvent.payload.delta, "ok");
      assert.equal(JSON.stringify(deltaEvent.raw).includes("t3://session/context"), false);
    }
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        const connection = {
          ...makeFakeConnection(options),
          prompt: vi.fn(async (input) => {
            options.onNotification?.({
              method: "session/update",
              params: {
                sessionId: input.sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "ok@t3://session/context" },
                },
              },
            });
            return { stopReason: "end_turn" };
          }),
        } satisfies GeminiAcpConnection;
        createdConnections.push(connection);
        return connection;
      }, checkpointContext),
    ),
  );
});

it.effect("GeminiAdapterLive removes internal context references after forking", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-fork-context-leak");
  const checkpointContext = makeCheckpointContext(threadId);

  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/workspace/gemini-worktree",
      runtimeMode: "full-access",
      resumeCursor: {
        sessionId: "gemini-session-source",
        cwd: "/workspace/gemini-worktree",
        fork: true,
      },
    });

    yield* adapter.sendTurn({
      threadId,
      input: "reply with ok",
    });
    const events = yield* Stream.take(adapter.streamEvents, 11).pipe(Stream.runCollect);

    const forkInput = vi.mocked(createdConnections[0]!.forkSession).mock.calls[0]?.[0];
    assert.equal(forkInput?.sessionId, "gemini-session-source");

    const promptInput = vi.mocked(createdConnections[0]!.prompt).mock.calls[0]?.[0];
    assert.equal(promptInput?.embeddedContext?.uri, "t3://session/context");

    const deltaEvent = Array.from(events).find((event) => event.type === "content.delta");
    assert.equal(deltaEvent?.type, "content.delta");
    if (deltaEvent?.type === "content.delta") {
      assert.equal(deltaEvent.payload.delta, "ok");
      assert.equal(JSON.stringify(deltaEvent.raw).includes("t3://session/context"), false);
    }
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        const connection = {
          ...makeFakeConnection(options),
          prompt: vi.fn(async (input) => {
            options.onNotification?.({
              method: "session/update",
              params: {
                sessionId: input.sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "ok@t3://session/context" },
                },
              },
            });
            return { stopReason: "end_turn" };
          }),
        } satisfies GeminiAcpConnection;
        createdConnections.push(connection);
        return connection;
      }, checkpointContext),
    ),
  );
});

it.effect("GeminiAdapterLive does not re-inject matching context on resume", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-resume-context");
  const checkpointContext = makeCheckpointContext(threadId);

  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;

    const initialSession = yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/workspace/gemini-worktree",
      runtimeMode: "full-access",
    });
    const initialCursor = initialSession.resumeCursor as {
      contextPromptHash?: string;
    };
    yield* adapter.stopSession(threadId);

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/workspace/gemini-worktree",
      runtimeMode: "full-access",
      resumeCursor: {
        sessionId: "gemini-session-resumed",
        cwd: "/workspace/gemini-worktree",
        contextPromptHash: initialCursor.contextPromptHash,
        contextPromptInjected: true,
      },
    });

    yield* adapter.sendTurn({
      threadId,
      input: "Continue.",
    });
    yield* Stream.take(adapter.streamEvents, 15).pipe(Stream.runCollect);

    const resumedConnection = createdConnections[1]!;
    const loadInput = vi.mocked(resumedConnection.loadSession).mock.calls[0]?.[0];
    assert.equal(loadInput?.sessionId, "gemini-session-resumed");
    assert.equal(loadInput?.cwd, "/workspace/gemini-worktree");
    // T3 does not register its own MCP bridge with Gemini; the REST-via-curl
    // injection is the unified delivery path for project tools.
    assert.equal(loadInput?.mcpServers, undefined);
    const promptInput = vi.mocked(resumedConnection.prompt).mock.calls[0]?.[0];
    assert.ok(promptInput);
    assert.equal(promptInput.text, "Continue.");
    assert.equal(promptInput.embeddedContext, undefined);
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        const connection = makeFakeConnection(options);
        createdConnections.push(connection);
        return connection;
      }, checkpointContext),
    ),
  );
});

it.effect("GeminiAdapterLive does not register its own MCP server with Gemini", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-mcp");
  const checkpointContext = makeCheckpointContext(threadId);

  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/workspace/gemini-worktree",
      runtimeMode: "full-access",
    });

    // Unified REST-via-curl injection: no MCP bridge is advertised by T3.
    // Any MCP servers users configure in ~/.gemini/settings.json are still
    // discovered by the Gemini CLI itself.
    const newSessionInput = vi.mocked(createdConnections[0]!.newSession).mock.calls[0]?.[0];
    assert.equal(newSessionInput?.mcpServers, undefined);
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        const connection = makeFakeConnection(options);
        createdConnections.push(connection);
        return connection;
      }, checkpointContext),
    ),
  );
});

it.effect("GeminiAdapterLive maps Gemini permission requests to approval events", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  const createdOptions: GeminiAcpConnectionOptions[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-approval");
  let resolvePrompt: ((value: unknown) => void) | undefined;

  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "approval-required",
    });
    yield* adapter.sendTurn({
      threadId,
      input: "Need approval",
      modelSelection: { provider: "gemini", model: "gemini-3.1-pro-preview" },
    });

    createdOptions[0]!.onRequest?.({
      id: 77,
      method: "session/request_permission",
      params: {
        toolCall: { kind: "execute", title: "Run npm install" },
        options: [
          { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
          { optionId: "allow-always", kind: "allow_always", name: "Allow always" },
          { optionId: "reject-once", kind: "reject_once", name: "Reject" },
        ],
      },
    });

    const events = yield* Stream.take(adapter.streamEvents, 7).pipe(Stream.runCollect);
    const opened = Array.from(events).find((event) => event.type === "request.opened");
    assert.equal(opened?.type, "request.opened");
    if (opened?.type !== "request.opened" || !opened.requestId) {
      assert.fail("Expected Gemini approval request event");
    }
    assert.equal(opened.payload.requestType, "command_execution_approval");
    assert.equal(opened.payload.detail, "Run npm install");

    yield* adapter.respondToRequest(
      threadId,
      ApprovalRequestId.makeUnsafe(opened.requestId),
      "acceptForSession",
    );
    const response = vi.mocked(createdConnections[0]!.respond).mock.calls[0]?.[0] as {
      id?: number;
      result?: { outcome?: { outcome?: string; optionId?: string } };
    };
    assert.equal(response.id, 77);
    assert.equal(response.result?.outcome?.outcome, "selected");
    assert.equal(response.result?.outcome?.optionId, "allow-always");

    const resolved = yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runCollect);
    assert.equal(Array.from(resolved)[0]?.type, "request.resolved");
    resolvePrompt?.({ stopReason: "end_turn" });
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        createdOptions.push(options);
        const connection = {
          ...makeFakeConnection(options),
          prompt: vi.fn(
            () =>
              new Promise<unknown>((resolve) => {
                resolvePrompt = resolve;
              }),
          ),
        };
        createdConnections.push(connection);
        return connection;
      }),
    ),
  );
});

it.effect("GeminiAdapterLive classifies MCP list permissions from Gemini tool titles", () => {
  const createdOptions: GeminiAcpConnectionOptions[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-mcp-approval");
  let resolvePrompt: ((value: unknown) => void) | undefined;

  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "approval-required",
    });
    yield* adapter.sendTurn({
      threadId,
      input: "Need MCP approval",
      modelSelection: { provider: "gemini", model: "gemini-3.1-pro-preview" },
    });

    createdOptions[0]!.onRequest?.({
      id: 78,
      method: "session/request_permission",
      params: {
        toolCall: {
          kind: "other",
          title: "ticketing__list_tickets (t3-code MCP Server)",
          toolCallId: "mcp_t3-code_ticketing__list_tickets-1",
        },
        options: [{ optionId: "proceed_once", kind: "allow_once", name: "Allow" }],
      },
    });

    const events = yield* Stream.take(adapter.streamEvents, 7).pipe(Stream.runCollect);
    const opened = Array.from(events).find((event) => event.type === "request.opened");
    assert.equal(opened?.type, "request.opened");
    if (opened?.type !== "request.opened") {
      assert.fail("Expected Gemini MCP approval request event");
    }
    // Generic MCP tool call without a file-semantic ACP kind is classified as
    // a dynamic tool call, not as a file read. Prior behavior scanned the
    // `toolCallId` and incorrectly matched on `list_tickets`.
    assert.equal(opened.payload.requestType, "dynamic_tool_call");
    assert.equal(opened.payload.detail, "ticketing__list_tickets (t3-code MCP Server)");
    resolvePrompt?.({ stopReason: "end_turn" });
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        createdOptions.push(options);
        return {
          ...makeFakeConnection(options),
          prompt: vi.fn(
            () =>
              new Promise<unknown>((resolve) => {
                resolvePrompt = resolve;
              }),
          ),
        };
      }),
    ),
  );
});

it.effect("GeminiAdapterLive fails unsupported ACP client requests without hanging", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  const createdOptions: GeminiAcpConnectionOptions[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-unsupported-request");

  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });

    createdOptions[0]!.onRequest?.({
      id: 88,
      method: "session/unsupported_client_request",
      params: { ok: false },
    });

    assert.deepEqual(vi.mocked(createdConnections[0]!.respond).mock.calls[0]?.[0], {
      id: 88,
      error: {
        code: -32601,
        message: "Unsupported Gemini ACP client request: session/unsupported_client_request.",
      },
    });

    const events = yield* Stream.take(adapter.streamEvents, 5).pipe(Stream.runCollect);
    assert.equal(Array.from(events).at(-1)?.type, "runtime.warning");
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        createdOptions.push(options);
        const connection = makeFakeConnection(options);
        createdConnections.push(connection);
        return connection;
      }),
    ),
  );
});

it.effect("GeminiAdapterLive reports rollback as unsupported by ACP", () => {
  const threadId = ThreadId.makeUnsafe("thread-gemini-rollback");

  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });

    const failure = yield* Effect.flip(adapter.rollbackThread(threadId, 1));
    if (failure._tag !== "ProviderAdapterRequestError") {
      assert.fail(`Expected ProviderAdapterRequestError, got ${failure._tag}`);
    }
    assert.include(failure.detail, "Gemini ACP");
    assert.include(failure.detail, "rewind");
  }).pipe(Effect.provide(makeGeminiTestLayer((options) => makeFakeConnection(options))));
});

it.effect("GeminiAdapterLive cancels late Gemini permission requests after a failed turn", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  const createdOptions: GeminiAcpConnectionOptions[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-late-request");

  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    yield* adapter.sendTurn({
      threadId,
      input: "Trigger a failed turn",
      modelSelection: { provider: "gemini", model: "gemini-3.1-pro-preview" },
    });
    yield* Stream.take(adapter.streamEvents, 9).pipe(Stream.runCollect);

    createdOptions[0]!.onRequest?.({
      id: 77,
      method: "session/request_permission",
      params: {
        toolCall: {
          kind: "execute",
          title: "echo late",
        },
        options: [{ optionId: "proceed_once", kind: "allow_once" }],
      },
    });

    assert.deepEqual(vi.mocked(createdConnections[0]!.respond).mock.calls.at(-1)?.[0], {
      id: 77,
      result: { outcome: { outcome: "cancelled" } },
    });
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        createdOptions.push(options);
        const connection = {
          ...makeFakeConnection(options),
          prompt: vi.fn(async () => {
            throw new Error("simulated Gemini prompt failure");
          }),
        };
        createdConnections.push(connection);
        return connection;
      }),
    ),
  );
});

it.effect("GeminiAdapterLive replies to Gemini user-input requests", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  const createdOptions: GeminiAcpConnectionOptions[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-user-input");
  let resolvePrompt: ((value: unknown) => void) | undefined;

  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    yield* adapter.sendTurn({
      threadId,
      input: "Need user input",
      modelSelection: { provider: "gemini", model: "gemini-3.1-pro-preview" },
    });

    createdOptions[0]!.onRequest?.({
      id: 99,
      method: "item/tool/requestUserInput",
      params: {
        questions: [
          {
            id: "choice",
            header: "Choice",
            question: "Pick one",
            options: [{ label: "A", description: "Choose A" }],
          },
        ],
      },
    });

    const events = yield* Stream.take(adapter.streamEvents, 7).pipe(Stream.runCollect);
    const requested = Array.from(events).find((event) => event.type === "user-input.requested");
    assert.equal(requested?.type, "user-input.requested");
    if (requested?.type !== "user-input.requested" || !requested.requestId) {
      assert.fail("Expected Gemini user-input request event");
    }
    assert.equal(requested.payload.questions[0]?.id, "choice");

    yield* adapter.respondToUserInput(threadId, ApprovalRequestId.makeUnsafe(requested.requestId), {
      choice: "A",
    });
    assert.deepEqual(vi.mocked(createdConnections[0]!.respond).mock.calls[0]?.[0], {
      id: 99,
      result: { answers: { choice: "A" } },
    });

    const resolved = yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runCollect);
    assert.equal(Array.from(resolved)[0]?.type, "user-input.resolved");
    resolvePrompt?.({ stopReason: "end_turn" });
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        createdOptions.push(options);
        const connection = {
          ...makeFakeConnection(options),
          prompt: vi.fn(
            () =>
              new Promise<unknown>((resolve) => {
                resolvePrompt = resolve;
              }),
          ),
        };
        createdConnections.push(connection);
        return connection;
      }),
    ),
  );
});

it.effect("GeminiAdapterLive forwards supported image attachments to ACP prompts", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-image");
  const attachmentId = "thread-gemini-image-00000000-0000-4000-8000-000000000001";

  return Effect.gen(function* () {
    yield* Effect.promise(async () => {
      await mkdir("/tmp/t3/dev/attachments", { recursive: true });
      await writeFile(
        "/tmp/t3/dev/attachments/thread-gemini-image-00000000-0000-4000-8000-000000000001.png",
        Buffer.from([1, 2, 3, 4]),
      );
    });

    const adapter = yield* GeminiAdapter;

    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });

    yield* adapter.sendTurn({
      threadId,
      input: "Describe this image.",
      attachments: [
        {
          type: "image",
          id: attachmentId,
          name: "sample.png",
          mimeType: "image/png",
          sizeBytes: 4,
        },
      ],
    });
    yield* Stream.take(adapter.streamEvents, 12).pipe(Stream.runCollect);

    const promptInput = vi.mocked(createdConnections[0]!.prompt).mock.calls[0]?.[0];
    assert.equal(promptInput?.images?.length, 1);
    assert.equal(promptInput?.images?.[0]?.mimeType, "image/png");
    assert.equal(promptInput?.images?.[0]?.data, Buffer.from([1, 2, 3, 4]).toString("base64"));
    assert.equal(promptInput?.images?.[0]?.uri, `t3://attachment/${attachmentId}`);
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        const connection = makeFakeConnection(options);
        createdConnections.push(connection);
        return connection;
      }),
    ),
  );
});

it.effect("GeminiAdapterLive forks Gemini sessions when the resume cursor requests a fork", () => {
  const createdConnections: GeminiAcpConnection[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-fork");
  const checkpointContext = makeCheckpointContext(threadId);

  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;

    const session = yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/workspace/gemini-worktree",
      runtimeMode: "full-access",
      resumeCursor: {
        sessionId: "gemini-session-source",
        cwd: "/workspace/gemini-worktree",
        fork: true,
      },
    });

    const forkInput = vi.mocked(createdConnections[0]!.forkSession).mock.calls[0]?.[0];
    assert.equal(forkInput?.sessionId, "gemini-session-source");
    assert.equal(forkInput?.cwd, "/workspace/gemini-worktree");
    assert.equal(forkInput?.mcpServers, undefined);
    const cursor = session.resumeCursor as {
      sessionId?: string;
      cwd?: string;
      contextPromptHash?: string;
      contextPromptInjected?: boolean;
    };
    assert.equal(cursor.sessionId, "gemini-session-forked");
    assert.equal(cursor.cwd, "/workspace/gemini-worktree");
    assert.equal(typeof cursor.contextPromptHash, "string");
    assert.equal(cursor.contextPromptInjected, false);
    assert.equal(vi.mocked(createdConnections[0]!.loadSession).mock.calls.length, 0);
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        const connection = makeFakeConnection(options);
        createdConnections.push(connection);
        return connection;
      }, checkpointContext),
    ),
  );
});

// ---------------------------------------------------------------------------
// Streaming sanitizer (FU-1)
// ---------------------------------------------------------------------------

function runStreamSanitize(chunks: ReadonlyArray<string>): string {
  let tail = "";
  let emitted = "";
  for (const chunk of chunks) {
    const result = sanitizeGeminiStreamChunk(tail, chunk);
    tail = result.tail;
    emitted += result.emit;
  }
  emitted += flushGeminiSanitizeTail(tail);
  return emitted;
}

it("sanitizeGeminiStreamChunk strips the bare URI regardless of split boundary", () => {
  const text = "ok@t3://session/context done";
  for (let splitAt = 0; splitAt <= text.length; splitAt++) {
    const a = text.slice(0, splitAt);
    const b = text.slice(splitAt);
    const result = runStreamSanitize([a, b]);
    assert.equal(
      result.includes("t3://"),
      false,
      `split at ${splitAt} leaked t3://: ${JSON.stringify(result)}`,
    );
    assert.equal(
      result.includes("@"),
      false,
      `split at ${splitAt} leaked @: ${JSON.stringify(result)}`,
    );
    assert.equal(
      result.includes("<"),
      false,
      `split at ${splitAt} leaked <: ${JSON.stringify(result)}`,
    );
    assert.equal(
      result.includes(">"),
      false,
      `split at ${splitAt} leaked >: ${JSON.stringify(result)}`,
    );
    assert.match(result, /^ok\b/);
    assert.match(result, /\bdone$/);
  }
});

it("sanitizeGeminiStreamChunk handles the angle-bracketed form across boundaries", () => {
  const text = "see @<t3://session/context> here";
  for (let splitAt = 0; splitAt <= text.length; splitAt++) {
    const a = text.slice(0, splitAt);
    const b = text.slice(splitAt);
    const result = runStreamSanitize([a, b]);
    assert.equal(
      result.includes("t3://"),
      false,
      `angle split at ${splitAt} leaked: ${JSON.stringify(result)}`,
    );
    assert.equal(result.includes("@<"), false, `angle split at ${splitAt} leaked: ${result}`);
    assert.match(result, /^see\b/);
    assert.match(result, /\bhere$/);
  }
});

it("sanitizeGeminiStreamChunk collapses the markdown-link sentinel across boundaries", () => {
  const text = "read [Context](t3://session/context) carefully";
  for (let splitAt = 0; splitAt <= text.length; splitAt++) {
    const a = text.slice(0, splitAt);
    const b = text.slice(splitAt);
    const result = runStreamSanitize([a, b]);
    assert.equal(
      result.includes("t3://"),
      false,
      `md split at ${splitAt} leaked URL: ${JSON.stringify(result)}`,
    );
    assert.match(result, /^read\b/);
    assert.match(result, /\bcarefully$/);
    assert.match(result, /\bContext\b/);
    assert.equal(result.includes("]("), false, `md split at ${splitAt} left ']('`);
    assert.equal(result.includes("[Context]"), false, `md split at ${splitAt} left '[Context]'`);
  }
});

it("sanitizeGeminiStreamChunk preserves legit @ mentions and unrelated markdown links", () => {
  const text = "hey @alice, see [docs](https://example.com) please";
  for (let splitAt = 0; splitAt <= text.length; splitAt++) {
    const a = text.slice(0, splitAt);
    const b = text.slice(splitAt);
    const result = runStreamSanitize([a, b]);
    assert.equal(result, text, `split at ${splitAt} corrupted legit text: ${result}`);
  }
});

it("sanitizeGeminiStreamChunk emits a trailing @ untouched when followed by non-sentinel", () => {
  const result = runStreamSanitize(["Wait for response@", " thanks"]);
  assert.equal(result, "Wait for response@ thanks");
});

it("sanitizeGeminiStreamChunk drops a full sentinel delivered in a single chunk", () => {
  const result = runStreamSanitize(["@t3://session/context"]);
  assert.equal(result, "");
});

it("flushGeminiSanitizeTail preserves residue when a sentinel URI remains incomplete", () => {
  // If the stream ends with an incomplete URI it was never a real sentinel; the
  // residue is emitted verbatim so user-typed content resembling the URI is not
  // silently dropped.
  const result = runStreamSanitize(["Partial ref @t3://session/cont"]);
  assert.equal(result, "Partial ref @t3://session/cont");
});

it.effect(
  "GeminiAdapterLive streams boundary-split context references without leaking characters",
  () => {
    const createdConnections: GeminiAcpConnection[] = [];
    const threadId = ThreadId.makeUnsafe("thread-gemini-stream-leak");
    const checkpointContext = makeCheckpointContext(threadId);

    return Effect.gen(function* () {
      const adapter = yield* GeminiAdapter;

      yield* adapter.startSession({
        threadId,
        provider: "gemini",
        cwd: "/workspace/gemini-worktree",
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId,
        input: "reply with ok",
      });
      const events = yield* Stream.take(adapter.streamEvents, 12).pipe(Stream.runCollect);
      const deltaEvents = Array.from(events).filter((event) => event.type === "content.delta");
      const joined = deltaEvents
        .map((event) =>
          event.type === "content.delta" && event.payload.streamKind === "assistant_text"
            ? event.payload.delta
            : "",
        )
        .join("");
      assert.equal(joined.includes("t3://"), false, `leaked URL: ${JSON.stringify(joined)}`);
      assert.equal(joined.includes("@"), false, `leaked @: ${JSON.stringify(joined)}`);
      assert.match(joined, /^ok\b/);
    }).pipe(
      Effect.provide(
        makeGeminiTestLayer((options) => {
          const connection = {
            ...makeFakeConnection(options),
            prompt: vi.fn(async (input) => {
              // Split the reply across delta boundaries exactly in the middle
              // of the sentinel to reproduce the original leak.
              for (const chunk of ["ok@", "t3://session/", "context done"]) {
                options.onNotification?.({
                  method: "session/update",
                  params: {
                    sessionId: input.sessionId,
                    update: {
                      sessionUpdate: "agent_message_chunk",
                      content: { type: "text", text: chunk },
                    },
                  },
                });
              }
              return { stopReason: "end_turn" };
            }),
          } satisfies GeminiAcpConnection;
          createdConnections.push(connection);
          return connection;
        }, checkpointContext),
      ),
    );
  },
);

// ---------------------------------------------------------------------------
// Permission request classification (FU-3)
// ---------------------------------------------------------------------------

it("canonicalPermissionRequestType prefers ACP kind over name heuristics", () => {
  // ACP says execute; name looks like a file write. ACP kind wins.
  assert.deepEqual(
    canonicalPermissionRequestType({ kind: "execute", name: "fs-write", toolCallId: "xyz" }),
    { canonicalRequestType: "command_execution_approval", providerRequestKind: "command" },
  );
  assert.deepEqual(canonicalPermissionRequestType({ kind: "read", name: "delete-all" }), {
    canonicalRequestType: "file_read_approval",
    providerRequestKind: "file-read",
  });
});

it("canonicalPermissionRequestType uses word-boundary name matching when ACP kind is missing", () => {
  // `patch-mcp-config` has no ACP kind; `patch` is a word, so we classify as file_change.
  assert.deepEqual(canonicalPermissionRequestType({ name: "patch-mcp-config" }), {
    canonicalRequestType: "file_change_approval",
    providerRequestKind: "file-change",
  });
});

it("canonicalPermissionRequestType ignores tokens inside snake_case identifiers", () => {
  // `list_tickets` used to match the old `includes("list")` scan and falsely
  // classify as file_read. Word-boundary regex + no `toolCallId` scanning
  // leaves the call as `unknown` when nothing else provides a signal.
  const classification = canonicalPermissionRequestType({
    kind: "other",
    toolName: "list_tickets",
    toolCallId: "mcp_foo_list_tickets-1",
  });
  assert.equal(classification.canonicalRequestType, "unknown");
  // A title that does contain a standalone `MCP` word lifts it to dynamic tool.
  const withMcpTitle = canonicalPermissionRequestType({
    kind: "other",
    toolName: "list_tickets",
    title: "Call ticketing via MCP",
  });
  assert.equal(withMcpTitle.canonicalRequestType, "dynamic_tool_call");
});

it("canonicalPermissionRequestType recognises MCP/tool tokens only by word boundary", () => {
  assert.deepEqual(canonicalPermissionRequestType({ title: "Call MCP server" }), {
    canonicalRequestType: "dynamic_tool_call",
  });
  // `toolCallId` alone is no longer scanned, so a `mcp` inside an id does not
  // flip classification on its own.
  assert.deepEqual(canonicalPermissionRequestType({ toolCallId: "abc-mcp-123" }), {
    canonicalRequestType: "unknown",
  });
});

it("canonicalPermissionRequestType returns unknown when nothing matches", () => {
  assert.deepEqual(canonicalPermissionRequestType({ name: "frobulate" }), {
    canonicalRequestType: "unknown",
  });
  assert.deepEqual(canonicalPermissionRequestType({}), { canonicalRequestType: "unknown" });
  assert.deepEqual(canonicalPermissionRequestType(null), { canonicalRequestType: "unknown" });
});

it("canonicalPermissionRequestType treats ACP 'other' as fall-through, not automatic dynamic", () => {
  // `other` is ACP's generic bucket; we should use name/title to refine. A
  // plain "other" with a file-write name should classify as file_change.
  assert.deepEqual(canonicalPermissionRequestType({ kind: "other", name: "write-file" }), {
    canonicalRequestType: "file_change_approval",
    providerRequestKind: "file-change",
  });
});

// ---------------------------------------------------------------------------
// Runtime-mode → process launch args (FU-4)
// ---------------------------------------------------------------------------

it.effect("GeminiAdapterLive launches Gemini with yolo + no-sandbox in full-access mode", () => {
  const createdOptions: GeminiAcpConnectionOptions[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-runtime-full-access");
  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;
    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    assert.equal(createdOptions.length, 1);
    assert.equal(createdOptions[0]?.approvalMode, "yolo");
    assert.equal(createdOptions[0]?.sandbox, false);
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        createdOptions.push(options);
        return makeFakeConnection(options);
      }),
    ),
  );
});

it.effect("GeminiAdapterLive launches Gemini with approval-mode default in supervised mode", () => {
  const createdOptions: GeminiAcpConnectionOptions[] = [];
  const threadId = ThreadId.makeUnsafe("thread-gemini-runtime-supervised");
  return Effect.gen(function* () {
    const adapter = yield* GeminiAdapter;
    yield* adapter.startSession({
      threadId,
      provider: "gemini",
      cwd: "/tmp/project",
      runtimeMode: "approval-required",
    });
    assert.equal(createdOptions.length, 1);
    assert.equal(createdOptions[0]?.approvalMode, "default");
    // Sandbox is left unset so Gemini's own default (from settings.json or the
    // installed CLI) is honored — T3 only forces sandbox off in full-access.
    assert.equal(createdOptions[0]?.sandbox, undefined);
  }).pipe(
    Effect.provide(
      makeGeminiTestLayer((options) => {
        createdOptions.push(options);
        return makeFakeConnection(options);
      }),
    ),
  );
});

it("buildGeminiAcpArgs / buildGeminiAcpEnv enforce full-access vs supervised contract", async () => {
  // Import locally so we don't add a top-level dependency just for this test.
  const { buildGeminiAcpArgs, buildGeminiAcpEnv } = await import("../gemini/GeminiAcpConnection");

  const fullAccessArgs = buildGeminiAcpArgs({
    binaryPath: "gemini",
    approvalMode: "yolo",
    sandbox: false,
  });
  assert.deepEqual(fullAccessArgs, ["--acp", "--approval-mode", "yolo", "--no-sandbox"]);

  const fullAccessEnv = buildGeminiAcpEnv(
    { binaryPath: "gemini", sandbox: false },
    { GEMINI_SANDBOX: "true" },
  );
  assert.equal(fullAccessEnv.GEMINI_SANDBOX, "false");

  const supervisedArgs = buildGeminiAcpArgs({
    binaryPath: "gemini",
    approvalMode: "default",
  });
  assert.deepEqual(supervisedArgs, ["--acp", "--approval-mode", "default"]);

  const supervisedEnv = buildGeminiAcpEnv({ binaryPath: "gemini" }, { PRESERVED: "ok" });
  assert.equal(supervisedEnv.PRESERVED, "ok");
  // Supervised mode should not force `GEMINI_SANDBOX=false`.
  assert.equal(supervisedEnv.GEMINI_SANDBOX, undefined);
});
