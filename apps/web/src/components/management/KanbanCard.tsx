import type { TicketSummary } from "@t3tools/contracts";

import { PRIORITY_CONFIG } from "../settings/ticketUtils";

interface KanbanCardProps {
  ticket: TicketSummary;
  onClick: () => void;
}

export function KanbanCard({ ticket, onClick }: KanbanCardProps) {
  const priorityCfg = PRIORITY_CONFIG[ticket.priority];

  return (
    <button
      type="button"
      className="flex w-full flex-col gap-1.5 rounded-md border border-border/70 bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent/50"
      onClick={onClick}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">{ticket.identifier}</span>
        {ticket.priority !== "none" && (
          <div className={`size-1.5 rounded-full ${priorityCfg.dotClass}`} />
        )}
      </div>
      <span className="line-clamp-2 text-xs font-medium text-foreground">{ticket.title}</span>
      {ticket.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ticket.labels.slice(0, 2).map((label) => (
            <span
              key={label.id}
              className="rounded-sm px-1 py-0.5 text-[9px] font-medium"
              style={{ backgroundColor: `${label.color}14`, color: label.color }}
            >
              {label.name}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
