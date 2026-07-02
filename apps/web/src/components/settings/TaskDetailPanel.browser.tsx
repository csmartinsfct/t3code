import "../../index.css";

import type {
  Comment,
  ModelSelection,
  NativeApi,
  ProjectId,
  Ticket,
  TicketHistoryEntry,
  TicketId,
  TicketSummary,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../../nativeApi";
import { findButtonByText, waitForElement } from "../../test-utils/browser";

// This ticket keeps the "TaskDetailPanel" filename for audit traceability, but the exercised
// surface is the shared Kanban ticket detail view that powers the settings-adjacent task detail UX.
const { mockNavigate, mockUseParams } = vi.hoisted(() => ({
  mockNavigate: vi.fn(async () => undefined),
  mockUseParams: vi.fn(() => null),
}));

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

vi.mock("~/hooks/useSettings", () => ({
  useSettings: () => ({
    maxReviewIterations: 1,
    orchestrationImplementerModelSelection: {
      provider: "codex",
      model: "gpt-5.4",
    } satisfies ModelSelection,
    orchestrationReviewerModelSelection: {
      provider: "codex",
      model: "gpt-5.4-mini",
    } satisfies ModelSelection,
  }),
}));

vi.mock("~/rpc/serverState", () => ({
  useServerProviders: () => [],
  resetServerStateForTests: () => {},
}));

vi.mock("~/modelSelection", () => ({
  resolveAppModelSelectionState: (settings: { textGenerationModelSelection?: ModelSelection }) =>
    settings.textGenerationModelSelection ?? { provider: "codex", model: "gpt-5.4" },
  modelSelectionProviderKind: (selection: ModelSelection) => selection.provider,
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
  ProviderModelPicker: ({
    provider,
    model,
    onProviderModelChange,
  }: {
    provider: string;
    model: string;
    onProviderModelChange: (provider: string, model: string) => void;
  }) => (
    <div>
      <button type="button" data-model-picker-current="true">
        {provider}:{model}
      </button>
      <button
        type="button"
        data-model-picker-change="true"
        onClick={() => onProviderModelChange("claudeAgent", "claude-sonnet-5")}
      >
        Switch model
      </button>
    </div>
  ),
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

const { KanbanTicketDetail } = await import("~/components/management/KanbanTicketDetail");

const PROJECT_ID = "project-1" as ProjectId;
const TICKET_ID = "ticket-1" as TicketId;
const NOW_ISO = "2026-04-11T12:00:00.000Z";

function cloneTicket(ticket: Ticket): Ticket {
  return JSON.parse(JSON.stringify(ticket)) as Ticket;
}

function createComment(input: {
  id: string;
  body: string;
  parentId?: string | null;
  authorName?: string;
}): Comment {
  return {
    id: input.id as Comment["id"],
    ticketId: TICKET_ID,
    parentId: (input.parentId ?? null) as Comment["parentId"],
    authorType: "human",
    authorName: input.authorName ?? "You",
    authorModel: null,
    body: input.body,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
}

function makeTicketSummary(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: TICKET_ID,
    projectId: PROJECT_ID,
    parentId: null,
    ticketNumber: 1,
    identifier: "T3CO-182",
    title: "Add tasks settings panel and ticketing live-refresh coverage",
    status: "todo",
    priority: "medium",
    sortOrder: 0,
    isArchived: false,
    worktree: null,
    labels: [],
    subTicketCount: 0,
    dependencyCount: 0,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ...makeTicketSummary(overrides),
    description: "Audit hash: `8b69f70`.",
    acceptanceCriteria: [
      { text: "Cover inline status and priority changes", status: "pending" },
      { text: "Cover comments and lazy history", status: "pending" },
    ],
    dependencies: [],
    subTickets: [],
    comments: [createComment({ id: "comment-seed", body: "Existing context comment" })],
    artifacts: [],
    ...overrides,
  } as Ticket;
}

describe("TaskDetailPanel browser coverage", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockUseParams.mockClear();
    mockUseParams.mockReturnValue(null);
    __resetNativeApiForTests();
  });

  afterEach(() => {
    __resetNativeApiForTests();
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("covers inline ticket detail changes, criteria toggles, comments, lazy history, and delete flow", async () => {
    // Audit traceability: 8b69f70.
    let ticket = makeTicket();
    const historyEntries: TicketHistoryEntry[] = [
      {
        id: "history-1" as TicketHistoryEntry["id"],
        ticketId: TICKET_ID,
        action: "status_changed",
        changes: { from: "todo", to: "blocked" },
        performedBy: "Codex",
        performedAt: NOW_ISO,
      },
    ];

    const getByIdSpy = vi.fn(async () => cloneTicket(ticket));
    const updateSpy = vi.fn<NativeApi["ticketing"]["update"]>(async (input) => {
      ticket = {
        ...ticket,
        ...(input.status ? { status: input.status } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
      };
      return cloneTicket(ticket);
    });
    const updateCriterionStatusSpy = vi.fn<NativeApi["ticketing"]["updateCriterionStatus"]>(
      async ({ index, status }) => {
        ticket = {
          ...ticket,
          acceptanceCriteria:
            ticket.acceptanceCriteria?.map((criterion, criterionIndex) =>
              criterionIndex === index ? { ...criterion, status } : criterion,
            ) ?? null,
        };
        return cloneTicket(ticket);
      },
    );
    const createCommentSpy = vi.fn<NativeApi["ticketing"]["createComment"]>(async (input) => {
      ticket = {
        ...ticket,
        comments: [
          ...ticket.comments,
          createComment({
            id: `comment-${ticket.comments.length + 1}`,
            body: input.body,
            parentId: input.parentId ?? null,
          }),
        ],
      };
      return ticket.comments.at(-1)!;
    });
    const getHistorySpy = vi.fn<NativeApi["ticketing"]["getHistory"]>(async () => historyEntries);
    const deleteSpy = vi.fn<NativeApi["ticketing"]["delete"]>(async () => undefined);
    const onBack = vi.fn();

    window.nativeApi = {
      ticketing: {
        getById: getByIdSpy,
        getThreadLinks: vi.fn(async () => ({ ticketId: TICKET_ID, originThread: null })),
        update: updateSpy,
        delete: deleteSpy,
        updateCriterionStatus: updateCriterionStatusSpy,
        createComment: createCommentSpy,
        deleteComment: vi.fn(async () => undefined),
        getHistory: getHistorySpy,
        listLabels: vi.fn(async () => []),
        createLabel: vi.fn(async () => {
          throw new Error("Not used in this test");
        }),
        addTicketLabel: vi.fn(async () => undefined),
        removeTicketLabel: vi.fn(async () => undefined),
        onEvent: vi.fn(() => () => {}),
      },
      contextMenu: {
        show: vi.fn(async () => null),
      },
    } as unknown as NativeApi;

    const screen = await render(
      <KanbanTicketDetail
        ticketId={TICKET_ID}
        projectId={PROJECT_ID}
        onBack={onBack}
        onNavigateToTicket={vi.fn()}
      />,
    );

    try {
      await waitForElement(
        () =>
          Array.from(document.querySelectorAll("input")).find(
            (candidate) =>
              candidate.value === "Add tasks settings panel and ticketing live-refresh coverage",
          ) as HTMLInputElement | null,
        "Unable to find the ticket title input.",
      );
      expect(getHistorySpy).not.toHaveBeenCalled();

      await waitForElement(
        () =>
          (document.querySelector('[data-slot="select-trigger"]') as HTMLButtonElement | null) ??
          null,
        "Unable to find the ticket status selector.",
      );
      const [statusTrigger, priorityTrigger] = Array.from(
        document.querySelectorAll('[data-slot="select-trigger"]'),
      ) as HTMLButtonElement[];
      if (
        !(statusTrigger instanceof HTMLButtonElement) ||
        !(priorityTrigger instanceof HTMLButtonElement)
      ) {
        throw new Error("Unable to resolve the ticket status and priority trigger buttons.");
      }

      statusTrigger.click();
      await page.getByText("Blocked").click();
      await vi.waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith({ id: TICKET_ID, status: "blocked" });
      });
      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Blocked");
      });

      priorityTrigger.click();
      await page.getByText("High").click();
      await vi.waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith({ id: TICKET_ID, priority: "high" });
      });
      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("High");
      });

      const firstCriterionToggle = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find((button) =>
            button.parentElement?.textContent?.includes("Cover inline status and priority changes"),
          ) as HTMLButtonElement | null,
        "Unable to find the first acceptance-criterion toggle.",
      );
      firstCriterionToggle.click();

      await vi.waitFor(() => {
        expect(updateCriterionStatusSpy).toHaveBeenCalledWith({
          ticketId: TICKET_ID,
          index: 0,
          status: "met",
        });
      });
      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Acceptance Criteria (1/2)");
      });

      await page.getByPlaceholder("Write a comment...").fill("Fresh browser coverage comment");
      findButtonByText(document.body, "Comment").click();

      await vi.waitFor(() => {
        expect(createCommentSpy).toHaveBeenCalledWith({
          ticketId: TICKET_ID,
          authorType: "human",
          authorName: "You",
          body: "Fresh browser coverage comment",
        });
      });
      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Fresh browser coverage comment");
        expect(document.body.textContent ?? "").toContain("Comments (2)");
      });

      await page.getByRole("button", { name: "History" }).click();
      await vi.waitFor(() => {
        expect(getHistorySpy).toHaveBeenCalledWith({ ticketId: TICKET_ID, limit: 50 });
      });
      await expect.element(page.getByText("Changed status")).toBeInTheDocument();

      await page.getByRole("button", { name: "Ticket actions" }).click();
      await page.getByText("Delete").click();

      const confirmDeleteButton = await waitForElement(
        () =>
          (Array.from(document.querySelectorAll("button")).findLast(
            (button) => button.textContent?.trim() === "Delete",
          ) as HTMLButtonElement | undefined) ?? null,
        "Unable to find the ticket delete confirmation button.",
      );
      confirmDeleteButton.click();

      await vi.waitFor(() => {
        expect(deleteSpy).toHaveBeenCalledWith({ id: TICKET_ID });
        expect(onBack).toHaveBeenCalledTimes(1);
      });
    } finally {
      await screen.unmount();
    }
  });
});
