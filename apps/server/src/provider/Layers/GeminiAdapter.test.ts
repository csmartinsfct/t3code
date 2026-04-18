import { it, assert, vi } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import { ThreadId } from "@t3tools/contracts";

import { ServerSettingsService } from "../../serverSettings";
import { GeminiAdapter } from "../Services/GeminiAdapter";
import type {
  GeminiAcpConnection,
  GeminiAcpConnectionOptions,
} from "../gemini/GeminiAcpConnection";
import { makeGeminiAdapterLive } from "./GeminiAdapter";

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
      makeGeminiAdapterLive({
        createConnection: (options) => {
          const connection = makeFakeConnection(options);
          createdConnections.push(connection);
          return connection;
        },
      }).pipe(Layer.provideMerge(ServerSettingsService.layerTest())),
    ),
  );
});
