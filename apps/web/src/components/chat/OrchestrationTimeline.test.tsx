import type { TicketId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Thread } from "../../types";
import type { OrchestrationTimelineRow } from "../../hooks/useOrchestrationTimeline.logic";

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
  Badge: ({ children }: { children: React.ReactNode }) => children,
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
  it("renders merged chronology and review cards", async () => {
    const { OrchestrationTimeline } = await import("./OrchestrationTimeline");
    const rows: OrchestrationTimelineRow[] = [
      {
        kind: "milestone",
        id: "milestone:start",
        activityKind: "orchestration.run.ticket.started",
        summary: "Starting work on T3CO-24",
        tone: "info",
        createdAt: "2026-04-09T10:00:00.000Z",
        ticketIdentifier: "T3CO-24",
      },
      {
        kind: "message",
        id: "message:impl",
        createdAt: "2026-04-09T10:00:01.000Z",
        threadId: "thread-1",
        ticketId: "ticket-1" as TicketId,
        ticketIdentifier: "T3CO-24",
        threadKind: "working",
        sourceLabel: "Implementation",
        isActiveSource: false,
        message: {
          id: "impl" as Thread["messages"][number]["id"],
          role: "assistant",
          text: "Addressed review feedback",
          createdAt: "2026-04-09T10:00:01.000Z",
          streaming: false,
        },
      },
      {
        kind: "milestone",
        id: "milestone:changes",
        activityKind: "orchestration.run.ticket.review.requested-changes",
        summary: "Changes requested",
        tone: "info",
        createdAt: "2026-04-09T10:00:02.000Z",
        ticketIdentifier: "T3CO-24",
        reviewIteration: 1,
        reviewState: "requested-changes",
      },
      {
        kind: "message",
        id: "message:review",
        createdAt: "2026-04-09T10:00:03.000Z",
        threadId: "thread-review-1",
        ticketId: "ticket-1" as TicketId,
        ticketIdentifier: "T3CO-24",
        threadKind: "review",
        sourceLabel: "Review 2",
        reviewIteration: 2,
        isActiveSource: true,
        message: {
          id: "review" as Thread["messages"][number]["id"],
          role: "assistant",
          text: '{"changesNeeded":false,"summary":"Looks good now.","comments":[]}',
          createdAt: "2026-04-09T10:00:03.000Z",
          streaming: false,
        },
        reviewOutput: {
          changesNeeded: false,
          summary: "Looks good now.",
          comments: [],
        },
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
      />,
    );

    expect(markup.indexOf("Addressed review feedback")).toBeLessThan(
      markup.indexOf("Changes requested"),
    );
    expect(markup.indexOf("Changes requested")).toBeLessThan(markup.indexOf("Looks good now."));
    expect(markup).toContain("Open thread");
    expect(markup).toContain("Review 2");
    expect(markup).toContain("Approved");
  });

  it("passes ticket-link handlers through to markdown rows", async () => {
    const { OrchestrationTimeline } = await import("./OrchestrationTimeline");
    useOrchestrationTimeline.mockReturnValue({
      loading: false,
      error: null,
      run: null,
      childThreads: [],
      timelineRows: [
        {
          kind: "message",
          id: "message:impl",
          createdAt: "2026-04-09T10:00:01.000Z",
          threadId: "thread-1",
          threadKind: "working",
          sourceLabel: "Implementation",
          isActiveSource: false,
          message: {
            id: "impl" as Thread["messages"][number]["id"],
            role: "assistant",
            text: "[T3CO-191](t3://ticket/T3CO-191)",
            createdAt: "2026-04-09T10:00:01.000Z",
            streaming: false,
          },
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
});
