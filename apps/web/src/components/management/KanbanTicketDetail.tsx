import type {
  AcceptanceCriterion,
  Ticket,
  TicketDependency,
  TicketId,
  TicketLinkedThread,
  TicketPriority,
  TicketStatus,
  TicketSummary,
  TicketingStreamEvent,
  TicketThreadLinks,
  ThreadId,
} from "@t3tools/contracts";
import { useDraggable } from "@dnd-kit/core";
import {
  ArchiveIcon,
  EllipsisVerticalIcon,
  GitBranchIcon,
  ListTreeIcon,
  PlayIcon,
  TrashIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_RUNTIME_MODE, type ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useComposerDraftStore } from "../../composerDraftStore";
import { newThreadId } from "../../lib/utils";
import { ensureNativeApi } from "../../nativeApi";
import { useTicketSelectionStore } from "../../ticketSelectionStore";
import { TicketAttachments } from "./TicketAttachments";
import { TicketDescriptionEditor } from "./TicketDescriptionEditor";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SubTicketPreviewContent } from "./SubTicketPreviewContent";
import { SubTicketsTree } from "./SubTicketsTree";
import { MoveTicketToBoardDialog } from "./MoveTicketToBoardDialog";
import { TicketAcceptanceCriteria } from "../settings/TicketAcceptanceCriteria";
import { TicketComments } from "../settings/TicketComments";
import { TicketLabelPicker } from "./TicketLabelPicker";
import { TicketHistory } from "../settings/TicketHistory";
import {
  ALL_PRIORITIES,
  ALL_STATUSES,
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  formatRelativeDate,
} from "../settings/ticketUtils";
import { PriorityIcon } from "./PriorityIcon";
import { handleTicketMultiSelectGesture } from "./ticketMultiSelect";

export const DECOMPOSE_PROMPT = `Decompose the attached ticket into sub-tickets.

Instructions:
1. Read the attached ticket thoroughly — its title, description, and acceptance criteria.
2. Propose a set of sub-tickets that together fully cover the parent ticket's scope. Each sub-ticket must:
   - Be small enough to complete in a single AI agent session (optimize for limited context windows).
   - Have a clear, specific title and description.
   - Include concrete acceptance criteria.
3. If there are dependencies between tickets make sure to link them appropriately.
4. If the parent ticket has acceptance criteria, map each criterion to one or more sub-tickets — nothing should be lost.
5. Present the proposed sub-tickets as a numbered list with title, description, and acceptance criteria for each. Do NOT create anything yet.
6. Wait for my explicit confirmation before proceeding.
7. Once I confirm, create each sub-ticket as a child of the parent ticket using the ticketing tools (set parentId to the attached ticket's identifier).
8. After all sub-tickets are created, update the parent ticket: revise its description to a high-level overview and remove detailed acceptance criteria that are now covered by sub-tickets.

Goal: Break this ticket into well-scoped units of work so that an AI agent can pick up and complete each one independently, within a single session.`;

export type InlineEditBlurAction = "cancel" | "save" | "ignore";

export function resolveInlineEditBlurAction(input: {
  cancelRequested: boolean;
  isEditing: boolean;
}): InlineEditBlurAction {
  if (input.cancelRequested) {
    return "cancel";
  }
  return input.isEditing ? "save" : "ignore";
}

export function resolveRequiredInlineTextSave(input: { currentValue: string; draft: string }): {
  action: "skip" | "save";
  nextValue: string;
} {
  const nextValue = input.draft.trim();
  if (!nextValue || nextValue === input.currentValue) {
    return { action: "skip", nextValue: input.currentValue };
  }
  return { action: "save", nextValue };
}

export function resolveNullableInlineTextSave(input: {
  currentValue: string | null;
  draft: string;
}): { action: "skip" | "save"; nextValue: string | null } {
  const nextValue = input.draft.trim() || null;
  if (nextValue === input.currentValue) {
    return { action: "skip", nextValue: input.currentValue };
  }
  return { action: "save", nextValue };
}

export function buildTicketDetailLookupInput(
  ticketId: TicketId,
  projectId: string,
): {
  id: TicketId;
  projectId: ProjectId;
  includeBody: true;
} {
  return {
    id: ticketId,
    projectId: projectId as ProjectId,
    includeBody: true,
  };
}

export function shouldAutoBackFromTicketProjectMismatch(input: {
  ticket: Pick<Ticket, "projectId"> | null;
  projectId: string;
}): boolean {
  return !!input.ticket && input.ticket.projectId !== (input.projectId as ProjectId);
}

interface TicketDetailDecomposeComposerDraftStore {
  clearProjectDraftThreadId: (projectId: ProjectId) => void;
  setProjectDraftThreadId: (
    projectId: ProjectId,
    threadId: ThreadId,
    state: {
      createdAt: string;
      envMode: "local";
      runtimeMode: typeof DEFAULT_RUNTIME_MODE;
    },
  ) => void;
  applyStickyState: (threadId: ThreadId) => void;
  setPrompt: (threadId: ThreadId, prompt: string) => void;
  addTicketAttachment: (
    threadId: ThreadId,
    attachment: Pick<Ticket, "id" | "identifier" | "title">,
  ) => void;
}

export function startTicketDetailDecomposeFlow(input: {
  ticket: Pick<Ticket, "id" | "identifier" | "title" | "projectId">;
  composerDraftStore: TicketDetailDecomposeComposerDraftStore;
  createThreadId?: () => ThreadId;
  now?: () => string;
  navigateToThread: (threadId: ThreadId) => void;
}) {
  const threadId = (input.createThreadId ?? newThreadId)();
  const createdAt = (input.now ?? (() => new Date().toISOString()))();

  input.composerDraftStore.clearProjectDraftThreadId(input.ticket.projectId);
  input.composerDraftStore.setProjectDraftThreadId(input.ticket.projectId, threadId, {
    createdAt,
    envMode: "local",
    runtimeMode: DEFAULT_RUNTIME_MODE,
  });
  input.composerDraftStore.applyStickyState(threadId);
  input.composerDraftStore.addTicketAttachment(threadId, {
    id: input.ticket.id,
    identifier: input.ticket.identifier,
    title: input.ticket.title,
  });
  input.composerDraftStore.setPrompt(threadId, DECOMPOSE_PROMPT);
  input.navigateToThread(threadId);

  return threadId;
}

function TicketDetailActionsMenu({
  ticket,
  onOrchestrate,
  onDecompose,
  onMoveToBoard,
  onArchive,
  onDelete,
}: {
  ticket: Ticket;
  onOrchestrate: ((ticket: Ticket) => void) | undefined;
  onDecompose: () => void;
  onMoveToBoard?: (() => void) | undefined;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const actions = buildTicketDetailActionItems({
    ticket,
    onOrchestrate,
    onDecompose,
    onMoveToBoard,
    onArchive,
    onDelete,
  });

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Ticket actions"
          />
        }
      >
        <EllipsisVerticalIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        {actions.map((action) =>
          action.kind === "separator" ? (
            <MenuSeparator key={action.key} />
          ) : (
            <MenuItem
              key={action.key}
              variant={action.variant ?? "default"}
              onClick={action.onSelect}
            >
              {action.icon}
              {action.label}
            </MenuItem>
          ),
        )}
      </MenuPopup>
    </Menu>
  );
}

type TicketDetailActionItem =
  | {
      key: string;
      kind: "item";
      label: string;
      icon: React.ReactNode;
      onSelect: () => void;
      variant?: "default" | "destructive";
    }
  | {
      key: string;
      kind: "separator";
    };

export function buildTicketDetailActionItems(input: {
  ticket: Ticket;
  onOrchestrate: ((ticket: Ticket) => void) | undefined;
  onDecompose: () => void;
  onMoveToBoard?: (() => void) | undefined;
  onArchive: () => void;
  onDelete: () => void;
}): TicketDetailActionItem[] {
  return [
    {
      key: "orchestrate",
      kind: "item",
      label: "Orchestrate",
      icon: <PlayIcon className="size-3.5" />,
      onSelect: () => input.onOrchestrate?.(input.ticket),
    },
    {
      key: "decompose",
      kind: "item",
      label: "Decompose",
      icon: <ListTreeIcon className="size-3.5" />,
      onSelect: input.onDecompose,
    },
    ...(input.ticket.parentId !== null && input.onMoveToBoard
      ? [
          {
            key: "move-to-board",
            kind: "item" as const,
            label: "Move to board",
            icon: null,
            onSelect: input.onMoveToBoard,
          },
        ]
      : []),
    {
      key: "separator",
      kind: "separator",
    },
    {
      key: "archive",
      kind: "item",
      label: "Archive",
      icon: <ArchiveIcon className="size-3.5" />,
      onSelect: input.onArchive,
    },
    {
      key: "delete",
      kind: "item",
      label: "Delete",
      icon: <TrashIcon className="size-3.5" />,
      onSelect: input.onDelete,
      variant: "destructive",
    },
  ];
}

type TicketRowButtonProps = React.ComponentPropsWithoutRef<"button"> & {
  "data-ticket-selectable"?: boolean;
};

interface KanbanTicketDetailProps {
  ticketId: TicketId;
  projectId: string;
  onBack: () => void;
  onNavigateToTicket: (ticketId: TicketId) => void;
  onOrchestrate?: (ticket: Ticket) => void;
  findTicketSummary?: (id: TicketId) => TicketSummary | undefined;
}

function TicketRelationRowButton({
  identifier,
  title,
  status,
  className,
  buttonRef,
  ...buttonProps
}: {
  identifier: string;
  title: string;
  status: TicketStatus;
  className: string;
  buttonRef?: React.Ref<HTMLButtonElement> | undefined;
} & TicketRowButtonProps) {
  const statusCfg = STATUS_CONFIG[status];

  return (
    <button ref={buttonRef} type="button" className={className} {...buttonProps}>
      <Badge size="sm" variant={statusCfg.badgeVariant}>
        {statusCfg.label}
      </Badge>
      <span className="shrink-0 text-muted-foreground">{identifier}</span>
      <span className="truncate text-foreground">{title}</span>
    </button>
  );
}

export function ParentTicketIndicator({
  parent,
  onClick,
}: {
  parent: { identifier: string; title: string };
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="mt-2 flex items-center gap-1.5 rounded-md px-1.5 py-1 -ml-1.5 text-left text-xs transition-colors hover:bg-accent"
      onClick={onClick}
    >
      <ListTreeIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="text-[11px] text-muted-foreground">Sub-issue of</span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {parent.identifier}
      </span>
      <span className="truncate text-foreground">{parent.title}</span>
    </button>
  );
}

export function DependencyTicketRow({
  dependency,
  onNavigateToTicket,
}: {
  dependency: TicketDependency;
  onNavigateToTicket: (ticketId: TicketId) => void;
}) {
  return TicketRelationRowButton({
    identifier: dependency.identifier,
    title: dependency.title,
    status: dependency.status,
    className:
      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/30",
    onClick: () => onNavigateToTicket(dependency.dependsOnTicketId),
  });
}

export function SubTicketRowButton({
  subTicket,
  isSelected,
  isDragging,
  isPreviewOpen = false,
  onClick,
  buttonRef,
  buttonProps,
}: {
  subTicket: TicketSummary;
  isSelected: boolean;
  isDragging: boolean;
  isPreviewOpen?: boolean;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  buttonRef?: React.Ref<HTMLButtonElement> | undefined;
  buttonProps?: TicketRowButtonProps;
}) {
  return TicketRelationRowButton({
    ...buttonProps,
    identifier: subTicket.identifier,
    title: subTicket.title,
    status: subTicket.status,
    buttonRef,
    className: `flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
      isSelected
        ? "bg-primary/5 ring-1.5 ring-primary/40"
        : isPreviewOpen
          ? "bg-accent/30"
          : "hover:bg-accent/30"
    } ${isDragging ? "opacity-40" : ""}`,
    onClick,
  });
}

export function resolveTicketDetailStreamEventAction(
  ticketId: TicketId,
  currentTicket: Ticket | null,
  event: TicketingStreamEvent,
): "back" | "refetch" | "ignore" {
  if (event.type === "ticket_deleted" && event.ticketId === ticketId) {
    return "back";
  }

  if (currentTicket === null) {
    return "ignore";
  }

  if (event.type === "ticket_deleted") {
    return currentTicket.subTickets.some((subTicket) => subTicket.id === event.ticketId) ||
      currentTicket.dependencies.some(
        (dependency) => dependency.dependsOnTicketId === event.ticketId,
      )
      ? "refetch"
      : "ignore";
  }

  if (event.type === "ticket_upserted") {
    if (event.ticket.id === ticketId || event.ticket.parentId === ticketId) {
      return "refetch";
    }
    if (currentTicket.subTickets.some((subTicket) => subTicket.id === event.ticket.id)) {
      return "refetch";
    }
    return currentTicket.dependencies.some(
      (dependency) => dependency.dependsOnTicketId === event.ticket.id,
    )
      ? "refetch"
      : "ignore";
  }

  if (
    (event.type === "comment_upserted" || event.type === "comment_deleted") &&
    event.ticketId === ticketId
  ) {
    return "refetch";
  }

  if (
    (event.type === "artifact_upserted" || event.type === "artifact_deleted") &&
    event.ticketId === ticketId
  ) {
    return "refetch";
  }

  return "ignore";
}

function linkedThreadSignature(thread: TicketLinkedThread | null): string {
  return thread
    ? [
        thread.threadId,
        thread.title,
        thread.linkedAt,
        thread.archivedAt ?? "",
        thread.isOrchestrationThread ? "review" : "normal",
      ].join("|")
    : "null";
}

function shouldRefetchThreadLinks(
  previousLinks: TicketThreadLinks | null,
  nextLinks: TicketThreadLinks,
): boolean {
  if (previousLinks === null) {
    return true;
  }
  return (
    linkedThreadSignature(previousLinks.originThread) !==
    linkedThreadSignature(nextLinks.originThread)
  );
}

export function KanbanTicketDetail({
  ticketId,
  projectId,
  onBack,
  onNavigateToTicket,
  onOrchestrate,
  findTicketSummary,
}: KanbanTicketDetailProps) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveSubTicketsDialog, setArchiveSubTicketsDialog] = useState<
    readonly TicketSummary[] | null
  >(null);
  const [archivingSubTickets, setArchivingSubTickets] = useState(false);
  const [moveToBoardDialogOpen, setMoveToBoardDialogOpen] = useState(false);
  const [moveToBoardTickets, setMoveToBoardTickets] = useState<readonly TicketSummary[]>([]);
  const [movingToBoard, setMovingToBoard] = useState(false);
  const [threadLinks, setThreadLinks] = useState<TicketThreadLinks | null>(null);
  const ticketRef = useRef<Ticket | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** Saved scroll positions keyed by ticketId — used to restore on back navigation. */
  const scrollMapRef = useRef<Map<TicketId, number>>(new Map());
  const prevTicketIdRef = useRef<TicketId>(ticketId);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingWorktree, setEditingWorktree] = useState(false);
  const [worktreeDraft, setWorktreeDraft] = useState("");
  /** Set to true when Escape is pressed so the blur handler skips saving. */
  const cancelEditRef = useRef(false);
  const removeFromSelection = useTicketSelectionStore((s) => s.removeFromSelection);

  const parentSummary = useMemo(() => {
    if (!ticket?.parentId || !findTicketSummary) return null;
    return findTicketSummary(ticket.parentId) ?? null;
  }, [ticket?.parentId, findTicketSummary]);

  const toTicketSummary = useCallback((value: Ticket): TicketSummary => {
    return {
      id: value.id,
      projectId: value.projectId,
      parentId: value.parentId,
      ticketNumber: value.ticketNumber,
      identifier: value.identifier,
      title: value.title,
      status: value.status,
      priority: value.priority,
      sortOrder: value.sortOrder,
      isArchived: value.isArchived,
      worktree: value.worktree,
      labels: value.labels,
      subTicketCount: value.subTickets.length,
      dependencyCount: value.dependencies.length,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    } as TicketSummary;
  }, []);

  const fetchTicket = useCallback(async () => {
    try {
      const api = ensureNativeApi();
      const [data, nextThreadLinks] = await Promise.all([
        api.ticketing.getById(buildTicketDetailLookupInput(ticketId, projectId)),
        api.ticketing.getThreadLinks({ ticketId }),
      ]);
      ticketRef.current = data;
      setTicket(data);
      setThreadLinks((currentLinks) =>
        shouldRefetchThreadLinks(currentLinks, nextThreadLinks) ? nextThreadLinks : currentLinks,
      );
    } catch (error) {
      console.error("Failed to fetch ticket:", error);
      setThreadLinks(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, ticketId]);

  useEffect(() => {
    setLoading(true);
    void fetchTicket();
  }, [fetchTicket]);

  useEffect(() => {
    const api = ensureNativeApi();
    const unsubscribe = api.ticketing.onEvent((event: TicketingStreamEvent) => {
      const action = resolveTicketDetailStreamEventAction(ticketId, ticketRef.current, event);
      if (action === "back") {
        onBack();
      } else if (action === "refetch") {
        void fetchTicket();
      }
    });
    return unsubscribe;
  }, [ticketId, onBack, fetchTicket]);

  useEffect(() => {
    if (shouldAutoBackFromTicketProjectMismatch({ ticket, projectId })) {
      onBack();
    }
  }, [onBack, projectId, ticket]);

  // Scroll management: reset to top on forward navigation, restore on back.
  useEffect(() => {
    const prev = prevTicketIdRef.current;
    if (prev === ticketId) return;

    // Save scroll position of the ticket we're leaving.
    const container = scrollContainerRef.current;
    if (container) {
      scrollMapRef.current.set(prev, container.scrollTop);
    }
    prevTicketIdRef.current = ticketId;

    // If we have a saved position for the incoming ticket, restore it (back navigation).
    // Otherwise scroll to top (forward navigation).
    const saved = scrollMapRef.current.get(ticketId);
    if (container) {
      container.scrollTop = saved ?? 0;
    }
    // Clean up the restored entry so re-visiting later starts fresh.
    if (saved != null) {
      scrollMapRef.current.delete(ticketId);
    }
  }, [ticketId]);

  const handleStatusChange = useCallback(
    async (status: TicketStatus) => {
      try {
        const api = ensureNativeApi();
        const updated = await api.ticketing.update({ id: ticketId, status });
        ticketRef.current = updated;
        setTicket(updated);
      } catch (error) {
        console.error("Failed to update status:", error);
      }
    },
    [ticketId],
  );

  const handlePriorityChange = useCallback(
    async (priority: TicketPriority) => {
      try {
        const api = ensureNativeApi();
        const updated = await api.ticketing.update({ id: ticketId, priority });
        ticketRef.current = updated;
        setTicket(updated);
      } catch (error) {
        console.error("Failed to update priority:", error);
      }
    },
    [ticketId],
  );

  const handleTitleSave = useCallback(async () => {
    const currentTitle = ticketRef.current?.title ?? "";
    const result = resolveRequiredInlineTextSave({
      currentValue: currentTitle,
      draft: titleDraft,
    });
    if (result.action === "skip") {
      setEditingTitle(false);
      return;
    }
    const previous = ticketRef.current;
    if (previous) {
      const optimistic = { ...previous, title: result.nextValue };
      ticketRef.current = optimistic;
      setTicket(optimistic);
    }
    setEditingTitle(false);
    try {
      const api = ensureNativeApi();
      const updated = await api.ticketing.update({
        id: ticketId,
        title: result.nextValue as never,
      });
      ticketRef.current = updated;
      setTicket(updated);
    } catch (error) {
      console.error("Failed to update title:", error);
      if (previous) {
        ticketRef.current = previous;
        setTicket(previous);
      }
    }
  }, [ticketId, titleDraft]);

  const saveDescription = useCallback(
    async (nextMarkdown: string | null) => {
      const currentValue = ticketRef.current?.description ?? null;
      if (nextMarkdown === currentValue) return;
      const previous = ticketRef.current;
      if (previous) {
        const optimistic = { ...previous, description: nextMarkdown };
        ticketRef.current = optimistic;
        setTicket(optimistic);
      }
      try {
        const api = ensureNativeApi();
        await api.ticketing.editBody({
          ticketId,
          expectedRevision: previous?.body?.revision ?? 1,
          operation: "replace_body",
          body: nextMarkdown ?? "",
        });
        const updated = await api.ticketing.getById({ id: ticketId, includeBody: true });
        ticketRef.current = updated;
        setTicket(updated);
      } catch (error) {
        console.error("Failed to update description:", error);
        if (previous) {
          ticketRef.current = previous;
          setTicket(previous);
        }
      }
    },
    [ticketId],
  );

  const handleCriteriaChange = useCallback(
    async (nextCriteria: AcceptanceCriterion[]) => {
      const previous = ticketRef.current;
      if (previous) {
        const optimistic = { ...previous, acceptanceCriteria: nextCriteria };
        ticketRef.current = optimistic;
        setTicket(optimistic);
      }
      try {
        const api = ensureNativeApi();
        if (nextCriteria.length === (previous?.acceptanceCriteria?.length ?? 0) + 1) {
          const added = nextCriteria[nextCriteria.length - 1];
          await api.ticketing.editCriteria({
            ticketId,
            expectedCriteriaRevision: previous?.criteriaRevision ?? 1,
            operation: "add",
            text: added?.text ?? "",
            status: added?.status ?? "pending",
          });
        } else if (nextCriteria.length === (previous?.acceptanceCriteria?.length ?? 0) - 1) {
          const removed = (previous?.acceptanceCriteria ?? []).find(
            (criterion) => !nextCriteria.some((next) => next.id === criterion.id),
          );
          await api.ticketing.editCriteria({
            ticketId,
            expectedCriteriaRevision: previous?.criteriaRevision ?? 1,
            operation: "remove",
            criterionId: removed?.id,
          });
        } else {
          const changedIndex = nextCriteria.findIndex((criterion, index) => {
            const before = previous?.acceptanceCriteria?.[index];
            return before?.text !== criterion.text || before?.status !== criterion.status;
          });
          const changed = nextCriteria[changedIndex];
          await api.ticketing.editCriteria({
            ticketId,
            expectedCriteriaRevision: previous?.criteriaRevision ?? 1,
            operation: "update",
            criterionId: changed?.id,
            text: changed?.text,
            status: changed?.status,
          });
        }
        const updated = await api.ticketing.getById({
          id: ticketId,
          includeBody: true,
        });
        ticketRef.current = updated;
        setTicket(updated);
      } catch (error) {
        console.error("Failed to update acceptance criteria:", error);
        if (previous) {
          ticketRef.current = previous;
          setTicket(previous);
        }
      }
    },
    [ticketId],
  );

  const handleWorktreeSave = useCallback(async () => {
    const result = resolveNullableInlineTextSave({
      currentValue: ticketRef.current?.worktree ?? null,
      draft: worktreeDraft,
    });
    if (result.action === "skip") {
      setEditingWorktree(false);
      return;
    }
    const previous = ticketRef.current;
    if (previous) {
      const optimistic = { ...previous, worktree: result.nextValue };
      ticketRef.current = optimistic;
      setTicket(optimistic);
    }
    setEditingWorktree(false);
    try {
      const api = ensureNativeApi();
      const updated = await api.ticketing.update({
        id: ticketId,
        worktree: result.nextValue,
      });
      ticketRef.current = updated;
      setTicket(updated);
    } catch (error) {
      console.error("Failed to update worktree:", error);
      if (previous) {
        ticketRef.current = previous;
        setTicket(previous);
      }
    }
  }, [ticketId, worktreeDraft]);

  const handleDelete = useCallback(async () => {
    try {
      const api = ensureNativeApi();
      await api.ticketing.delete({ id: ticketId });
      setDeleteDialogOpen(false);
      onBack();
    } catch (error) {
      console.error("Failed to delete ticket:", error);
    }
  }, [ticketId, onBack]);

  const handleArchive = useCallback(async () => {
    try {
      const api = ensureNativeApi();
      await api.ticketing.archive({ id: ticketId });
      setArchiveDialogOpen(false);
      onBack();
    } catch (error) {
      console.error("Failed to archive ticket:", error);
    }
  }, [ticketId, onBack]);

  const handleArchiveSubTicketsRequest = useCallback((tickets: readonly TicketSummary[]) => {
    if (tickets.length === 0) return;
    setArchiveSubTicketsDialog(tickets);
  }, []);

  const handleConfirmArchiveSubTickets = useCallback(async () => {
    const targets = archiveSubTicketsDialog;
    if (!targets || targets.length === 0) {
      setArchiveSubTicketsDialog(null);
      return;
    }
    setArchivingSubTickets(true);
    try {
      const api = ensureNativeApi();
      await Promise.all(targets.map((t) => api.ticketing.archive({ id: t.id })));
      removeFromSelection(targets.map((t) => t.id));
      setArchiveSubTicketsDialog(null);
      await fetchTicket();
    } catch (error) {
      console.error("Failed to archive sub-tickets:", error);
    } finally {
      setArchivingSubTickets(false);
    }
  }, [archiveSubTicketsDialog, fetchTicket, removeFromSelection]);

  const handleMoveToBoardRequest = useCallback((tickets: readonly TicketSummary[]) => {
    if (tickets.length === 0) return;
    setMoveToBoardTickets(tickets);
    setMoveToBoardDialogOpen(true);
  }, []);

  const handleMoveCurrentTicketToBoard = useCallback(() => {
    if (!ticket || ticket.parentId === null) return;
    handleMoveToBoardRequest([toTicketSummary(ticket)]);
  }, [handleMoveToBoardRequest, ticket, toTicketSummary]);

  const handleConfirmMoveToBoard = useCallback(async () => {
    if (moveToBoardTickets.length === 0) return;
    setMovingToBoard(true);
    try {
      const api = ensureNativeApi();
      await Promise.all(
        moveToBoardTickets.map((ticket) =>
          api.ticketing.update({
            id: ticket.id,
            parentId: null,
          }),
        ),
      );
      removeFromSelection(moveToBoardTickets.map((ticket) => ticket.id));
      setMoveToBoardDialogOpen(false);
      setMoveToBoardTickets([]);
      await fetchTicket();
    } catch (error) {
      console.error("Failed to move ticket(s) to board:", error);
    } finally {
      setMovingToBoard(false);
    }
  }, [fetchTicket, moveToBoardTickets, removeFromSelection]);

  const navigate = useNavigate();
  const handleDecompose = useCallback(() => {
    if (!ticket) return;
    startTicketDetailDecomposeFlow({
      ticket,
      composerDraftStore: useComposerDraftStore.getState(),
      navigateToThread: (threadId) => {
        void navigate({ to: "/$threadId", params: { threadId } });
      },
    });
  }, [navigate, ticket]);

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">Ticket not found.</p>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[ticket.status];

  return (
    <div ref={scrollContainerRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-8">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 font-mono text-md text-muted-foreground">
                  {ticket.identifier}
                </span>
                <input
                  type="text"
                  className="min-w-0 flex-1 cursor-text bg-transparent font-[inherit]! text-lg font-medium text-foreground outline-none"
                  value={editingTitle ? titleDraft : ticket.title}
                  onFocus={() => {
                    setTitleDraft(ticket.title);
                    setEditingTitle(true);
                  }}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => {
                    const blurAction = resolveInlineEditBlurAction({
                      cancelRequested: cancelEditRef.current,
                      isEditing: editingTitle,
                    });
                    if (blurAction === "cancel") {
                      cancelEditRef.current = false;
                      setEditingTitle(false);
                    } else if (blurAction === "save") {
                      void handleTitleSave();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                    if (e.key === "Escape") {
                      cancelEditRef.current = true;
                      e.currentTarget.blur();
                    }
                  }}
                />
              </div>
              {parentSummary && (
                <ParentTicketIndicator
                  parent={{
                    identifier: parentSummary.identifier,
                    title: parentSummary.title,
                  }}
                  onClick={() => onNavigateToTicket(parentSummary.id)}
                />
              )}
            </div>
            <TicketDetailActionsMenu
              ticket={ticket}
              onOrchestrate={onOrchestrate}
              onDecompose={handleDecompose}
              onMoveToBoard={handleMoveCurrentTicketToBoard}
              onArchive={() => setArchiveDialogOpen(true)}
              onDelete={() => setDeleteDialogOpen(true)}
            />
          </div>

          {/* Status + Priority inline selectors */}
          <div className="flex flex-wrap items-center gap-3">
            {threadLinks?.originThread && (
              <>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    void navigate({
                      to: "/$threadId",
                      params: { threadId: threadLinks.originThread!.threadId },
                    })
                  }
                >
                  Origin Thread
                </Button>
                <span className="text-border">|</span>
              </>
            )}

            <Select
              value={ticket.status}
              onValueChange={(v) => void handleStatusChange(v as TicketStatus)}
            >
              <SelectTrigger size="xs" variant="ghost" className="h-auto gap-1.5 px-1.5 py-1">
                <Badge size="sm" variant={statusCfg.badgeVariant}>
                  <SelectValue />
                </Badge>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    <div className="flex items-center gap-2">
                      <Badge size="sm" variant={STATUS_CONFIG[s].badgeVariant}>
                        {STATUS_CONFIG[s].label}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>

            <span className="text-border">|</span>

            <Select
              value={ticket.priority}
              onValueChange={(v) => void handlePriorityChange(v as TicketPriority)}
            >
              <SelectTrigger size="xs" variant="ghost" className="h-auto gap-1.5 px-1.5 py-1">
                <PriorityIcon priority={ticket.priority} className="size-4 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {[...ALL_PRIORITIES].reverse().map((p) => (
                  <SelectItem key={p} value={p}>
                    <div className="flex items-center gap-2">
                      <PriorityIcon priority={p} className="size-4 text-muted-foreground" />
                      {PRIORITY_CONFIG[p].label}
                    </div>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>

            <span className="text-border">|</span>
            <TicketLabelPicker
              ticketId={ticketId}
              projectId={projectId}
              labels={ticket.labels}
              onUpdated={() => void fetchTicket()}
              inline
            />
            <span className="text-border">|</span>
            <div className="flex items-center gap-1.5">
              <GitBranchIcon className="size-3 shrink-0 text-muted-foreground" />
              <input
                type="text"
                className={`min-w-[120px] max-w-[200px] cursor-text bg-transparent font-[inherit]! text-[11px] outline-none ${
                  editingWorktree || ticket.worktree
                    ? "text-foreground"
                    : "italic text-muted-foreground/60"
                }`}
                value={editingWorktree ? worktreeDraft : (ticket.worktree ?? "")}
                placeholder="No worktree specified"
                onFocus={() => {
                  setWorktreeDraft(ticket.worktree ?? "");
                  setEditingWorktree(true);
                }}
                onChange={(e) => setWorktreeDraft(e.target.value)}
                onBlur={() => {
                  const blurAction = resolveInlineEditBlurAction({
                    cancelRequested: cancelEditRef.current,
                    isEditing: editingWorktree,
                  });
                  if (blurAction === "cancel") {
                    cancelEditRef.current = false;
                    setEditingWorktree(false);
                  } else if (blurAction === "save") {
                    void handleWorktreeSave();
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                  if (e.key === "Escape") {
                    cancelEditRef.current = true;
                    e.currentTarget.blur();
                  }
                }}
              />
            </div>
            <span className="text-border">|</span>
            <span className="text-[11px] text-muted-foreground">
              Created {formatRelativeDate(ticket.createdAt)}
            </span>
          </div>
        </div>

        {/* Description */}
        <div className="rounded-md py-2">
          <TicketDescriptionEditor
            ticketId={ticketId}
            initialContent={ticket.description}
            onSave={saveDescription}
          />
        </div>

        {/* Attachments */}
        <TicketAttachments
          ticketId={ticketId}
          artifacts={ticket.artifacts}
          onUpdated={() => void fetchTicket()}
        />

        {/* Acceptance Criteria */}
        <TicketAcceptanceCriteria
          ticketId={ticketId}
          criteria={ticket.acceptanceCriteria ?? []}
          criteriaRevision={ticket.criteriaRevision ?? 1}
          onUpdated={() => void fetchTicket()}
          onCriteriaChange={handleCriteriaChange}
        />

        {/* Dependencies */}
        {ticket.dependencies.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Dependencies ({ticket.dependencies.length})
            </h3>
            <div className="flex flex-col gap-1">
              {ticket.dependencies.map((dep) => {
                return (
                  <DependencyTicketRow
                    key={dep.dependsOnTicketId}
                    dependency={dep}
                    onNavigateToTicket={onNavigateToTicket}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Sub-tickets — recursive tree, default open, per-node collapse persisted. */}
        {ticket.subTickets.length > 0 && (
          <SubTicketsTree
            ticketId={ticketId}
            projectId={projectId}
            onNavigateToTicket={onNavigateToTicket}
            onMoveToBoardRequest={handleMoveToBoardRequest}
            onArchiveRequest={handleArchiveSubTicketsRequest}
          />
        )}

        {/* Comments */}
        <TicketComments
          ticketId={ticketId}
          comments={ticket.comments}
          onUpdated={() => void fetchTicket()}
        />

        {/* History */}
        <TicketHistory ticketId={ticketId} />
      </div>
      <MoveTicketToBoardDialog
        open={moveToBoardDialogOpen}
        onOpenChange={(open) => {
          setMoveToBoardDialogOpen(open);
          if (!open && !movingToBoard) {
            setMoveToBoardTickets([]);
          }
        }}
        tickets={moveToBoardTickets}
        pending={movingToBoard}
        onConfirm={() => void handleConfirmMoveToBoard()}
      />
      {/* Delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{ticket.identifier}: {ticket.title}" and all its data.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </AlertDialogClose>
            <Button variant="destructive" size="sm" onClick={() => void handleDelete()}>
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      {/* Archive confirmation */}
      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              "{ticket.identifier}: {ticket.title}" and any sub-tickets will be archived. You can
              restore them from Settings → Archived tickets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </AlertDialogClose>
            <Button variant="destructive" size="sm" onClick={() => void handleArchive()}>
              Archive
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      {/* Archive sub-tickets confirmation (multi-select / context-menu archive). */}
      <AlertDialog
        open={archiveSubTicketsDialog !== null}
        onOpenChange={(open) => {
          if (!open && !archivingSubTickets) {
            setArchiveSubTicketsDialog(null);
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {(archiveSubTicketsDialog?.length ?? 0) === 1
                ? "Archive this ticket?"
                : `Archive ${archiveSubTicketsDialog?.length ?? 0} tickets?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Sub-tickets will also be archived. You can restore them from Settings → Archived
              tickets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose>
              <Button variant="outline" size="sm" disabled={archivingSubTickets}>
                Cancel
              </Button>
            </AlertDialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleConfirmArchiveSubTickets()}
              disabled={archivingSubTickets}
            >
              {archivingSubTickets ? "Archiving..." : "Archive"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-ticket list with drag-to-chat and Alt/Shift+click multi-select
// ---------------------------------------------------------------------------

export function SubTicketsList({
  projectId,
  subTickets,
  onNavigateToTicket,
  onMoveToBoardRequest,
  onArchiveRequest,
}: {
  projectId: string;
  subTickets: readonly TicketSummary[];
  onNavigateToTicket: (ticketId: TicketId) => void;
  onMoveToBoardRequest: (tickets: readonly TicketSummary[]) => void;
  onArchiveRequest: (tickets: readonly TicketSummary[]) => void;
}) {
  const selectedTicketIds = useTicketSelectionStore((s) => s.selectedTicketIds);
  const selectedTickets = useTicketSelectionStore((s) => s.selectedTickets);
  const toggleTicket = useTicketSelectionStore((s) => s.toggleTicket);
  const rangeSelectTo = useTicketSelectionStore((s) => s.rangeSelectTo);
  const clearSelection = useTicketSelectionStore((s) => s.clearSelection);
  const subTicketIds = useMemo(() => new Set(subTickets.map((ticket) => ticket.id)), [subTickets]);
  const selectedSubTickets = useMemo(
    () => [...selectedTickets.values()].filter((ticket) => subTicketIds.has(ticket.id)),
    [selectedTickets, subTicketIds],
  );

  const handleSubTicketMultiSelectClick = useCallback(
    (e: React.MouseEvent, sub: TicketSummary) => {
      handleTicketMultiSelectGesture(e, sub, subTickets, {
        toggleTicket,
        rangeSelectTo,
      });
    },
    [toggleTicket, rangeSelectTo, subTickets],
  );

  // Hover-preview cache scoped to this list's lifetime
  const cacheRef = useRef(new Map<string, Ticket>());
  const inflightRef = useRef(new Map<string, Promise<Ticket | null>>());

  // Invalidate cache when a sub-ticket is updated externally
  useEffect(() => {
    const api = ensureNativeApi();
    return api.ticketing.onEvent((event: TicketingStreamEvent) => {
      if (event.type === "ticket_upserted") {
        cacheRef.current.delete(event.ticket.id as string);
      }
    });
  }, []);

  const fetchPreview = useCallback(
    async (id: TicketId): Promise<Ticket | null> => {
      const key = id as string;
      const cached = cacheRef.current.get(key);
      if (cached) return cached;
      const existing = inflightRef.current.get(key);
      if (existing) return existing;
      const promise = ensureNativeApi()
        .ticketing.getById(buildTicketDetailLookupInput(id, projectId))
        .then((t) => {
          cacheRef.current.set(key, t);
          return t;
        })
        .catch(() => null)
        .finally(() => {
          inflightRef.current.delete(key);
        });
      inflightRef.current.set(key, promise);
      return promise;
    },
    [projectId],
  );

  const getCached = useCallback((id: TicketId): Ticket | undefined => {
    return cacheRef.current.get(id as string);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        Sub-tickets ({subTickets.length})
      </h3>
      <div className="flex flex-col gap-1">
        {subTickets.map((sub) => (
          <DraggableSubTicket
            key={sub.id}
            sub={sub}
            isSelected={selectedTicketIds.has(sub.id)}
            onNavigate={() => {
              clearSelection();
              onNavigateToTicket(sub.id);
            }}
            onMultiSelectClick={handleSubTicketMultiSelectClick}
            onMoveToBoardRequest={onMoveToBoardRequest}
            onArchiveRequest={onArchiveRequest}
            selectedTicketIds={selectedTicketIds}
            selectedTickets={selectedSubTickets}
            fetchPreview={fetchPreview}
            getCached={getCached}
          />
        ))}
      </div>
    </div>
  );
}

function DraggableSubTicket({
  sub,
  isSelected,
  onNavigate,
  onMultiSelectClick,
  onMoveToBoardRequest,
  onArchiveRequest,
  selectedTicketIds,
  selectedTickets,
  fetchPreview,
  getCached,
}: {
  sub: TicketSummary;
  isSelected: boolean;
  onNavigate: () => void;
  onMultiSelectClick: (e: React.MouseEvent, sub: TicketSummary) => void;
  onMoveToBoardRequest: (tickets: readonly TicketSummary[]) => void;
  onArchiveRequest: (tickets: readonly TicketSummary[]) => void;
  selectedTicketIds: ReadonlySet<TicketId>;
  selectedTickets: readonly TicketSummary[];
  fetchPreview: (id: TicketId) => Promise<Ticket | null>;
  getCached: (id: TicketId) => Ticket | undefined;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: sub.id,
    data: { ticket: sub, status: sub.status },
  });
  const handleContextMenu = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const api = ensureNativeApi();
      const selection =
        selectedTicketIds.has(sub.id) && selectedTickets.length > 0 ? selectedTickets : [sub];
      const clicked = await api.contextMenu.show(
        [
          {
            id: "move-to-board",
            label: selection.length > 1 ? "Move all tickets to the board" : "Move to board",
          },
          {
            id: "archive",
            label: selection.length > 1 ? `Archive (${selection.length})` : "Archive",
          },
        ],
        {
          x: e.clientX,
          y: e.clientY,
        },
      );
      if (clicked === "move-to-board") {
        onMoveToBoardRequest(selection);
      } else if (clicked === "archive") {
        onArchiveRequest(selection);
      }
    },
    [onArchiveRequest, onMoveToBoardRequest, selectedTicketIds, selectedTickets, sub],
  );

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={150}
        render={
          <SubTicketRowButton
            subTicket={sub}
            isSelected={isSelected}
            isDragging={isDragging}
            buttonRef={setNodeRef}
            onClick={(e) => {
              if (e.altKey || e.metaKey || e.shiftKey) {
                onMultiSelectClick(e, sub);
                return;
              }
              onNavigate();
            }}
            buttonProps={{
              "data-ticket-selectable": true,
              onContextMenu: handleContextMenu,
              ...attributes,
              ...listeners,
            }}
          />
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
          ticketId={sub.id}
          fetchPreview={fetchPreview}
          getCached={getCached}
        />
      </PopoverPopup>
    </Popover>
  );
}
