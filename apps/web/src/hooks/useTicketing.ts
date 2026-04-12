import type { NativeApi, TicketSummary, TicketingStreamEvent } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { ensureNativeApi } from "../nativeApi";
import { useStore } from "../store";
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

export interface TicketingProjectSnapshot {
  id: string;
  title: string;
  workspaceRoot: string;
}

export interface TicketingProjectResyncState {
  shouldResync: boolean;
  nextProjectId: string | null;
}

export interface TicketingFetchState {
  projects: ReadonlyArray<TicketingProjectSnapshot>;
  resolvedProjectId: string | null;
  tickets: ReadonlyArray<TicketSummary>;
  shouldSelectResolvedProject: boolean;
}

export function resolveTicketingProjectResyncState(input: {
  requestedProjectId?: string | undefined;
  selectedProjectId: string | null;
}): TicketingProjectResyncState {
  const nextProjectId = input.requestedProjectId ?? null;
  return {
    shouldResync:
      input.requestedProjectId !== undefined && nextProjectId !== input.selectedProjectId,
    nextProjectId,
  };
}

export async function fetchTicketingState(input: {
  api: Pick<NativeApi, "ticketing">;
  storeProjects: ReadonlyArray<{ id: string; name: string; cwd: string }>;
  requestedProjectId?: string | undefined;
  selectedProjectId: string | null;
  currentFetchId: number;
  isCurrentFetch: (fetchId: number) => boolean;
}): Promise<TicketingFetchState | null> {
  const projects: ReadonlyArray<TicketingProjectSnapshot> = input.storeProjects.map((p) => ({
    id: p.id,
    title: p.name,
    workspaceRoot: p.cwd,
  }));
  let resolvedProjectId = input.selectedProjectId ?? input.requestedProjectId ?? null;
  resolvedProjectId ??= projects[0]?.id ?? null;

  if (!resolvedProjectId) {
    return {
      projects,
      resolvedProjectId,
      tickets: [],
      shouldSelectResolvedProject: false,
    };
  }

  const tickets = await input.api.ticketing.list({ projectId: resolvedProjectId as never });
  if (!input.isCurrentFetch(input.currentFetchId)) return null;

  return {
    projects,
    resolvedProjectId,
    tickets,
    shouldSelectResolvedProject: input.selectedProjectId === null,
  };
}

export function useTicketing(options?: UseTicketingOptions): UseTicketingReturn {
  const [tickets, setTickets] = useState<ReadonlyArray<TicketSummary>>([]);
  const storeProjects = useStore((s) => s.projects);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    options?.projectId ?? null,
  );

  // Sync internal state when the caller-supplied projectId changes.
  // Handles TanStack Router keeping components mounted across param-only
  // navigations (thread switches in management view).
  useEffect(() => {
    const resync = resolveTicketingProjectResyncState({
      requestedProjectId: options?.projectId,
      selectedProjectId,
    });
    if (resync.shouldResync) {
      setLoading(true);
      setTickets([]);
      setSelectedProjectId(resync.nextProjectId);
    }
    // Only react to prop changes, not internal state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.projectId]);

  const fetchIdRef = useRef(0);
  const selectedProjectIdRef = useRef(selectedProjectId);
  selectedProjectIdRef.current = selectedProjectId;

  const fetchData = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current;
    try {
      const api = ensureNativeApi();
      const requestedProjectId = options?.projectId ?? undefined;
      // Use the prop-supplied projectId directly to avoid a stale fetch when
      // the resync effect hasn't updated selectedProjectId yet.
      // Read from ref to always get the latest value without adding it as a dep.
      const effectiveProjectId = options?.projectId ?? selectedProjectIdRef.current;

      logWebTimeline("ticketing.fetch.start", {
        fetchId: currentFetchId,
        selectedProjectId: effectiveProjectId,
        requestedProjectId: requestedProjectId ?? null,
        resolvedProjectId: effectiveProjectId ?? requestedProjectId ?? null,
      });

      const result = await fetchTicketingState({
        api,
        storeProjects,
        requestedProjectId,
        selectedProjectId: effectiveProjectId,
        currentFetchId,
        isCurrentFetch: (fetchId) => fetchIdRef.current === fetchId,
      });
      if (!result) return;

      // If no project selected yet and there are projects, select the first one.
      if (result.shouldSelectResolvedProject && result.resolvedProjectId) {
        setSelectedProjectId(result.resolvedProjectId);
      }

      if (!result.resolvedProjectId) {
        setTickets([]);
        logWebTimeline("ticketing.fetch.empty", { fetchId: currentFetchId });
        return;
      }

      setTickets(result.tickets);
      logWebTimeline("ticketing.fetch.success", {
        fetchId: currentFetchId,
        projectId: result.resolvedProjectId,
        ticketCount: result.tickets.length,
        ...summarizeTicketSet(result.tickets),
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
    // selectedProjectId intentionally omitted — effectiveProjectId reads it
    // synchronously via ref to avoid stale double-fetches.
  }, [options?.projectId, storeProjects]);

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

  const projects: ReadonlyArray<TicketingProjectSnapshot> = storeProjects.map((p) => ({
    id: p.id,
    title: p.name,
    workspaceRoot: p.cwd,
  }));

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
