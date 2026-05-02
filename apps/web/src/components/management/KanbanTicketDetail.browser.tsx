import "../../index.css";

import type { Ticket, TicketId, TicketSummary } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { dispatchModifiedClick, findButtonByText, waitForElement } from "~/test-utils/browser";

import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { TicketPreviewContent } from "./TicketPreviewContent";
import { SharedTicketPreviewPopup, useTicketPreviewHoverTarget } from "./TicketPreviewPopup";
import {
  TICKET_PREVIEW_POSITION_STORAGE_KEY,
  TICKET_PREVIEW_SIZE_STORAGE_KEY,
  TICKET_PREVIEW_VIEWPORT_PADDING,
} from "./ticketPreviewSize";

// Audit traceability: 5f27fa2, 5dba42d, 1f727cb.
// This file covers the browser-only hover preview flow that KanbanTicketDetail wires around
// TicketPreviewContent, without mounting the full ticket detail surface.

const { mockNavigate, mockUseParams } = vi.hoisted(() => ({
  mockNavigate: vi.fn(async () => undefined),
  mockUseParams: vi.fn(() => null),
}));

const mockGetById = vi.fn(async () => null);
const mockGetThreadLinks = vi.fn(async () => ({ ticketId: "ticket-1", originThread: null }));
const mockOnEvent = vi.fn(() => () => {});
const capturedDraggables: Array<{ id: string; data: unknown }> = [];

const selectionStoreState = {
  selectedTicketIds: new Set<Ticket["id"]>(),
  selectedTickets: new Map<Ticket["id"], TicketSummary>(),
  toggleTicket: vi.fn(),
  rangeSelectTo: vi.fn(),
  clearSelection: vi.fn(),
  removeFromSelection: vi.fn(),
};

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    useDraggable: (config: { id: string; data: unknown }) => {
      capturedDraggables.push(config);
      return {
        attributes: {},
        listeners: {},
        setNodeRef: () => {},
        isDragging: false,
      };
    },
  };
});

vi.mock("@dnd-kit/sortable", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/sortable")>("@dnd-kit/sortable");

  return {
    ...actual,
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

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => mockUseParams(),
}));

vi.mock("../../nativeApi", () => ({
  ensureNativeApi: () => ({
    ticketing: {
      getById: mockGetById,
      getThreadLinks: mockGetThreadLinks,
      onEvent: mockOnEvent,
    },
    contextMenu: {
      show: vi.fn(async () => null),
    },
  }),
}));

vi.mock("../../ticketSelectionStore", () => ({
  useTicketSelectionStore: (selector: (state: typeof selectionStoreState) => unknown) =>
    selector(selectionStoreState),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({ maxReviewIterations: 1 }),
}));

vi.mock("../../rpc/serverState", () => ({
  useServerProviders: () => [],
}));

vi.mock("../../modelSelection", () => ({
  resolveAppModelSelectionState: () => ({ provider: "codex", model: "gpt-5.4" }),
  modelSelectionProviderKind: () => "codex",
  getCustomModelOptionsByProvider: () => ({}),
  makeAppModelSelection: (provider: string, model: string) => ({ provider, model }),
}));

vi.mock("../../composerDraftStore", () => ({
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

vi.mock("../../uiStateStore", () => ({
  useUiStateStore: {
    getState: () => ({}),
  },
}));

vi.mock("./TicketMarkdown", () => ({
  TicketMarkdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock("./TicketDescriptionEditor", () => ({
  TicketDescriptionEditor: ({ initialContent }: { initialContent: string | null }) => (
    <div>{initialContent}</div>
  ),
}));

vi.mock("../chat/ProviderModelPicker", () => ({
  ProviderModelPicker: () => null,
}));

vi.mock("../chat/TraitsPicker", () => ({
  TraitsPicker: () => null,
}));

vi.mock("./TicketOriginThreadSection", () => ({
  TicketOriginThreadSection: () => null,
}));

vi.mock("../settings/TicketAcceptanceCriteria", () => ({
  TicketAcceptanceCriteria: () => null,
}));

vi.mock("../settings/TicketComments", () => ({
  TicketComments: () => null,
}));

vi.mock("../settings/TicketHistory", () => ({
  TicketHistory: () => null,
}));

const { KanbanCard } = await import("./KanbanCard");
const { resolveTicketDetailStreamEventAction, SubTicketRowButton, SubTicketsList } =
  await import("./KanbanTicketDetail");
const { handleTicketMultiSelectGesture } = await import("./ticketMultiSelect");

function makePreviewTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "child-ticket" as Ticket["id"],
    projectId: "project-1" as Ticket["projectId"],
    parentId: "parent-ticket" as Ticket["id"],
    ticketNumber: 202,
    identifier: "T3CO-202",
    title: "Preview child ticket",
    description: "Fetched preview description",
    status: "todo",
    priority: "medium",
    sortOrder: 0,
    isArchived: false,
    worktree: null,
    acceptanceCriteria: [
      { text: "First preview criterion", status: "met" },
      { text: "Second preview criterion", status: "pending" },
    ],
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

function DeferredPreviewHarness({
  fetchPreview,
  getCached,
}: {
  fetchPreview: (id: TicketId) => Promise<Ticket | null>;
  getCached: (id: TicketId) => Ticket | undefined;
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={150}
        render={
          <button type="button" className="rounded-md px-2 py-1.5 text-left text-xs">
            T3CO-202 Preview child ticket
          </button>
        }
      />
      <PopoverPopup
        side="bottom"
        align="end"
        alignOffset={-190}
        sideOffset={4}
        className="w-[380px]"
      >
        <TicketPreviewContent
          ticketId={"child-ticket" as Ticket["id"]}
          fetchPreview={fetchPreview}
          getCached={getCached}
        />
      </PopoverPopup>
    </Popover>
  );
}

function ResizablePreviewHarness({
  fetchPreview,
  getCached,
}: {
  fetchPreview: (id: TicketId) => Promise<Ticket | null>;
  getCached: (id: TicketId) => Ticket | undefined;
}) {
  const { cancelPreviewTimers, handlePreviewMouseEnter, handlePreviewMouseLeave, previewTarget } =
    useTicketPreviewHoverTarget({
      closeDelayMs: 150,
      openDelayMs: 300,
    });

  return (
    <div className="flex flex-col gap-1">
      {[
        ["child-ticket", "T3CO-202 Preview child ticket"],
        ["second-child-ticket", "T3CO-203 Second preview child ticket"],
      ].map(([ticketId, label]) => (
        <button
          key={ticketId}
          type="button"
          className="rounded-md px-2 py-1.5 text-left text-xs"
          onMouseEnter={(event) =>
            handlePreviewMouseEnter(ticketId as TicketId, event.currentTarget)
          }
          onMouseLeave={handlePreviewMouseLeave}
        >
          {label}
        </button>
      ))}
      <SharedTicketPreviewPopup
        anchorElement={previewTarget?.anchorElement ?? null}
        ticketId={previewTarget?.ticketId ?? null}
        fetchPreview={fetchPreview}
        getCached={getCached}
        onMouseEnter={cancelPreviewTimers}
        onMouseLeave={handlePreviewMouseLeave}
      />
    </div>
  );
}

async function mountPreviewHarness(input: {
  fetchPreview: (id: TicketId) => Promise<Ticket | null>;
  getCached?: (id: TicketId) => Ticket | undefined;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <DeferredPreviewHarness
      fetchPreview={input.fetchPreview}
      getCached={input.getCached ?? (() => undefined)}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("KanbanTicketDetail ticket preview", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockUseParams.mockReset();
    mockUseParams.mockReturnValue(null);
    capturedDraggables.length = 0;
    localStorage.clear();
    selectionStoreState.selectedTicketIds = new Set();
    selectionStoreState.selectedTickets = new Map();
    document.body.innerHTML = "";
  });

  it("opens the hover preview after the delay, fetches sub-ticket detail, and renders description plus acceptance criteria", async () => {
    let resolvePreview: ((ticket: Ticket | null) => void) | null = null;
    const fetchPreview = vi.fn(
      () =>
        new Promise<Ticket | null>((resolve) => {
          resolvePreview = resolve;
        }),
    );

    await using _ = await mountPreviewHarness({ fetchPreview });

    vi.useFakeTimers();

    const subTicketTrigger = page.getByRole("button", { name: /T3CO-202 Preview child ticket/i });
    await subTicketTrigger.hover();

    await vi.advanceTimersByTimeAsync(299);
    expect(fetchPreview).not.toHaveBeenCalled();
    expect(document.body.textContent ?? "").not.toContain("Fetched preview description");

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(fetchPreview).toHaveBeenCalledTimes(1);
    });
    expect(fetchPreview).toHaveBeenCalledWith("child-ticket");

    expect(resolvePreview).not.toBeNull();
    resolvePreview!(makePreviewTicket());

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Fetched preview description");
      expect(text).toContain("Acceptance Criteria (1/2)");
      expect(text).toContain("First preview criterion");
      expect(text).toContain("Second preview criterion");
    });
  });

  it("renders epic progress badges for cards with sub-ticket completion metadata", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <KanbanCard
        ticket={makeTicketSummary({
          id: "epic-ticket" as TicketSummary["id"],
          identifier: "T3CO-300",
          title: "Epic ticket",
          subTicketCount: 3,
        })}
        status="todo"
        epicProgress={{ completed: 1, total: 3 }}
        onClick={() => {}}
      />,
      { container: host },
    );

    try {
      await vi.waitFor(() => {
        expect(host.textContent ?? "").toContain("1/3");
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("routes alt/shift clicks on sub-tickets into multi-select handlers and wires drag metadata", async () => {
    selectionStoreState.toggleTicket.mockReset();
    selectionStoreState.rangeSelectTo.mockReset();
    capturedDraggables.length = 0;

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

    const interactionHost = document.createElement("div");
    document.body.append(interactionHost);
    const interactionScreen = await render(
      <div className="flex flex-col gap-1">
        {[subTicketOne, subTicketTwo].map((subTicket) => (
          <SubTicketRowButton
            key={subTicket.id}
            subTicket={subTicket}
            isSelected={false}
            isDragging={false}
            onClick={(event) => {
              handleTicketMultiSelectGesture(
                event,
                subTicket,
                [subTicketOne, subTicketTwo],
                selectionStoreState,
              );
            }}
          />
        ))}
      </div>,
      { container: interactionHost },
    );

    await using interaction = {
      host: interactionHost,
      [Symbol.asyncDispose]: async () => {
        await interactionScreen.unmount();
        interactionHost.remove();
      },
    };

    dispatchModifiedClick(findButtonByText(interaction.host, subTicketOne.identifier), {
      altKey: true,
    });
    dispatchModifiedClick(findButtonByText(interaction.host, subTicketTwo.identifier), {
      shiftKey: true,
    });

    await vi.waitFor(() => {
      expect(selectionStoreState.toggleTicket).toHaveBeenCalledWith(subTicketOne.id, subTicketOne);
      expect(selectionStoreState.rangeSelectTo).toHaveBeenCalledWith(subTicketTwo.id, [
        subTicketOne,
        subTicketTwo,
      ]);
    });

    const dragHost = document.createElement("div");
    document.body.append(dragHost);
    const dragScreen = await render(
      <SubTicketsList
        projectId="project-1"
        subTickets={[subTicketOne, subTicketTwo]}
        onNavigateToTicket={() => {}}
        onMoveToBoardRequest={() => {}}
        onArchiveRequest={() => {}}
      />,
      { container: dragHost },
    );

    await using _dragSurface = {
      [Symbol.asyncDispose]: async () => {
        await dragScreen.unmount();
        dragHost.remove();
      },
    };

    expect(capturedDraggables).toEqual(
      expect.arrayContaining([
        {
          id: subTicketOne.id,
          data: { ticket: subTicketOne, status: subTicketOne.status },
        },
        {
          id: subTicketTwo.id,
          data: { ticket: subTicketTwo, status: subTicketTwo.status },
        },
      ]),
    );
  });

  it("resizes the hover preview from a fixed top-left and applies preferences to other previews", async () => {
    const fetchPreview = vi.fn(async () =>
      makePreviewTicket({
        description: Array.from(
          { length: 12 },
          (_, index) => `Preview paragraph ${index + 1}.`,
        ).join("\n\n"),
      }),
    );

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <ResizablePreviewHarness fetchPreview={fetchPreview} getCached={() => undefined} />,
      { container: host },
    );
    let firstSurfaceUnmounted = false;

    vi.useFakeTimers();
    try {
      await page.getByRole("button", { name: /T3CO-202 Preview child ticket/i }).hover();
      await vi.advanceTimersByTimeAsync(300);

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Preview paragraph 1.");
      });

      const popup = await waitForElement(
        () => document.querySelector<HTMLElement>("[data-slot='popover-popup']"),
        "Unable to find ticket preview popup.",
      );
      const handle = await waitForElement(
        () =>
          document.querySelector<HTMLButtonElement>("button[aria-label='Resize ticket preview']"),
        "Unable to find ticket preview resize handle.",
      );
      const startingRect = popup.getBoundingClientRect();

      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 0,
          clientY: 0,
          pointerId: 1,
        }),
      );
      handle.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 120,
          clientY: 80,
          pointerId: 1,
        }),
      );

      await vi.waitFor(() => {
        expect(popup.style.height).toBe("380px");
      });
      expect(Math.abs(popup.getBoundingClientRect().left - startingRect.left)).toBeLessThanOrEqual(
        2.5,
      );
      expect(Math.abs(popup.getBoundingClientRect().top - startingRect.top)).toBeLessThanOrEqual(
        2.5,
      );

      handle.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 120,
          clientY: 80,
          pointerId: 1,
        }),
      );

      const expectedWidth = Number.parseInt(popup.style.width, 10);
      const stored = JSON.parse(localStorage.getItem(TICKET_PREVIEW_SIZE_STORAGE_KEY) ?? "{}");
      expect(popup.style.height).toBe("380px");
      expect(stored).toMatchObject({
        version: 1,
        width: expectedWidth,
        maxHeight: 380,
      });

      await screen.unmount();
      host.remove();
      firstSurfaceUnmounted = true;

      const secondHost = document.createElement("div");
      document.body.append(secondHost);
      const secondScreen = await render(
        <ResizablePreviewHarness fetchPreview={fetchPreview} getCached={() => undefined} />,
        { container: secondHost },
      );
      try {
        await page.getByRole("button", { name: /T3CO-203 Second preview child ticket/i }).hover();
        await vi.advanceTimersByTimeAsync(300);

        await vi.waitFor(() => {
          const nextPopup = document.querySelector<HTMLElement>("[data-slot='popover-popup']");
          expect(nextPopup?.style.width).toBe(`${expectedWidth}px`);
        });
      } finally {
        await secondScreen.unmount();
        secondHost.remove();
      }
    } finally {
      if (!firstSurfaceUnmounted) {
        await screen.unmount();
        host.remove();
      }
    }
  });

  it("keeps the preview shell mounted while hovering between different sub-tickets", async () => {
    const fetchPreview = vi.fn(async (id: TicketId) =>
      makePreviewTicket({
        id: id as Ticket["id"],
        title:
          id === ("second-child-ticket" as TicketId)
            ? "Second preview child ticket detail"
            : "Preview child ticket detail",
        description:
          id === ("second-child-ticket" as TicketId)
            ? "Second preview description"
            : "First preview description",
      }),
    );

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <ResizablePreviewHarness fetchPreview={fetchPreview} getCached={() => undefined} />,
      { container: host },
    );

    vi.useFakeTimers();
    try {
      await page.getByRole("button", { name: /T3CO-202 Preview child ticket/i }).hover();
      await vi.advanceTimersByTimeAsync(300);

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("First preview description");
      });
      const firstPopup = await waitForElement(
        () => document.querySelector<HTMLElement>("[data-slot='popover-popup']"),
        "Unable to find first ticket preview popup.",
      );
      expect(firstPopup.querySelector("[data-slot='popover-viewport']")).toBeNull();
      expect(firstPopup.querySelector("[data-current], [data-previous]")).toBeNull();

      const firstTrigger = findButtonByText(host, "T3CO-202");
      const secondTrigger = findButtonByText(host, "T3CO-203");
      firstTrigger.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: secondTrigger,
        }),
      );
      secondTrigger.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: firstTrigger,
        }),
      );

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Second preview description");
      });
      expect(document.querySelector<HTMLElement>("[data-slot='popover-popup']")).toBe(firstPopup);
      expect(firstPopup.querySelector("[data-slot='popover-viewport']")).toBeNull();
      expect(firstPopup.querySelector("[data-current], [data-previous]")).toBeNull();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("does not render stale preview text after the hover target changes before the next body loads", async () => {
    let resolveSecondPreview: ((ticket: Ticket | null) => void) | null = null;
    const fetchPreview = vi.fn(async (id: TicketId) => {
      if (id === ("second-child-ticket" as TicketId)) {
        return new Promise<Ticket | null>((resolve) => {
          resolveSecondPreview = resolve;
        });
      }
      return makePreviewTicket({
        id: id as Ticket["id"],
        title: "Preview child ticket detail",
        description: "First preview description",
      });
    });

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <ResizablePreviewHarness fetchPreview={fetchPreview} getCached={() => undefined} />,
      { container: host },
    );

    vi.useFakeTimers();
    try {
      const firstTrigger = findButtonByText(host, "T3CO-202");
      const secondTrigger = findButtonByText(host, "T3CO-203");

      await page.getByRole("button", { name: /T3CO-202 Preview child ticket/i }).hover();
      await vi.advanceTimersByTimeAsync(300);

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("First preview description");
      });
      const popup = await waitForElement(
        () => document.querySelector<HTMLElement>("[data-slot='popover-popup']"),
        "Unable to find ticket preview popup.",
      );
      const firstRect = popup.getBoundingClientRect();

      firstTrigger.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: secondTrigger,
        }),
      );
      secondTrigger.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: firstTrigger,
        }),
      );

      await vi.waitFor(() => {
        expect(fetchPreview).toHaveBeenCalledWith("second-child-ticket");
        expect(popup.textContent ?? "").not.toContain("First preview description");
        expect(popup.querySelector("[data-testid='ticket-preview-skeleton']")).not.toBeNull();
      });
      const pendingRect = popup.getBoundingClientRect();
      expect(Math.abs(pendingRect.left - firstRect.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(pendingRect.top - firstRect.top)).toBeLessThanOrEqual(1);

      expect(resolveSecondPreview).not.toBeNull();
      resolveSecondPreview!(
        makePreviewTicket({
          id: "second-child-ticket" as Ticket["id"],
          title: "Second preview child ticket detail",
          description: "Second preview description",
        }),
      );

      await vi.waitFor(() => {
        expect(popup.textContent ?? "").toContain("Second preview description");
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("reopens the preview without a stale close after switching tickets and fully closing", async () => {
    const fetchPreview = vi.fn(async (id: TicketId) =>
      makePreviewTicket({
        id: id as Ticket["id"],
        description:
          id === ("second-child-ticket" as TicketId)
            ? "Second preview description"
            : "First preview description",
      }),
    );

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <ResizablePreviewHarness fetchPreview={fetchPreview} getCached={() => undefined} />,
      { container: host },
    );

    vi.useFakeTimers();
    try {
      const firstTrigger = findButtonByText(host, "T3CO-202");
      const secondTrigger = findButtonByText(host, "T3CO-203");

      await page.getByRole("button", { name: /T3CO-202 Preview child ticket/i }).hover();
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("First preview description");
      });

      firstTrigger.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: secondTrigger,
        }),
      );
      secondTrigger.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: firstTrigger,
        }),
      );
      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Second preview description");
      });

      secondTrigger.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
      await vi.advanceTimersByTimeAsync(151);
      await vi.waitFor(() => {
        expect(document.querySelector<HTMLElement>("[data-slot='popover-popup']")).toBeNull();
      });

      firstTrigger.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => {
        expect(document.querySelector<HTMLElement>("[data-slot='popover-popup']")).not.toBeNull();
        expect(document.body.textContent ?? "").toContain("First preview description");
      });

      await vi.advanceTimersByTimeAsync(200);
      expect(document.querySelector<HTMLElement>("[data-slot='popover-popup']")).not.toBeNull();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("keeps an oversized stored preview fully inside the viewport safe area", async () => {
    localStorage.setItem(
      TICKET_PREVIEW_SIZE_STORAGE_KEY,
      JSON.stringify({ version: 1, width: 720, maxHeight: 960 }),
    );
    localStorage.setItem(
      TICKET_PREVIEW_POSITION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        x: 520,
        y: 520,
        viewportWidth: 1440,
        viewportHeight: 1100,
      }),
    );

    const fetchPreview = vi.fn(async () =>
      makePreviewTicket({
        description: Array.from(
          { length: 24 },
          (_, index) => `Long preview paragraph ${index + 1}.`,
        ).join("\n\n"),
      }),
    );

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <ResizablePreviewHarness fetchPreview={fetchPreview} getCached={() => undefined} />,
      { container: host },
    );

    vi.useFakeTimers();
    try {
      await page.getByRole("button", { name: /T3CO-202 Preview child ticket/i }).hover();
      await vi.advanceTimersByTimeAsync(300);

      const popup = await waitForElement(
        () => document.querySelector<HTMLElement>("[data-slot='popover-popup']"),
        "Unable to find ticket preview popup.",
      );

      await vi.waitFor(() => {
        const rect = popup.getBoundingClientRect();
        expect(rect.top).toBeGreaterThanOrEqual(TICKET_PREVIEW_VIEWPORT_PADDING - 1);
        expect(rect.left).toBeGreaterThanOrEqual(TICKET_PREVIEW_VIEWPORT_PADDING - 1);
        expect(rect.right).toBeLessThanOrEqual(
          window.innerWidth - TICKET_PREVIEW_VIEWPORT_PADDING + 1,
        );
        expect(rect.bottom).toBeLessThanOrEqual(
          window.innerHeight - TICKET_PREVIEW_VIEWPORT_PADDING + 1,
        );
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("persists dragged preview position as a viewport position across later previews", async () => {
    const fetchPreview = vi.fn(async () => makePreviewTicket());

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <ResizablePreviewHarness fetchPreview={fetchPreview} getCached={() => undefined} />,
      { container: host },
    );
    let firstSurfaceUnmounted = false;

    vi.useFakeTimers();
    try {
      await page.getByRole("button", { name: /T3CO-202 Preview child ticket/i }).hover();
      await vi.advanceTimersByTimeAsync(300);

      const popup = await waitForElement(
        () => document.querySelector<HTMLElement>("[data-slot='popover-popup']"),
        "Unable to find ticket preview popup.",
      );
      const moveHandle = await waitForElement(
        () => document.querySelector<HTMLButtonElement>("button[aria-label='Move ticket preview']"),
        "Unable to find ticket preview move handle.",
      );
      const handleRect = moveHandle.getBoundingClientRect();
      const pointerStart = {
        x: handleRect.left + handleRect.width / 2,
        y: handleRect.top + handleRect.height / 2,
      };

      moveHandle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: pointerStart.x,
          clientY: pointerStart.y,
          pointerId: 10,
        }),
      );
      moveHandle.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: pointerStart.x - 120,
          clientY: pointerStart.y + 140,
          pointerId: 10,
        }),
      );

      await vi.waitFor(() => {
        const movedRect = popup.getBoundingClientRect();
        expect(movedRect.left).toBeGreaterThanOrEqual(TICKET_PREVIEW_VIEWPORT_PADDING - 1);
        expect(movedRect.bottom).toBeLessThanOrEqual(
          window.innerHeight - TICKET_PREVIEW_VIEWPORT_PADDING + 1,
        );
      });

      moveHandle.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: pointerStart.x - 120,
          clientY: pointerStart.y + 140,
          pointerId: 10,
        }),
      );

      const draggedRect = popup.getBoundingClientRect();
      const storedPosition = JSON.parse(
        localStorage.getItem(TICKET_PREVIEW_POSITION_STORAGE_KEY) ?? "{}",
      );
      expect(storedPosition).toMatchObject({
        version: 1,
        x: Math.round(draggedRect.left),
        y: Math.round(draggedRect.top),
      });

      await screen.unmount();
      host.remove();
      firstSurfaceUnmounted = true;

      const secondHost = document.createElement("div");
      secondHost.style.marginTop = "260px";
      document.body.append(secondHost);
      const secondScreen = await render(
        <ResizablePreviewHarness fetchPreview={fetchPreview} getCached={() => undefined} />,
        { container: secondHost },
      );
      try {
        await page.getByRole("button", { name: /T3CO-203 Second preview child ticket/i }).hover();
        await vi.advanceTimersByTimeAsync(300);

        await vi.waitFor(() => {
          const nextPopup = document.querySelector<HTMLElement>("[data-slot='popover-popup']");
          const nextRect = nextPopup?.getBoundingClientRect();
          expect(nextRect).toBeDefined();
          expect(Math.abs((nextRect?.left ?? 0) - draggedRect.left)).toBeLessThanOrEqual(3);
          expect(Math.abs((nextRect?.top ?? 0) - draggedRect.top)).toBeLessThanOrEqual(3);
        });
      } finally {
        await secondScreen.unmount();
        secondHost.remove();
      }
    } finally {
      if (!firstSurfaceUnmounted) {
        await screen.unmount();
        host.remove();
      }
    }
  });
});

describe("KanbanTicketDetail ticketing stream coverage", () => {
  it("refetches when comment events target the current task detail", () => {
    // Audit traceability: 8b69f70.
    const currentTicket = makePreviewTicket({
      id: "ticket-live" as Ticket["id"],
      parentId: null,
      acceptanceCriteria: [],
    });

    expect(
      resolveTicketDetailStreamEventAction("ticket-live" as Ticket["id"], currentTicket, {
        type: "comment_upserted",
        ticketId: "ticket-live",
      } as never),
    ).toBe("refetch");

    expect(
      resolveTicketDetailStreamEventAction("ticket-live" as Ticket["id"], currentTicket, {
        type: "comment_deleted",
        ticketId: "ticket-live",
      } as never),
    ).toBe("refetch");
  });

  it("refetches when self, sub-ticket, or dependency updates change the rendered task detail", () => {
    const currentTicket = makePreviewTicket({
      id: "ticket-live" as Ticket["id"],
      parentId: null,
      subTickets: [
        makeTicketSummary({
          id: "sub-ticket" as TicketSummary["id"],
          parentId: "ticket-live" as TicketSummary["id"],
        }),
      ],
      dependencies: [
        {
          ticketId: "ticket-live" as Ticket["id"],
          dependsOnTicketId: "dependency-ticket" as Ticket["id"],
          identifier: "T3CO-900",
          title: "Dependency ticket",
          status: "todo",
        },
      ],
      acceptanceCriteria: [],
    });

    expect(
      resolveTicketDetailStreamEventAction("ticket-live" as Ticket["id"], currentTicket, {
        type: "ticket_upserted",
        projectId: "project-1",
        ticket: makeTicketSummary({
          id: "ticket-live" as TicketSummary["id"],
          parentId: null,
        }),
      } as never),
    ).toBe("refetch");

    expect(
      resolveTicketDetailStreamEventAction("ticket-live" as Ticket["id"], currentTicket, {
        type: "ticket_upserted",
        projectId: "project-1",
        ticket: makeTicketSummary({
          id: "sub-ticket" as TicketSummary["id"],
          parentId: "ticket-live" as TicketSummary["id"],
        }),
      } as never),
    ).toBe("refetch");

    expect(
      resolveTicketDetailStreamEventAction("ticket-live" as Ticket["id"], currentTicket, {
        type: "ticket_upserted",
        projectId: "project-1",
        ticket: makeTicketSummary({
          id: "dependency-ticket" as TicketSummary["id"],
          parentId: null,
        }),
      } as never),
    ).toBe("refetch");

    expect(
      resolveTicketDetailStreamEventAction("ticket-live" as Ticket["id"], currentTicket, {
        type: "ticket_deleted",
        ticketId: "dependency-ticket",
      } as never),
    ).toBe("refetch");
  });

  it("backs out when the current task is deleted through the stream", () => {
    expect(
      resolveTicketDetailStreamEventAction(
        "ticket-live" as Ticket["id"],
        makePreviewTicket({
          id: "ticket-live" as Ticket["id"],
          parentId: null,
          acceptanceCriteria: [],
        }),
        { type: "ticket_deleted", ticketId: "ticket-live" } as never,
      ),
    ).toBe("back");
  });

  it("ignores unrelated stream events and events while the current task is not loaded", () => {
    const currentTicket = makePreviewTicket({
      id: "ticket-live" as Ticket["id"],
      parentId: null,
      subTickets: [],
      dependencies: [],
      acceptanceCriteria: [],
    });

    expect(
      resolveTicketDetailStreamEventAction("ticket-live" as Ticket["id"], null, {
        type: "ticket_upserted",
        projectId: "project-1",
        ticket: makeTicketSummary({
          id: "ticket-live" as TicketSummary["id"],
        }),
      } as never),
    ).toBe("ignore");

    expect(
      resolveTicketDetailStreamEventAction("ticket-live" as Ticket["id"], currentTicket, {
        type: "ticket_upserted",
        projectId: "project-1",
        ticket: makeTicketSummary({
          id: "another-ticket" as TicketSummary["id"],
          parentId: null,
        }),
      } as never),
    ).toBe("ignore");

    expect(
      resolveTicketDetailStreamEventAction("ticket-live" as Ticket["id"], currentTicket, {
        type: "ticket_deleted",
        ticketId: "another-ticket",
      } as never),
    ).toBe("ignore");

    expect(
      resolveTicketDetailStreamEventAction("ticket-live" as Ticket["id"], currentTicket, {
        type: "comment_upserted",
        ticketId: "another-ticket",
      } as never),
    ).toBe("ignore");
  });
});
