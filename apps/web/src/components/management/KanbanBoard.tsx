import type { TicketId, TicketStatus, TicketSummary } from "@t3tools/contracts";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";

import { isElectron } from "../../env";
import { useTicketing } from "../../hooks/useTicketing";
import { useTicketSelectionStore } from "../../ticketSelectionStore";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "../../nativeApi";
import { Button } from "../ui/button";
import { CreateTicketDialog } from "../settings/CreateTicketDialog";
import { ALL_STATUSES } from "../settings/ticketUtils";
import type { EpicProgress } from "./KanbanCard";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanTicketDetail } from "./KanbanTicketDetail";

interface KanbanBoardProps {
  projectId: string;
  onDropOnChat?: (tickets: TicketSummary[]) => void;
}

export interface KanbanBoardHandle {
  handleDragEnd: (event: DragEndEvent) => void;
}

export const KanbanBoard = forwardRef<KanbanBoardHandle, KanbanBoardProps>(function KanbanBoard(
  { projectId, onDropOnChat },
  ref,
) {
  const { tickets, loading, applyLocalReorder } = useTicketing({ projectId });
  const [ticketStack, setTicketStack] = useState<TicketId[]>([]);
  const selectedTicketId = ticketStack.length > 0 ? ticketStack[ticketStack.length - 1] : null;
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const selectedTicketIds = useTicketSelectionStore((s) => s.selectedTicketIds);
  const toggleTicket = useTicketSelectionStore((s) => s.toggleTicket);
  const clearSelection = useTicketSelectionStore((s) => s.clearSelection);

  const ticketsByStatus = useMemo(() => {
    const grouped: Record<TicketStatus, TicketSummary[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
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
      grouped[status].sort((a, b) => a.sortOrder - b.sortOrder);
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

  const handleShiftClickTicket = useCallback(
    (ticket: TicketSummary) => {
      toggleTicket(ticket.id, ticket);
    },
    [toggleTicket],
  );

  const handleBoardDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !active.data.current) return;

      const ticket = (active.data.current as { ticket: TicketSummary }).ticket;
      const sourceStatus = (active.data.current as { status: TicketStatus }).status;
      const overId = String(over.id);

      // --- Drop on chat ---
      if (overId === "chat-composer") {
        const selStore = useTicketSelectionStore.getState();
        if (selStore.selectedTicketIds.has(ticket.id)) {
          onDropOnChat?.([...selStore.selectedTickets.values()]);
        } else {
          onDropOnChat?.([ticket]);
        }
        return;
      }

      // --- Determine target status and index ---
      let targetStatus: TicketStatus;
      let overIndex: number;

      if (overId.startsWith("column:")) {
        // Dropped on the column background (empty area) — append to end
        targetStatus = overId.replace("column:", "") as TicketStatus;
        overIndex = ticketsByStatusRef.current[targetStatus].length;
      } else {
        // Dropped on another ticket
        const overData = over.data.current as { status?: TicketStatus } | undefined;
        targetStatus = overData?.status ?? sourceStatus;
        const column = ticketsByStatusRef.current[targetStatus];
        overIndex = column.findIndex((t) => t.id === overId);
        if (overIndex === -1) overIndex = column.length;
      }

      const api = ensureNativeApi();

      if (targetStatus === sourceStatus) {
        // --- Same column reorder ---
        const column = [...ticketsByStatusRef.current[sourceStatus]];
        const fromIndex = column.findIndex((t) => t.id === ticket.id);
        if (fromIndex === -1 || fromIndex === overIndex) return;

        const reordered = arrayMove(column, fromIndex, overIndex);
        const items = reordered.map((t, i) => ({ id: t.id, sortOrder: i * 1000 }));
        applyLocalReorder(items);
        void api.ticketing.reorder({ items: items as never });
      } else {
        // --- Cross-column move ---
        // Insert into target column at the drop index
        const targetColumn = [...ticketsByStatusRef.current[targetStatus]];
        targetColumn.splice(overIndex, 0, ticket);
        const items = targetColumn.map((t, i) => ({ id: t.id, sortOrder: i * 1000 }));

        // Optimistically update local state
        const localUpdates: Array<{ id: string; sortOrder: number; status?: string }> = items.map(
          (item) => (item.id === ticket.id ? { ...item, status: targetStatus } : item),
        );

        // Epic cascade: move sub-tickets that match the source status
        const cascadeSubTickets =
          ticket.subTicketCount > 0
            ? ticketsRef.current.filter(
                (t) => t.parentId === ticket.id && t.status === sourceStatus,
              )
            : [];
        for (const sub of cascadeSubTickets) {
          localUpdates.push({ id: sub.id, sortOrder: sub.sortOrder, status: targetStatus });
        }

        applyLocalReorder(localUpdates);

        // Persist: update status for the moved ticket, reorder the full column
        void api.ticketing.update({
          id: ticket.id as never,
          status: targetStatus as never,
          sortOrder: (overIndex * 1000) as never,
        });
        void api.ticketing.reorder({ items: items as never });

        // Persist sub-ticket status changes
        for (const sub of cascadeSubTickets) {
          void api.ticketing.update({
            id: sub.id as never,
            status: targetStatus as never,
          });
        }
      }
    },
    [applyLocalReorder, onDropOnChat],
  );

  useImperativeHandle(ref, () => ({ handleDragEnd: handleBoardDragEnd }), [handleBoardDragEnd]);

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
        <Button size="xs" variant="outline" onClick={() => setCreateDialogOpen(true)}>
          <PlusIcon className="size-3.5" />
          New ticket
        </Button>
      </div>

      {/* Board body */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-muted-foreground">Loading...</p>
        </div>
      ) : selectedTicketId ? (
        <KanbanTicketDetail
          ticketId={selectedTicketId}
          onBack={handleBack}
          onNavigateToTicket={handleNavigateToTicket}
        />
      ) : (
        <div className="flex min-h-0 flex-1 overflow-x-auto">
          {ALL_STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tickets={ticketsByStatus[status]}
              epicProgressMap={epicProgressMap}
              selectedTicketIds={selectedTicketIds}
              onShiftClickTicket={handleShiftClickTicket}
              onTicketClick={handleTicketClick}
            />
          ))}
        </div>
      )}

      <CreateTicketDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        projectId={projectId}
      />
    </div>
  );
});
