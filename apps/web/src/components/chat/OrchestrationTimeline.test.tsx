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

const chatMarkdownMock = vi.fn(({ text }: { text: string }) => text);

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
    variant,
    size,
  }: {
    children: ReactNode;
    render?: React.ReactElement | undefined;
    variant?: string;
    size?: string;
  }) => {
    const content = (
      <span data-variant={variant} data-size={size}>
        {children}
      </span>
    );
    if (!render) {
      return content;
    }

    return React.cloneElement(render, undefined, content);
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
});

async function renderTimeline(
  rows: OrchestrationTimelineRow[],
  extra?: {
    nowIso?: string;
    onOpenTicketLink?: (identifier: string) => void | Promise<void>;
  },
) {
  const { OrchestrationTimeline } = await import("./OrchestrationTimeline");

  return renderToStaticMarkup(
    <OrchestrationTimeline
      {...({
        timelineRows: rows,
        scrollContainer: null,
        resolvedTheme: "dark",
        timestampFormat: "locale",
        markdownCwd: undefined,
        workspaceRoot: undefined,
        nowIso: extra?.nowIso ?? "2026-04-09T10:02:00.000Z",
        onNavigateToThread: () => {},
        onOpenTicketLink: extra?.onOpenTicketLink ?? (() => {}),
      } as any)}
    />,
  );
}

describe("OrchestrationTimeline", () => {
  it("renders resumed and user-takeover markers with the expected badge variants", async () => {
    const markup = await renderTimeline([
      {
        kind: "separator",
        id: "sep:resumed",
        activityKind: "orchestration.run.resumed",
        summary: "Run resumed after restart",
        tone: "info",
        createdAt: "2026-04-09T10:00:00.000Z",
      },
      {
        kind: "separator",
        id: "sep:takeover",
        activityKind: "orchestration.run.user-takeover",
        summary: "Paused because the user took over ticket T3CO-188",
        tone: "info",
        createdAt: "2026-04-09T10:01:00.000Z",
        ticketIdentifier: "T3CO-188",
      },
    ]);

    expect(markup).toContain("Run resumed after restart");
    expect(markup).toContain("Paused because the user took over ticket ");
    expect(markup).toContain('data-variant="info"');
    expect(markup).toContain('data-variant="warning"');
    expect(markup).toContain('href="t3://ticket/T3CO-188"');
  });

  it("renders chronological implementation and review blocks with the old section chrome", async () => {
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

    const markup = await renderTimeline(rows, { nowIso: "2026-04-09T10:00:10.000Z" });

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
    const onOpenTicketLink = vi.fn();
    await renderTimeline(
      [
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
      { nowIso: "2026-04-09T10:00:10.000Z", onOpenTicketLink },
    );

    expect(chatMarkdownMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "[T3CO-191](t3://ticket/T3CO-191)",
        onOpenTicketLink,
      }),
    );
  });

  it("renders timeline ticket mentions as internal ticket anchors when a handler is available", async () => {
    const markup = await renderTimeline(
      [
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
      { nowIso: "2026-04-09T10:00:10.000Z", onOpenTicketLink: () => {} },
    );

    expect(markup).toContain('href="t3://ticket/T3CO-169"');
    expect(markup).toContain('data-variant="outline" data-size="sm">T3CO-169</span></a>');
    expect(markup).toContain("Starting work on ticket");
    expect(markup).not.toContain("Starting work on ticket T3CO-169");
  });

  it("renders blocked ticket pauses without duplicating the identifier in the label", async () => {
    const markup = await renderTimeline(
      [
        {
          kind: "separator",
          id: "sep:blocked",
          activityKind: "orchestration.run.paused",
          summary: "Ticket TEST-11 is blocked",
          tone: "error",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketIdentifier: "TEST-11",
        },
      ],
      { nowIso: "2026-04-09T10:00:10.000Z", onOpenTicketLink: () => {} },
    );

    expect(markup).toContain("Ticket is blocked");
    expect(markup).not.toContain("Ticket TEST-11 is blocked");
    expect(markup).toContain('href="t3://ticket/TEST-11"');
    expect(markup).toContain('data-variant="outline" data-size="sm">TEST-11</span></a>');
  });

  it("renders non-prompt review user messages when they are present in timeline blocks", async () => {
    const markup = await renderTimeline(
      [
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
      { nowIso: "2026-04-09T10:00:10.000Z" },
    );

    expect(markup).toContain("Human review follow-up");
    expect(markup).toContain("Automated review 2 Approved Looks good now.");
    expect(markup).not.toContain("Continue.");
  });

  it("renders outcome-derived review labels and review cards instead of raw JSON", async () => {
    const markup = await renderTimeline(
      [
        {
          kind: "thread-block",
          id: "block:review-approved",
          threadId: "thread-review-approved",
          sectionKind: "review",
          isActive: false,
          reviewIteration: 1,
          reviewOutcome: "approved",
          messages: [
            {
              id: "review-approved" as Thread["messages"][number]["id"],
              role: "assistant",
              text: '{"changesNeeded":false,"summary":"Ship it.","comments":[]}',
              createdAt: "2026-04-09T10:00:01.000Z",
              streaming: false,
            },
          ],
        },
        {
          kind: "thread-block",
          id: "block:review-failed",
          threadId: "thread-review-failed",
          sectionKind: "review",
          isActive: false,
          reviewIteration: 2,
          reviewOutcome: "requested-changes",
          messages: [
            {
              id: "review-failed" as Thread["messages"][number]["id"],
              role: "assistant",
              text: '{"changesNeeded":true,"summary":"Still needs follow-up.","comments":[]}',
              createdAt: "2026-04-09T10:00:02.000Z",
              streaming: false,
            },
          ],
        },
        {
          kind: "thread-block",
          id: "block:review-blocked",
          threadId: "thread-review-blocked",
          sectionKind: "review",
          isActive: false,
          reviewIteration: 3,
          reviewOutcome: "blocked",
          messages: [
            {
              id: "review-blocked" as Thread["messages"][number]["id"],
              role: "assistant",
              text: '{"changesNeeded":true,"summary":"Missing review payload.","comments":[]}',
              createdAt: "2026-04-09T10:00:03.000Z",
              streaming: false,
            },
          ],
        },
      ],
      { nowIso: "2026-04-09T10:00:10.000Z" },
    );

    expect(markup).toContain("Review Passed");
    expect(markup).toContain("Review Failed");
    expect(markup).toContain("Review Blocked");
    expect(markup).toContain("Automated review 1 Approved Ship it.");
    expect(markup).toContain("Automated review 2 Changes needed Still needs follow-up.");
    expect(markup).toContain("Automated review 3 Changes needed Missing review payload.");
    expect(markup).not.toContain('{"changesNeeded":false,"summary":"Ship it.","comments":[]}');
    expect(markup).not.toContain(
      '{"changesNeeded":true,"summary":"Still needs follow-up.","comments":[]}',
    );
    expect(markup).not.toContain(
      '{"changesNeeded":true,"summary":"Missing review payload.","comments":[]}',
    );
  });

  it("renders the shared working timer row for active orchestration runs", async () => {
    const markup = await renderTimeline(
      [
        {
          kind: "working",
          id: "working-indicator-row",
          createdAt: "2026-04-09T10:00:00.000Z",
        },
      ],
      { nowIso: "2026-04-09T10:02:21.000Z" },
    );

    expect(markup).toContain("Working for 2m 21s");
  });
});
