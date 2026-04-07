import type { TicketId, TicketStatus, TicketSummary } from "@t3tools/contracts";

import { STATUS_CONFIG } from "../settings/ticketUtils";
import { KanbanCard } from "./KanbanCard";

interface KanbanColumnProps {
  status: TicketStatus;
  tickets: TicketSummary[];
  onTicketClick: (ticketId: TicketId) => void;
}

export function KanbanColumn({ status, tickets, onTicketClick }: KanbanColumnProps) {
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border last:border-r-0">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className={`size-2 rounded-full ${cfg.dotClass}`} />
        <span className="text-[11px] font-medium text-foreground">{cfg.label}</span>
        <span className="text-[10px] text-muted-foreground">{tickets.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="flex flex-col gap-1.5">
          {tickets.map((ticket) => (
            <KanbanCard key={ticket.id} ticket={ticket} onClick={() => onTicketClick(ticket.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
