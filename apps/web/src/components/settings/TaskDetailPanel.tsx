import type {
  Ticket,
  TicketId,
  TicketPriority,
  TicketStatus,
  TicketingStreamEvent,
} from "@t3tools/contracts";
import { ArrowLeftIcon, TrashIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";

import { ensureNativeApi } from "../../nativeApi";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { TaskAcceptanceCriteria } from "./TaskAcceptanceCriteria";
import { TaskComments } from "./TaskComments";
import { TaskHistory } from "./TaskHistory";
import {
  ALL_PRIORITIES,
  ALL_STATUSES,
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  formatRelativeDate,
} from "./taskUtils";

export function TaskDetailPanel() {
  const { ticketId: rawTicketId } = useParams({ from: "/settings/tasks/$ticketId" });
  const ticketId = rawTicketId as TicketId;
  const navigate = useNavigate();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const fetchTicket = useCallback(async () => {
    try {
      const api = ensureNativeApi();
      const data = await api.ticketing.getById({ id: ticketId });
      setTicket(data);
    } catch (error) {
      console.error("Failed to fetch ticket:", error);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    void fetchTicket();
  }, [fetchTicket]);

  // Real-time updates
  useEffect(() => {
    const api = ensureNativeApi();
    const unsubscribe = api.ticketing.onEvent((event: TicketingStreamEvent) => {
      if (event.type === "ticket_deleted" && event.ticketId === ticketId) {
        void navigate({
          to: "/settings/tasks",
          ...(ticket?.projectId ? { search: { project: String(ticket.projectId) } } : {}),
          replace: true,
        });
      } else if (event.type === "ticket_upserted" && event.ticket.id === ticketId) {
        void fetchTicket();
      } else if (
        (event.type === "comment_upserted" || event.type === "comment_deleted") &&
        event.ticketId === ticketId
      ) {
        void fetchTicket();
      }
    });
    return unsubscribe;
  }, [ticketId, navigate, fetchTicket]);

  const handleStatusChange = useCallback(
    async (status: TicketStatus) => {
      try {
        const api = ensureNativeApi();
        const updated = await api.ticketing.update({ id: ticketId, status });
        setTicket(updated);
      } catch (error) {
        console.error("Failed to update status:", error);
      }
    },
    [ticketId],
  );

  const handlePriorityChange = useCallback(
    async (priority: TicketPriority) => {
      try {
        const api = ensureNativeApi();
        const updated = await api.ticketing.update({ id: ticketId, priority });
        setTicket(updated);
      } catch (error) {
        console.error("Failed to update priority:", error);
      }
    },
    [ticketId],
  );

  const handleDelete = useCallback(async () => {
    try {
      const api = ensureNativeApi();
      await api.ticketing.delete({ id: ticketId });
      void navigate({
        to: "/settings/tasks",
        ...(ticket?.projectId ? { search: { project: String(ticket.projectId) } } : {}),
        replace: true,
      });
    } catch (error) {
      console.error("Failed to delete ticket:", error);
    }
  }, [ticketId, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">Ticket not found.</p>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[ticket.status];
  const priorityCfg = PRIORITY_CONFIG[ticket.priority];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 py-8">
        {/* Back link */}
        <button
          type="button"
          className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={() =>
            void navigate({
              to: "/settings/tasks",
              ...(ticket?.projectId ? { search: { project: String(ticket.projectId) } } : {}),
              replace: true,
            })
          }
        >
          <ArrowLeftIcon className="size-3" />
          Back to Tasks
        </button>

        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <span className="font-mono text-[11px] text-muted-foreground">
                {ticket.identifier}
              </span>
              <h2 className="mt-0.5 text-sm font-medium text-foreground">{ticket.title}</h2>
            </div>
            <Button
              size="xs"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <TrashIcon className="size-3" />
              Delete
            </Button>
          </div>

          {/* Status + Priority inline selectors */}
          <div className="flex items-center gap-3">
            <Select
              value={ticket.status}
              onValueChange={(v) => void handleStatusChange(v as TicketStatus)}
            >
              <SelectTrigger size="xs" variant="ghost" className="h-auto gap-1.5 px-1.5 py-1">
                <div className={`size-2 rounded-full ${statusCfg.dotClass}`} />
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    <div className="flex items-center gap-2">
                      <div className={`size-2 rounded-full ${STATUS_CONFIG[s].dotClass}`} />
                      {STATUS_CONFIG[s].label}
                    </div>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>

            <span className="text-border">|</span>

            <Select
              value={ticket.priority}
              onValueChange={(v) => void handlePriorityChange(v as TicketPriority)}
            >
              <SelectTrigger size="xs" variant="ghost" className="h-auto gap-1.5 px-1.5 py-1">
                <div className={`size-2 rounded-full ${priorityCfg.dotClass}`} />
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {ALL_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    <div className="flex items-center gap-2">
                      <div className={`size-2 rounded-full ${PRIORITY_CONFIG[p].dotClass}`} />
                      {PRIORITY_CONFIG[p].label}
                    </div>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>

            <span className="text-border">|</span>
            <span className="text-[11px] text-muted-foreground">
              Created {formatRelativeDate(ticket.createdAt)}
            </span>
          </div>
        </div>

        {/* Description */}
        {ticket.description && (
          <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2">
            <p className="text-[11px] font-medium text-muted-foreground">Description</p>
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-foreground">
              {ticket.description}
            </p>
          </div>
        )}

        {/* Acceptance Criteria */}
        {ticket.acceptanceCriteria && ticket.acceptanceCriteria.length > 0 && (
          <TaskAcceptanceCriteria
            ticketId={ticketId}
            criteria={ticket.acceptanceCriteria}
            onUpdated={() => void fetchTicket()}
          />
        )}

        {/* Labels */}
        {ticket.labels.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Labels</h3>
            <div className="flex flex-wrap gap-1.5">
              {ticket.labels.map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: `${label.color}14`,
                    color: label.color,
                  }}
                >
                  {label.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Dependencies */}
        {ticket.dependencies.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Dependencies ({ticket.dependencies.length})
            </h3>
            <div className="flex flex-col gap-1">
              {ticket.dependencies.map((dep) => (
                <button
                  key={dep.dependsOnTicketId}
                  type="button"
                  className="flex w-fit items-center gap-1.5 text-xs text-blue-500 hover:underline"
                  onClick={() =>
                    void navigate({
                      to: "/settings/tasks/$ticketId",
                      params: { ticketId: dep.dependsOnTicketId },
                    })
                  }
                >
                  {dep.dependsOnTicketId}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sub-tickets */}
        {ticket.subTickets.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Sub-tasks ({ticket.subTickets.length})
            </h3>
            <div className="flex flex-col gap-1">
              {ticket.subTickets.map((sub) => {
                const subStatusCfg = STATUS_CONFIG[sub.status];
                return (
                  <button
                    key={sub.id}
                    type="button"
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/30"
                    onClick={() =>
                      void navigate({
                        to: "/settings/tasks/$ticketId",
                        params: { ticketId: sub.id },
                      })
                    }
                  >
                    <div className={`size-2 shrink-0 rounded-full ${subStatusCfg.dotClass}`} />
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {sub.identifier}
                    </span>
                    <span className="truncate text-foreground">{sub.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Comments */}
        <TaskComments
          ticketId={ticketId}
          comments={ticket.comments}
          onUpdated={() => void fetchTicket()}
        />

        {/* History */}
        <TaskHistory ticketId={ticketId} />
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{ticket.identifier}: {ticket.title}" and all its data.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </AlertDialogClose>
            <Button variant="destructive" size="sm" onClick={() => void handleDelete()}>
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
