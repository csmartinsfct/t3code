import "../../index.css";

import type { Ticket, TicketSummary } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { KanbanTicketDetail } from "~/components/management/KanbanTicketDetail";

const mockNavigate = vi.fn();
const mockUseParams = vi.fn(() => null);
const mockGetById = vi.fn();
const mockGetThreadLinks = vi.fn(async () => ({ ticketId: "ticket-1", originThread: null }));
const mockUpdate = vi.fn(async () => null);
const mockDelete = vi.fn(async () => undefined);
const mockOnEvent = vi.fn(() => () => {});
const mockContextMenuShow = vi.fn(async () => null as string | null);

const selectionStoreState = {
  selectedTicketIds: new Set<Ticket["id"]>(),
  selectedTickets: new Map<Ticket["id"], TicketSummary>(),
  toggleTicket: vi.fn(),
  rangeSelectTo: vi.fn(),
  clearSelection: vi.fn(),
  removeFromSelection: vi.fn(),
};

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => mockUseParams(),
}));

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual("@dnd-kit/core");
  return {
    ...actual,
    useDraggable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      isDragging: false,
    }),
  };
});

vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({
    ticketing: {
      getById: mockGetById,
      getThreadLinks: mockGetThreadLinks,
      update: mockUpdate,
      delete: mockDelete,
      onEvent: mockOnEvent,
    },
    contextMenu: {
      show: mockContextMenuShow,
    },
  }),
}));

vi.mock("~/ticketSelectionStore", () => ({
  useTicketSelectionStore: (selector: (state: typeof selectionStoreState) => unknown) =>
    selector(selectionStoreState),
}));

vi.mock("~/hooks/useSettings", () => ({
  useSettings: () => ({}),
}));

vi.mock("~/rpc/serverState", () => ({
  useServerProviders: () => [],
}));

vi.mock("~/modelSelection", () => ({
  resolveAppModelSelectionState: () => ({ provider: "codex", model: "gpt-5.4" }),
  modelSelectionProviderKind: () => "codex",
  getCustomModelOptionsByProvider: () => ({}),
  makeAppModelSelection: (provider: string, model: string) => ({ provider, model }),
}));

vi.mock("~/composerDraftStore", () => ({
  useComposerDraftStore: {
    getState: () => ({
      clearProjectDraftThreadId: vi.fn(),
      setProjectDraftThreadId: vi.fn(),
      applyStickyState: vi.fn(),
      setPrompt: vi.fn(),
      addTicketAttachment: vi.fn(),
    }),
  },
}));

vi.mock("~/uiStateStore", () => ({
  useUiStateStore: {
    getState: () => ({}),
  },
}));

vi.mock("~/lib/utils", async () => {
  const actual = await vi.importActual<typeof import("~/lib/utils")>("~/lib/utils");

  return {
    ...actual,
    newThreadId: () => "thread-2",
  };
});

vi.mock("~/components/chat/ProviderModelPicker", () => ({
  ProviderModelPicker: () => null,
}));

vi.mock("~/components/chat/TraitsPicker", () => ({
  TraitsPicker: () => null,
}));

vi.mock("~/components/management/TicketMarkdown", () => ({
  TicketMarkdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock("~/components/management/TicketOriginThreadSection", () => ({
  TicketOriginThreadSection: () => null,
}));

vi.mock("~/components/settings/TicketAcceptanceCriteria", () => ({
  TicketAcceptanceCriteria: () => null,
}));

vi.mock("~/components/settings/TicketComments", () => ({
  TicketComments: () => null,
}));

vi.mock("~/components/settings/TicketHistory", () => ({
  TicketHistory: () => null,
}));

function makeTicketSummary(overrides: Partial<TicketSummary> = {}): TicketSummary {
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

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ...makeTicketSummary(overrides),
    description: "Detail description",
    acceptanceCriteria: [],
    implementerModelOverride: null,
    reviewerModelOverride: null,
    dependencies: [],
    subTickets: [],
    comments: [],
    artifacts: [],
    ...overrides,
  } as Ticket;
}

async function mountDetail(input: {
  tickets: Ticket[];
  onBack?: () => void;
  onNavigateToTicket?: (ticketId: Ticket["id"]) => void;
}) {
  mockGetById.mockReset();
  for (const ticket of input.tickets) {
    mockGetById.mockResolvedValueOnce(ticket);
  }
  const onBack = input.onBack ?? vi.fn();
  const onNavigateToTicket = input.onNavigateToTicket ?? vi.fn();

  const host = document.createElement("div");
  document.body.append(host);

  const screen = await render(
    <KanbanTicketDetail
      ticketId={(input.tickets[0]?.id ?? "ticket-1") as Ticket["id"]}
      projectId="project-1"
      onBack={onBack}
      onNavigateToTicket={onNavigateToTicket}
    />,
    { container: host },
  );

  await vi.waitFor(() => {
    expect(document.body.textContent ?? "").toContain(input.tickets[0]?.identifier ?? "T3CO-1");
  });

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    host,
    onBack,
    onNavigateToTicket,
    cleanup,
    [Symbol.asyncDispose]: cleanup,
  };
}

function findButtonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Unable to find button containing "${text}"`);
  }
  return button;
}

describe("KanbanTicketDetail move-to-board actions", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockContextMenuShow.mockImplementation(async () => null);
    mockUpdate.mockImplementation(async () => null);
    selectionStoreState.selectedTicketIds = new Set();
    selectionStoreState.selectedTickets = new Map();
    document.body.innerHTML = "";
  });

  it("shows the hamburger action only for subtickets", async () => {
    const first = await mountDetail({
      tickets: [
        makeTicket({
          id: "child-ticket" as Ticket["id"],
          parentId: "parent-ticket" as Ticket["id"],
          identifier: "T3CO-101",
          title: "Child ticket",
        }),
      ],
    });

    await page.getByRole("button", { name: "Ticket actions" }).click();
    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Move to board");
    });

    await first.cleanup();

    await using _second = await mountDetail({
      tickets: [
        makeTicket({
          id: "top-level" as Ticket["id"],
          parentId: null,
          identifier: "T3CO-102",
          title: "Top-level ticket",
        }),
      ],
    });

    await page.getByRole("button", { name: "Ticket actions" }).click();
    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").not.toContain("Move to board");
    });
  });

  it("moves the current subticket to the board without changing route state", async () => {
    selectionStoreState.removeFromSelection.mockReset();
    const mounted = await mountDetail({
      tickets: [
        makeTicket({
          id: "child-ticket" as Ticket["id"],
          parentId: "parent-ticket" as Ticket["id"],
          identifier: "T3CO-103",
          title: "Child ticket",
        }),
        makeTicket({
          id: "child-ticket" as Ticket["id"],
          parentId: null,
          identifier: "T3CO-103",
          title: "Child ticket",
        }),
      ],
    });

    await using _ = mounted;

    await page.getByRole("button", { name: "Ticket actions" }).click();
    await page.getByRole("menuitem", { name: "Move to board" }).click();
    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Move sub-ticket to board?");
    });

    await page.getByRole("button", { name: "Move to board" }).click();

    await vi.waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({
        id: "child-ticket",
        parentId: null,
      });
    });
    expect(mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: expect.anything(),
      }),
    );
    expect(selectionStoreState.removeFromSelection).toHaveBeenCalledWith(["child-ticket"]);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mounted.onBack).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mockGetById).toHaveBeenCalledTimes(2);
    });
  });

  it("bulk moves the selected subtickets from the right-click menu and refreshes the parent detail", async () => {
    selectionStoreState.removeFromSelection.mockReset();
    const subTicketOne = makeTicketSummary({
      id: "sub-1" as TicketSummary["id"],
      parentId: "parent-ticket" as TicketSummary["id"],
      identifier: "T3CO-201",
      title: "Sub-ticket one",
    });
    const subTicketTwo = makeTicketSummary({
      id: "sub-2" as TicketSummary["id"],
      parentId: "parent-ticket" as TicketSummary["id"],
      identifier: "T3CO-202",
      title: "Sub-ticket two",
    });
    selectionStoreState.selectedTicketIds = new Set([subTicketOne.id, subTicketTwo.id]);
    selectionStoreState.selectedTickets = new Map([
      [subTicketOne.id, subTicketOne],
      [subTicketTwo.id, subTicketTwo],
    ]);
    mockContextMenuShow.mockResolvedValue("move-to-board");

    const mounted = await mountDetail({
      tickets: [
        makeTicket({
          id: "parent-ticket" as Ticket["id"],
          parentId: null,
          identifier: "T3CO-200",
          title: "Parent ticket",
          subTickets: [subTicketOne, subTicketTwo],
        }),
        makeTicket({
          id: "parent-ticket" as Ticket["id"],
          parentId: null,
          identifier: "T3CO-200",
          title: "Parent ticket",
          subTickets: [],
        }),
      ],
    });

    await using _ = mounted;

    const subTicketButton = findButtonByText(mounted.host, "T3CO-201");
    subTicketButton.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 24,
        clientY: 32,
      }),
    );

    await vi.waitFor(() => {
      expect(mockContextMenuShow).toHaveBeenCalledWith(
        [{ id: "move-to-board", label: "Move all tickets to the board" }],
        { x: 24, y: 32 },
      );
    });
    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Move all tickets to board?");
    });

    await page.getByRole("button", { name: "Move to board" }).click();

    await vi.waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });
    expect(mockUpdate).toHaveBeenNthCalledWith(1, {
      id: "sub-1",
      parentId: null,
    });
    expect(mockUpdate).toHaveBeenNthCalledWith(2, {
      id: "sub-2",
      parentId: null,
    });
    expect(selectionStoreState.removeFromSelection).toHaveBeenCalledWith(["sub-1", "sub-2"]);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mounted.onBack).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mockGetById).toHaveBeenCalledTimes(2);
      expect(document.body.textContent ?? "").not.toContain("Sub-ticket one");
      expect(document.body.textContent ?? "").not.toContain("Sub-ticket two");
      expect(document.body.textContent ?? "").toContain("T3CO-200");
    });
  });
});
