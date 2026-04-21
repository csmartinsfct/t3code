import type { TicketSummary, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { STATUS_CONFIG } from "../settings/ticketUtils";
import {
  hasBoardOrchestrationProjectMismatch,
  launchBoardOrchestration,
  resolveBoardOrchestrateSelectionFromContextMenu,
  resolveBoardOrchestrateSelectionFromDetail,
  resolveBoardOrchestrateSelectionFromSelectionBar,
} from "./KanbanBoard";

// Audit traceability: 4973c83, b0b9d97, 9c5b9e2, 105f574, c709853, b3db7d6, 6d20dbf.

const mockNavigate = vi.fn();
const mockUseNavigate = vi.fn(() => mockNavigate);
const mockUseProjectById = vi.fn();
const mockUseTicketing = vi.fn();
const mockCreateRun = vi.fn();
const mockStartRun = vi.fn();
const mockEnsureNativeApi = vi.fn(() => ({
  contextMenu: { show: vi.fn() },
  orchestration: { createRun: mockCreateRun, startRun: mockStartRun },
  ticketing: {
    reorder: vi.fn(),
    update: vi.fn(),
  },
}));
const mockLogWebTimeline = vi.fn();
const mockToastAdd = vi.fn();
const detailMockState: {
  lastProps: {
    ticketId: TicketSummary["id"];
    onBack: () => void;
    onNavigateToTicket: (ticketId: TicketSummary["id"]) => void;
    findTicketSummary?: (id: TicketSummary["id"]) => TicketSummary | undefined;
    onOrchestrate?: (ticket: {
      id: TicketSummary["id"];
      projectId: TicketSummary["projectId"];
      parentId: TicketSummary["parentId"];
      ticketNumber: TicketSummary["ticketNumber"];
      identifier: TicketSummary["identifier"];
      title: TicketSummary["title"];
      status: TicketSummary["status"];
      priority: TicketSummary["priority"];
      sortOrder: TicketSummary["sortOrder"];
      isArchived: TicketSummary["isArchived"];
      worktree: TicketSummary["worktree"];
      labels: TicketSummary["labels"];
      subTickets: [];
      dependencies: [];
      createdAt: TicketSummary["createdAt"];
      updatedAt: TicketSummary["updatedAt"];
    }) => void;
  } | null;
} = {
  lastProps: null,
};
const selectionBarMockState: {
  lastProps: {
    selectedCount: number;
    onOrchestrate: () => void;
    onDelete: () => void;
    onClear: () => void;
  } | null;
} = {
  lastProps: null,
};
const columnMockState: {
  lastProps: {
    onCardContextMenu: (event: React.MouseEvent, ticket: TicketSummary) => void | Promise<void>;
  } | null;
} = {
  lastProps: null,
};
const orchestrationSubpageMockState: {
  lastProps: {
    selectedTickets: ReadonlyMap<string, TicketSummary>;
    allTickets: readonly TicketSummary[];
    projectId: string;
    onConfirm: (...args: unknown[]) => Promise<void> | void;
    onBack: () => void;
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
  managementBoardContext: null as {
    projectId: TicketSummary["projectId"];
    ticketStack: TicketSummary["id"][];
    boardScrollLeft: number;
    updatedAt: string;
  } | null,
  boardViewMode: "cards" as "cards" | "list",
  browserVisible: false,
  boardFiltersByProjectId: {},
  setManagementBoardRoot: vi.fn(),
  pushManagementBoardTicket: vi.fn(),
  popManagementBoardTicket: vi.fn(),
  setManagementBoardScrollLeft: vi.fn(),
  sanitizeManagementBoardContext: vi.fn(),
  setBoardViewMode: vi.fn(),
  setBrowserVisible: vi.fn(),
  setBoardFilters: vi.fn(),
  toggleBoardCollapsedStatus: vi.fn(),
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
  DEFAULT_BOARD_FILTERS: {
    priorityFilter: [],
    labelFilter: [],
    searchQuery: "",
    collapsedStatuses: [],
  },
  useUiStateStore: (selector: (state: typeof uiStateStoreState) => unknown) =>
    selector(uiStateStoreState),
}));

vi.mock("../../nativeApi", () => ({
  ensureNativeApi: () => mockEnsureNativeApi(),
}));

vi.mock("../../timelineLogger", () => ({
  logWebTimeline: (...args: unknown[]) => mockLogWebTimeline(...args),
}));

vi.mock("../ui/toast", () => ({
  toastManager: {
    add: (...args: unknown[]) => mockToastAdd(...args),
  },
}));

vi.mock("../ui/sidebar", () => ({
  CollapsedSidebarTrigger: ({ className }: { className?: string }) => (
    <button type="button" className={className}>
      Toggle sidebar
    </button>
  ),
}));

vi.mock("../browser/EmbeddedBrowser", () => ({
  EmbeddedBrowser: ({ projectId }: { projectId: string }) => <div>EmbeddedBrowser:{projectId}</div>,
}));

vi.mock("./KanbanSelectionBar", () => ({
  KanbanSelectionBar: (props: {
    selectedCount: number;
    onOrchestrate: () => void;
    onDelete: () => void;
    onClear: () => void;
  }) => {
    selectionBarMockState.lastProps = props;
    return null;
  },
}));

vi.mock("./KanbanColumn", () => ({
  KanbanColumn: (props: {
    status?: TicketSummary["status"];
    tickets?: TicketSummary[];
    onCardContextMenu: (event: React.MouseEvent, ticket: TicketSummary) => void | Promise<void>;
  }) => {
    columnMockState.lastProps = props;
    const statusConfig = props.status ? STATUS_CONFIG[props.status] : null;
    return (
      <section>
        <div>{statusConfig?.label ?? props.status}</div>
        <div>{statusConfig?.dotClass}</div>
        {props.tickets?.map((ticket) => (
          <div key={ticket.id}>
            <span>{ticket.title}</span>
            <span>{ticket.identifier}</span>
          </div>
        ))}
      </section>
    );
  },
}));

vi.mock("./KanbanTicketDetail", () => ({
  KanbanTicketDetail: (props: {
    ticketId: TicketSummary["id"];
    onBack: () => void;
    onNavigateToTicket: (ticketId: TicketSummary["id"]) => void;
    findTicketSummary?: (id: TicketSummary["id"]) => TicketSummary | undefined;
    onOrchestrate?: (ticket: {
      id: TicketSummary["id"];
      projectId: TicketSummary["projectId"];
      parentId: TicketSummary["parentId"];
      ticketNumber: TicketSummary["ticketNumber"];
      identifier: TicketSummary["identifier"];
      title: TicketSummary["title"];
      status: TicketSummary["status"];
      priority: TicketSummary["priority"];
      sortOrder: TicketSummary["sortOrder"];
      isArchived: TicketSummary["isArchived"];
      worktree: TicketSummary["worktree"];
      labels: TicketSummary["labels"];
      subTickets: [];
      dependencies: [];
      createdAt: TicketSummary["createdAt"];
      updatedAt: TicketSummary["updatedAt"];
    }) => void;
  }) => {
    detailMockState.lastProps = props;
    return <div>Detail:{props.ticketId}</div>;
  },
}));

vi.mock("./OrchestrationSubpage", () => ({
  OrchestrationSubpage: (props: {
    selectedTickets: ReadonlyMap<string, TicketSummary>;
    allTickets: readonly TicketSummary[];
    projectId: string;
    onConfirm: (...args: unknown[]) => Promise<void> | void;
    onBack: () => void;
  }) => {
    orchestrationSubpageMockState.lastProps = props;
    return <div>OrchestrationSubpage</div>;
  },
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
  managementBoardContext = null,
  boardViewMode = "cards",
  browserVisible = false,
}: {
  electron?: boolean;
  threadId?: ThreadId | null;
  tickets?: ReadonlyArray<TicketSummary>;
  managementBoardContext?: typeof uiStateStoreState.managementBoardContext;
  boardViewMode?: typeof uiStateStoreState.boardViewMode;
  browserVisible?: boolean;
} = {}) {
  vi.resetModules();
  vi.clearAllMocks();

  selectionStoreState.selectedTicketIds = new Set();
  selectionStoreState.selectedTickets = new Map();
  uiStateStoreState.managementBoardContext = managementBoardContext;
  uiStateStoreState.boardViewMode = boardViewMode;
  uiStateStoreState.browserVisible = browserVisible;
  detailMockState.lastProps = null;
  selectionBarMockState.lastProps = null;
  columnMockState.lastProps = null;
  orchestrationSubpageMockState.lastProps = null;
  mockToastAdd.mockReset();
  mockCreateRun.mockReset();
  mockStartRun.mockReset();

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

  it("renders the embedded browser when the browser toggle is enabled", async () => {
    const markup = await renderBoard({
      tickets: [makeTicket()],
      browserVisible: true,
    });

    expect(markup).toContain("EmbeddedBrowser:project-1");
    expect(markup).not.toContain("Default ticket");
  });

  it("steps back through nested ticket detail state one level at a time before returning to the board", async () => {
    const threadId = "thread-1" as ThreadId;
    const updatedAt = "2026-04-10T11:00:00.000Z";

    const boardMarkup = await renderBoard({
      threadId,
      tickets: [makeTicket()],
      managementBoardContext: {
        projectId: "project-1" as TicketSummary["projectId"],
        ticketStack: [],
        boardScrollLeft: 0,
        updatedAt,
      },
    });

    expect(boardMarkup).toContain(">Board<");
    expect(boardMarkup).not.toContain("Detail:");

    const nestedDetailMarkup = await renderBoard({
      threadId,
      tickets: [makeTicket()],
      managementBoardContext: {
        projectId: "project-1" as TicketSummary["projectId"],
        ticketStack: [
          "parent-ticket" as TicketSummary["id"],
          "child-ticket" as TicketSummary["id"],
        ],
        boardScrollLeft: 0,
        updatedAt,
      },
    });

    expect(nestedDetailMarkup).toContain("Back");
    expect(nestedDetailMarkup).toContain("Detail:child-ticket");
    expect(detailMockState.lastProps?.ticketId).toBe("child-ticket");

    detailMockState.lastProps?.onBack();
    expect(uiStateStoreState.popManagementBoardTicket).toHaveBeenCalledWith();

    const parentDetailMarkup = await renderBoard({
      threadId,
      tickets: [makeTicket()],
      managementBoardContext: {
        projectId: "project-1" as TicketSummary["projectId"],
        ticketStack: ["parent-ticket" as TicketSummary["id"]],
        boardScrollLeft: 0,
        updatedAt,
      },
    });

    expect(parentDetailMarkup).toContain("Back");
    expect(parentDetailMarkup).toContain("Detail:parent-ticket");
    expect(detailMockState.lastProps?.ticketId).toBe("parent-ticket");

    // renderBoard() clears mocks between renders, so this assertion is scoped to the second back step.
    detailMockState.lastProps?.onBack();
    expect(uiStateStoreState.popManagementBoardTicket).toHaveBeenCalledOnce();
    expect(uiStateStoreState.popManagementBoardTicket).toHaveBeenCalledWith();

    const restoredBoardMarkup = await renderBoard({
      threadId,
      tickets: [makeTicket()],
      managementBoardContext: {
        projectId: "project-1" as TicketSummary["projectId"],
        ticketStack: [],
        boardScrollLeft: 0,
        updatedAt,
      },
    });

    expect(restoredBoardMarkup).toContain(">Board<");
    expect(restoredBoardMarkup).not.toContain("Detail:parent-ticket");
  });

  it("clears stale cross-project detail state instead of rendering the wrong ticket detail", async () => {
    const threadId = "thread-stale-project" as ThreadId;

    const markup = await renderBoard({
      threadId,
      tickets: [makeTicket()],
      managementBoardContext: {
        projectId: "project-2" as TicketSummary["projectId"],
        ticketStack: ["stale-ticket" as TicketSummary["id"]],
        boardScrollLeft: 0,
        updatedAt: "2026-04-10T11:30:00.000Z",
      },
    });

    expect(markup).toContain(">Board<");
    expect(markup).not.toContain("Detail:stale-ticket");
  });

  it("detects stale cross-project orchestration selections before the board starts a run", () => {
    const sameProjectTicket = makeTicket({
      id: "ticket-1" as TicketSummary["id"],
      identifier: "T3CO-1",
      title: "Active project ticket",
    });
    const staleProjectTicket = makeTicket({
      id: "ticket-99" as TicketSummary["id"],
      projectId: "project-2" as TicketSummary["projectId"],
      identifier: "T3CO-99",
      title: "Stale project ticket",
    });

    expect(
      hasBoardOrchestrationProjectMismatch(
        new Map([
          [sameProjectTicket.id, sameProjectTicket],
          [staleProjectTicket.id, staleProjectTicket],
        ]),
        "project-1" as TicketSummary["projectId"],
      ),
    ).toBe(true);

    expect(
      hasBoardOrchestrationProjectMismatch(
        new Map([[sameProjectTicket.id, sameProjectTicket]]),
        "project-1" as TicketSummary["projectId"],
      ),
    ).toBe(false);
  });

  it("opens orchestration from the card context menu using the current multi-selection", () => {
    const selectedTicket = makeTicket({
      id: "ticket-2" as TicketSummary["id"],
      identifier: "T3CO-2",
      title: "Selected ticket",
    });

    const selection = resolveBoardOrchestrateSelectionFromContextMenu({
      clickedItem: "orchestrate",
      ticket: makeTicket(),
      selectedTicketIds: new Set(["ticket-1" as TicketSummary["id"], selectedTicket.id]),
      selectedTickets: new Map([
        ["ticket-1" as TicketSummary["id"], makeTicket()],
        [selectedTicket.id, selectedTicket],
      ]),
    });

    expect([...(selection?.values() ?? [])].map((ticket) => ticket.identifier)).toEqual([
      "T3CO-1",
      "T3CO-2",
    ]);
  });

  it("falls back to the clicked ticket when the context-menu card is not in the current selection", () => {
    const clickedTicket = makeTicket({
      id: "ticket-9" as TicketSummary["id"],
      identifier: "T3CO-9",
      title: "Clicked ticket",
    });

    const selection = resolveBoardOrchestrateSelectionFromContextMenu({
      clickedItem: "orchestrate",
      ticket: clickedTicket,
      selectedTicketIds: new Set(["ticket-1" as TicketSummary["id"]]),
      selectedTickets: new Map([["ticket-1" as TicketSummary["id"], makeTicket()]]),
    });

    expect(selection).toEqual(new Map([[clickedTicket.id, clickedTicket]]));
  });

  it("opens orchestration from the selection bar with the selected tickets", () => {
    const selectedTicket = makeTicket({
      id: "ticket-2" as TicketSummary["id"],
      identifier: "T3CO-2",
      title: "Selected ticket",
    });
    const selection = resolveBoardOrchestrateSelectionFromSelectionBar(
      new Map([
        ["ticket-1" as TicketSummary["id"], makeTicket()],
        [selectedTicket.id, selectedTicket],
      ]),
    );

    expect([...selection.values()].map((ticket) => ticket.identifier)).toEqual([
      "T3CO-1",
      "T3CO-2",
    ]);
  });

  it("opens orchestration from ticket detail with a single-ticket preview selection", () => {
    const ticket = {
      ...makeTicket(),
      description: null,
      acceptanceCriteria: [],
      dependencies: [],
      subTickets: [],
      comments: [],
      artifacts: [],
    };

    const resolution = resolveBoardOrchestrateSelectionFromDetail({
      ticket,
      projectId: "project-1" as TicketSummary["projectId"],
    });

    expect(resolution.kind).toBe("open-dialog");
    if (resolution.kind !== "open-dialog") {
      return;
    }
    expect([...resolution.selectedTickets.values()][0]).toMatchObject({
      identifier: "T3CO-1",
      subTicketCount: 0,
      dependencyCount: 0,
    });
  });

  it("creates, starts, and hands off navigation after orchestration launch", async () => {
    const navigateToThread = vi.fn();
    const clearSelection = vi.fn();
    const api = {
      orchestration: {
        createRun: vi.fn(async () => ({
          runId: "run-1" as never,
          orchestrationThreadId: "thread-orch-1" as ThreadId,
          workingThreadIds: [],
        })),
        startRun: vi.fn(async () => undefined),
      },
    };

    const result = await launchBoardOrchestration({
      api,
      projectId: "project-1" as TicketSummary["projectId"],
      selectedTicketIdentifiers: ["T3CO-2", "T3CO-1"] as const,
      implementerModelSelection: { provider: "codex", model: "gpt-5.4" },
      reviewerModelSelection: { provider: "codex", model: "gpt-5.4-mini" },
      orchestrateTickets: new Map([[makeTicket().id, makeTicket()]]),
      onProjectMismatch: vi.fn(),
      clearSelection,
      navigateToThread,
    });

    expect(result.kind).toBe("started");
    expect(api.orchestration.createRun).toHaveBeenCalledWith({
      projectId: "project-1",
      selectedTicketIdentifiers: ["T3CO-2", "T3CO-1"],
      implementerModelSelection: { provider: "codex", model: "gpt-5.4" },
      reviewerModelSelection: { provider: "codex", model: "gpt-5.4-mini" },
    });
    expect(api.orchestration.startRun).toHaveBeenCalledWith({ runId: "run-1" });
    expect(clearSelection).toHaveBeenCalledOnce();
    expect(navigateToThread).toHaveBeenCalledWith("thread-orch-1");
  });

  it("stops orchestration launch early when the board selection no longer matches the active project", async () => {
    const onProjectMismatch = vi.fn();
    const api = {
      orchestration: {
        createRun: vi.fn(),
        startRun: vi.fn(),
      },
    };

    const result = await launchBoardOrchestration({
      api,
      projectId: "project-1" as TicketSummary["projectId"],
      selectedTicketIdentifiers: ["T3CO-1"] as const,
      implementerModelSelection: { provider: "codex", model: "gpt-5.4" },
      reviewerModelSelection: { provider: "codex", model: "gpt-5.4-mini" },
      orchestrateTickets: new Map([
        [
          "ticket-99" as TicketSummary["id"],
          makeTicket({
            id: "ticket-99" as TicketSummary["id"],
            projectId: "project-2" as TicketSummary["projectId"],
          }),
        ],
      ]),
      onProjectMismatch,
      clearSelection: vi.fn(),
      navigateToThread: vi.fn(),
    });

    expect(result.kind).toBe("project-mismatch");
    expect(onProjectMismatch).toHaveBeenCalledOnce();
    expect(api.orchestration.createRun).not.toHaveBeenCalled();
    expect(api.orchestration.startRun).not.toHaveBeenCalled();
  });
});
