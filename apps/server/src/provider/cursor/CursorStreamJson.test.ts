import { describe, expect, it } from "vitest";

import {
  CursorStreamJsonParseError,
  findCursorResultEvent,
  parseCursorStreamJsonChunks,
  parseCursorStreamJsonLine,
} from "./CursorStreamJson";

const SIMPLE_FIXTURE = [
  {
    type: "system",
    subtype: "init",
    apiKeySource: "login",
    cwd: "/tmp/t3-cursor-fixture",
    session_id: "2048a654-f39b-4d4b-a892-d049baa6968d",
    model: "Auto",
    permissionMode: "default",
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: "Say exactly: cursor fixture ok" }],
    },
    session_id: "2048a654-f39b-4d4b-a892-d049baa6968d",
  },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "cursor fixture ok" }],
    },
    session_id: "2048a654-f39b-4d4b-a892-d049baa6968d",
  },
  {
    type: "result",
    subtype: "success",
    duration_ms: 4456,
    duration_api_ms: 4456,
    is_error: false,
    result: "cursor fixture ok",
    session_id: "2048a654-f39b-4d4b-a892-d049baa6968d",
    request_id: "750d85a4-8a0a-4775-b629-cb8cf1253f81",
    usage: {
      inputTokens: 9195,
      outputTokens: 28,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  },
]
  .map((event) => JSON.stringify(event))
  .join("\n");

describe("parseCursorStreamJsonLine", () => {
  it("normalizes assistant text and result metadata from observed Cursor events", () => {
    const events = parseCursorStreamJsonChunks([SIMPLE_FIXTURE]);
    const assistant = events.find((event) => event.type === "assistant");
    const result = findCursorResultEvent(events);

    expect(assistant).toMatchObject({
      type: "assistant",
      text: "cursor fixture ok",
      sessionId: "2048a654-f39b-4d4b-a892-d049baa6968d",
    });
    expect(result).toMatchObject({
      type: "result",
      subtype: "success",
      isError: false,
      sessionId: "2048a654-f39b-4d4b-a892-d049baa6968d",
      requestId: "750d85a4-8a0a-4775-b629-cb8cf1253f81",
      usage: {
        inputTokens: 9195,
        outputTokens: 28,
      },
    });
  });

  it("handles plan-mode thinking, tool, and interaction_query events", () => {
    const events = parseCursorStreamJsonChunks([
      [
        {
          type: "thinking",
          subtype: "delta",
          text: "Planning",
          session_id: "session-1",
          timestamp_ms: 1777758231054,
        },
        {
          type: "tool_call",
          subtype: "started",
          call_id: "tool_1",
          tool_call: { createPlanToolCall: { args: { name: "Create file" } } },
          session_id: "session-1",
        },
        {
          type: "interaction_query",
          subtype: "request",
          query_type: "createPlanRequestQuery",
          query: { id: 0 },
          session_id: "session-1",
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    ]);

    expect(events).toEqual([
      expect.objectContaining({
        type: "thinking",
        subtype: "delta",
        text: "Planning",
        timestampMs: 1777758231054,
      }),
      expect.objectContaining({
        type: "tool_call",
        subtype: "started",
        callId: "tool_1",
      }),
      expect.objectContaining({
        type: "interaction_query",
        subtype: "request",
        queryType: "createPlanRequestQuery",
      }),
    ]);
  });

  it("preserves unknown event types and unknown fields", () => {
    const event = parseCursorStreamJsonLine(
      JSON.stringify({ type: "future_event", extra: { value: true }, session_id: "session-1" }),
    );

    expect(event).toMatchObject({
      type: "future_event",
      sessionId: "session-1",
      raw: { extra: { value: true } },
    });
  });

  it("parses lines split across chunks", () => {
    const chunks = [
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hel',
      'lo"}]},"session_id":"session-1"}\n{"type":"result","subtype":"success","is_error":false,',
      '"result":"hello","session_id":"session-1"}',
    ];

    const events = parseCursorStreamJsonChunks(chunks);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "assistant", text: "hello" });
    expect(events[1]).toMatchObject({ type: "result", result: "hello" });
  });

  it("fails malformed JSON with line context", () => {
    expect(() => parseCursorStreamJsonChunks(['{"type":"assistant"}\nnot-json\n'])).toThrow(
      CursorStreamJsonParseError,
    );
  });
});
