import type {
  Ticket,
  TicketId,
  TicketPriority,
  TicketStatus,
  TicketSummary,
  TicketingStreamEvent,
} from "@t3tools/contracts";
import { useDraggable } from "@dnd-kit/core";
import { EllipsisVerticalIcon, ListTreeIcon, TrashIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_RUNTIME_MODE, type ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useComposerDraftStore } from "../../composerDraftStore";
import { newThreadId } from "../../lib/utils";
import { ensureNativeApi } from "../../nativeApi";
import { useTicketSelectionStore } from "../../ticketSelectionStore";
import { TicketMarkdown } from "./TicketMarkdown";
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
import { TicketAcceptanceCriteria } from "../settings/TicketAcceptanceCriteria";
import { TicketComments } from "../settings/TicketComments";
import { TicketHistory } from "../settings/TicketHistory";
import {
  ALL_PRIORITIES,
  ALL_STATUSES,
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  formatRelativeDate,
} from "../settings/ticketUtils";

const DECOMPOSE_PROMPT = `Decompose the attached ticket into sub-tickets.

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

interface KanbanTicketDetailProps {
  ticketId: TicketId;
  projectId: string;
  onBack: () => void;
  onNavigateToTicket: (ticketId: TicketId) => void;
}

export function KanbanTicketDetail({
  ticketId,
  projectId,
  onBack,
  onNavigateToTicket,
}: KanbanTicketDetailProps) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const ticketRef = useRef<Ticket | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [editingWorktree, setEditingWorktree] = useState(false);
  const [worktreeDraft, setWorktreeDraft] = useState("");
  const descriptionRef = useRef<HTMLDivElement>(null);
  /** Set to true when Escape is pressed so the blur handler skips saving. */
  const cancelEditRef = useRef(false);

  const fetchTicket = useCallback(async () => {
    try {
      const api = ensureNativeApi();
      const data = await api.ticketing.getById({ id: ticketId });
      ticketRef.current = data;
      setTicket(data);
    } catch (error) {
      console.error("Failed to fetch ticket:", error);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    setLoading(true);
    void fetchTicket();
  }, [fetchTicket]);

  useEffect(() => {
    const api = ensureNativeApi();
    const unsubscribe = api.ticketing.onEvent((event: TicketingStreamEvent) => {
      if (event.type === "ticket_deleted" && event.ticketId === ticketId) {
        onBack();
      } else if (event.type === "ticket_deleted") {
        // A sub-ticket was deleted — refetch if it was one of ours
        const current = ticketRef.current;
        if (current?.subTickets.some((s) => s.id === event.ticketId)) {
          void fetchTicket();
        }
      } else if (event.type === "ticket_upserted") {
        if (event.ticket.id === ticketId) {
          // The current ticket itself was updated
          void fetchTicket();
        } else if (event.ticket.parentId === ticketId) {
          // A sub-ticket was upserted
          void fetchTicket();
        } else {
          // A dependency ticket was updated
          const current = ticketRef.current;
          if (current?.dependencies.some((d) => d.dependsOnTicketId === event.ticket.id)) {
            void fetchTicket();
          }
        }
      } else if (
        (event.type === "comment_upserted" || event.type === "comment_deleted") &&
        event.ticketId === ticketId
      ) {
        void fetchTicket();
      }
    });
    return unsubscribe;
  }, [ticketId, onBack, fetchTicket]);

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
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setEditingTitle(false);
      return;
    }
    if (trimmed === ticketRef.current?.title) {
      setEditingTitle(false);
      return;
    }
    const previous = ticketRef.current;
    if (previous) {
      const optimistic = { ...previous, title: trimmed };
      ticketRef.current = optimistic;
      setTicket(optimistic);
    }
    setEditingTitle(false);
    try {
      const api = ensureNativeApi();
      const updated = await api.ticketing.update({
        id: ticketId,
        title: trimmed as never,
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

  const handleDescriptionSave = useCallback(async () => {
    const newDesc = descriptionDraft.trim() || null;
    const currentDesc = ticketRef.current?.description ?? null;
    if (newDesc === currentDesc) {
      setEditingDescription(false);
      return;
    }
    const previous = ticketRef.current;
    if (previous) {
      const optimistic = { ...previous, description: newDesc };
      ticketRef.current = optimistic;
      setTicket(optimistic);
    }
    setEditingDescription(false);
    try {
      const api = ensureNativeApi();
      const updated = await api.ticketing.update({
        id: ticketId,
        description: newDesc,
      });
      ticketRef.current = updated;
      setTicket(updated);
    } catch (error) {
      console.error("Failed to update description:", error);
      if (previous) {
        ticketRef.current = previous;
        setTicket(previous);
      }
    }
  }, [ticketId, descriptionDraft]);

  const handleWorktreeSave = useCallback(async () => {
    const newWorktree = worktreeDraft.trim() || null;
    const currentWorktree = ticketRef.current?.worktree ?? null;
    if (newWorktree === currentWorktree) {
      setEditingWorktree(false);
      return;
    }
    const previous = ticketRef.current;
    if (previous) {
      const optimistic = { ...previous, worktree: newWorktree };
      ticketRef.current = optimistic;
      setTicket(optimistic);
    }
    setEditingWorktree(false);
    try {
      const api = ensureNativeApi();
      const updated = await api.ticketing.update({
        id: ticketId,
        worktree: newWorktree,
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
      onBack();
    } catch (error) {
      console.error("Failed to delete ticket:", error);
    }
  }, [ticketId, onBack]);

  const navigate = useNavigate();

  const handleDecompose = useCallback(() => {
    if (!ticket) return;

    const {
      clearProjectDraftThreadId,
      setProjectDraftThreadId,
      applyStickyState,
      setPrompt,
      addTicketAttachment,
    } = useComposerDraftStore.getState();

    const typedProjectId = projectId as ProjectId;

    clearProjectDraftThreadId(typedProjectId);

    const threadId = newThreadId();
    setProjectDraftThreadId(typedProjectId, threadId, {
      createdAt: new Date().toISOString(),
      envMode: "local",
      runtimeMode: DEFAULT_RUNTIME_MODE,
    });
    applyStickyState(threadId);

    addTicketAttachment(threadId, {
      id: ticket.id,
      identifier: ticket.identifier,
      title: ticket.title,
    });
    setPrompt(threadId, DECOMPOSE_PROMPT);

    void navigate({ to: "/$threadId", params: { threadId } });
  }, [ticket, projectId, navigate]);

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
  const priorityCfg = PRIORITY_CONFIG[ticket.priority];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-8">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <span className="font-mono text-[11px] text-muted-foreground">
                {ticket.identifier}
              </span>
              <input
                type="text"
                className="mt-0.5 w-full cursor-text bg-transparent font-[inherit]! text-sm font-medium text-foreground outline-none"
                value={editingTitle ? titleDraft : ticket.title}
                onFocus={() => {
                  setTitleDraft(ticket.title);
                  setEditingTitle(true);
                }}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  if (cancelEditRef.current) {
                    cancelEditRef.current = false;
                    setEditingTitle(false);
                  } else if (editingTitle) {
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
                <MenuItem onClick={handleDecompose}>
                  <ListTreeIcon className="size-3.5" />
                  Decompose
                </MenuItem>
                <MenuSeparator />
                <MenuItem variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
                  <TrashIcon className="size-3.5" />
                  Delete
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>

          {/* Status + Priority inline selectors */}
          <div className="flex items-center gap-3">
            <Select
              value={ticket.status}
              onValueChange={(v) => void handleStatusChange(v as TicketStatus)}
            >
              <SelectTrigger
                size="xs"
                variant="ghost"
                className="h-auto gap-0 border-none px-0 py-0 shadow-none"
              >
                <Badge size="sm" variant={statusCfg.badgeVariant}>
                  <SelectValue />
                </Badge>
              </SelectTrigger>
              <SelectPopup>
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
                <div className={`size-2 rounded-full ${priorityCfg.dotClass}`} />
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {ALL_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    <div className="flex items-center gap-2">
                      <div className={`size-2 rounded-full ${PRIORITY_CONFIG[p].dotClass}`} />
                      {PRIORITY_CONFIG[p].label}
                    </div>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>

            <span className="text-border">|</span>
            <span className="text-[11px] text-muted-foreground">
              Created {formatRelativeDate(ticket.createdAt)}
            </span>
          </div>
        </div>

        {/* Description */}
        <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2">
          <p className="text-[11px] font-medium text-muted-foreground">Description</p>
          {editingDescription ? (
            <textarea
              className="mt-0.5 w-full resize-y bg-transparent font-[inherit]! text-xs leading-relaxed text-foreground outline-none"
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              onBlur={() => {
                if (cancelEditRef.current) {
                  cancelEditRef.current = false;
                  setEditingDescription(false);
                } else {
                  void handleDescriptionSave();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  cancelEditRef.current = true;
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
              autoFocus
              style={{
                minHeight: descriptionRef.current
                  ? `${descriptionRef.current.offsetHeight}px`
                  : undefined,
              }}
              rows={Math.max(3, descriptionDraft.split("\n").length + 1)}
            />
          ) : ticket.description ? (
            <div
              ref={descriptionRef}
              className="mt-0.5 cursor-text text-foreground"
              onClick={() => {
                setDescriptionDraft(ticket.description ?? "");
                setEditingDescription(true);
              }}
            >
              <TicketMarkdown>{ticket.description}</TicketMarkdown>
            </div>
          ) : (
            <p
              className="mt-0.5 cursor-text text-xs italic text-muted-foreground/60"
              onClick={() => {
                setDescriptionDraft("");
                setEditingDescription(true);
              }}
            >
              Click to add a description...
            </p>
          )}
        </div>

        {/* Acceptance Criteria */}
        {ticket.acceptanceCriteria && ticket.acceptanceCriteria.length > 0 && (
          <TicketAcceptanceCriteria
            ticketId={ticketId}
            criteria={ticket.acceptanceCriteria}
            onUpdated={() => void fetchTicket()}
          />
        )}

        {/* Labels */}
        {ticket.labels.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Labels</h3>
            <div className="flex flex-wrap gap-1.5">
              {ticket.labels.map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: `${label.color}14`,
                    color: label.color,
                  }}
                >
                  {label.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Dependencies */}
        {ticket.dependencies.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Dependencies ({ticket.dependencies.length})
            </h3>
            <div className="flex flex-col gap-1">
              {ticket.dependencies.map((dep) => {
                const depStatusCfg = STATUS_CONFIG[dep.status];
                return (
                  <button
                    key={dep.dependsOnTicketId}
                    type="button"
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/30"
                    onClick={() => onNavigateToTicket(dep.dependsOnTicketId)}
                  >
                    <Badge size="sm" variant={depStatusCfg.badgeVariant}>
                      {depStatusCfg.label}
                    </Badge>
                    <span className="shrink-0 text-muted-foreground">{dep.identifier}</span>
                    <span className="truncate text-foreground">{dep.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Worktree */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Worktree</h3>
          <input
            type="text"
            className={`w-full cursor-text bg-transparent font-[inherit]! text-xs outline-none ${
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
              if (cancelEditRef.current) {
                cancelEditRef.current = false;
                setEditingWorktree(false);
              } else if (editingWorktree) {
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

        {/* Sub-tickets */}
        {ticket.subTickets.length > 0 && (
          <SubTicketsList subTickets={ticket.subTickets} onNavigateToTicket={onNavigateToTicket} />
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-ticket list with drag-to-chat and Alt/Shift+click multi-select
// ---------------------------------------------------------------------------

function SubTicketsList({
  subTickets,
  onNavigateToTicket,
}: {
  subTickets: readonly TicketSummary[];
  onNavigateToTicket: (ticketId: TicketId) => void;
}) {
  const selectedTicketIds = useTicketSelectionStore((s) => s.selectedTicketIds);
  const toggleTicket = useTicketSelectionStore((s) => s.toggleTicket);
  const rangeSelectTo = useTicketSelectionStore((s) => s.rangeSelectTo);
  const clearSelection = useTicketSelectionStore((s) => s.clearSelection);

  const handleSubTicketMultiSelectClick = useCallback(
    (e: React.MouseEvent, sub: TicketSummary) => {
      if (e.altKey || e.metaKey) {
        e.preventDefault();
        toggleTicket(sub.id, sub);
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        rangeSelectTo(sub.id, subTickets);
        return;
      }
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

  const fetchPreview = useCallback(async (id: TicketId): Promise<Ticket | null> => {
    const key = id as string;
    const cached = cacheRef.current.get(key);
    if (cached) return cached;
    const existing = inflightRef.current.get(key);
    if (existing) return existing;
    const promise = ensureNativeApi()
      .ticketing.getById({ id })
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
  }, []);

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
  fetchPreview,
  getCached,
}: {
  sub: TicketSummary;
  isSelected: boolean;
  onNavigate: () => void;
  onMultiSelectClick: (e: React.MouseEvent, sub: TicketSummary) => void;
  fetchPreview: (id: TicketId) => Promise<Ticket | null>;
  getCached: (id: TicketId) => Ticket | undefined;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: sub.id,
    data: { ticket: sub, status: sub.status },
  });
  const subStatusCfg = STATUS_CONFIG[sub.status];

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={150}
        render={
          <button
            ref={setNodeRef}
            type="button"
            data-ticket-selectable
            className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
              isSelected ? "bg-primary/5 ring-1.5 ring-primary/40" : "hover:bg-accent/30"
            } ${isDragging ? "opacity-40" : ""}`}
            onClick={(e) => {
              if (e.altKey || e.metaKey || e.shiftKey) {
                onMultiSelectClick(e, sub);
                return;
              }
              onNavigate();
            }}
            {...attributes}
            {...listeners}
          />
        }
      >
        <Badge size="sm" variant={subStatusCfg.badgeVariant}>
          {subStatusCfg.label}
        </Badge>
        <span className="shrink-0 text-muted-foreground">{sub.identifier}</span>
        <span className="truncate text-foreground">{sub.title}</span>
      </PopoverTrigger>
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
