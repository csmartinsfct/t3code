import type {
  Ticket,
  TicketDependency,
  TicketLinkedThread,
  TicketSummary,
  TicketingStreamEvent,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DependencyTicketRow,
  KanbanTicketDetailDescription,
  SubTicketRowButton,
  resolveTicketDetailStreamEventAction,
} from "./KanbanTicketDetail";
import {
  TicketOriginThreadSection,
  TicketRelatedThreadsSection,
  TicketThreadRowButton,
} from "./TicketOriginThreadSection";

// Audit traceability: c709853, a8b01f5, 4603fb8, 4d81550, 96da4f9.
const DETAIL_DESCRIPTION = `- Detail list item

Visit [spec](https://example.com/spec) with \`inline detail code\`.

> Detail quote

\`\`\`tsx
export function DetailExample() {
  return <div />;
}
\`\`\`
`;

function makeDependency(overrides: Partial<TicketDependency> = {}): TicketDependency {
  return {
    ticketId: "ticket-1" as Ticket["id"],
    dependsOnTicketId: "ticket-2" as Ticket["id"],
    identifier: "T3CO-2",
    title: "Hydrated dependency title",
    status: "in_review",
    ...overrides,
  };
}

function makeSubTicket(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: "ticket-3" as TicketSummary["id"],
    projectId: "project-1" as TicketSummary["projectId"],
    parentId: "ticket-1" as TicketSummary["id"],
    ticketNumber: 3,
    identifier: "T3CO-3",
    title: "Child ticket title",
    status: "blocked",
    priority: "medium",
    sortOrder: 0,
    isArchived: false,
    worktree: null,
    labels: [],
    subTicketCount: 0,
    dependencyCount: 0,
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:00:00.000Z",
    ...overrides,
  };
}

function makeLinkedThread(overrides: Partial<TicketLinkedThread> = {}): TicketLinkedThread {
  return {
    threadId: "thread-1" as TicketLinkedThread["threadId"],
    title: "Orchestration JSON Parsing Regression",
    createdAt: "2026-04-10T08:00:00.000Z",
    updatedAt: "2026-04-10T08:00:00.000Z",
    archivedAt: "2026-04-10T09:00:00.000Z",
    isOrchestrationThread: true,
    parentThreadId: "parent-thread-1" as TicketLinkedThread["threadId"],
    linkTypes: ["origin"],
    isVisible: false,
    linkedAt: "2026-04-10T10:00:00.000Z",
    ...overrides,
  };
}

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "ticket-1" as Ticket["id"],
    projectId: "project-1" as Ticket["projectId"],
    parentId: null,
    ticketNumber: 1,
    identifier: "T3CO-1",
    title: "Parent ticket",
    description: DETAIL_DESCRIPTION,
    status: "todo",
    priority: "medium",
    sortOrder: 0,
    isArchived: false,
    worktree: null,
    implementerModelOverride: null,
    reviewerModelOverride: null,
    acceptanceCriteria: [],
    labels: [],
    dependencies: [],
    subTickets: [],
    comments: [],
    artifacts: [],
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("KanbanTicketDetail", () => {
  it("renders the read-only ticket description with Markdown/GFM structure", () => {
    const html = renderToStaticMarkup(
      <div className="rounded-md px-3 py-2">
        <p className="text-[11px] font-medium text-muted-foreground">Description</p>
        <KanbanTicketDetailDescription description={DETAIL_DESCRIPTION} />
      </div>,
    );

    expect(html).toContain("<ul>");
    expect(html).toContain('<a href="https://example.com/spec">spec</a>');
    expect(html).toContain("<code>inline detail code</code>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('class="language-tsx"');
  });

  it("renders dependency rows with hydrated title, status badge, and identifier", () => {
    const html = renderToStaticMarkup(
      <DependencyTicketRow dependency={makeDependency()} onNavigateToTicket={() => undefined} />,
    );

    expect(html).toContain("In Review");
    expect(html).toContain("T3CO-2");
    expect(html).toContain("Hydrated dependency title");
  });

  it("renders sub-ticket rows with status badge and identifier alongside the title", () => {
    const html = renderToStaticMarkup(
      <SubTicketRowButton
        subTicket={makeSubTicket()}
        isSelected={false}
        isDragging={false}
        onClick={() => undefined}
      />,
    );

    expect(html).toContain("Blocked");
    expect(html).toContain("T3CO-3");
    expect(html).toContain("Child ticket title");
  });

  it("wires dependency row click-through navigation", () => {
    const onNavigateToTicket = vi.fn();
    const element = DependencyTicketRow({
      dependency: makeDependency({ dependsOnTicketId: "ticket-99" as Ticket["id"] }),
      onNavigateToTicket,
    });

    element.props.onClick();

    expect(onNavigateToTicket).toHaveBeenCalledWith("ticket-99");
  });

  it("wires sub-ticket row click-through navigation", () => {
    const onClick = vi.fn();
    const element = SubTicketRowButton({
      subTicket: makeSubTicket({ id: "ticket-77" as TicketSummary["id"] }),
      isSelected: false,
      isDragging: false,
      onClick,
    });

    element.props.onClick();

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("refetches for related ticket_upserted events that add or remove sub-ticket and dependency relationships", () => {
    const currentTicket = makeTicket({
      dependencies: [makeDependency({ dependsOnTicketId: "ticket-2" as Ticket["id"] })],
      subTickets: [makeSubTicket({ id: "ticket-3" as TicketSummary["id"] })],
    });

    const cases: TicketingStreamEvent[] = [
      {
        type: "ticket_upserted",
        projectId: currentTicket.projectId,
        ticket: makeSubTicket({ id: "ticket-3" as TicketSummary["id"], parentId: null }),
      },
      {
        type: "ticket_upserted",
        projectId: currentTicket.projectId,
        ticket: makeSubTicket({
          id: "ticket-4" as TicketSummary["id"],
          parentId: currentTicket.id,
        }),
      },
      {
        type: "ticket_upserted",
        projectId: currentTicket.projectId,
        ticket: makeSubTicket({ id: "ticket-2" as TicketSummary["id"], parentId: null }),
      },
      {
        type: "ticket_upserted",
        projectId: currentTicket.projectId,
        ticket: makeSubTicket({
          id: "ticket-99" as TicketSummary["id"],
          parentId: null,
          identifier: "T3CO-99",
        }),
      },
    ];

    expect(
      cases.map((event) =>
        resolveTicketDetailStreamEventAction(currentTicket.id, currentTicket, event),
      ),
    ).toEqual(["refetch", "refetch", "refetch", "ignore"]);
  });

  it("refetches for related delete events that remove dependency or sub-ticket rows", () => {
    const currentTicket = makeTicket({
      dependencies: [makeDependency({ dependsOnTicketId: "ticket-2" as Ticket["id"] })],
      subTickets: [makeSubTicket({ id: "ticket-3" as TicketSummary["id"] })],
    });

    const dependencyDelete: TicketingStreamEvent = {
      type: "ticket_deleted",
      projectId: currentTicket.projectId,
      ticketId: "ticket-2" as Ticket["id"],
    };
    const subTicketDelete: TicketingStreamEvent = {
      type: "ticket_deleted",
      projectId: currentTicket.projectId,
      ticketId: "ticket-3" as Ticket["id"],
    };

    expect(
      resolveTicketDetailStreamEventAction(currentTicket.id, currentTicket, dependencyDelete),
    ).toBe("refetch");
    expect(
      resolveTicketDetailStreamEventAction(currentTicket.id, currentTicket, subTicketDelete),
    ).toBe("refetch");
  });

  it("renders origin and related thread sections with source, state, and review badges", () => {
    const html = renderToStaticMarkup(
      <>
        <TicketOriginThreadSection thread={makeLinkedThread()} onOpenThread={() => undefined} />
        <TicketRelatedThreadsSection
          threads={[
            makeLinkedThread({
              threadId: "thread-2" as TicketLinkedThread["threadId"],
              title: "Visible implementation thread",
              archivedAt: null,
              isOrchestrationThread: false,
              parentThreadId: null,
              linkTypes: ["bound", "mention"],
              isVisible: true,
              linkedAt: "2026-04-10T11:00:00.000Z",
            }),
          ]}
          onOpenThread={() => undefined}
        />
      </>,
    );

    expect(html).toContain("Origin Thread");
    expect(html).toContain("Related Threads (1)");
    expect(html).toContain("Origin");
    expect(html).toContain("Bound");
    expect(html).toContain("Mention");
    expect(html).toContain("Archived");
    expect(html).toContain("Review");
    expect(html).toContain("Hidden");
    expect(html).toContain("Visible");
  });

  it("wires thread-row navigation for both hidden and visible linked threads", () => {
    const onOpenThread = vi.fn();

    const hiddenThreadRow = TicketThreadRowButton({
      thread: makeLinkedThread(),
      onOpenThread,
    });
    const visibleThreadRow = TicketThreadRowButton({
      thread: makeLinkedThread({
        threadId: "thread-2" as TicketLinkedThread["threadId"],
        archivedAt: null,
        isOrchestrationThread: false,
        parentThreadId: null,
        linkTypes: ["bound", "mention"],
        isVisible: true,
      }),
      onOpenThread,
    });

    hiddenThreadRow.props.onClick();
    visibleThreadRow.props.onClick();

    expect(onOpenThread).toHaveBeenNthCalledWith(1, "thread-1");
    expect(onOpenThread).toHaveBeenNthCalledWith(2, "thread-2");
  });
});
