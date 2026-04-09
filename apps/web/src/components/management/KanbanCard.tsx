import type { TicketStatus, TicketSummary } from "@t3tools/contracts";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { PRIORITY_CONFIG } from "../settings/ticketUtils";

export interface EpicProgress {
  completed: number;
  total: number;
}

interface KanbanCardProps {
  ticket: TicketSummary;
  status: TicketStatus;
  epicProgress?: EpicProgress | undefined;
  isSelected?: boolean | undefined;
  onMultiSelectClick?: ((e: React.MouseEvent, ticket: TicketSummary) => void) | undefined;
  onContextMenu?: ((e: React.MouseEvent, ticket: TicketSummary) => void) | undefined;
  onClick: () => void;
}

export function KanbanCard({
  ticket,
  status,
  epicProgress,
  isSelected,
  onMultiSelectClick,
  onContextMenu,
  onClick,
}: KanbanCardProps) {
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
      data-ticket-selectable
      className={`flex w-full flex-col gap-1.5 rounded-md border px-2.5 py-2 text-left transition-colors ${
        isSelected
          ? "border-primary/40 bg-primary/5 ring-1.5 ring-primary/40"
          : "border-border/70 bg-card hover:bg-accent/50"
      } ${isDragging ? "opacity-40" : ""}`}
      style={style}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(e, ticket);
        }
      }}
      onClick={(e) => {
        if ((e.altKey || e.metaKey || e.shiftKey) && onMultiSelectClick) {
          onMultiSelectClick(e, ticket);
          return;
        }
        onClick();
      }}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">{ticket.identifier}</span>
        {ticket.priority !== "none" && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <div className={`size-1.5 rounded-full ${priorityCfg.dotClass}`} />
            {priorityCfg.label.toLowerCase()}
          </span>
        )}
      </div>
      <span className="text-xs font-medium text-foreground">{ticket.title}</span>
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
      {epicProgress && (
        <div className="flex items-center justify-end gap-1 pt-0.5">
          <div className="flex h-1 w-10 overflow-hidden rounded-full bg-muted/50">
            <div
              className="h-full rounded-full bg-emerald-500/80 transition-all"
              style={{
                width: `${epicProgress.total > 0 ? (epicProgress.completed / epicProgress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
            {epicProgress.completed}/{epicProgress.total}
          </span>
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
      <p className="mt-0.5 text-xs font-medium text-foreground">{ticket.title}</p>
    </div>
  );
}

/** Stacked preview for multi-drag overlay. */
export function KanbanMultiCardOverlay({ tickets }: { tickets: TicketSummary[] }) {
  const first = tickets[0];
  if (!first) return null;
  return (
    <div className="relative">
      {tickets.length > 2 && (
        <div className="absolute left-1.5 top-1.5 w-60 rounded-md border border-border/40 bg-card/50 px-2.5 py-2" />
      )}
      <div className="absolute left-0.5 top-0.5 w-60 rounded-md border border-border/60 bg-card/70 px-2.5 py-2 shadow-sm" />
      <div className="relative w-60 rounded-md border border-border bg-card px-2.5 py-2 shadow-lg">
        <span className="font-mono text-[10px] text-muted-foreground">{first.identifier}</span>
        <p className="mt-0.5 text-xs font-medium text-foreground">{first.title}</p>
        <div className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow">
          {tickets.length}
        </div>
      </div>
    </div>
  );
}
