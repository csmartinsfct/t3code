import type { TicketSummary, TicketingStreamEvent } from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";

import { ensureNativeApi } from "../nativeApi";

export interface UseTicketingReturn {
  tickets: ReadonlyArray<TicketSummary>;
  projects: ReadonlyArray<{ id: string; title: string; workspaceRoot: string }>;
  loading: boolean;
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  refetch: () => Promise<void>;
}

export function useTicketing(): UseTicketingReturn {
  const [tickets, setTickets] = useState<ReadonlyArray<TicketSummary>>([]);
  const [projects, setProjects] = useState<
    ReadonlyArray<{ id: string; title: string; workspaceRoot: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const api = ensureNativeApi();
      const snapshot = await api.orchestration.getSnapshot();
      const projectList = snapshot.projects.map((p) => ({
        id: p.id,
        title: p.title,
        workspaceRoot: p.workspaceRoot,
      }));
      setProjects(projectList);

      // If no project selected yet and there are projects, select the first one
      const projectId = selectedProjectId ?? projectList[0]?.id ?? null;
      if (projectId && !selectedProjectId) {
        setSelectedProjectId(projectId);
      }

      if (projectId) {
        const ticketList = await api.ticketing.list({ projectId: projectId as never });
        setTickets(ticketList);
      } else {
        setTickets([]);
      }
    } catch (error) {
      console.error("Failed to fetch tickets:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Real-time subscription — global, filter client-side
  useEffect(() => {
    const api = ensureNativeApi();
    const unsubscribe = api.ticketing.onEvent((event: TicketingStreamEvent) => {
      if (event.type === "ticket_upserted") {
        if (selectedProjectId && event.projectId !== selectedProjectId) return;
        setTickets((current) => {
          const idx = current.findIndex((t) => t.id === event.ticket.id);
          if (idx >= 0) {
            const next = [...current];
            next[idx] = event.ticket;
            return next;
          }
          return [event.ticket, ...current];
        });
      } else if (event.type === "ticket_deleted") {
        setTickets((current) => current.filter((t) => t.id !== event.ticketId));
      }
    });
    return unsubscribe;
  }, [selectedProjectId]);

  const refetch = useCallback(async () => {
    setLoading(true);
    await fetchData();
  }, [fetchData]);

  return { tickets, projects, loading, selectedProjectId, setSelectedProjectId, refetch };
}
