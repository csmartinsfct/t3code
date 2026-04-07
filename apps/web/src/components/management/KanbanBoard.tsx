import type { TicketId, TicketStatus, TicketSummary } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useTicketing } from "../../hooks/useTicketing";
import { Button } from "../ui/button";
import { CreateTicketDialog } from "../settings/CreateTicketDialog";
import { ALL_STATUSES } from "../settings/ticketUtils";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanTicketDetail } from "./KanbanTicketDetail";

interface KanbanBoardProps {
  projectId: string;
}

export function KanbanBoard({ projectId }: KanbanBoardProps) {
  const { tickets, loading } = useTicketing({ projectId });
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
    return grouped;
  }, [tickets]);

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
        <h2 className="text-xs font-medium text-foreground">Board</h2>
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
}
