import { PlusIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Route } from "../../routes/settings.tickets.index";

import { useTicketing } from "../../hooks/useTicketing";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { CreateTicketDialog } from "./CreateTicketDialog";
import { TicketCard } from "./TicketCard";

export function TicketsPanel() {
  const navigate = useNavigate();
  const { project: initialProject } = Route.useSearch();
  const { tickets, projects, loading, selectedProjectId, setSelectedProjectId } = useTicketing({
    initialProjectId: initialProject,
  });
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleProjectChange = useCallback(
    (val: string | null) => {
      setSelectedProjectId(val || null);
      void navigate({
        to: "/settings/tickets",
        search: val ? { project: val } : {},
        replace: true,
      });
    },
    [setSelectedProjectId, navigate],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-foreground">Tickets</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Track and manage tickets across your projects.
            </p>
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setDialogOpen(true)}
            disabled={projects.length === 0}
          >
            <PlusIcon className="size-3.5" />
            New ticket
          </Button>
        </div>

        {projects.length > 1 && (
          <div className="flex items-center gap-2">
            <Select value={selectedProjectId ?? ""} onValueChange={handleProjectChange}>
              <SelectTrigger size="sm" className="w-48">
                <SelectValue>
                  {projects.find((p) => p.id === selectedProjectId)?.title ?? "Select project"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        )}

        {loading ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : tickets.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
            <p className="text-xs text-muted-foreground">
              {selectedProjectId
                ? "No tickets yet. Create one to get started."
                : "Select a project to view tickets."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                onClick={() =>
                  void navigate({
                    to: "/settings/tickets/$ticketId",
                    params: { ticketId: ticket.id },
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      {selectedProjectId && (
        <CreateTicketDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          projectId={selectedProjectId}
        />
      )}
    </div>
  );
}
