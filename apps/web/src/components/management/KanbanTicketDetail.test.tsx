import type {
  ProjectId,
  ThreadId,
  Ticket,
  TicketDependency,
  TicketLinkedThread,
  TicketSummary,
  TicketingStreamEvent,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildTicketDetailLookupInput,
  buildTicketDetailActionItems,
  DECOMPOSE_PROMPT,
  DependencyTicketRow,
  mergeTicketDetailMetadataUpdate,
  ParentTicketIndicator,
  resolveInlineEditBlurAction,
  resolveNullableInlineTextSave,
  resolveRequiredInlineTextSave,
  shouldAutoBackFromTicketProjectMismatch,
  startTicketDetailDecomposeFlow,
  SubTicketRowButton,
  resolveTicketDetailStreamEventAction,
} from "./KanbanTicketDetail";
import { TicketOriginThreadSection, TicketThreadRowButton } from "./TicketOriginThreadSection";

// Audit traceability: c709853, a8b01f5, 4603fb8, 4d81550, 96da4f9, 8e30a6c, b6dd6a5, b3db7d6, 6d20dbf.
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

function makeLinkedThread(overrides: Partial<TicketLinkedThread> = {}): TicketLinkedThread {
  return {
    threadId: "thread-1" as TicketLinkedThread["threadId"],
    title: "Orchestration JSON Parsing Regression",
    createdAt: "2026-04-10T08:00:00.000Z",
    updatedAt: "2026-04-10T08:00:00.000Z",
    archivedAt: "2026-04-10T09:00:00.000Z",
    isOrchestrationThread: true,
    parentThreadId: "parent-thread-1" as TicketLinkedThread["threadId"],
    linkedAt: "2026-04-10T10:00:00.000Z",
    ...overrides,
  };
}

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "ticket-1" as Ticket["id"],
    projectId: "project-1" as Ticket["projectId"],
    parentId: null,
    ticketNumber: 1,
    identifier: "T3CO-1",
    title: "Parent ticket",
    description: DETAIL_DESCRIPTION,
    status: "todo",
    priority: "medium",
    sortOrder: 0,
    isArchived: false,
    worktree: null,
    acceptanceCriteria: [],
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

describe("KanbanTicketDetail", () => {
  afterEach(() => {
    vi.useRealTimers();
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

  it("renders parent ticket indicator with identifier, title, and sub-issue label", () => {
    const html = renderToStaticMarkup(
      <ParentTicketIndicator
        parent={{ identifier: "T3CO-1", title: "Parent ticket" }}
        onClick={() => undefined}
      />,
    );

    expect(html).toContain("Sub-issue of");
    expect(html).toContain("T3CO-1");
    expect(html).toContain("Parent ticket");
  });

  it("fires onClick when parent ticket indicator is clicked", () => {
    const onClick = vi.fn();
    const element = ParentTicketIndicator({
      parent: { identifier: "T3CO-1", title: "Parent ticket" },
      onClick,
    });

    element.props.onClick();

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("saves inline title edits only when the trimmed title changes", () => {
    expect(
      resolveRequiredInlineTextSave({
        currentValue: "Parent ticket",
        draft: "  Updated parent ticket  ",
      }),
    ).toEqual({
      action: "save",
      nextValue: "Updated parent ticket",
    });

    expect(
      resolveRequiredInlineTextSave({
        currentValue: "Parent ticket",
        draft: "   ",
      }),
    ).toEqual({
      action: "skip",
      nextValue: "Parent ticket",
    });

    expect(
      resolveRequiredInlineTextSave({
        currentValue: "Parent ticket",
        draft: "Parent ticket",
      }),
    ).toEqual({
      action: "skip",
      nextValue: "Parent ticket",
    });
  });

  it("saves inline description edits and allows clearing the description", () => {
    expect(
      resolveNullableInlineTextSave({
        currentValue: DETAIL_DESCRIPTION,
        draft: "  Refined ticket description  ",
      }),
    ).toEqual({
      action: "save",
      nextValue: "Refined ticket description",
    });

    expect(
      resolveNullableInlineTextSave({
        currentValue: DETAIL_DESCRIPTION,
        draft: "   ",
      }),
    ).toEqual({
      action: "save",
      nextValue: null,
    });
  });

  it("saves inline worktree edits and allows clearing the worktree", () => {
    expect(
      resolveNullableInlineTextSave({
        currentValue: "feature/t3co-161",
        draft: "  feature/t3co-161-inline  ",
      }),
    ).toEqual({
      action: "save",
      nextValue: "feature/t3co-161-inline",
    });

    expect(
      resolveNullableInlineTextSave({
        currentValue: "feature/t3co-161",
        draft: "   ",
      }),
    ).toEqual({
      action: "save",
      nextValue: null,
    });
  });

  it("includes the orchestrate menu action and routes the ticket through the detail callback", () => {
    const ticket = makeTicket();
    const onOrchestrate = vi.fn();
    const onDecompose = vi.fn();
    const onDelete = vi.fn();

    const actions = buildTicketDetailActionItems({
      ticket,
      onOrchestrate,
      onDecompose,
      onArchive: () => undefined,
      onDelete,
    });

    const orchestrateAction = actions.find(
      (action) => action.kind === "item" && action.key === "orchestrate",
    );

    expect(orchestrateAction).toMatchObject({
      kind: "item",
      label: "Orchestrate",
    });

    if (!orchestrateAction || orchestrateAction.kind !== "item") {
      throw new Error("Expected orchestrate action");
    }

    orchestrateAction.onSelect();

    expect(onOrchestrate).toHaveBeenCalledWith(ticket);
    expect(onDecompose).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("resolves blur actions so escape cancels and normal blur saves inline edits", () => {
    expect(
      resolveInlineEditBlurAction({
        cancelRequested: true,
        isEditing: true,
      }),
    ).toBe("cancel");

    expect(
      resolveInlineEditBlurAction({
        cancelRequested: false,
        isEditing: true,
      }),
    ).toBe("save");

    expect(
      resolveInlineEditBlurAction({
        cancelRequested: false,
        isEditing: false,
      }),
    ).toBe("ignore");
  });

  it("includes the decompose action in the ticket actions menu and wires it to the handler", () => {
    const onDecompose = vi.fn();
    const actions = buildTicketDetailActionItems({
      ticket: makeTicket(),
      onOrchestrate: () => undefined,
      onDecompose,
      onArchive: () => undefined,
      onDelete: () => undefined,
    });

    expect(actions.map((action) => action.key)).toEqual([
      "orchestrate",
      "decompose",
      "separator",
      "archive",
      "delete",
    ]);

    const decomposeAction = actions[1] as Extract<(typeof actions)[number], { kind: "item" }>;

    expect(decomposeAction).toMatchObject({
      kind: "item",
      key: "decompose",
      label: "Decompose",
    });

    decomposeAction.onSelect();

    expect(onDecompose).toHaveBeenCalledOnce();
  });

  it("decompose creates a draft thread, attaches the ticket, seeds the prompt, and navigates into the draft", () => {
    const clearProjectDraftThreadId = vi.fn();
    const setProjectDraftThreadId = vi.fn();
    const applyStickyState = vi.fn();
    const setPrompt = vi.fn();
    const addTicketAttachment = vi.fn();
    const navigateToThread = vi.fn();

    const ticket = makeTicket({
      id: "ticket-55" as Ticket["id"],
      projectId: "project-55" as ProjectId,
      identifier: "T3CO-55",
      title: "Decompose parent ticket",
    });

    const threadId = startTicketDetailDecomposeFlow({
      ticket,
      composerDraftStore: {
        clearProjectDraftThreadId,
        setProjectDraftThreadId,
        applyStickyState,
        setPrompt,
        addTicketAttachment,
      },
      createThreadId: () => "thread-draft" as ThreadId,
      now: () => "2026-04-10T18:22:00.000Z",
      navigateToThread,
    });

    expect(threadId).toBe("thread-draft");
    expect(clearProjectDraftThreadId).toHaveBeenCalledWith("project-55");
    expect(setProjectDraftThreadId).toHaveBeenCalledWith("project-55", "thread-draft", {
      createdAt: "2026-04-10T18:22:00.000Z",
      envMode: "local",
      runtimeMode: "full-access",
    });
    expect(applyStickyState).toHaveBeenCalledWith("thread-draft");
    expect(addTicketAttachment).toHaveBeenCalledWith("thread-draft", {
      id: "ticket-55",
      identifier: "T3CO-55",
      title: "Decompose parent ticket",
    });
    expect(setPrompt).toHaveBeenCalledWith("thread-draft", DECOMPOSE_PROMPT);
    expect(navigateToThread).toHaveBeenCalledWith("thread-draft");
  });

  it("wires dependency row click-through navigation", () => {
    const onNavigateToTicket = vi.fn();
    const element = DependencyTicketRow({
      dependency: makeDependency({ dependsOnTicketId: "ticket-99" as Ticket["id"] }),
      onNavigateToTicket,
    });

    element.props.onClick();

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

    element.props.onClick();

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("scopes ticket detail lookups by project id so stale cross-project detail state cannot hydrate", () => {
    expect(
      buildTicketDetailLookupInput("ticket-55" as Ticket["id"], "project-55" as ProjectId),
    ).toEqual({
      id: "ticket-55",
      projectId: "project-55",
      includeBody: true,
    });
  });

  it("auto-backs when the fetched ticket belongs to a different project than the active board", () => {
    expect(
      shouldAutoBackFromTicketProjectMismatch({
        ticket: makeTicket({
          id: "ticket-55" as Ticket["id"],
          projectId: "project-55" as ProjectId,
        }),
        projectId: "project-55",
      }),
    ).toBe(false);

    expect(
      shouldAutoBackFromTicketProjectMismatch({
        ticket: makeTicket({
          id: "ticket-89" as Ticket["id"],
          projectId: "project-89" as ProjectId,
        }),
        projectId: "project-55",
      }),
    ).toBe(true);

    expect(
      shouldAutoBackFromTicketProjectMismatch({
        ticket: null,
        projectId: "project-55",
      }),
    ).toBe(false);
  });

  it("preserves the loaded description when metadata update responses are body-light", () => {
    const currentTicket = makeTicket({
      description: "Loaded body content",
      status: "todo",
    });
    const updated = makeTicket({
      description: null,
      status: "backlog",
      updatedAt: "2026-04-10T11:00:00.000Z",
    });

    expect(mergeTicketDetailMetadataUpdate(currentTicket, updated)).toMatchObject({
      description: "Loaded body content",
      status: "backlog",
      updatedAt: "2026-04-10T11:00:00.000Z",
    });
  });

  it("uses body-light metadata update descriptions as-is when no loaded detail exists", () => {
    const updated = makeTicket({
      description: null,
      status: "backlog",
    });

    expect(mergeTicketDetailMetadataUpdate(null, updated).description).toBeNull();
  });

  it("refetches for related ticket_upserted events that add or remove sub-ticket and dependency relationships", () => {
    const currentTicket = makeTicket({
      dependencies: [makeDependency({ dependsOnTicketId: "ticket-2" as Ticket["id"] })],
      subTickets: [makeSubTicket({ id: "ticket-3" as TicketSummary["id"] })],
    });

    const cases: TicketingStreamEvent[] = [
      {
        type: "ticket_upserted",
        projectId: currentTicket.projectId,
        ticket: makeSubTicket({ id: "ticket-3" as TicketSummary["id"], parentId: null }),
      },
      {
        type: "ticket_upserted",
        projectId: currentTicket.projectId,
        ticket: makeSubTicket({
          id: "ticket-4" as TicketSummary["id"],
          parentId: currentTicket.id,
        }),
      },
      {
        type: "ticket_upserted",
        projectId: currentTicket.projectId,
        ticket: makeSubTicket({ id: "ticket-2" as TicketSummary["id"], parentId: null }),
      },
      {
        type: "ticket_upserted",
        projectId: currentTicket.projectId,
        ticket: makeSubTicket({
          id: "ticket-99" as TicketSummary["id"],
          parentId: null,
          identifier: "T3CO-99",
        }),
      },
    ];

    expect(
      cases.map((event) =>
        resolveTicketDetailStreamEventAction(currentTicket.id, currentTicket, event),
      ),
    ).toEqual(["refetch", "refetch", "refetch", "ignore"]);
  });

  it("refetches for related delete events that remove dependency or sub-ticket rows", () => {
    const currentTicket = makeTicket({
      dependencies: [makeDependency({ dependsOnTicketId: "ticket-2" as Ticket["id"] })],
      subTickets: [makeSubTicket({ id: "ticket-3" as TicketSummary["id"] })],
    });

    const dependencyDelete: TicketingStreamEvent = {
      type: "ticket_deleted",
      projectId: currentTicket.projectId,
      ticketId: "ticket-2" as Ticket["id"],
    };
    const subTicketDelete: TicketingStreamEvent = {
      type: "ticket_deleted",
      projectId: currentTicket.projectId,
      ticketId: "ticket-3" as Ticket["id"],
    };

    expect(
      resolveTicketDetailStreamEventAction(currentTicket.id, currentTicket, dependencyDelete),
    ).toBe("refetch");
    expect(
      resolveTicketDetailStreamEventAction(currentTicket.id, currentTicket, subTicketDelete),
    ).toBe("refetch");
  });

  it("renders the origin thread section with inline status and time metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T22:00:00.000Z"));

    const html = renderToStaticMarkup(
      <TicketOriginThreadSection thread={makeLinkedThread()} onOpenThread={() => undefined} />,
    );

    expect(html).toContain("Origin Thread");
    expect(html).toContain("Archived");
    expect(html).toContain("Review");
    expect(html).toContain("12h ago");
  });

  it("wires thread-row navigation for the origin thread row", () => {
    const onOpenThread = vi.fn();

    const threadRow = TicketThreadRowButton({
      thread: makeLinkedThread(),
      onOpenThread,
    });

    threadRow.props.onClick();

    expect(onOpenThread).toHaveBeenCalledWith("thread-1");
  });
});
