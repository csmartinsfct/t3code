import { it, assert, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ApprovalRequestId, ThreadId } from "@t3tools/contracts";
import { Effect, Layer, Option, Stream } from "effect";

import { ServerConfig, type ServerConfigShape } from "../../config";
import { ManagedRunService } from "../../managedRuns/Services/ManagedRuns";
import {
  ProjectionSnapshotQuery,
  type ProjectionThreadCheckpointContext,
} from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ServerSettingsService } from "../../serverSettings";
import { ProviderAdapterRequestError, type ProviderAdapterError } from "../Errors";
import { CursorAdapter, type CursorAdapterShape } from "../Services/CursorAdapter";
import type {
  LifecycleEntry,
  ProviderLifecycleLoggerShape,
} from "../Services/ProviderLifecycleLogger";
import type { CursorTurnCommandInput, CursorTurnRunResult } from "../cursor/CursorTurnRunner";
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

function makeCursorTestLayer(
  options: CursorAdapterLiveOptions,
  context: ProjectionThreadCheckpointContext | null = null,
) {
  return makeCursorAdapterLive(options).pipe(
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(serverConfigTestLayer),
    Layer.provideMerge(managedRunServiceTestLayer),
    Layer.provideMerge(makeProjectionSnapshotQueryTestLayer(context)),
    Layer.provideMerge(NodeServices.layer),
  );
}

function makeCheckpointContext(
  threadId: ThreadId = ThreadId.makeUnsafe("thread-cursor-context"),
): ProjectionThreadCheckpointContext {
  return {
    threadId,
    projectId: "project-cursor" as ProjectionThreadCheckpointContext["projectId"],
    projectTitle: "Cursor Project",
    workspaceRoot: "/workspace/cursor",
    worktreePath: "/workspace/cursor-worktree",
    systemPrompt: "Always follow the Cursor project prompt.",
    checkpoints: [],
  };
}

function makeCursorRunResult(
  sessionId = "cursor-session-1",
  text = "Hello from Cursor",
): CursorTurnRunResult {
  const result = {
    type: "result" as const,
    subtype: "success",
    isError: false,
    sessionId,
    requestId: "cursor-request-1",
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
    },
    raw: {
      type: "result",
      subtype: "success",
      session_id: sessionId,
      request_id: "cursor-request-1",
    },
  };
  return {
    events: [
      {
        type: "assistant",
        text,
        raw: {
          type: "assistant",
          message: { content: [{ type: "text", text }] },
        },
      },
      result,
    ],
    result,
    sessionId,
    requestId: "cursor-request-1",
    usage: result.usage,
    exitCode: 0,
    stderr: "",
  };
}

it.effect("CursorAdapterLive starts a Cursor session and sends a text turn", () => {
  const runInputs: CursorTurnCommandInput[] = [];
  const createChat = vi.fn(() => Effect.succeed("cursor-session-1"));
  const runTurn = vi.fn((input: CursorTurnCommandInput) => {
    runInputs.push(input);
    return Effect.succeed(makeCursorRunResult(input.resumeSessionId));
  });

  return Effect.gen(function* () {
    const adapter = yield* CursorAdapter;
    const threadId = ThreadId.makeUnsafe("thread-cursor");

    const session = yield* adapter.startSession({
      threadId,
      provider: "cursor",
      cwd: "/tmp/project",
      modelSelection: { provider: "cursor", model: "auto" },
      runtimeMode: "full-access",
    });

    assert.equal(session.provider, "cursor");
    assert.deepInclude(session.resumeCursor as Record<string, unknown>, {
      sessionId: "cursor-session-1",
      provider: "cursor",
      cwd: "/tmp/project",
      model: "auto",
      contextPromptInjected: true,
    });

    const turn = yield* adapter.sendTurn({
      threadId,
      input: "Say hello",
      modelSelection: { provider: "cursor", model: "auto" },
    });
    const events = yield* Stream.take(adapter.streamEvents, 11).pipe(Stream.runCollect);
    const eventTypes = Array.from(events).map((event) => event.type);

    assert.equal(turn.threadId, threadId);
    assert.ok(turn.turnId.startsWith("cursor-turn-"));
    assert.deepEqual(eventTypes, [
      "session.started",
      "thread.started",
      "session.state.changed",
      "session.state.changed",
      "turn.started",
      "item.started",
      "content.delta",
      "thread.token-usage.updated",
      "item.completed",
      "turn.completed",
      "session.state.changed",
    ]);
    assert.equal(runInputs[0]?.resumeSessionId, "cursor-session-1");
    assert.equal(runInputs[0]?.runtimeMode, "full-access");
    assert.equal(runInputs[0]?.model, "auto");
    assert.equal(runInputs[0]?.streamPartialOutput, true);
  }).pipe(Effect.provide(makeCursorTestLayer({ createChat, runTurn })));
});

it.effect("CursorAdapterLive injects T3 context only on the first matching prompt", () => {
  const runInputs: CursorTurnCommandInput[] = [];
  const threadId = ThreadId.makeUnsafe("thread-cursor-context");
  const checkpointContext = makeCheckpointContext(threadId);
  const createChat = vi.fn(() => Effect.succeed("cursor-session-context"));
  const runTurn = vi.fn((input: CursorTurnCommandInput) => {
    runInputs.push(input);
    return Effect.succeed(makeCursorRunResult(input.resumeSessionId));
  });

  return Effect.gen(function* () {
    const adapter = yield* CursorAdapter;

    const session = yield* adapter.startSession({
      threadId,
      provider: "cursor",
      cwd: "/workspace/cursor-worktree",
      runtimeMode: "full-access",
    });
    const startCursor = session.resumeCursor as {
      contextPromptHash?: string;
      contextPromptInjected?: boolean;
    };
    assert.equal(typeof startCursor.contextPromptHash, "string");
    assert.equal(startCursor.contextPromptInjected, false);

    const firstTurn = yield* adapter.sendTurn({
      threadId,
      input: "Inspect the project.",
    });
    yield* Stream.take(adapter.streamEvents, 11).pipe(Stream.runCollect);

    const firstCursor = firstTurn.resumeCursor as { contextPromptInjected?: boolean };
    assert.equal(firstCursor.contextPromptInjected, true);
    assert.match(runInputs[0]?.prompt ?? "", /## T3 Project Context/);
    assert.match(runInputs[0]?.prompt ?? "", /Cursor Project/);
    assert.match(runInputs[0]?.prompt ?? "", /Authorization: Bearer test-token/);
    assert.match(runInputs[0]?.prompt ?? "", /Always follow the Cursor project prompt\./);
    assert.match(runInputs[0]?.prompt ?? "", /Inspect the project\./);

    yield* adapter.sendTurn({
      threadId,
      input: "Continue.",
    });
    yield* Stream.take(adapter.streamEvents, 8).pipe(Stream.runCollect);

    assert.equal(runInputs[1]?.prompt, "Continue.");
  }).pipe(Effect.provide(makeCursorTestLayer({ createChat, runTurn }, checkpointContext)));
});

it.effect(
  "CursorAdapterLive reuses a matching resume cursor without creating or reinjecting",
  () => {
    const runInputs: CursorTurnCommandInput[] = [];
    const threadId = ThreadId.makeUnsafe("thread-cursor-resume");
    const checkpointContext = makeCheckpointContext(threadId);
    const createChat = vi.fn(() => Effect.succeed("cursor-session-original"));
    const runTurn = vi.fn((input: CursorTurnCommandInput) => {
      runInputs.push(input);
      return Effect.succeed(makeCursorRunResult(input.resumeSessionId));
    });

    return Effect.gen(function* () {
      const adapter = yield* CursorAdapter;

      const initialSession = yield* adapter.startSession({
        threadId,
        provider: "cursor",
        cwd: "/workspace/cursor-worktree",
        runtimeMode: "full-access",
      });
      const initialCursor = initialSession.resumeCursor as { contextPromptHash?: string };
      yield* adapter.stopSession(threadId);

      yield* adapter.startSession({
        threadId,
        provider: "cursor",
        cwd: "/workspace/cursor-worktree",
        runtimeMode: "full-access",
        resumeCursor: {
          sessionId: "cursor-session-resumed",
          provider: "cursor",
          cwd: "/workspace/cursor-worktree",
          contextPromptHash: initialCursor.contextPromptHash,
          contextPromptInjected: true,
        },
      });
      yield* adapter.sendTurn({ threadId, input: "Continue." });
      yield* Stream.take(adapter.streamEvents, 14).pipe(Stream.runCollect);

      assert.equal(createChat.mock.calls.length, 1);
      assert.equal(runInputs[0]?.resumeSessionId, "cursor-session-resumed");
      assert.equal(runInputs[0]?.prompt, "Continue.");
    }).pipe(Effect.provide(makeCursorTestLayer({ createChat, runTurn }, checkpointContext)));
  },
);

it.effect("CursorAdapterLive rejects concurrent turns and recovers after runner failure", () => {
  let calls = 0;
  let adapterRef: CursorAdapterShape | undefined;
  let nestedFailureTag: string | undefined;
  const threadId = ThreadId.makeUnsafe("thread-cursor-concurrent");
  const createChat = vi.fn(() => Effect.succeed("cursor-session-active"));
  const runTurnImpl = (
    input: CursorTurnCommandInput,
  ): Effect.Effect<CursorTurnRunResult, ProviderAdapterError> => {
    calls += 1;
    if (calls === 1) {
      return Effect.gen(function* () {
        const failure = yield* adapterRef!
          .sendTurn({
            threadId,
            input: "Nested concurrent turn.",
          })
          .pipe(
            Effect.flip,
            Effect.catch((unexpected) =>
              Effect.die(new Error(`Expected nested sendTurn to fail, got ${unexpected.turnId}`)),
            ),
          );
        nestedFailureTag = failure._tag;
        return makeCursorRunResult(input.resumeSessionId);
      });
    }
    if (calls === 2) {
      return Effect.gen(function* () {
        return yield* new ProviderAdapterRequestError({
          provider: "cursor",
          method: "sendTurn",
          detail: "boom",
        });
      });
    }
    return Effect.succeed(makeCursorRunResult(input.resumeSessionId));
  };
  const runTurn = vi.fn(runTurnImpl);

  return Effect.gen(function* () {
    const adapter = yield* CursorAdapter;
    adapterRef = adapter;

    yield* adapter.startSession({
      threadId,
      provider: "cursor",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    yield* adapter.sendTurn({ threadId, input: "First." });
    yield* Stream.take(adapter.streamEvents, 11).pipe(Stream.runCollect);
    assert.equal(nestedFailureTag, "ProviderAdapterValidationError");

    yield* adapter.sendTurn({ threadId, input: "Fail once." });
    yield* Stream.take(adapter.streamEvents, 5).pipe(Stream.runCollect);

    const recovered = yield* adapter.sendTurn({ threadId, input: "Recover." });
    yield* Stream.take(adapter.streamEvents, 8).pipe(Stream.runCollect);

    assert.ok(recovered.turnId.startsWith("cursor-turn-"));
    assert.equal(calls, 3);
  }).pipe(Effect.provide(makeCursorTestLayer({ createChat, runTurn })));
});

it.effect("CursorAdapterLive writes lifecycle entries while interrupting active turns", () => {
  const lifecycleEntries: Array<{ threadId: ThreadId | null; entry: LifecycleEntry }> = [];
  const lifecycleLogger: ProviderLifecycleLoggerShape = {
    log: (threadId, entry) =>
      Effect.sync(() => {
        lifecycleEntries.push({ threadId, entry });
      }),
    close: () => Effect.void,
  };
  const createChat = vi.fn(() => Effect.succeed("cursor-session-lifecycle"));
  const runTurn = vi.fn(
    () => Effect.never as Effect.Effect<CursorTurnRunResult, ProviderAdapterError>,
  );

  return Effect.gen(function* () {
    const adapter = yield* CursorAdapter;
    const threadId = ThreadId.makeUnsafe("thread-cursor-lifecycle");

    yield* adapter.startSession({
      threadId,
      provider: "cursor",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
    });
    const turn = yield* adapter.sendTurn({ threadId, input: "Keep working." });
    yield* adapter.interruptTurn(threadId, turn.turnId);

    const events = lifecycleEntries.map((entry) => entry.entry.event);
    assert.deepEqual(events, ["cursor.turn.interrupt.requested", "cursor.turn.interrupt.finished"]);
    assert.equal(lifecycleEntries[0]?.threadId, threadId);
    assert.deepInclude(lifecycleEntries[0]?.entry.details ?? {}, {
      cleanupRunner: "CursorTurnRunner",
      graceMs: 2000,
      adapterWaitMs: 5000,
    });
  }).pipe(Effect.provide(makeCursorTestLayer({ createChat, runTurn, lifecycleLogger })));
});

it.effect(
  "CursorAdapterLive fails unsupported Cursor interaction and fork features clearly",
  () => {
    const createChat = vi.fn(() => Effect.succeed("cursor-session-unsupported"));
    const runTurn = vi.fn((input: CursorTurnCommandInput) =>
      Effect.succeed(makeCursorRunResult(input.resumeSessionId)),
    );

    return Effect.gen(function* () {
      const adapter = yield* CursorAdapter;
      const threadId = ThreadId.makeUnsafe("thread-cursor-unsupported");

      yield* adapter.startSession({
        threadId,
        provider: "cursor",
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      });

      const approvalFailure = yield* Effect.flip(
        adapter.respondToRequest(threadId, ApprovalRequestId.makeUnsafe("req-1"), "accept"),
      );
      if (approvalFailure._tag !== "ProviderAdapterRequestError") {
        assert.fail(`Expected ProviderAdapterRequestError, got ${approvalFailure._tag}`);
      }
      assert.match(approvalFailure.detail, /interaction round trips are not supported/);

      const userInputFailure = yield* Effect.flip(
        adapter.respondToUserInput(threadId, ApprovalRequestId.makeUnsafe("req-2"), {}),
      );
      if (userInputFailure._tag !== "ProviderAdapterRequestError") {
        assert.fail(`Expected ProviderAdapterRequestError, got ${userInputFailure._tag}`);
      }
      assert.match(userInputFailure.detail, /interaction round trips are not supported/);

      const rollbackFailure = yield* Effect.flip(adapter.rollbackThread(threadId, 1));
      if (rollbackFailure._tag !== "ProviderAdapterRequestError") {
        assert.fail(`Expected ProviderAdapterRequestError, got ${rollbackFailure._tag}`);
      }
      assert.match(rollbackFailure.detail, /rollback or rewind/);

      const forkFailure = yield* Effect.flip(
        adapter.startSession({
          threadId: ThreadId.makeUnsafe("thread-cursor-fork"),
          provider: "cursor",
          cwd: "/tmp/project",
          runtimeMode: "full-access",
          resumeCursor: {
            sessionId: "cursor-session-source",
            provider: "cursor",
            fork: true,
          },
        }),
      );
      if (forkFailure._tag !== "ProviderAdapterRequestError") {
        assert.fail(`Expected ProviderAdapterRequestError, got ${forkFailure._tag}`);
      }
      assert.match(forkFailure.detail, /fork or conversation copy/);
    }).pipe(Effect.provide(makeCursorTestLayer({ createChat, runTurn })));
  },
);
