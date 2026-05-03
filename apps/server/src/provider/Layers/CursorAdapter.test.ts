import { it, assert, vi } from "@effect/vitest";
import { ApprovalRequestId, ThreadId } from "@t3tools/contracts";
import { Effect, Layer, Option, Stream } from "effect";

import { ServerConfig, type ServerConfigShape } from "../../config";
import { ManagedRunService } from "../../managedRuns/Services/ManagedRuns";
import {
  ProjectionSnapshotQuery,
  type ProjectionThreadCheckpointContext,
} from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ServerSettingsService } from "../../serverSettings";
import { CursorAdapter } from "../Services/CursorAdapter";
import type {
  CursorAcpConnection,
  CursorAcpConnectionOptions,
  JsonRpcId,
} from "../cursor/CursorAcpConnection";
import { makeCursorAdapterLive, type CursorAdapterLiveOptions } from "./CursorAdapter";

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

const projectionSnapshotQueryTestLayer = Layer.succeed(ProjectionSnapshotQuery, {
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
    Effect.succeed(Option.none<ProjectionThreadCheckpointContext>()),
});

function makeCursorTestLayer(options: CursorAdapterLiveOptions) {
  return makeCursorAdapterLive(options).pipe(
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(serverConfigTestLayer),
    Layer.provideMerge(managedRunServiceTestLayer),
    Layer.provideMerge(projectionSnapshotQueryTestLayer),
  );
}

function sessionInfo(sessionId = "cursor-session-1") {
  return {
    sessionId,
    modes: { currentModeId: "agent", availableModes: [{ id: "agent" }, { id: "plan" }] },
    models: {
      currentModelId: "composer-2[fast=true]",
      availableModels: [{ modelId: "composer-2[fast=true]", name: "composer-2" }],
    },
    configOptions: [],
  };
}

function configOptionsOnlySessionInfo() {
  return {
    configOptions: [
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "plan",
        options: [
          { value: "agent", name: "Agent" },
          { value: "plan", name: "Plan" },
        ],
      },
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "composer-2[fast=true]",
        options: [{ value: "composer-2[fast=true]", name: "composer-2" }],
      },
    ],
  };
}

function makeFakeConnection(
  options: CursorAcpConnectionOptions,
  hooks: {
    readonly prompt?: () => Promise<unknown> | unknown;
    readonly sessionId?: string;
    readonly calls: Array<{ method: string; input?: unknown }>;
    readonly responses: Array<{ id: JsonRpcId; result?: unknown; error?: unknown }>;
  },
): CursorAcpConnection {
  const sessionId = hooks.sessionId ?? "cursor-session-1";
  return {
    childPid: 123,
    initialize: async () => {
      hooks.calls.push({ method: "initialize" });
      return {};
    },
    authenticate: async () => {
      hooks.calls.push({ method: "authenticate" });
      return {};
    },
    newSession: async (input) => {
      hooks.calls.push({ method: "session/new", input });
      return { sessionId, result: sessionInfo(sessionId) };
    },
    loadSession: async (input) => {
      hooks.calls.push({ method: "session/load", input });
      return sessionInfo(input.sessionId);
    },
    setConfigOption: async (input) => {
      hooks.calls.push({ method: "session/set_config_option", input });
      if (input.configId === "mode") {
        return configOptionsOnlySessionInfo();
      }
      return sessionInfo(sessionId);
    },
    prompt: async (input) => {
      hooks.calls.push({ method: "session/prompt", input });
      if (hooks.prompt) return await hooks.prompt();
      options.onNotification?.({
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello" },
          },
        },
      });
      return { stopReason: "end_turn" };
    },
    respond: (input) => {
      hooks.responses.push(input);
    },
    cancel: async (id) => {
      hooks.calls.push({ method: "session/cancel", input: id });
    },
    close: () => {
      hooks.calls.push({ method: "close" });
    },
  };
}

it.effect("CursorAdapterLive starts and sends turns through Cursor ACP", () => {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const responses: Array<{ id: JsonRpcId; result?: unknown; error?: unknown }> = [];
  const createConnection = vi.fn((options: CursorAcpConnectionOptions) =>
    makeFakeConnection(options, { calls, responses }),
  );

  return Effect.gen(function* () {
    const adapter = yield* CursorAdapter;
    const threadId = ThreadId.makeUnsafe("thread-cursor-acp");

    const session = yield* adapter.startSession({
      threadId,
      provider: "cursor",
      cwd: "/tmp/project",
      modelSelection: { provider: "cursor", model: "composer-2" },
      runtimeMode: "full-access",
    });

    assert.deepInclude(session.resumeCursor as Record<string, unknown>, {
      sessionId: "cursor-session-1",
      provider: "cursor",
      cwd: "/tmp/project",
      model: "composer-2",
    });

    yield* adapter.sendTurn({
      threadId,
      input: "Say hello",
      modelSelection: { provider: "cursor", model: "composer-2" },
      interactionMode: "plan",
    });

    const events = yield* Stream.take(adapter.streamEvents, 9).pipe(Stream.runCollect);
    const eventTypes = Array.from(events).map((event) => event.type);

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
    ]);
    assert.ok(calls.some((call) => call.method === "session/new"));
    assert.deepInclude(
      calls.find((call) => call.method === "session/set_config_option")?.input as Record<
        string,
        unknown
      >,
      {
        configId: "mode",
        value: "plan",
      },
    );
    assert.deepInclude(
      calls.filter((call) => call.method === "session/set_config_option")[1]?.input as Record<
        string,
        unknown
      >,
      {
        configId: "model",
        value: "composer-2[fast=true]",
      },
    );
    assert.ok(createConnection.mock.calls[0]?.[0].settings.binaryPath === "agent");
  }).pipe(Effect.provide(makeCursorTestLayer({ createConnection })));
});

it.effect("CursorAdapterLive captures Cursor ACP create_plan requests as proposed plans", () => {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const responses: Array<{ id: JsonRpcId; result?: unknown; error?: unknown }> = [];
  const createConnection = vi.fn((options: CursorAcpConnectionOptions) =>
    makeFakeConnection(options, {
      calls,
      responses,
      prompt: async () => {
        options.onRequest?.({
          id: 42,
          method: "cursor/create_plan",
          params: { toolCallId: "tool-plan-1", plan: "# Plan\n\nDo the thing." },
        });
        return { stopReason: "end_turn" };
      },
    }),
  );

  return Effect.gen(function* () {
    const adapter = yield* CursorAdapter;
    const threadId = ThreadId.makeUnsafe("thread-cursor-plan-acp");
    yield* adapter.startSession({
      threadId,
      provider: "cursor",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    yield* adapter.sendTurn({ threadId, input: "Plan only", interactionMode: "plan" });

    const events = yield* Stream.take(adapter.streamEvents, 7).pipe(Stream.runCollect);
    const proposed = Array.from(events).find((event) => event.type === "turn.proposed.completed");
    const request = Array.from(events).find((event) => event.type === "request.opened");

    assert.ok(proposed);
    assert.deepEqual(proposed?.payload, { planMarkdown: "# Plan\n\nDo the thing." });
    assert.ok(request);
    assert.deepInclude(request?.payload as Record<string, unknown>, {
      requestType: "plan_approval",
      detail: "Review Cursor's proposed plan to continue this turn.",
    });
    assert.deepEqual(responses, []);

    yield* adapter.respondToRequest(
      threadId,
      ApprovalRequestId.makeUnsafe(request!.requestId!),
      "accept",
    );

    assert.deepEqual(responses[0]?.result, { outcome: { outcome: "accepted" } });
  }).pipe(Effect.provide(makeCursorTestLayer({ createConnection })));
});

it.effect("CursorAdapterLive rejects Cursor ACP create_plan requests on decline", () => {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const responses: Array<{ id: JsonRpcId; result?: unknown; error?: unknown }> = [];
  const createConnection = vi.fn((options: CursorAcpConnectionOptions) =>
    makeFakeConnection(options, {
      calls,
      responses,
      prompt: async () => {
        options.onRequest?.({
          id: 43,
          method: "cursor/create_plan",
          params: { toolCallId: "tool-plan-2", plan: "# Plan\n\nDo not do the thing." },
        });
        return { stopReason: "end_turn" };
      },
    }),
  );

  return Effect.gen(function* () {
    const adapter = yield* CursorAdapter;
    const threadId = ThreadId.makeUnsafe("thread-cursor-plan-reject-acp");
    yield* adapter.startSession({
      threadId,
      provider: "cursor",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    yield* adapter.sendTurn({ threadId, input: "Plan only", interactionMode: "plan" });

    const events = yield* Stream.take(adapter.streamEvents, 7).pipe(Stream.runCollect);
    const request = Array.from(events).find((event) => event.type === "request.opened");
    assert.ok(request);

    yield* adapter.respondToRequest(
      threadId,
      ApprovalRequestId.makeUnsafe(request!.requestId!),
      "decline",
    );

    assert.deepEqual(responses[0]?.result, {
      outcome: { outcome: "rejected", reason: "Plan rejected in T3 Code." },
    });
  }).pipe(Effect.provide(makeCursorTestLayer({ createConnection })));
});

it.effect("CursorAdapterLive classifies real Cursor ACP command permission payloads", () => {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const responses: Array<{ id: JsonRpcId; result?: unknown; error?: unknown }> = [];
  const createConnection = vi.fn((options: CursorAcpConnectionOptions) =>
    makeFakeConnection(options, {
      calls,
      responses,
      prompt: async () => {
        options.onNotification?.({
          method: "session/update",
          params: {
            sessionId: "cursor-session-1",
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-command-1",
              title: "Terminal",
              kind: "execute",
              status: "pending",
              rawInput: {},
            },
          },
        });
        options.onNotification?.({
          method: "session/update",
          params: {
            sessionId: "cursor-session-1",
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tool-command-1",
              status: "in_progress",
            },
          },
        });
        options.onRequest?.({
          id: 44,
          method: "session/request_permission",
          params: {
            sessionId: "cursor-session-1",
            toolCall: {
              toolCallId: "tool-command-1",
              title: "`pwd`",
              kind: "execute",
              status: "pending",
              content: [
                {
                  type: "content",
                  content: { type: "text", text: "Not in allowlist: pwd" },
                },
              ],
            },
            options: [
              { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
              { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
              { optionId: "reject-once", name: "Reject", kind: "reject_once" },
            ],
          },
        });
        return { stopReason: "end_turn" };
      },
    }),
  );

  return Effect.gen(function* () {
    const adapter = yield* CursorAdapter;
    const threadId = ThreadId.makeUnsafe("thread-cursor-command-permission-acp");
    yield* adapter.startSession({
      threadId,
      provider: "cursor",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    yield* adapter.sendTurn({ threadId, input: "Run pwd", interactionMode: "default" });

    const events = yield* Stream.take(adapter.streamEvents, 8).pipe(Stream.runCollect);
    const toolUpdate = Array.from(events).find((event) => event.type === "item.updated");
    const request = Array.from(events).find((event) => event.type === "request.opened");

    assert.deepInclude(toolUpdate?.payload as Record<string, unknown>, {
      itemType: "command_execution",
      status: "inProgress",
      title: "Terminal",
    });
    assert.deepInclude(request?.payload as Record<string, unknown>, {
      requestType: "command_execution_approval",
      detail: "`pwd`\nNot in allowlist: pwd",
    });

    yield* adapter.respondToRequest(
      threadId,
      ApprovalRequestId.makeUnsafe(request!.requestId!),
      "acceptForSession",
    );

    assert.deepEqual(responses[0]?.result, {
      outcome: { outcome: "selected", optionId: "allow-always" },
    });
  }).pipe(Effect.provide(makeCursorTestLayer({ createConnection })));
});

it.effect("CursorAdapterLive classifies Cursor ACP file permission payloads", () => {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const responses: Array<{ id: JsonRpcId; result?: unknown; error?: unknown }> = [];
  const createConnection = vi.fn((options: CursorAcpConnectionOptions) =>
    makeFakeConnection(options, {
      calls,
      responses,
      prompt: async () => {
        options.onRequest?.({
          id: 45,
          method: "session/request_permission",
          params: {
            sessionId: "cursor-session-1",
            toolCall: {
              toolCallId: "tool-edit-1",
              title: "Edit File",
              kind: "edit",
              status: "pending",
            },
            options: [
              { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
              { optionId: "reject-once", name: "Reject", kind: "reject_once" },
            ],
          },
        });
        return { stopReason: "end_turn" };
      },
    }),
  );

  return Effect.gen(function* () {
    const adapter = yield* CursorAdapter;
    const threadId = ThreadId.makeUnsafe("thread-cursor-file-permission-acp");
    yield* adapter.startSession({
      threadId,
      provider: "cursor",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    yield* adapter.sendTurn({ threadId, input: "Edit file", interactionMode: "default" });

    const events = yield* Stream.take(adapter.streamEvents, 6).pipe(Stream.runCollect);
    const request = Array.from(events).find((event) => event.type === "request.opened");
    assert.deepInclude(request?.payload as Record<string, unknown>, {
      requestType: "file_change_approval",
      detail: "Edit File",
    });

    yield* adapter.respondToRequest(
      threadId,
      ApprovalRequestId.makeUnsafe(request!.requestId!),
      "decline",
    );

    assert.deepEqual(responses[0]?.result, {
      outcome: { outcome: "selected", optionId: "reject-once" },
    });
  }).pipe(Effect.provide(makeCursorTestLayer({ createConnection })));
});

it.effect("CursorAdapterLive cancels pending Cursor requests on interrupt", () => {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const responses: Array<{ id: JsonRpcId; result?: unknown; error?: unknown }> = [];
  let resolvePrompt: ((value: unknown) => void) | undefined;
  const createConnection = vi.fn((options: CursorAcpConnectionOptions) =>
    makeFakeConnection(options, {
      calls,
      responses,
      prompt: async () => {
        options.onRequest?.({
          id: 46,
          method: "session/request_permission",
          params: {
            sessionId: "cursor-session-1",
            toolCall: {
              toolCallId: "tool-command-2",
              title: "`pwd`",
              kind: "execute",
              status: "pending",
            },
            options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
          },
        });
        return await new Promise((resolve) => {
          resolvePrompt = resolve;
        });
      },
    }),
  );

  return Effect.gen(function* () {
    const adapter = yield* CursorAdapter;
    const threadId = ThreadId.makeUnsafe("thread-cursor-interrupt-pending-acp");
    yield* adapter.startSession({
      threadId,
      provider: "cursor",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    const turn = yield* adapter.sendTurn({
      threadId,
      input: "Run pwd",
      interactionMode: "default",
    });

    const events = yield* Stream.take(adapter.streamEvents, 6).pipe(Stream.runCollect);
    const request = Array.from(events).find((event) => event.type === "request.opened");
    assert.ok(request);

    yield* adapter.interruptTurn(threadId, turn.turnId);
    resolvePrompt?.({ stopReason: "cancelled" });

    assert.deepEqual(responses[0]?.result, { outcome: { outcome: "cancelled" } });
    assert.deepEqual(
      calls.find((call) => call.method === "session/cancel")?.input,
      "cursor-session-1",
    );
  }).pipe(Effect.provide(makeCursorTestLayer({ createConnection })));
});

it.effect("CursorAdapterLive answers Cursor ACP ask_question requests with option ids", () => {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const responses: Array<{ id: JsonRpcId; result?: unknown; error?: unknown }> = [];
  const createConnection = vi.fn((options: CursorAcpConnectionOptions) =>
    makeFakeConnection(options, {
      calls,
      responses,
      prompt: async () => {
        options.onRequest?.({
          id: 51,
          method: "cursor/ask_question",
          params: {
            toolCallId: "tool-question-1",
            title: "Need input",
            questions: [
              {
                id: "mode",
                prompt: "Which mode should I use?",
                options: [
                  { id: "agent", label: "Agent" },
                  { id: "plan", label: "Plan" },
                ],
              },
            ],
          },
        });
        return { stopReason: "end_turn" };
      },
    }),
  );

  return Effect.gen(function* () {
    const adapter = yield* CursorAdapter;
    const threadId = ThreadId.makeUnsafe("thread-cursor-question-acp");
    yield* adapter.startSession({
      threadId,
      provider: "cursor",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    yield* adapter.sendTurn({ threadId, input: "Ask me", interactionMode: "default" });

    const events = yield* Stream.take(adapter.streamEvents, 7).pipe(Stream.runCollect);
    const request = Array.from(events).find((event) => event.type === "user-input.requested");
    assert.ok(request);
    assert.deepInclude(request?.payload as Record<string, unknown>, {
      questions: [
        {
          id: "mode",
          header: "Need input",
          question: "Which mode should I use?",
          options: [
            { label: "Agent", description: "Agent" },
            { label: "Plan", description: "Plan" },
          ],
          multiSelect: false,
        },
      ],
    });

    yield* adapter.respondToUserInput(threadId, ApprovalRequestId.makeUnsafe(request!.requestId!), {
      mode: "Plan",
    });

    assert.deepEqual(responses[0]?.result, {
      outcome: {
        outcome: "answered",
        answers: [{ questionId: "mode", selectedOptionIds: ["plan"] }],
      },
    });
  }).pipe(Effect.provide(makeCursorTestLayer({ createConnection })));
});

it.effect("CursorAdapterLive resumes Cursor ACP sessions with session/load", () => {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const responses: Array<{ id: JsonRpcId; result?: unknown; error?: unknown }> = [];
  const createConnection = vi.fn((options: CursorAcpConnectionOptions) =>
    makeFakeConnection(options, { calls, responses }),
  );

  return Effect.gen(function* () {
    const adapter = yield* CursorAdapter;
    const threadId = ThreadId.makeUnsafe("thread-cursor-load-acp");
    yield* adapter.startSession({
      threadId,
      provider: "cursor",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
      resumeCursor: { version: 1, sessionId: "cursor-existing", provider: "cursor" },
    });

    assert.ok(calls.some((call) => call.method === "session/load"));
    assert.notOk(calls.some((call) => call.method === "session/new"));
  }).pipe(Effect.provide(makeCursorTestLayer({ createConnection })));
});
