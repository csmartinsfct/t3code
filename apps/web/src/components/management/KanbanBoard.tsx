import type { TicketId, TicketStatus, TicketSummary } from "@t3tools/contracts";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";

import { useTicketing } from "../../hooks/useTicketing";
import { ensureNativeApi } from "../../nativeApi";
import { Button } from "../ui/button";
import { CreateTicketDialog } from "../settings/CreateTicketDialog";
import { ALL_STATUSES } from "../settings/ticketUtils";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanTicketDetail } from "./KanbanTicketDetail";

interface KanbanBoardProps {
  projectId: string;
  onDropOnChat?: (ticket: TicketSummary) => void;
}

export interface KanbanBoardHandle {
  handleDragEnd: (event: DragEndEvent) => void;
}

export const KanbanBoard = forwardRef<KanbanBoardHandle, KanbanBoardProps>(function KanbanBoard(
  { projectId, onDropOnChat },
  ref,
) {
  const { tickets, loading, applyLocalReorder } = useTicketing({ projectId });
  const [selectedTicketId, setSelectedTicketId] = useState<TicketId | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

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
      grouped[ticket.status]?.push(ticket);
    }
    for (const status of ALL_STATUSES) {
      grouped[status].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return grouped;
  }, [tickets]);

  // Keep a ref so the drag-end handler always sees the latest grouped tickets
  const ticketsByStatusRef = useRef(ticketsByStatus);
  ticketsByStatusRef.current = ticketsByStatus;

  const handleBoardDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !active.data.current) return;

      const ticket = (active.data.current as { ticket: TicketSummary }).ticket;
      const sourceStatus = (active.data.current as { status: TicketStatus }).status;
      const overId = String(over.id);

      // --- Drop on chat ---
      if (overId === "chat-composer") {
        onDropOnChat?.(ticket);
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
        applyLocalReorder(
          items.map((item) => (item.id === ticket.id ? { ...item, status: targetStatus } : item)),
        );
        // Persist: update status for the moved ticket, reorder the full column
        void api.ticketing.update({
          id: ticket.id as never,
          status: targetStatus as never,
          sortOrder: (overIndex * 1000) as never,
        });
        void api.ticketing.reorder({ items: items as never });
      }
    },
    [applyLocalReorder, onDropOnChat],
  );

  useImperativeHandle(ref, () => ({ handleDragEnd: handleBoardDragEnd }), [handleBoardDragEnd]);

  const handleTicketClick = useCallback((ticketId: TicketId) => {
    setSelectedTicketId(ticketId);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedTicketId(null);
  }, []);

  const handleNavigateToTicket = useCallback((ticketId: TicketId) => {
    setSelectedTicketId(ticketId);
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Board header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        {selectedTicketId ? (
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={handleBack}
          >
            <ArrowLeftIcon className="size-3" />
            Back to board
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
