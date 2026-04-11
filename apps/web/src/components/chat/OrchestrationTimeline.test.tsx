import type { ThreadId } from "@t3tools/contracts";
import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { OrchestrationTimelineRow } from "../../hooks/useOrchestrationTimeline.logic";
import type { Thread } from "../../types";

vi.mock("@tanstack/react-virtual", () => ({
  measureElement: () => undefined,
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: `row-${index}`,
        index,
        start: index * 120,
        end: (index + 1) * 120,
      })),
    getTotalSize: () => count * 120,
    shouldAdjustScrollPositionOnItemSizeChange: undefined,
  }),
}));

const useOrchestrationTimeline = vi.fn();
const chatMarkdownMock = vi.fn(({ text }: { text: string }) => text);

vi.mock("../../hooks/useOrchestrationTimeline", () => ({
  useOrchestrationTimeline: (...args: unknown[]) => useOrchestrationTimeline(...args),
}));

vi.mock("../ChatMarkdown", () => ({
  default: (props: {
    text: string;
    onOpenTicketLink?: (identifier: string) => void | Promise<void>;
  }) => chatMarkdownMock(props),
}));

vi.mock("../ui/badge", () => ({
  Badge: ({
    children,
    render,
  }: {
    children: ReactNode;
    render?: React.ReactElement | undefined;
  }) => {
    if (!render) {
      return <span>{children}</span>;
    }

    return React.cloneElement(render, undefined, children);
  },
}));

vi.mock("./ReviewOutputCard", () => ({
  default: ({
    output,
    heading,
  }: {
    output: { summary: string; changesNeeded: boolean };
    heading?: string;
  }) =>
    `${heading ?? "Automated review"} ${output.changesNeeded ? "Changes needed" : "Approved"} ${output.summary}`,
}));

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
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
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

afterEach(() => {
  chatMarkdownMock.mockClear();
  useOrchestrationTimeline.mockReset();
});

function makeThread(): Thread {
  return {
    id: "parent-thread" as ThreadId,
    codexThreadId: null,
    projectId: "project-1" as Thread["projectId"],
    title: "Orchestration",
    modelSelection: { provider: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-04-09T10:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-04-09T10:00:00.000Z",
    latestTurn: null,
    pendingSourceProposedPlan: undefined,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    initialDraft: undefined,
    isOrchestrationThread: true,
    parentThreadId: null,
    ticketId: null,
  };
}

describe("OrchestrationTimeline", () => {
  it("renders chronological implementation and review blocks with the old section chrome", async () => {
    const { OrchestrationTimeline } = await import("./OrchestrationTimeline");
    const rows: OrchestrationTimelineRow[] = [
      {
        kind: "separator",
        id: "sep:start",
        activityKind: "orchestration.run.ticket.started",
        summary: "Starting work on T3CO-24",
        tone: "info",
        createdAt: "2026-04-09T10:00:00.000Z",
        ticketIdentifier: "T3CO-24",
      },
      {
        kind: "thread-block",
        id: "block:impl-1",
        threadId: "thread-impl",
        sectionKind: "working",
        messages: [
          {
            id: "impl-1" as Thread["messages"][number]["id"],
            role: "assistant",
            text: "Initial implementation",
            createdAt: "2026-04-09T10:00:01.000Z",
            streaming: false,
          },
        ],
        isActive: false,
      },
      {
        kind: "thread-block",
        id: "block:impl-2",
        threadId: "thread-impl",
        sectionKind: "working",
        messages: [
          {
            id: "impl-2" as Thread["messages"][number]["id"],
            role: "assistant",
            text: "Addressed review feedback",
            createdAt: "2026-04-09T10:00:03.000Z",
            streaming: false,
          },
        ],
        isActive: false,
      },
      {
        kind: "separator",
        id: "sep:review-2",
        activityKind: "orchestration.run.ticket.review.started",
        summary: "Reviewing ticket T3CO-24 again",
        tone: "info",
        createdAt: "2026-04-09T10:00:03.500Z",
        ticketIdentifier: "T3CO-24",
        reviewIteration: 2,
        reviewState: "started",
      },
      {
        kind: "thread-block",
        id: "block:review-2",
        threadId: "thread-review",
        sectionKind: "review",
        messages: [
          {
            id: "review-2" as Thread["messages"][number]["id"],
            role: "assistant",
            text: '{"changesNeeded":false,"summary":"Looks good now.","comments":[]}',
            createdAt: "2026-04-09T10:00:04.000Z",
            streaming: false,
          },
        ],
        isActive: false,
        reviewIteration: 2,
        reviewOutcome: "approved",
      },
    ];
    useOrchestrationTimeline.mockReturnValue({
      loading: false,
      error: null,
      run: null,
      childThreads: [],
      timelineRows: rows,
      refresh: () => {},
    });

    const markup = renderToStaticMarkup(
      <OrchestrationTimeline
        thread={makeThread()}
        projectId="project-1"
        scrollContainer={null}
        resolvedTheme="dark"
        timestampFormat="locale"
        markdownCwd={undefined}
        workspaceRoot={undefined}
        onNavigateToThread={() => {}}
        onOpenTicketLink={() => {}}
      />,
    );

    expect(markup).toContain("Implementation");
    expect(markup).toContain("Review Passed");
    expect(markup).toContain("Open thread");
    expect(markup).not.toContain("Active");
    expect(markup.indexOf("Initial implementation")).toBeLessThan(
      markup.indexOf("Addressed review feedback"),
    );
    expect(markup).toContain("Reviewing ticket ");
    expect(markup).toContain('href="t3://ticket/T3CO-24"');
    expect(markup).toContain(" again");
    expect(markup.indexOf("Addressed review feedback")).toBeLessThan(
      markup.indexOf("Looks good now."),
    );
    expect(markup).not.toContain("Changes requested");
    expect(markup).toContain("Automated review 2 Approved Looks good now.");
  });

  it("passes ticket-link handlers through to markdown inside a thread block", async () => {
    const { OrchestrationTimeline } = await import("./OrchestrationTimeline");
    useOrchestrationTimeline.mockReturnValue({
      loading: false,
      error: null,
      run: null,
      childThreads: [],
      timelineRows: [
        {
          kind: "thread-block",
          id: "block:impl",
          threadId: "thread-1",
          sectionKind: "working",
          isActive: false,
          messages: [
            {
              id: "impl" as Thread["messages"][number]["id"],
              role: "assistant",
              text: "[T3CO-191](t3://ticket/T3CO-191)",
              createdAt: "2026-04-09T10:00:01.000Z",
              streaming: false,
            },
          ],
        },
      ],
      refresh: () => {},
    });

    const onOpenTicketLink = vi.fn();
    renderToStaticMarkup(
      <OrchestrationTimeline
        thread={makeThread()}
        projectId="project-1"
        scrollContainer={null}
        resolvedTheme="dark"
        timestampFormat="locale"
        markdownCwd={undefined}
        workspaceRoot={undefined}
        onNavigateToThread={() => {}}
        onOpenTicketLink={onOpenTicketLink}
      />,
    );

    expect(chatMarkdownMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "[T3CO-191](t3://ticket/T3CO-191)",
        onOpenTicketLink,
      }),
    );
  });

  it("renders timeline ticket mentions as internal ticket anchors when a handler is available", async () => {
    const { OrchestrationTimeline } = await import("./OrchestrationTimeline");
    useOrchestrationTimeline.mockReturnValue({
      loading: false,
      error: null,
      run: null,
      childThreads: [],
      timelineRows: [
        {
          kind: "separator",
          id: "sep:start",
          activityKind: "orchestration.run.ticket.started",
          summary: "Starting work on ticket T3CO-169",
          tone: "info",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketIdentifier: "T3CO-169",
        },
      ],
      refresh: () => {},
    });

    const markup = renderToStaticMarkup(
      <OrchestrationTimeline
        thread={makeThread()}
        projectId="project-1"
        scrollContainer={null}
        resolvedTheme="dark"
        timestampFormat="locale"
        markdownCwd={undefined}
        workspaceRoot={undefined}
        onNavigateToThread={() => {}}
        onOpenTicketLink={() => {}}
      />,
    );

    expect(markup).toContain('href="t3://ticket/T3CO-169"');
    expect(markup).toContain(">T3CO-169</a>");
  });

  it("renders non-prompt review user messages when they are present in timeline blocks", async () => {
    const { OrchestrationTimeline } = await import("./OrchestrationTimeline");
    useOrchestrationTimeline.mockReturnValue({
      loading: false,
      error: null,
      run: null,
      childThreads: [],
      timelineRows: [
        {
          kind: "thread-block",
          id: "block:review",
          threadId: "thread-review",
          sectionKind: "review",
          isActive: false,
          messages: [
            {
              id: "review-user" as Thread["messages"][number]["id"],
              role: "user",
              text: "Human review follow-up",
              createdAt: "2026-04-09T10:00:01.000Z",
              streaming: false,
            },
            {
              id: "review-assistant" as Thread["messages"][number]["id"],
              role: "assistant",
              text: '{"changesNeeded":false,"summary":"Looks good now.","comments":[]}',
              createdAt: "2026-04-09T10:00:02.000Z",
              streaming: false,
            },
          ],
          reviewIteration: 2,
          reviewOutcome: "approved",
        },
      ],
      refresh: () => {},
    });

    const markup = renderToStaticMarkup(
      <OrchestrationTimeline
        thread={makeThread()}
        projectId="project-1"
        scrollContainer={null}
        resolvedTheme="dark"
        timestampFormat="locale"
        markdownCwd={undefined}
        workspaceRoot={undefined}
        onNavigateToThread={() => {}}
      />,
    );

    expect(markup).toContain("Human review follow-up");
    expect(markup).toContain("Automated review 2 Approved Looks good now.");
    expect(markup).not.toContain("Continue.");
  });
});
