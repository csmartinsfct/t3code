import type { TicketSummary, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { STATUS_CONFIG } from "../settings/ticketUtils";

// Audit traceability: b0b9d97, 9c5b9e2, 105f574, c709853.

const mockNavigate = vi.fn();
const mockUseNavigate = vi.fn(() => mockNavigate);
const mockUseProjectById = vi.fn();
const mockUseTicketing = vi.fn();
const mockEnsureNativeApi = vi.fn(() => ({
  contextMenu: { show: vi.fn() },
  orchestration: { createRun: vi.fn(), startRun: vi.fn() },
  ticketing: {
    reorder: vi.fn(),
    update: vi.fn(),
  },
}));
const mockLogWebTimeline = vi.fn();
const detailMockState: {
  lastProps: {
    ticketId: TicketSummary["id"];
    onBack: () => void;
    onNavigateToTicket: (ticketId: TicketSummary["id"]) => void;
  } | null;
} = {
  lastProps: null,
};

const selectionStoreState = {
  selectedTicketIds: new Set<string>(),
  selectedTickets: new Map<string, TicketSummary>(),
  toggleTicket: vi.fn(),
  rangeSelectTo: vi.fn(),
  clearSelection: vi.fn(),
};

const uiStateStoreState = {
  boardContextByThreadId: {} as Record<
    string,
    {
      projectId: TicketSummary["projectId"];
      ticketStack: TicketSummary["id"][];
      boardScrollLeft: number;
      updatedAt: string;
    }
  >,
  setThreadBoardRoot: vi.fn(),
  pushThreadBoardTicket: vi.fn(),
  popThreadBoardTicket: vi.fn(),
  setThreadBoardScrollLeft: vi.fn(),
  sanitizeThreadBoardContext: vi.fn(),
  setManagementLastProjectId: vi.fn(),
};

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockUseNavigate(),
}));

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual("@dnd-kit/core");
  return {
    ...actual,
    useDroppable: () => ({
      setNodeRef: () => {},
      isOver: false,
    }),
  };
});

vi.mock("@dnd-kit/sortable", async () => {
  const actual = await vi.importActual("@dnd-kit/sortable");
  return {
    ...actual,
    SortableContext: ({ children }: { children: unknown }) => children,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});

vi.mock("../../hooks/useTicketing", () => ({
  useTicketing: (args: unknown) => mockUseTicketing(args),
}));

vi.mock("../../storeSelectors", () => ({
  useProjectById: (projectId: unknown) => mockUseProjectById(projectId),
}));

vi.mock("../../ticketSelectionStore", () => ({
  useTicketSelectionStore: (selector: (state: typeof selectionStoreState) => unknown) =>
    selector(selectionStoreState),
}));

vi.mock("../../uiStateStore", () => ({
  useUiStateStore: (selector: (state: typeof uiStateStoreState) => unknown) =>
    selector(uiStateStoreState),
}));

vi.mock("../../nativeApi", () => ({
  ensureNativeApi: () => mockEnsureNativeApi(),
}));

vi.mock("../../timelineLogger", () => ({
  logWebTimeline: (...args: unknown[]) => mockLogWebTimeline(...args),
}));

vi.mock("../ui/sidebar", () => ({
  CollapsedSidebarTrigger: ({ className }: { className?: string }) => (
    <button type="button" className={className}>
      Toggle sidebar
    </button>
  ),
}));

vi.mock("./KanbanSelectionBar", () => ({
  KanbanSelectionBar: () => null,
}));

vi.mock("./KanbanTicketDetail", () => ({
  KanbanTicketDetail: (props: {
    ticketId: TicketSummary["id"];
    onBack: () => void;
    onNavigateToTicket: (ticketId: TicketSummary["id"]) => void;
  }) => {
    detailMockState.lastProps = props;
    return <div>Detail:{props.ticketId}</div>;
  },
}));

vi.mock("./OrchestrateConfirmDialog", () => ({
  OrchestrateConfirmDialog: () => null,
}));

function makeTicket(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: "ticket-1" as TicketSummary["id"],
    projectId: "project-1" as TicketSummary["projectId"],
    parentId: null,
    ticketNumber: 1,
    identifier: "T3CO-1",
    title: "Default ticket",
    status: "todo",
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

async function renderBoard({
  electron = false,
  threadId = null,
  tickets = [],
  boardContextByThreadId = {},
}: {
  electron?: boolean;
  threadId?: ThreadId | null;
  tickets?: ReadonlyArray<TicketSummary>;
  boardContextByThreadId?: typeof uiStateStoreState.boardContextByThreadId;
} = {}) {
  vi.resetModules();
  vi.clearAllMocks();

  selectionStoreState.selectedTicketIds = new Set();
  selectionStoreState.selectedTickets = new Map();
  uiStateStoreState.boardContextByThreadId = boardContextByThreadId;
  detailMockState.lastProps = null;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: electron ? { nativeApi: {} } : {},
  });

  mockUseProjectById.mockReturnValue({
    id: "project-1",
    name: "Alpha Project",
  });

  mockUseTicketing.mockReturnValue({
    tickets,
    projects: [],
    loading: false,
    selectedProjectId: "project-1",
    setSelectedProjectId: vi.fn(),
    refetch: vi.fn(),
    applyLocalReorder: vi.fn(),
  });

  const { KanbanBoard } = await import("./KanbanBoard");

  return renderToStaticMarkup(<KanbanBoard threadId={threadId} projectId="project-1" />);
}

describe("KanbanBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders top-level tickets while filtering out child subtickets", async () => {
    const markup = await renderBoard({
      tickets: [
        makeTicket({
          id: "todo-parent" as TicketSummary["id"],
          ticketNumber: 10,
          identifier: "T3CO-10",
          title: "Top-level todo",
          status: "todo",
        }),
        makeTicket({
          id: "blocked-parent" as TicketSummary["id"],
          ticketNumber: 11,
          identifier: "T3CO-11",
          title: "Top-level blocked",
          status: "blocked",
          priority: "high",
          sortOrder: 1000,
        }),
        makeTicket({
          id: "child-ticket" as TicketSummary["id"],
          parentId: "todo-parent" as TicketSummary["id"],
          ticketNumber: 12,
          identifier: "T3CO-12",
          title: "Child task should stay off-board",
          status: "todo",
          sortOrder: 2000,
        }),
      ],
    });

    expect(markup).toContain("Top-level todo");
    expect(markup).toContain("Top-level blocked");
    expect(markup).not.toContain("Child task should stay off-board");
    expect(markup).not.toContain("T3CO-12");
  });

  it("renders blocked tickets in the blocked column with the expected label treatment", async () => {
    const blockedLabel = STATUS_CONFIG.blocked.label;
    const markup = await renderBoard({
      tickets: [
        makeTicket({
          id: "blocked-parent" as TicketSummary["id"],
          ticketNumber: 21,
          identifier: "T3CO-21",
          title: "Waiting on vendor response",
          status: "blocked",
          priority: "urgent",
        }),
      ],
    });

    expect(markup).toContain(blockedLabel);
    expect(markup).toContain("Waiting on vendor response");
    expect(markup).toContain("T3CO-21");
    expect(markup).toContain(STATUS_CONFIG.blocked.dotClass);
  });

  it("renders web board chrome without the removed New ticket action", async () => {
    const markup = await renderBoard({
      electron: false,
      tickets: [makeTicket()],
    });

    expect(markup).toContain(">Board<");
    expect(markup).toContain("Alpha Project");
    expect(markup).toContain("px-3 sm:px-5");
    expect(markup).not.toContain("drag-region");
    expect(markup).not.toContain("New ticket");
  });

  it("renders electron board chrome with the drag region and responsive spacing classes", async () => {
    const markup = await renderBoard({
      electron: true,
      tickets: [makeTicket()],
    });

    expect(markup).toContain("drag-region");
    expect(markup).toContain("px-3 sm:px-5");
    expect(markup).not.toContain("New ticket");
  });

  it("steps back through nested ticket detail state one level at a time before returning to the board", async () => {
    const threadId = "thread-1" as ThreadId;
    const updatedAt = "2026-04-10T11:00:00.000Z";

    const boardMarkup = await renderBoard({
      threadId,
      tickets: [makeTicket()],
      boardContextByThreadId: {
        [threadId]: {
          projectId: "project-1" as TicketSummary["projectId"],
          ticketStack: [],
          boardScrollLeft: 0,
          updatedAt,
        },
      },
    });

    expect(boardMarkup).toContain(">Board<");
    expect(boardMarkup).not.toContain("Detail:");

    const nestedDetailMarkup = await renderBoard({
      threadId,
      tickets: [makeTicket()],
      boardContextByThreadId: {
        [threadId]: {
          projectId: "project-1" as TicketSummary["projectId"],
          ticketStack: [
            "parent-ticket" as TicketSummary["id"],
            "child-ticket" as TicketSummary["id"],
          ],
          boardScrollLeft: 0,
          updatedAt,
        },
      },
    });

    expect(nestedDetailMarkup).toContain("Back");
    expect(nestedDetailMarkup).toContain("Detail:child-ticket");
    expect(detailMockState.lastProps?.ticketId).toBe("child-ticket");

    detailMockState.lastProps?.onBack();
    expect(uiStateStoreState.popThreadBoardTicket).toHaveBeenCalledWith(threadId);

    const parentDetailMarkup = await renderBoard({
      threadId,
      tickets: [makeTicket()],
      boardContextByThreadId: {
        [threadId]: {
          projectId: "project-1" as TicketSummary["projectId"],
          ticketStack: ["parent-ticket" as TicketSummary["id"]],
          boardScrollLeft: 0,
          updatedAt,
        },
      },
    });

    expect(parentDetailMarkup).toContain("Back");
    expect(parentDetailMarkup).toContain("Detail:parent-ticket");
    expect(detailMockState.lastProps?.ticketId).toBe("parent-ticket");

    // renderBoard() clears mocks between renders, so this assertion is scoped to the second back step.
    detailMockState.lastProps?.onBack();
    expect(uiStateStoreState.popThreadBoardTicket).toHaveBeenCalledOnce();
    expect(uiStateStoreState.popThreadBoardTicket).toHaveBeenCalledWith(threadId);

    const restoredBoardMarkup = await renderBoard({
      threadId,
      tickets: [makeTicket()],
      boardContextByThreadId: {
        [threadId]: {
          projectId: "project-1" as TicketSummary["projectId"],
          ticketStack: [],
          boardScrollLeft: 0,
          updatedAt,
        },
      },
    });

    expect(restoredBoardMarkup).toContain(">Board<");
    expect(restoredBoardMarkup).not.toContain("Detail:parent-ticket");
  });
});
