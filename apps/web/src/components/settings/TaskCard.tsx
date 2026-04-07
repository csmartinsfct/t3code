import type { TicketSummary } from "@t3tools/contracts";

import { PRIORITY_CONFIG, STATUS_CONFIG, formatRelativeDate } from "./taskUtils";

interface TaskCardProps {
  ticket: TicketSummary;
  onClick: () => void;
}

export function TaskCard({ ticket, onClick }: TaskCardProps) {
  const statusCfg = STATUS_CONFIG[ticket.status];
  const priorityCfg = PRIORITY_CONFIG[ticket.priority];

  return (
    <button
      type="button"
      className="flex items-center gap-3 rounded-md border border-border/70 px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
      onClick={onClick}
    >
      <div className={`size-2 shrink-0 rounded-full ${statusCfg.dotClass}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {ticket.identifier}
          </span>
          <span className="truncate text-xs font-medium text-foreground">{ticket.title}</span>
          {ticket.labels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              className="inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: `${label.color}14`,
                color: label.color,
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {ticket.subTicketCount > 0 && (
            <>
              <span>
                {ticket.subTicketCount} sub-task{ticket.subTicketCount !== 1 ? "s" : ""}
              </span>
              <span className="text-border">|</span>
            </>
          )}
          <span>{formatRelativeDate(ticket.createdAt)}</span>
        </div>
      </div>
      {ticket.priority !== "none" && (
        <div className={`size-2 shrink-0 rounded-full ${priorityCfg.dotClass}`} />
      )}
    </button>
  );
}
