import type {
  ModelSelection,
  Ticket,
  TicketId,
  TicketStatus,
  TicketSummary,
} from "@t3tools/contracts";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { ArrowLeftIcon } from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";

import type { ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { isElectron } from "../../env";
import { useTicketing } from "../../hooks/useTicketing";
import { useTicketSelectionStore } from "../../ticketSelectionStore";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "../../nativeApi";
import { ALL_STATUSES } from "../settings/ticketUtils";
import type { EpicProgress } from "./KanbanCard";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanSelectionBar } from "./KanbanSelectionBar";
import { KanbanTicketDetail } from "./KanbanTicketDetail";
import { OrchestrateConfirmDialog } from "./OrchestrateConfirmDialog";

interface KanbanBoardProps {
  projectId: string;
  onDropOnChat?: (tickets: TicketSummary[]) => void;
}

export interface KanbanBoardHandle {
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleDragCancel: () => void;
}

export const KanbanBoard = forwardRef<KanbanBoardHandle, KanbanBoardProps>(function KanbanBoard(
  { projectId, onDropOnChat },
  ref,
) {
  const { tickets, loading, applyLocalReorder } = useTicketing({ projectId });
  const [ticketStack, setTicketStack] = useState<TicketId[]>([]);
  const selectedTicketId = ticketStack.length > 0 ? ticketStack[ticketStack.length - 1] : null;

  const selectedTicketIds = useTicketSelectionStore((s) => s.selectedTicketIds);
  const selectedTickets = useTicketSelectionStore((s) => s.selectedTickets);
  const toggleTicket = useTicketSelectionStore((s) => s.toggleTicket);
  const rangeSelectTo = useTicketSelectionStore((s) => s.rangeSelectTo);
  const clearSelection = useTicketSelectionStore((s) => s.clearSelection);

  const navigate = useNavigate();

  // Orchestration dialog state
  const [orchestrateDialogOpen, setOrchestrateDialogOpen] = useState(false);
  const [orchestrateTickets, setOrchestrateTickets] = useState<
    ReadonlyMap<TicketId, TicketSummary>
  >(new Map());

  const ticketsByStatus = useMemo(() => {
    const grouped: Record<TicketStatus, TicketSummary[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      blocked: [],
      in_review: [],
      done: [],
      canceled: [],
    };
    for (const ticket of tickets) {
      // Skip subtickets — they belong to an epic and shouldn't appear on the board
      if (ticket.parentId) continue;
      grouped[ticket.status]?.push(ticket);
    }
    for (const status of ALL_STATUSES) {
      grouped[status].sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    }
    return grouped;
  }, [tickets]);

  // Compute epic progress: for each ticket with sub-tickets, count how many are done
  const epicProgressMap = useMemo(() => {
    const map = new Map<string, EpicProgress>();
    const epics = tickets.filter((t) => t.subTicketCount > 0);
    if (epics.length === 0) return map;

    const epicIds = new Set(epics.map((e) => e.id));
    // Group children by parentId
    const childrenByParent = new Map<string, TicketSummary[]>();
    for (const t of tickets) {
      if (t.parentId && epicIds.has(t.parentId)) {
        const list = childrenByParent.get(t.parentId);
        if (list) list.push(t);
        else childrenByParent.set(t.parentId, [t]);
      }
    }

    for (const epic of epics) {
      const children = childrenByParent.get(epic.id) ?? [];
      const completed = children.filter((c) => c.status === "done").length;
      map.set(epic.id, { completed, total: epic.subTicketCount });
    }
    return map;
  }, [tickets]);

  // Keep refs so the drag-end handler always sees the latest data
  const ticketsByStatusRef = useRef(ticketsByStatus);
  ticketsByStatusRef.current = ticketsByStatus;

  const ticketsRef = useRef(tickets);
  ticketsRef.current = tickets;

  const flatOrderedTickets = useMemo(() => {
    return ALL_STATUSES.flatMap((s) => ticketsByStatus[s]);
  }, [ticketsByStatus]);

  const handleTicketMultiSelectClick = useCallback(
    (e: React.MouseEvent, ticket: TicketSummary) => {
      if (e.altKey || e.metaKey) {
        e.preventDefault();
        toggleTicket(ticket.id, ticket);
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        rangeSelectTo(ticket.id, flatOrderedTickets);
        return;
      }
    },
    [toggleTicket, rangeSelectTo, flatOrderedTickets],
  );

  // ---------------------------------------------------------------------------
  // Context menu & orchestration handlers
  // ---------------------------------------------------------------------------

  const handleCardContextMenu = useCallback(
    async (e: React.MouseEvent, ticket: TicketSummary) => {
      const api = ensureNativeApi();
      const isInSelection = selectedTicketIds.has(ticket.id);
      const count = isInSelection ? selectedTicketIds.size : 1;
      const label = count > 1 ? `Orchestrate (${count})` : "Orchestrate";

      const clicked = await api.contextMenu.show([{ id: "orchestrate", label }], {
        x: e.clientX,
        y: e.clientY,
      });

      if (clicked === "orchestrate") {
        if (isInSelection && selectedTicketIds.size > 0) {
          setOrchestrateTickets(new Map(selectedTickets));
        } else {
          setOrchestrateTickets(new Map([[ticket.id, ticket]]));
        }
        setOrchestrateDialogOpen(true);
      }
    },
    [selectedTicketIds, selectedTickets],
  );

  const openOrchestrateForSelection = useCallback(() => {
    setOrchestrateTickets(new Map(selectedTickets));
    setOrchestrateDialogOpen(true);
  }, [selectedTickets]);

  const handleOrchestrateFromDetail = useCallback((ticket: Ticket) => {
    const summary: TicketSummary = {
      id: ticket.id,
      projectId: ticket.projectId,
      parentId: ticket.parentId,
      ticketNumber: ticket.ticketNumber,
      identifier: ticket.identifier,
      title: ticket.title,
      status: ticket.status,
      priority: ticket.priority,
      sortOrder: ticket.sortOrder,
      isArchived: ticket.isArchived,
      worktree: ticket.worktree,
      labels: ticket.labels,
      subTicketCount: ticket.subTickets.length,
      dependencyCount: ticket.dependencies.length,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    } as TicketSummary;
    setOrchestrateTickets(new Map([[ticket.id, summary]]));
    setOrchestrateDialogOpen(true);
  }, []);

  const handleConfirmOrchestrate = useCallback(
    async (
      ticketIdentifiers: string[],
      implementerModelSelection: ModelSelection,
      reviewerModelSelection: ModelSelection,
    ) => {
      const api = ensureNativeApi();
      const result = await api.orchestration.createRun({
        projectId: projectId as ProjectId,
        ticketIdentifiers: ticketIdentifiers as never,
        implementerModelSelection,
        reviewerModelSelection,
      });
      await api.orchestration.startRun({ runId: result.runId });
      clearSelection();
      void navigate({
        to: "/$threadId",
        params: { threadId: result.orchestrationThreadId },
      });
    },
    [projectId, navigate, clearSelection],
  );

  // ---------------------------------------------------------------------------
  // Drag-and-drop handlers
  // ---------------------------------------------------------------------------

  // Track the original column so we can detect cross-column moves and revert on cancel
  const dragOriginalStatusRef = useRef<TicketStatus | null>(null);
  const dragActiveIdRef = useRef<string | null>(null);

  const findTicketColumn = (ticketId: string): TicketStatus | null => {
    for (const s of ALL_STATUSES) {
      if (ticketsByStatusRef.current[s].some((t) => t.id === ticketId)) return s;
    }
    return null;
  };

  const revertToOriginalColumn = useCallback(
    (ticketId: string, originalStatus: TicketStatus) => {
      const currentStatus = findTicketColumn(ticketId);
      if (!currentStatus || currentStatus === originalStatus) return;
      const source = ticketsByStatusRef.current[currentStatus];
      const target = ticketsByStatusRef.current[originalStatus];
      const movedTicket = source.find((t) => t.id === ticketId);
      if (!movedTicket) return;
      const updates: Array<{ id: string; sortOrder: number; status?: string }> = [];
      const sourceWithout = source.filter((t) => t.id !== ticketId);
      for (let i = 0; i < sourceWithout.length; i++) {
        updates.push({ id: sourceWithout[i]!.id, sortOrder: i * 1000 });
      }
      const targetWith = [...target, movedTicket];
      for (let i = 0; i < targetWith.length; i++) {
        updates.push({
          id: targetWith[i]!.id,
          sortOrder: i * 1000,
          ...(targetWith[i]!.id === ticketId ? { status: originalStatus } : {}),
        });
      }
      applyLocalReorder(updates);
    },
    [applyLocalReorder],
  );

  const handleBoardDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { status: TicketStatus } | undefined;
    dragOriginalStatusRef.current = data?.status ?? null;
    dragActiveIdRef.current = String(event.active.id);
  }, []);

  // Move items between columns during drag so the target SortableContext includes
  // the dragged ID and cards animate to make room.
  const handleBoardDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over || !active.data.current) return;

      const activeId = String(active.id);
      const overId = String(over.id);
      if (overId === "chat-composer") return;

      const activeStatus = findTicketColumn(activeId);
      if (!activeStatus) return;

      let overStatus: TicketStatus;
      if (overId.startsWith("column:")) {
        overStatus = overId.replace("column:", "") as TicketStatus;
      } else {
        const overData = over.data.current as { status?: TicketStatus } | undefined;
        overStatus = overData?.status ?? activeStatus;
      }

      if (activeStatus === overStatus) return;

      const sourceColumn = ticketsByStatusRef.current[activeStatus];
      const targetColumn = ticketsByStatusRef.current[overStatus];
      const activeTicket = sourceColumn.find((t) => t.id === activeId);
      if (!activeTicket) return;

      let insertIndex: number;
      if (overId.startsWith("column:")) {
        insertIndex = targetColumn.length;
      } else {
        insertIndex = targetColumn.findIndex((t) => t.id === overId);
        if (insertIndex === -1) insertIndex = targetColumn.length;
      }

      const updates: Array<{ id: string; sortOrder: number; status?: string }> = [];
      const sourceWithout = sourceColumn.filter((t) => t.id !== activeId);
      for (let i = 0; i < sourceWithout.length; i++) {
        updates.push({ id: sourceWithout[i]!.id, sortOrder: i * 1000 });
      }
      const targetWith = [...targetColumn];
      targetWith.splice(insertIndex, 0, activeTicket);
      for (let i = 0; i < targetWith.length; i++) {
        updates.push({
          id: targetWith[i]!.id,
          sortOrder: i * 1000,
          ...(targetWith[i]!.id === activeId ? { status: overStatus } : {}),
        });
      }
      applyLocalReorder(updates);
    },
    [applyLocalReorder],
  );

  const handleBoardDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const originalStatus = dragOriginalStatusRef.current;
      dragOriginalStatusRef.current = null;
      dragActiveIdRef.current = null;

      if (!over || !active.data.current || !originalStatus) return;

      const ticket = (active.data.current as { ticket: TicketSummary }).ticket;
      const overId = String(over.id);

      // --- Drop on chat ---
      if (overId === "chat-composer") {
        revertToOriginalColumn(ticket.id, originalStatus);
        const selStore = useTicketSelectionStore.getState();
        if (selStore.selectedTicketIds.has(ticket.id)) {
          onDropOnChat?.([...selStore.selectedTickets.values()]);
        } else {
          onDropOnChat?.([ticket]);
        }
        return;
      }

      // The item may have already been moved cross-column by onDragOver.
      // Determine its current column and do a final position adjustment.
      const currentStatus = findTicketColumn(ticket.id) ?? originalStatus;
      const column = [...ticketsByStatusRef.current[currentStatus]];
      const currentIndex = column.findIndex((t) => t.id === ticket.id);

      // Final same-column position adjustment from the drop target
      let finalColumn = column;
      if (!overId.startsWith("column:")) {
        const overIndex = column.findIndex((t) => t.id === overId);
        if (overIndex >= 0 && overIndex !== currentIndex && currentIndex >= 0) {
          finalColumn = arrayMove(column, currentIndex, overIndex);
        }
      }

      // Persist column order
      const items = finalColumn.map((t, i) => ({ id: t.id, sortOrder: i * 1000 }));
      applyLocalReorder(items);
      const api = ensureNativeApi();
      void api.ticketing.reorder({ items: items as never });

      // Persist status change + epic cascade
      if (currentStatus !== originalStatus) {
        void api.ticketing.update({
          id: ticket.id as never,
          status: currentStatus as never,
        });

        if (ticket.subTicketCount > 0) {
          const cascadeSubTickets = ticketsRef.current.filter(
            (t) => t.parentId === ticket.id && t.status === originalStatus,
          );
          if (cascadeSubTickets.length > 0) {
            const cascadeUpdates = cascadeSubTickets.map((sub) => ({
              id: sub.id,
              sortOrder: sub.sortOrder,
              status: currentStatus,
            }));
            applyLocalReorder(cascadeUpdates);
            for (const sub of cascadeSubTickets) {
              void api.ticketing.update({
                id: sub.id as never,
                status: currentStatus as never,
              });
            }
          }
        }
      }
    },
    [applyLocalReorder, onDropOnChat, revertToOriginalColumn],
  );

  const handleBoardDragCancel = useCallback(() => {
    const originalStatus = dragOriginalStatusRef.current;
    const activeId = dragActiveIdRef.current;
    dragOriginalStatusRef.current = null;
    dragActiveIdRef.current = null;
    if (originalStatus && activeId) {
      revertToOriginalColumn(activeId, originalStatus);
    }
  }, [revertToOriginalColumn]);

  useImperativeHandle(
    ref,
    () => ({
      handleDragStart: handleBoardDragStart,
      handleDragOver: handleBoardDragOver,
      handleDragEnd: handleBoardDragEnd,
      handleDragCancel: handleBoardDragCancel,
    }),
    [handleBoardDragStart, handleBoardDragOver, handleBoardDragEnd, handleBoardDragCancel],
  );

  const handleTicketClick = useCallback(
    (ticketId: TicketId) => {
      clearSelection();
      setTicketStack([ticketId]);
    },
    [clearSelection],
  );

  const handleBack = useCallback(() => {
    clearSelection();
    setTicketStack((prev) => prev.slice(0, -1));
  }, [clearSelection]);

  const handleNavigateToTicket = useCallback(
    (ticketId: TicketId) => {
      clearSelection();
      setTicketStack((prev) => [...prev, ticketId]);
    },
    [clearSelection],
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Board header */}
      <div
        className={cn(
          "flex items-center justify-between border-b border-border px-3 sm:px-5",
          isElectron ? "drag-region h-[52px]" : "py-2 sm:py-3",
        )}
      >
        {selectedTicketId ? (
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={handleBack}
          >
            <ArrowLeftIcon className="size-3" />
            Back
          </button>
        ) : (
          <h2 className="text-xs font-medium text-foreground">Board</h2>
        )}
      </div>

      {/* Board body */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-muted-foreground">Loading...</p>
        </div>
      ) : selectedTicketId ? (
        <KanbanTicketDetail
          ticketId={selectedTicketId}
          projectId={projectId}
          onBack={handleBack}
          onNavigateToTicket={handleNavigateToTicket}
          onOrchestrate={handleOrchestrateFromDetail}
        />
      ) : (
        <div className="relative flex min-h-0 flex-1 overflow-x-auto">
          {ALL_STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tickets={ticketsByStatus[status]}
              epicProgressMap={epicProgressMap}
              selectedTicketIds={selectedTicketIds}
              onMultiSelectClick={handleTicketMultiSelectClick}
              onCardContextMenu={handleCardContextMenu}
              onTicketClick={handleTicketClick}
            />
          ))}
          {selectedTicketIds.size > 0 && (
            <KanbanSelectionBar
              selectedCount={selectedTicketIds.size}
              onOrchestrate={openOrchestrateForSelection}
              onClear={clearSelection}
            />
          )}
        </div>
      )}

      <OrchestrateConfirmDialog
        open={orchestrateDialogOpen}
        onOpenChange={setOrchestrateDialogOpen}
        selectedTickets={orchestrateTickets}
        allTickets={tickets}
        projectId={projectId}
        onConfirm={handleConfirmOrchestrate}
      />
    </div>
  );
});
