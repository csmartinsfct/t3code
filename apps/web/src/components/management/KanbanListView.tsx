import type { TicketId, TicketStatus, TicketSummary } from "@t3tools/contracts";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { ALL_STATUSES, STATUS_CONFIG } from "../settings/ticketUtils";
import type { EpicProgress } from "./KanbanCard";
import { PriorityIcon } from "./PriorityIcon";

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// KanbanListRow
// ---------------------------------------------------------------------------

interface KanbanListRowProps {
  ticket: TicketSummary;
  status: TicketStatus;
  isSelected: boolean;
  onMultiSelectClick: (e: React.MouseEvent, ticket: TicketSummary) => void;
  onCardContextMenu: (e: React.MouseEvent, ticket: TicketSummary) => void;
  onClick: () => void;
}

function KanbanListRow({
  ticket,
  status,
  isSelected,
  onMultiSelectClick,
  onCardContextMenu,
  onClick,
}: KanbanListRowProps) {
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
      className={cn(
        "flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left transition-colors",
        isSelected ? "bg-primary/5 text-foreground" : "text-foreground hover:bg-accent/50",
        isDragging && "opacity-40",
      )}
      style={style}
      onContextMenu={(e) => {
        e.preventDefault();
        onCardContextMenu(e, ticket);
      }}
      onClick={(e) => {
        if (e.altKey || e.metaKey || e.shiftKey) {
          onMultiSelectClick(e, ticket);
          return;
        }
        onClick();
      }}
      {...attributes}
      {...listeners}
    >
      <PriorityIcon priority={ticket.priority} className="size-4 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {ticket.identifier}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs">{ticket.title}</span>
      {ticket.labels.length > 0 && (
        <div className="flex shrink-0 items-center gap-1">
          {ticket.labels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: `${label.color}14`, color: label.color }}
            >
              <div className="size-1.5 rounded-full" style={{ backgroundColor: label.color }} />
              {label.name}
            </span>
          ))}
        </div>
      )}
      {ticket.worktree && (
        <span className="max-w-32 shrink-0 truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {ticket.worktree}
        </span>
      )}
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {formatShortDate(ticket.createdAt)}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// KanbanListSection
// ---------------------------------------------------------------------------

interface KanbanListSectionProps {
  status: TicketStatus;
  tickets: TicketSummary[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  selectedTicketIds: ReadonlySet<string>;
  onMultiSelectClick: (e: React.MouseEvent, ticket: TicketSummary) => void;
  onCardContextMenu: (e: React.MouseEvent, ticket: TicketSummary) => void;
  onTicketClick: (ticketId: TicketId) => void;
}

function KanbanListSection({
  status,
  tickets,
  collapsed,
  onToggleCollapsed,
  selectedTicketIds,
  onMultiSelectClick,
  onCardContextMenu,
  onTicketClick,
}: KanbanListSectionProps) {
  const cfg = STATUS_CONFIG[status];
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}`, data: { status } });

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-2 border-b border-border px-1 py-2"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
      >
        <ChevronRightIcon
          className={cn("size-3.5 text-muted-foreground", !collapsed && "rotate-90")}
        />
        <div className={cn("size-2.5 rounded-full", cfg.dotClass)} />
        <span className="text-xs font-medium text-foreground">{cfg.label}</span>
        <span className="rounded-[4px] bg-muted px-1.5 py-px font-mono text-[10.5px] text-muted-foreground">
          {tickets.length}
        </span>
      </button>
      {!collapsed && (
        <div ref={setNodeRef} className={cn(isOver && "bg-accent/20")}>
          <SortableContext items={tickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tickets.map((ticket) => (
              <KanbanListRow
                key={ticket.id}
                ticket={ticket}
                status={status}
                isSelected={selectedTicketIds.has(ticket.id)}
                onMultiSelectClick={onMultiSelectClick}
                onCardContextMenu={onCardContextMenu}
                onClick={() => onTicketClick(ticket.id)}
              />
            ))}
          </SortableContext>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KanbanListView
// ---------------------------------------------------------------------------

interface KanbanListViewProps {
  filteredTicketsByStatus: Record<TicketStatus, TicketSummary[]>;
  epicProgressMap: ReadonlyMap<string, EpicProgress>;
  selectedTicketIds: ReadonlySet<string>;
  collapsedStatuses: ReadonlyArray<string>;
  onToggleCollapsed: (status: TicketStatus) => void;
  onMultiSelectClick: (e: React.MouseEvent, ticket: TicketSummary) => void;
  onCardContextMenu: (e: React.MouseEvent, ticket: TicketSummary) => void;
  onTicketClick: (ticketId: TicketId) => void;
}

export function KanbanListView({
  filteredTicketsByStatus,
  selectedTicketIds,
  collapsedStatuses,
  onToggleCollapsed,
  onMultiSelectClick,
  onCardContextMenu,
  onTicketClick,
}: KanbanListViewProps) {
  return (
    <div className="min-h-0 w-full flex-1 overflow-y-auto pb-4">
      {ALL_STATUSES.map((status) => (
        <KanbanListSection
          key={status}
          status={status}
          tickets={filteredTicketsByStatus[status]}
          collapsed={collapsedStatuses.includes(status)}
          onToggleCollapsed={() => onToggleCollapsed(status)}
          selectedTicketIds={selectedTicketIds}
          onMultiSelectClick={onMultiSelectClick}
          onCardContextMenu={onCardContextMenu}
          onTicketClick={onTicketClick}
        />
      ))}
    </div>
  );
}
