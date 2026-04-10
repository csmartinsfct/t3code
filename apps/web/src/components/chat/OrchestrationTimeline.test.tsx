import type { ThreadId } from "@t3tools/contracts";
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
        kind: "separator",
        id: "sep:changes",
        activityKind: "orchestration.run.ticket.review.requested-changes",
        summary: "Changes requested",
        tone: "info",
        createdAt: "2026-04-09T10:00:02.000Z",
        ticketIdentifier: "T3CO-24",
        reviewIteration: 1,
        reviewState: "requested-changes",
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
      />,
    );

    expect(markup).toContain("Implementation");
    expect(markup).toContain("Review Passed");
    expect(markup).toContain("Open thread");
    expect(markup).not.toContain("Active");
    expect(markup.indexOf("Initial implementation")).toBeLessThan(
      markup.indexOf("Changes requested"),
    );
    expect(markup.indexOf("Changes requested")).toBeLessThan(
      markup.indexOf("Addressed review feedback"),
    );
    expect(markup.indexOf("Addressed review feedback")).toBeLessThan(
      markup.indexOf("Looks good now."),
    );
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
});
