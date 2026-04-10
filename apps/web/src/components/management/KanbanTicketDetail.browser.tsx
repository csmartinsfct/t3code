import "../../index.css";

import type { Ticket, TicketId, TicketSummary } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SubTicketPreviewContent } from "./SubTicketPreviewContent";

// Audit traceability: 5f27fa2, 5dba42d, 1f727cb.
// This file covers the browser-only hover preview flow that KanbanTicketDetail wires around
// SubTicketPreviewContent, without mounting the full ticket detail surface.

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

vi.mock("../../nativeApi", () => ({
  ensureNativeApi: () => ({
    ticketing: {
      getById: vi.fn(async () => null),
      onEvent: mockOnEvent,
    },
  }),
}));

vi.mock("../../ticketSelectionStore", () => ({
  useTicketSelectionStore: (selector: (state: typeof selectionStoreState) => unknown) =>
    selector(selectionStoreState),
}));

vi.mock("./TicketMarkdown", () => ({
  TicketMarkdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

const { KanbanCard } = await import("./KanbanCard");
const { SubTicketRowButton, SubTicketsList } = await import("./KanbanTicketDetail");
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
    implementerModelOverride: null,
    reviewerModelOverride: null,
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
        <SubTicketPreviewContent
          ticketId={"child-ticket" as Ticket["id"]}
          fetchPreview={fetchPreview}
          getCached={getCached}
        />
      </PopoverPopup>
    </Popover>
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

function dispatchModifiedClick(
  element: HTMLButtonElement,
  modifiers: { altKey?: boolean; shiftKey?: boolean },
) {
  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...modifiers,
  };
  element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
  element.dispatchEvent(new MouseEvent("mousedown", eventInit));
  element.dispatchEvent(new PointerEvent("pointerup", eventInit));
  element.dispatchEvent(new MouseEvent("mouseup", eventInit));
  element.dispatchEvent(new MouseEvent("click", eventInit));
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

describe("KanbanTicketDetail sub-ticket preview", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    capturedDraggables.length = 0;
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
      cleanup: async () => {
        await interactionScreen.unmount();
        interactionHost.remove();
      },
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
      />,
      { container: dragHost },
    );

    await using _dragSurface = {
      cleanup: async () => {
        await dragScreen.unmount();
        dragHost.remove();
      },
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
});
