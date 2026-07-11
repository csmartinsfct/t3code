import {
  CommandId,
  MessageId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationThreadContent,
} from "@t3tools/contracts";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { backfillCodexInlineVisualizations } from "./codexInlineVisualizationBackfill";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("backfillCodexInlineVisualizations", () => {
  it("materializes an existing directive using the persisted Codex resume cursor", async () => {
    const codexHomePath = fs.mkdtempSync(path.join(os.tmpdir(), "t3-codex-backfill-"));
    temporaryDirectories.push(codexHomePath);
    const nativeThreadId = "native-thread-123";
    const visualizationDirectory = path.join(
      codexHomePath,
      "visualizations",
      "2026",
      "07",
      "12",
      nativeThreadId,
    );
    fs.mkdirSync(visualizationDirectory, { recursive: true });
    fs.writeFileSync(path.join(visualizationDirectory, "chart.html"), "<main>Chart</main>");

    const threadId = ThreadId.makeUnsafe("thread-123");
    const messageId = MessageId.makeUnsafe("message-123");
    let content: OrchestrationThreadContent = {
      threadId,
      sequence: 1,
      messages: [
        {
          id: messageId,
          role: "assistant",
          text: 'Before ::codex-inline-vis{file="chart.html"} after',
          streaming: false,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
          turnId: null,
          attachments: [],
        },
      ],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    } satisfies OrchestrationThreadContent;
    const dispatched: OrchestrationCommand[] = [];

    const result = await Effect.runPromise(
      backfillCodexInlineVisualizations({
        threadId,
        getThreadContent: () => Effect.succeed(content),
        getPersistedSession: () =>
          Effect.succeed({
            provider: "codex",
            resumeCursor: { threadId: nativeThreadId },
          }),
        resolveCodexHomeForProvider: () => Effect.succeed(codexHomePath),
        dispatch: (command) =>
          Effect.sync(() => {
            dispatched.push(command);
            if (command.type !== "thread.message.assistant.complete") {
              throw new Error(`Unexpected command: ${command.type}`);
            }
            content = {
              ...content,
              sequence: 2,
              messages: content.messages.map((message) =>
                message.id === command.messageId
                  ? {
                      ...message,
                      text: command.text ?? message.text,
                      ...(command.metadata ? { metadata: command.metadata } : {}),
                    }
                  : message,
              ),
            };
            return { sequence: 2 };
          }),
        makeCommandId: () => CommandId.makeUnsafe("backfill-command-123"),
      }),
    );

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      type: "thread.message.assistant.complete",
      threadId,
      messageId,
      commandId: "backfill-command-123",
      createdAt: "2026-07-12T00:00:00.000Z",
    });
    expect(result.sequence).toBe(2);
    expect(result.messages[0]?.text).toContain("```t3:dynamic-chat-ui");
    expect(result.messages[0]?.text).not.toContain("::codex-inline-vis");
    expect(result.messages[0]?.metadata?.dynamicChatUiArtifacts).toEqual([
      expect.objectContaining({
        title: "chart",
        html: "<main>Chart</main>",
      }),
    ]);
  });

  it("returns the original thread when persistence fails", async () => {
    const threadId = ThreadId.makeUnsafe("thread-failure");
    const content: OrchestrationThreadContent = {
      threadId,
      sequence: 4,
      messages: [
        {
          id: MessageId.makeUnsafe("message-failure"),
          role: "assistant",
          text: '::codex-inline-vis{file="missing.html"}',
          streaming: false,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
          turnId: null,
          attachments: [],
        },
      ],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    };

    const result = await Effect.runPromise(
      backfillCodexInlineVisualizations({
        threadId,
        getThreadContent: () => Effect.succeed(content),
        getPersistedSession: () =>
          Effect.succeed({ provider: "codex", resumeCursor: { threadId: "native-failure" } }),
        resolveCodexHomeForProvider: () => Effect.succeed(os.tmpdir()),
        dispatch: () => Effect.fail(new Error("database unavailable")),
      }),
    );

    expect(result).toBe(content);
  });

  it("limits historical enrichment to eight messages", async () => {
    const threadId = ThreadId.makeUnsafe("thread-bounded");
    const content: OrchestrationThreadContent = {
      threadId,
      sequence: 10,
      messages: Array.from({ length: 10 }, (_, index) => ({
        id: MessageId.makeUnsafe(`message-${index}`),
        role: "assistant" as const,
        text: `::codex-inline-vis{file="missing-${index}.html"}`,
        streaming: false,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
        turnId: null,
        attachments: [],
      })),
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    };
    const dispatched: OrchestrationCommand[] = [];

    await Effect.runPromise(
      backfillCodexInlineVisualizations({
        threadId,
        getThreadContent: () => Effect.succeed(content),
        getPersistedSession: () =>
          Effect.succeed({ provider: "codex", resumeCursor: { threadId: "native-bounded" } }),
        resolveCodexHomeForProvider: () => Effect.succeed(os.tmpdir()),
        dispatch: (command) =>
          Effect.sync(() => {
            dispatched.push(command);
            return { sequence: content.sequence + dispatched.length };
          }),
      }),
    );

    expect(dispatched).toHaveLength(8);
  });
});
