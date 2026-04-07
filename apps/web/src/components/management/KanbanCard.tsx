import type { TicketStatus, TicketSummary } from "@t3tools/contracts";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { PRIORITY_CONFIG } from "../settings/ticketUtils";

interface KanbanCardProps {
  ticket: TicketSummary;
  status: TicketStatus;
  onClick: () => void;
}

export function KanbanCard({ ticket, status, onClick }: KanbanCardProps) {
  const priorityCfg = PRIORITY_CONFIG[ticket.priority];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
    data: { ticket, status },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`flex w-full flex-col gap-1.5 rounded-md border border-border/70 bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent/50 ${
        isDragging ? "opacity-40" : ""
      }`}
      style={style}
      onClick={onClick}
      {...attributes}
      {...listeners}
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

/** Lightweight preview for the DragOverlay. */
export function KanbanCardOverlay({ ticket }: { ticket: TicketSummary }) {
  return (
    <div className="w-60 rounded-md border border-border bg-card px-2.5 py-2 shadow-lg">
      <span className="font-mono text-[10px] text-muted-foreground">{ticket.identifier}</span>
      <p className="mt-0.5 line-clamp-2 text-xs font-medium text-foreground">{ticket.title}</p>
    </div>
  );
}
