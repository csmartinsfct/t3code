import type { TicketId, TicketStatus, TicketSummary } from "@t3tools/contracts";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";

import { STATUS_CONFIG } from "../settings/ticketUtils";
import type { BoardViewMode } from "../../uiStateStore";
import type { EpicProgress } from "./KanbanCard";
import { KanbanCard } from "./KanbanCard";

interface KanbanColumnProps {
  status: TicketStatus;
  tickets: TicketSummary[];
  epicProgressMap: ReadonlyMap<string, EpicProgress>;
  selectedTicketIds: ReadonlySet<string>;
  onMultiSelectClick: (e: React.MouseEvent, ticket: TicketSummary) => void;
  onCardContextMenu: (e: React.MouseEvent, ticket: TicketSummary) => void;
  onTicketClick: (ticketId: TicketId) => void;
  viewMode: BoardViewMode;
}

export function KanbanColumn({
  status,
  tickets,
  epicProgressMap,
  selectedTicketIds,
  onMultiSelectClick,
  onCardContextMenu,
  onTicketClick,
  viewMode,
}: KanbanColumnProps) {
  const cfg = STATUS_CONFIG[status];
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}`, data: { status } });

  return (
    <div className="flex h-full w-64 shrink-0 flex-col">
      <div className="flex items-center gap-2 px-1 py-2">
        <div className={`size-2.5 rounded-full ${cfg.dotClass}`} />
        <span className="text-xs font-medium text-foreground">{cfg.label}</span>
        <span className="rounded-[4px] bg-muted px-1.5 py-px font-mono text-[10.5px] text-muted-foreground">
          {tickets.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto px-1 pb-2 pt-1.5 transition-colors ${
          isOver ? "bg-accent/20" : ""
        }`}
      >
        <SortableContext items={tickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className={viewMode === "list" ? "flex flex-col" : "flex flex-col gap-2"}>
            {tickets.map((ticket) => (
              <KanbanCard
                key={ticket.id}
                ticket={ticket}
                status={status}
                epicProgress={epicProgressMap.get(ticket.id)}
                isSelected={selectedTicketIds.has(ticket.id)}
                onMultiSelectClick={onMultiSelectClick}
                onContextMenu={onCardContextMenu}
                onClick={() => onTicketClick(ticket.id)}
                variant={viewMode === "list" ? "list" : "card"}
              />
            ))}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}
