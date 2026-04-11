import "../../index.css";

import type { Ticket, TicketId, TicketSummary } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { dispatchModifiedClick, findButtonByText } from "~/test-utils/browser";

import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SubTicketPreviewContent } from "./SubTicketPreviewContent";

// Audit traceability: 5f27fa2, 5dba42d, 1f727cb.
// This file covers the browser-only hover preview flow that KanbanTicketDetail wires around
// SubTicketPreviewContent, without mounting the full ticket detail surface.

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
    getState: () => ({
      initializeThreadBoardContextFromSource: vi.fn(),
    }),
  },
}));

vi.mock("./TicketMarkdown", () => ({
  TicketMarkdown: ({ children }: { children: string }) => <div>{children}</div>,
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

describe("KanbanTicketDetail sub-ticket preview", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockUseParams.mockReset();
    mockUseParams.mockReturnValue(null);
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
