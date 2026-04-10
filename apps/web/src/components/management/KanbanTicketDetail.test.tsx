import type { Ticket, TicketDependency, TicketSummary } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DependencyTicketRow,
  KanbanTicketDetailDescription,
  SubTicketRowButton,
} from "./KanbanTicketDetail";

// Audit traceability: c709853, a8b01f5, 4603fb8.
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

    element.props.buttonProps.onClick();

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

    element.props.buttonProps.onClick();

    expect(onClick).toHaveBeenCalledOnce();
  });
});
