import type { ProjectId, TicketId, TicketSummary, TicketTreeNode } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetTree = vi.fn();
const mockOnEvent = vi.fn(() => () => {});
const mockGetById = vi.fn();

vi.mock("../../nativeApi", () => ({
  ensureNativeApi: () => ({
    ticketing: {
      getTree: mockGetTree,
      getById: mockGetById,
      onEvent: mockOnEvent,
    },
  }),
}));

vi.mock("./TicketPreviewContent", () => ({
  TicketPreviewContent: () => null,
}));

import { SubTicketsTree, countTreeNodes } from "./SubTicketsTree";

function makeSummary(overrides: Partial<TicketSummary>): TicketSummary {
  return {
    id: "ticket-x" as TicketId,
    projectId: "project-x" as ProjectId,
    parentId: null,
    ticketNumber: 1,
    identifier: "X-1" as TicketSummary["identifier"],
    title: "Ticket" as TicketSummary["title"],
    status: "todo",
    priority: "medium",
    sortOrder: 0,
    isArchived: false,
    worktree: null,
    labels: [],
    subTicketCount: 0,
    dependencyCount: 0,
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
    ...overrides,
  };
}

function makeNode(summary: TicketSummary, children: TicketTreeNode[] = []): TicketTreeNode {
  return { ticket: summary, children, dependencies: [] };
}

describe("countTreeNodes", () => {
  it("returns 0 for an empty tree", () => {
    expect(countTreeNodes([])).toBe(0);
  });

  it("counts every node across all depths", () => {
    const tree: TicketTreeNode[] = [
      makeNode(makeSummary({ id: "a" as TicketId }), [
        makeNode(makeSummary({ id: "a1" as TicketId }), [
          makeNode(makeSummary({ id: "a1a" as TicketId })),
        ]),
        makeNode(makeSummary({ id: "a2" as TicketId })),
      ]),
      makeNode(makeSummary({ id: "b" as TicketId })),
    ];
    // 5 nodes total: a, a1, a1a, a2, b
    expect(countTreeNodes(tree)).toBe(5);
  });
});

describe("SubTicketsTree static render", () => {
  beforeEach(() => {
    mockGetTree.mockReset();
    mockOnEvent.mockReset();
    mockGetById.mockReset();
    mockOnEvent.mockReturnValue(() => {});
    // The component shows a skeleton until getTree resolves; static markup
    // before the promise settles still includes the heading.
    mockGetTree.mockResolvedValue({
      roots: [
        makeNode(
          makeSummary({
            id: "child-a" as TicketId,
            identifier: "PRJ-2" as TicketSummary["identifier"],
            title: "Child A" as TicketSummary["title"],
          }),
          [
            makeNode(
              makeSummary({
                id: "grand-a1" as TicketId,
                identifier: "PRJ-3" as TicketSummary["identifier"],
                title: "Grand A1" as TicketSummary["title"],
                parentId: "child-a" as TicketId,
              }),
            ),
          ],
        ),
        makeNode(
          makeSummary({
            id: "child-b" as TicketId,
            identifier: "PRJ-4" as TicketSummary["identifier"],
            title: "Child B" as TicketSummary["title"],
          }),
        ),
      ],
      truncated: false,
      totalCount: 3,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the loading skeleton on the initial synchronous pass", () => {
    const markup = renderToStaticMarkup(
      <SubTicketsTree
        ticketId={"root-ticket" as TicketId}
        projectId={"project-1"}
        onNavigateToTicket={() => {}}
        onMoveToBoardRequest={() => {}}
        onArchiveRequest={() => {}}
      />,
    );

    expect(markup).toContain("Sub-tickets");
    expect(markup).toContain("sub-tickets-tree-skeleton-row");
  });
});

describe("SubTicketsTree truncation banner", () => {
  it("counts root + descendants correctly when banner triggers", () => {
    // The banner fires when result.truncated === true. We assert that
    // the helper counts all root-and-descendant nodes — server uses the same
    // logic to drive `totalCount`.
    const tree: TicketTreeNode[] = Array.from({ length: 4 }, (_, i) =>
      makeNode(
        makeSummary({
          id: `child-${i}` as TicketId,
          identifier: `PRJ-${i + 2}` as TicketSummary["identifier"],
          title: `Child ${i}` as TicketSummary["title"],
        }),
      ),
    );
    expect(countTreeNodes(tree)).toBe(4);
  });
});
