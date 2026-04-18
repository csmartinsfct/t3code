import { it, assert, vi } from "@effect/vitest";
import { Effect, Layer, Option, Stream } from "effect";
import { ThreadId } from "@t3tools/contracts";

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
import { makeGeminiAdapterLive } from "./GeminiAdapter";

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
  autoBootstrapProjectFromCwd: false,
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
      return { stopReason: "end_turn" };
    }),
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
    const events = yield* Stream.take(adapter.streamEvents, 10).pipe(Stream.runCollect);
    const eventTypes = Array.from(events).map((event) => event.type);

    assert.equal(turn.threadId, threadId);
    assert.ok(turn.turnId.startsWith("gemini-turn-"));
    assert.deepEqual(eventTypes, [
      "session.started",
      "thread.started",
      "session.state.changed",
      "session.state.changed",
      "turn.started",
      "item.started",
      "content.delta",
      "item.completed",
      "turn.completed",
      "session.state.changed",
    ]);
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
    yield* Stream.take(adapter.streamEvents, 10).pipe(Stream.runCollect);

    const promptInput = vi.mocked(createdConnections[0]!.prompt).mock.calls[0]?.[0];
    assert.ok(promptInput);
    assert.match(promptInput.text, /Use the referenced T3 session context/);
    assert.match(promptInput.text, /User request:\nInspect the project\./);
    assert.equal(promptInput.embeddedContext?.uri, "t3://session/context");
    assert.equal(promptInput.embeddedContext?.mimeType, "text/markdown");
    assert.match(promptInput.embeddedContext?.text ?? "", /## T3 Project Context/);
    assert.match(promptInput.embeddedContext?.text ?? "", /Gemini Project/);
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
    assert.deepEqual(vi.mocked(resumedConnection.loadSession).mock.calls[0]?.[0], {
      sessionId: "gemini-session-resumed",
      cwd: "/workspace/gemini-worktree",
      mcpServers: [],
    });
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
