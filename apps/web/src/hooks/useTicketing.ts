import type { TicketSummary, TicketingStreamEvent } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { ensureNativeApi } from "../nativeApi";
import { logWebTimeline, warnWebTimeline } from "../timelineLogger";

function summarizeTicketSet(tickets: ReadonlyArray<TicketSummary>): Record<string, number> {
  const topLevelCount = tickets.filter((ticket) => ticket.parentId === null).length;
  const epicCount = tickets.filter((ticket) => ticket.subTicketCount > 0).length;
  return {
    topLevelCount,
    childCount: tickets.length - topLevelCount,
    epicCount,
    backlogCount: tickets.filter(
      (ticket) => ticket.parentId === null && ticket.status === "backlog",
    ).length,
    todoCount: tickets.filter((ticket) => ticket.parentId === null && ticket.status === "todo")
      .length,
    inProgressCount: tickets.filter(
      (ticket) => ticket.parentId === null && ticket.status === "in_progress",
    ).length,
    blockedCount: tickets.filter(
      (ticket) => ticket.parentId === null && ticket.status === "blocked",
    ).length,
    inReviewCount: tickets.filter(
      (ticket) => ticket.parentId === null && ticket.status === "in_review",
    ).length,
    doneCount: tickets.filter((ticket) => ticket.parentId === null && ticket.status === "done")
      .length,
    canceledCount: tickets.filter(
      (ticket) => ticket.parentId === null && ticket.status === "canceled",
    ).length,
  };
}

export interface UseTicketingOptions {
  projectId?: string | undefined;
}

export interface UseTicketingReturn {
  tickets: ReadonlyArray<TicketSummary>;
  projects: ReadonlyArray<{ id: string; title: string; workspaceRoot: string }>;
  loading: boolean;
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  refetch: () => Promise<void>;
  applyLocalReorder: (
    updates: ReadonlyArray<{ id: string; sortOrder: number; status?: string }>,
  ) => void;
}

export function useTicketing(options?: UseTicketingOptions): UseTicketingReturn {
  const [tickets, setTickets] = useState<ReadonlyArray<TicketSummary>>([]);
  const [projects, setProjects] = useState<
    ReadonlyArray<{ id: string; title: string; workspaceRoot: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    options?.projectId ?? null,
  );

  // Sync internal state when the caller-supplied projectId changes.
  // Handles TanStack Router keeping components mounted across param-only
  // navigations (thread switches in management view).
  useEffect(() => {
    if (options?.projectId !== undefined && options.projectId !== selectedProjectId) {
      setLoading(true);
      setTickets([]);
      setSelectedProjectId(options.projectId);
    }
    // Only react to prop changes, not internal state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.projectId]);

  const fetchIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current;
    try {
      const api = ensureNativeApi();
      let projectList: ReadonlyArray<{ id: string; title: string; workspaceRoot: string }> = [];
      let resolvedProjectId = selectedProjectId ?? options?.projectId ?? null;

      logWebTimeline("ticketing.fetch.start", {
        fetchId: currentFetchId,
        selectedProjectId,
        requestedProjectId: options?.projectId ?? null,
        resolvedProjectId,
      });

      try {
        const snapshot = await api.orchestration.getSnapshot();
        if (fetchIdRef.current !== currentFetchId) return;
        projectList = snapshot.projects.map((p) => ({
          id: p.id,
          title: p.title,
          workspaceRoot: p.workspaceRoot,
        }));
        setProjects(projectList);
        resolvedProjectId ??= projectList[0]?.id ?? null;
        logWebTimeline("ticketing.snapshot.success", {
          fetchId: currentFetchId,
          projectCount: projectList.length,
          resolvedProjectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnWebTimeline("ticketing.snapshot.failed", {
          fetchId: currentFetchId,
          error: message,
        });
        console.warn("Failed to fetch ticketing project snapshot:", error);
      }

      // If no project selected yet and there are projects, select the first one.
      if (resolvedProjectId && !selectedProjectId) {
        setSelectedProjectId(resolvedProjectId);
      }

      if (!resolvedProjectId) {
        if (fetchIdRef.current !== currentFetchId) return;
        setTickets([]);
        logWebTimeline("ticketing.fetch.empty", {
          fetchId: currentFetchId,
          projectCount: projectList.length,
        });
        return;
      }

      const ticketList = await api.ticketing.list({ projectId: resolvedProjectId as never });
      if (fetchIdRef.current !== currentFetchId) return;
      setTickets(ticketList);
      logWebTimeline("ticketing.fetch.success", {
        fetchId: currentFetchId,
        projectId: resolvedProjectId,
        ticketCount: ticketList.length,
        ...summarizeTicketSet(ticketList),
      });
    } catch (error) {
      if (fetchIdRef.current !== currentFetchId) return;
      warnWebTimeline("ticketing.fetch.failed", {
        fetchId: currentFetchId,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error("Failed to fetch tickets:", error);
    } finally {
      if (fetchIdRef.current === currentFetchId) {
        setLoading(false);
      }
    }
  }, [options?.projectId, selectedProjectId]);

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

  const applyLocalReorder = useCallback(
    (updates: ReadonlyArray<{ id: string; sortOrder: number; status?: string }>) => {
      setTickets((current) => {
        const updateMap = new Map(updates.map((u) => [u.id, u]));
        return current.map((t) => {
          const u = updateMap.get(t.id);
          if (!u) return t;
          return {
            ...t,
            sortOrder: u.sortOrder,
            ...(u.status ? { status: u.status as TicketSummary["status"] } : {}),
          };
        });
      });
    },
    [],
  );

  return {
    tickets,
    projects,
    loading,
    selectedProjectId,
    setSelectedProjectId,
    refetch,
    applyLocalReorder,
  };
}
