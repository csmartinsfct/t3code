import type { TicketId, TicketStatus, TicketSummary } from "@t3tools/contracts";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";

import { STATUS_CONFIG } from "../settings/ticketUtils";
import type { EpicProgress } from "./KanbanCard";
import { KanbanCard } from "./KanbanCard";

interface KanbanColumnProps {
  status: TicketStatus;
  tickets: TicketSummary[];
  epicProgressMap: ReadonlyMap<string, EpicProgress>;
  selectedTicketIds: ReadonlySet<string>;
  onMultiSelectClick: (e: React.MouseEvent, ticket: TicketSummary) => void;
  onTicketClick: (ticketId: TicketId) => void;
}

export function KanbanColumn({
  status,
  tickets,
  epicProgressMap,
  selectedTicketIds,
  onMultiSelectClick,
  onTicketClick,
}: KanbanColumnProps) {
  const cfg = STATUS_CONFIG[status];
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}`, data: { status } });

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border last:border-r-0">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className={`size-2 rounded-full ${cfg.dotClass}`} />
        <span className="text-[11px] font-medium text-foreground">{cfg.label}</span>
        <span className="text-[10px] text-muted-foreground">{tickets.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto px-2 pb-2 transition-colors ${
          isOver ? "bg-accent/20" : ""
        }`}
      >
        <SortableContext items={tickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5">
            {tickets.map((ticket) => (
              <KanbanCard
                key={ticket.id}
                ticket={ticket}
                status={status}
                epicProgress={epicProgressMap.get(ticket.id)}
                isSelected={selectedTicketIds.has(ticket.id)}
                onMultiSelectClick={onMultiSelectClick}
                onClick={() => onTicketClick(ticket.id)}
              />
            ))}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}
