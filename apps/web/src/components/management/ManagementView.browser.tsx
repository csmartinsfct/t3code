import "../../index.css";

import type { NativeApi, TicketStatus, TicketSummary, ThreadId } from "@t3tools/contracts";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import type { PropsWithChildren } from "react";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { __resetNativeApiForTests } from "~/nativeApi";
import { useStore } from "~/store";
import { findButtonByText } from "~/test-utils/browser";
import { useTicketSelectionStore } from "~/ticketSelectionStore";
import { useUiStateStore } from "~/uiStateStore";
import { SidebarProvider } from "../ui/sidebar";

// Audit traceability: aa1e7da, 1f727cb, 9a22a14.

const mockNavigate = vi.fn();
let currentTicketsByProject: Record<string, TicketSummary[]> = {};

let latestDndHandlers: {
  onDragStart?: ((event: DragStartEvent) => void) | undefined;
  onDragOver?: ((event: DragOverEvent) => void) | undefined;
  onDragEnd?: ((event: DragEndEvent) => void) | undefined;
  onDragCancel?: (() => void) | undefined;
} | null = null;

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");

  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");

  return {
    ...actual,
    DndContext: ({
      children,
      onDragStart,
      onDragOver,
      onDragEnd,
      onDragCancel,
    }: PropsWithChildren<{
      onDragStart?: (event: DragStartEvent) => void;
      onDragOver?: (event: DragOverEvent) => void;
      onDragEnd?: (event: DragEndEvent) => void;
      onDragCancel?: () => void;
    }>) => {
      latestDndHandlers = { onDragStart, onDragOver, onDragEnd, onDragCancel };
      return <div data-testid="management-dnd-context">{children}</div>;
    },
    DragOverlay: ({ children }: PropsWithChildren) => (
      <div data-testid="management-drag-overlay">{children}</div>
    ),
    PointerSensor: class MockPointerSensor {},
    pointerWithin: vi.fn(),
    useDroppable: () => ({
      setNodeRef: () => {},
      isOver: false,
    }),
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn((...sensors: unknown[]) => sensors),
  };
});

vi.mock("@dnd-kit/sortable", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/sortable")>("@dnd-kit/sortable");

  return {
    ...actual,
    SortableContext: ({ children }: React.PropsWithChildren) => children,
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

vi.mock("../../storeSelectors", () => ({
  useProjectById: () => ({
    id: "project-1",
    name: "Project One",
  }),
}));

vi.mock("../../hooks/useTicketing", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    useTicketing: ({ projectId }: { projectId?: string }) => {
      const resolvedProjectId = projectId ?? "project-1";
      const [tickets, setTickets] = React.useState<ReadonlyArray<TicketSummary>>(
        currentTicketsByProject[resolvedProjectId] ?? [],
      );

      React.useEffect(() => {
        setTickets(currentTicketsByProject[resolvedProjectId] ?? []);
      }, [resolvedProjectId]);

      return {
        tickets,
        projects: [],
        loading: false,
        selectedProjectId: resolvedProjectId,
        setSelectedProjectId: vi.fn(),
        refetch: vi.fn(async () => {}),
        applyLocalReorder: (
          updates: ReadonlyArray<{ id: string; sortOrder: number; status?: string }>,
        ) => {
          currentTicketsByProject[resolvedProjectId] = applyTicketUpdates(
            currentTicketsByProject[resolvedProjectId] ?? [],
            updates,
          );
          applyLocalReorderMock(updates);
          setTickets((current) => applyTicketUpdates(current, updates));
        },
      };
    },
  };
});

vi.mock("../ChatView", () => ({
  default: ({ threadId }: { threadId: ThreadId }) => (
    <div data-testid="management-chat-view">Chat shell {threadId}</div>
  ),
}));

const { ManagementView } = await import("./ManagementView");

// Referenced from the hoisted useTicketing vi.mock factory above.
const applyLocalReorderMock = vi.fn();
const ticketingUpdateMock = vi.fn(async () => null);
const ticketingReorderMock = vi.fn(async () => null);

function makeTicket(input: {
  id: string;
  identifier: string;
  title: string;
  projectId?: string;
  status?: TicketStatus;
  sortOrder?: number;
}): TicketSummary {
  return {
    id: input.id as TicketSummary["id"],
    projectId: (input.projectId ?? "project-1") as TicketSummary["projectId"],
    parentId: null,
    ticketNumber: Number(input.identifier.replace(/\D/g, "")) || 1,
    identifier: input.identifier,
    title: input.title,
    status: input.status ?? "todo",
    priority: "medium",
    sortOrder: input.sortOrder ?? 0,
    isArchived: false,
    worktree: null,
    labels: [],
    subTicketCount: 0,
    dependencyCount: 0,
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:00:00.000Z",
  };
}

function installNativeApiStub() {
  applyLocalReorderMock.mockReset();
  ticketingUpdateMock.mockReset();
  ticketingReorderMock.mockReset();

  const api: Partial<NativeApi> = {
    orchestration: {
      getSnapshot: vi.fn(async () => ({
        projects: [
          { id: "project-1", title: "Project One", workspaceRoot: "/repo/project-1" },
          { id: "project-2", title: "Project Two", workspaceRoot: "/repo/project-2" },
        ],
      })),
    } as unknown as NativeApi["orchestration"],
    ticketing: {
      list: vi.fn(
        async ({ projectId }: { projectId: string }) => currentTicketsByProject[projectId] ?? [],
      ),
      onEvent: vi.fn(() => () => {}),
      reorder: ticketingReorderMock,
      update: ticketingUpdateMock,
    } as unknown as NativeApi["ticketing"],
  };

  window.nativeApi = api as NativeApi;
}

function applyTicketUpdates(
  tickets: ReadonlyArray<TicketSummary>,
  updates: ReadonlyArray<{ id: string; sortOrder: number; status?: string }>,
): TicketSummary[] {
  const updateMap = new Map(updates.map((update) => [update.id, update]));
  return tickets.map((ticket) => {
    const update = updateMap.get(ticket.id);
    if (!update) return ticket;
    return {
      ...ticket,
      sortOrder: update.sortOrder,
      ...(update.status ? { status: update.status as TicketSummary["status"] } : {}),
    };
  });
}

function seedStores() {
  useStore.setState({
    projects: [
      {
        id: "project-1",
        name: "Project One",
        cwd: "/repo/project-1",
        defaultModelSelection: null,
        systemPrompt: null,
        promptOverrides: {},
        scripts: [],
      },
      {
        id: "project-2",
        name: "Project Two",
        cwd: "/repo/project-2",
        defaultModelSelection: null,
        systemPrompt: null,
        promptOverrides: {},
        scripts: [],
      },
    ] as any,
    threads: [],
    threadsById: {},
    sidebarThreadsById: {},
    threadIdsByProjectId: {},
    bootstrapComplete: true,
    orchestrationRunStatusByThreadId: {},
  });

  useUiStateStore.setState((state) => ({
    ...state,
    managementBoardContext: null,
  }));

  useTicketSelectionStore.setState({
    selectedTicketIds: new Set(),
    selectedTickets: new Map(),
    anchorTicketId: null,
  });

  useComposerDraftStore.setState({
    draftsByThreadId: {},
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
}

function Harness() {
  const [mode, setMode] = useState<"chat" | "management">("chat");
  const [projectId, setProjectId] = useState("project-1");

  return (
    <SidebarProvider defaultOpen>
      <button type="button" onClick={() => setMode("chat")}>
        Chat mode
      </button>
      <button type="button" onClick={() => setMode("management")}>
        Board mode
      </button>
      <button type="button" onClick={() => setProjectId("project-2")}>
        Project 2
      </button>
      {mode === "management" ? (
        <ManagementView threadId={null} projectId={projectId} />
      ) : (
        <div data-testid="chat-mode-shell">Chat shell</div>
      )}
    </SidebarProvider>
  );
}

async function mountManagementView(input: { threadId: ThreadId | null; projectId?: string }) {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <SidebarProvider defaultOpen>
      <ManagementView threadId={input.threadId} projectId={input.projectId ?? "project-1"} />
    </SidebarProvider>,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    host,
    cleanup,
    rerender: screen.rerender,
    [Symbol.asyncDispose]: cleanup,
  };
}

function makeActiveEvent(ticket: TicketSummary): DragStartEvent {
  return {
    activatorEvent: new MouseEvent("pointerdown"),
    active: {
      id: ticket.id,
      data: {
        current: {
          ticket,
          status: ticket.status,
        },
      },
    },
  } as unknown as DragStartEvent;
}

function makeOverEvent(input: {
  id: string;
  status?: TicketStatus;
  ticket?: TicketSummary;
}): DragOverEvent["over"] {
  return {
    id: input.id,
    data: {
      current: {
        ...(input.ticket ? { ticket: input.ticket } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    },
  } as DragOverEvent["over"];
}

describe("ManagementView", () => {
  beforeEach(() => {
    latestDndHandlers = null;
    currentTicketsByProject = {
      "project-1": [
        makeTicket({ id: "ticket-1", identifier: "T3CO-1", title: "Alpha ticket", sortOrder: 0 }),
        makeTicket({ id: "ticket-2", identifier: "T3CO-2", title: "Beta ticket", sortOrder: 1000 }),
        makeTicket({
          id: "ticket-3",
          identifier: "T3CO-3",
          title: "Blocked ticket",
          status: "blocked",
          sortOrder: 0,
        }),
      ],
      "project-2": [
        makeTicket({
          id: "ticket-4",
          identifier: "T3CO-4",
          title: "Project two ticket",
          projectId: "project-2",
        }),
      ],
    };
    __resetNativeApiForTests();
    installNativeApiStub();
    seedStores();
  });

  afterEach(() => {
    latestDndHandlers = null;
    __resetNativeApiForTests();
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("switches from chat mode into the mounted management board and renders the empty chat placeholder", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<Harness />, { container: host });

    try {
      await expect.element(page.getByTestId("chat-mode-shell")).toBeInTheDocument();

      await page.getByRole("button", { name: "Board mode" }).click();

      await expect.element(page.getByRole("heading", { name: "Board" })).toBeInTheDocument();
      await expect.element(page.getByText("Project One")).toBeInTheDocument();
      await expect.element(page.getByText("Alpha ticket")).toBeInTheDocument();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("clears the mounted board selection when the active project changes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<Harness />, { container: host });

    try {
      useTicketSelectionStore.setState({
        selectedTicketIds: new Set(["ticket-1" as TicketSummary["id"]]),
        selectedTickets: new Map([
          ["ticket-1" as TicketSummary["id"], currentTicketsByProject["project-1"]![0]!],
        ]),
        anchorTicketId: "ticket-1" as TicketSummary["id"],
      });

      await page.getByRole("button", { name: "Board mode" }).click();
      await expect.element(page.getByText("Alpha ticket")).toBeInTheDocument();

      await page.getByRole("button", { name: "Project 2" }).click();

      await expect.element(page.getByText("Project two ticket")).toBeInTheDocument();
      await vi.waitFor(() => {
        expect(useTicketSelectionStore.getState().selectedTicketIds.size).toBe(0);
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("persists same-column reorder through the board drag handlers", async () => {
    await using _ = await mountManagementView({ threadId: null });

    await vi.waitFor(() => {
      expect(latestDndHandlers?.onDragStart).toBeTypeOf("function");
      expect(document.body.textContent ?? "").toContain("Alpha ticket");
      expect(document.body.textContent ?? "").toContain("Beta ticket");
    });

    const alpha = currentTicketsByProject["project-1"]![0]!;
    const beta = currentTicketsByProject["project-1"]![1]!;
    const active = makeActiveEvent(alpha);

    latestDndHandlers?.onDragStart?.(active);
    latestDndHandlers?.onDragEnd?.({
      ...active,
      over: makeOverEvent({ id: beta.id, status: beta.status, ticket: beta }),
    } as DragEndEvent);

    await vi.waitFor(() => {
      expect(ticketingReorderMock).toHaveBeenCalledWith({
        items: [
          { id: beta.id, sortOrder: 0 },
          { id: alpha.id, sortOrder: 1000 },
        ],
      });
    });
    expect(ticketingUpdateMock).not.toHaveBeenCalled();
  });

  it("persists cross-column moves through drag-over and drag-end", async () => {
    await using mounted = await mountManagementView({ threadId: null });

    await vi.waitFor(() => {
      expect(latestDndHandlers?.onDragOver).toBeTypeOf("function");
    });

    const alpha = currentTicketsByProject["project-1"]![0]!;
    const active = makeActiveEvent(alpha);

    latestDndHandlers?.onDragStart?.(active);
    latestDndHandlers?.onDragOver?.({
      ...active,
      over: makeOverEvent({ id: "column:blocked", status: "blocked" }),
    } as DragOverEvent);
    await mounted.rerender(
      <SidebarProvider defaultOpen>
        <ManagementView threadId={null} projectId="project-1" />
      </SidebarProvider>,
    );

    latestDndHandlers?.onDragEnd?.({
      ...active,
      over: makeOverEvent({ id: "column:blocked", status: "blocked" }),
    } as DragEndEvent);

    await vi.waitFor(() => {
      expect(ticketingUpdateMock).toHaveBeenCalledWith({
        id: alpha.id,
        status: "blocked",
      });
      expect(ticketingReorderMock).toHaveBeenCalledWith({
        items: [
          { id: "ticket-3", sortOrder: 0 },
          { id: alpha.id, sortOrder: 1000 },
        ],
      });
    });
  });

  it("does not persist a cross-column hover when the drag is canceled", async () => {
    await using mounted = await mountManagementView({ threadId: null });

    await vi.waitFor(() => {
      expect(latestDndHandlers?.onDragOver).toBeTypeOf("function");
      expect(latestDndHandlers?.onDragCancel).toBeTypeOf("function");
    });

    const alpha = currentTicketsByProject["project-1"]![0]!;
    const active = makeActiveEvent(alpha);

    latestDndHandlers?.onDragStart?.(active);
    latestDndHandlers?.onDragOver?.({
      ...active,
      over: makeOverEvent({ id: "column:blocked", status: "blocked" }),
    } as DragOverEvent);
    await mounted.rerender(
      <SidebarProvider defaultOpen>
        <ManagementView threadId={null} projectId="project-1" />
      </SidebarProvider>,
    );

    latestDndHandlers?.onDragCancel?.();

    await vi.waitFor(() => {
      expect(ticketingUpdateMock).not.toHaveBeenCalled();
      expect(ticketingReorderMock).not.toHaveBeenCalled();
    });
  });

  it("reverts optimistic cross-column hover state when the ticket is dropped onto chat", async () => {
    const threadId = "thread-cross-column-chat-drop" as ThreadId;
    await using mounted = await mountManagementView({ threadId });

    await vi.waitFor(() => {
      expect(latestDndHandlers?.onDragOver).toBeTypeOf("function");
      expect(latestDndHandlers?.onDragEnd).toBeTypeOf("function");
    });

    const alpha = currentTicketsByProject["project-1"]![0]!;
    const beta = currentTicketsByProject["project-1"]![1]!;

    useTicketSelectionStore.setState({
      selectedTicketIds: new Set([alpha.id, beta.id]),
      selectedTickets: new Map([
        [alpha.id, alpha],
        [beta.id, beta],
      ]),
      anchorTicketId: alpha.id,
    });

    const active = makeActiveEvent(alpha);
    latestDndHandlers?.onDragStart?.(active);
    latestDndHandlers?.onDragOver?.({
      ...active,
      over: makeOverEvent({ id: "column:blocked", status: "blocked" }),
    } as DragOverEvent);
    await mounted.rerender(
      <SidebarProvider defaultOpen>
        <ManagementView threadId={threadId} projectId="project-1" />
      </SidebarProvider>,
    );

    latestDndHandlers?.onDragEnd?.({
      ...active,
      over: makeOverEvent({ id: "chat-composer" }),
    } as DragEndEvent);

    await vi.waitFor(() => {
      expect(ticketingUpdateMock).not.toHaveBeenCalled();
      expect(ticketingReorderMock).not.toHaveBeenCalled();
      const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
      expect(draft?.ticketAttachments).toEqual([
        {
          id: alpha.id,
          identifier: alpha.identifier,
          title: alpha.title,
        },
        {
          id: beta.id,
          identifier: beta.identifier,
          title: beta.title,
        },
      ]);
    });
  });

  it("supports alt-toggle selection and shift range selection on board cards", async () => {
    await using mounted = await mountManagementView({ threadId: null });

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Alpha ticket");
      expect(document.body.textContent ?? "").toContain("Beta ticket");
    });

    const alpha = currentTicketsByProject["project-1"]![0]!;
    const beta = currentTicketsByProject["project-1"]![1]!;
    const alphaButton = findButtonByText(mounted.host, alpha.identifier);
    const betaButton = findButtonByText(mounted.host, beta.identifier);

    alphaButton.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }),
    );

    await vi.waitFor(() => {
      const state = useTicketSelectionStore.getState();
      expect(Array.from(state.selectedTicketIds)).toEqual([alpha.id]);
      expect(Array.from(state.selectedTickets.keys())).toEqual([alpha.id]);
      expect(state.anchorTicketId).toBe(alpha.id);
    });

    alphaButton.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }),
    );

    await vi.waitFor(() => {
      const state = useTicketSelectionStore.getState();
      expect(state.selectedTicketIds.size).toBe(0);
      expect(state.selectedTickets.size).toBe(0);
    });

    alphaButton.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }),
    );
    betaButton.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }),
    );

    await vi.waitFor(() => {
      const state = useTicketSelectionStore.getState();
      expect(Array.from(state.selectedTicketIds)).toEqual([alpha.id, beta.id]);
      expect(Array.from(state.selectedTickets.keys())).toEqual([alpha.id, beta.id]);
      expect(state.anchorTicketId).toBe(alpha.id);
    });
    await expect.element(page.getByText("2 selected")).toBeInTheDocument();
  });

  it("shows the stacked drag overlay for selected cards and drops them onto chat", async () => {
    const threadId = "thread-drop-target" as ThreadId;
    await using _ = await mountManagementView({ threadId });

    await vi.waitFor(() => {
      expect(latestDndHandlers?.onDragEnd).toBeTypeOf("function");
    });

    const alpha = currentTicketsByProject["project-1"]![0]!;
    const beta = currentTicketsByProject["project-1"]![1]!;

    useTicketSelectionStore.setState({
      selectedTicketIds: new Set([alpha.id, beta.id]),
      selectedTickets: new Map([
        [alpha.id, alpha],
        [beta.id, beta],
      ]),
      anchorTicketId: alpha.id,
    });

    const active = makeActiveEvent(alpha);
    latestDndHandlers?.onDragStart?.(active);

    await vi.waitFor(() => {
      const overlay = document.querySelector("[data-testid='management-drag-overlay']");
      expect(overlay?.textContent ?? "").toContain(alpha.identifier);
      expect(overlay?.textContent ?? "").toContain("2");
    });

    latestDndHandlers?.onDragEnd?.({
      ...active,
      over: makeOverEvent({ id: "chat-composer" }),
    } as DragEndEvent);

    await vi.waitFor(() => {
      const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
      expect(draft?.ticketAttachments).toEqual([
        {
          id: alpha.id,
          identifier: alpha.identifier,
          title: alpha.title,
        },
        {
          id: beta.id,
          identifier: beta.identifier,
          title: beta.title,
        },
      ]);
      expect(useTicketSelectionStore.getState().selectedTicketIds.size).toBe(0);
    });
  });
});
