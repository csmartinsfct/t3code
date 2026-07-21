import { MessageId, TurnId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

describe("MessagesTimeline", () => {
  it("renders inline terminal labels with the composer chip UI", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("message-2"),
              role: "user",
              text: [
                "yoo what's @terminal-1:1-5 mean",
                "",
                "<terminal_context>",
                "- Terminal 1 lines 1-5:",
                "  1 | julius@mac effect-http-ws-cli % bun i",
                "  2 | bun install v1.3.9 (cf6cdbbb)",
                "</terminal_context>",
              ].join("\n"),
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Terminal 1 lines 1-5");
    expect(markup).toContain("lucide-terminal");
    expect(markup).toContain("yoo what&#x27;s ");
  });

  it("renders context compaction entries in the normal work log", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Context compacted",
              tone: "info",
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Context compacted");
    expect(markup).toContain("Work log");
  });

  it("renders runtime diagnostics with category-specific labels and icons", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-memory",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-memory",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Memory recall - project",
              detail: "3 memories - /Users/example/.claude/memory.md (personal)",
              tone: "info",
              diagnosticCategory: "memory_recall",
            },
          },
          {
            id: "entry-mirror",
            kind: "work",
            createdAt: "2026-03-17T19:12:29.000Z",
            entry: {
              id: "work-mirror",
              createdAt: "2026-03-17T19:12:29.000Z",
              label: "Session mirror error",
              detail: "Mirror write failed",
              tone: "error",
              diagnosticCategory: "mirror_error",
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Memory recall");
    expect(markup).toContain("3 memories");
    expect(markup).toContain("/Users/example/.claude/memory.md");
    expect(markup).toContain("Mirror error");
    expect(markup).toContain("Mirror write failed");
    expect(markup).toContain("lucide-brain");
    expect(markup).toContain("lucide-circle-alert");
  });

  it("renders terminal reason labels in the completion divider", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-limit-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("message-limit-1"),
              role: "assistant",
              text: "Limit reached.",
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
        completionDividerBeforeEntryId="entry-limit-1"
        completionSummary="Worked for 2m"
        completionTerminalReason={{ label: "Limit reached", tone: "warning" }}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Response");
    expect(markup).toContain("Worked for 2m");
    expect(markup).toContain("Limit reached");
    expect(markup).toContain("text-warning");
  });

  it("renders structured review output as a review card for review threads", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-review-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("message-review-1"),
              role: "assistant",
              text: JSON.stringify({
                changesNeeded: true,
                summary: "A couple of follow-ups remain before this is ready.",
                comments: [
                  {
                    file: "apps/web/src/components/chat/OrchestrationTimeline.tsx",
                    line: 42,
                    severity: "critical",
                    body: "Render the review state badge distinctly.",
                  },
                  {
                    file: null,
                    line: null,
                    severity: "suggestion",
                    body: "Add a regression test for review thread grouping.",
                  },
                ],
              }),
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
        isReviewThread
      />,
    );

    expect(markup).toContain("Automated review");
    expect(markup).toContain("Changes needed");
    expect(markup).toContain("Critical");
    expect(markup).toContain("Add a regression test for review thread grouping.");
    expect(markup).not.toContain("&quot;changesNeeded&quot;");
  });

  it("renders changed-file cards compact by default for a new turn summary", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const messageId = MessageId.makeUnsafe("message-diff-1");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-diff-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: messageId,
              role: "assistant",
              text: "Updated the relevant files.",
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={
          new Map([
            [
              messageId,
              {
                turnId: TurnId.makeUnsafe("turn-diff-1"),
                completedAt: "2026-03-17T19:12:29.000Z",
                files: [
                  {
                    path: "apps/web/src/components/chat/MessagesTimeline.tsx",
                    additions: 10,
                    deletions: 4,
                  },
                  {
                    path: "apps/web/src/components/chat/ChangedFilesTree.tsx",
                    additions: 8,
                    deletions: 1,
                  },
                ],
              },
            ],
          ])
        }
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Show files");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("Hide files");
    expect(markup).not.toContain("Expand all");
    expect(markup).not.toContain("apps/web/src/components/chat");
    expect(markup).not.toContain("MessagesTimeline.tsx");
    expect(markup).not.toContain("ChangedFilesTree.tsx");
  });
});
