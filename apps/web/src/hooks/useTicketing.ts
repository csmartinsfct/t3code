import type { NativeApi, ProjectId, TicketSummary, TicketingStreamEvent } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ensureNativeApi } from "../nativeApi";
import { useStore } from "../store";
import {
  applyLocalTicketUpdates,
  applyTicketEvent,
  fetchTicketingProject,
  getCachedTickets,
  useTicketingCacheStore,
} from "../lib/ticketingCacheStore";
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
  refreshing: boolean;
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

export function resolveTicketingLoadingState(input: {
  tickets: ReadonlyArray<TicketSummary>;
  status: "loading" | "ready" | "refreshing" | "error" | null;
  hasResolvedProject: boolean;
}): { loading: boolean; refreshing: boolean } {
  return {
    loading: input.hasResolvedProject && input.tickets.length === 0 && input.status !== "ready",
    refreshing: input.tickets.length > 0 && input.status === "refreshing",
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
  const storeProjects = useStore((s) => s.projects);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    options?.projectId ?? null,
  );
  const projects: ReadonlyArray<TicketingProjectSnapshot> = useMemo(
    () =>
      storeProjects.map((p) => ({
        id: p.id,
        title: p.name,
        workspaceRoot: p.cwd,
      })),
    [storeProjects],
  );
  const resolvedProjectId = options?.projectId ?? selectedProjectId ?? projects[0]?.id ?? null;
  const cacheEntry = useTicketingCacheStore((state) =>
    resolvedProjectId ? state.entries[resolvedProjectId] : undefined,
  );
  const tickets = cacheEntry?.tickets ?? [];
  const loadingState = resolveTicketingLoadingState({
    tickets,
    status: cacheEntry?.status ?? null,
    hasResolvedProject: resolvedProjectId !== null,
  });

  // Sync internal state when the caller-supplied projectId changes.
  // Handles TanStack Router keeping components mounted across param-only
  // navigations (thread switches in management view).
  useEffect(() => {
    const resync = resolveTicketingProjectResyncState({
      requestedProjectId: options?.projectId,
      selectedProjectId,
    });
    if (resync.shouldResync) {
      setSelectedProjectId(resync.nextProjectId);
    }
    // Only react to prop changes, not internal state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.projectId]);

  const fetchIdRef = useRef(0);

  const fetchData = useCallback(
    async (input?: { force?: boolean }) => {
      const currentFetchId = ++fetchIdRef.current;
      const effectiveProjectId = options?.projectId ?? selectedProjectId ?? projects[0]?.id ?? null;
      try {
        const api = ensureNativeApi();
        const requestedProjectId = options?.projectId ?? undefined;

        logWebTimeline("ticketing.fetch.start", {
          fetchId: currentFetchId,
          selectedProjectId: effectiveProjectId,
          requestedProjectId: requestedProjectId ?? null,
          resolvedProjectId: effectiveProjectId ?? requestedProjectId ?? null,
        });

        if (!effectiveProjectId) {
          logWebTimeline("ticketing.fetch.empty", { fetchId: currentFetchId });
          return;
        }

        if (selectedProjectId === null && options?.projectId === undefined) {
          setSelectedProjectId(effectiveProjectId);
        }

        await fetchTicketingProject({
          api,
          projectId: effectiveProjectId as ProjectId,
          ...(input?.force !== undefined ? { force: input.force } : {}),
        });
        if (fetchIdRef.current !== currentFetchId) return;

        const resultTickets = getCachedTickets(effectiveProjectId as ProjectId)?.tickets ?? [];
        logWebTimeline("ticketing.fetch.success", {
          fetchId: currentFetchId,
          projectId: effectiveProjectId,
          ticketCount: resultTickets.length,
          ...summarizeTicketSet(resultTickets),
        });
      } catch (error) {
        if (fetchIdRef.current !== currentFetchId) return;
        warnWebTimeline("ticketing.fetch.failed", {
          fetchId: currentFetchId,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error("Failed to fetch tickets:", error);
      }
    },
    [options?.projectId, projects, selectedProjectId],
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Real-time subscription — global, filter client-side
  useEffect(() => {
    const api = ensureNativeApi();
    const unsubscribe = api.ticketing.onEvent((event: TicketingStreamEvent) => {
      applyTicketEvent(event);
    });
    return unsubscribe;
  }, []);

  const refetch = useCallback(async () => {
    await fetchData({ force: true });
  }, [fetchData]);

  const applyLocalReorder = useCallback(
    (updates: ReadonlyArray<{ id: string; sortOrder: number; status?: string }>) => {
      if (!resolvedProjectId) return;
      applyLocalTicketUpdates(resolvedProjectId as ProjectId, updates);
    },
    [resolvedProjectId],
  );

  return {
    tickets,
    projects,
    loading: loadingState.loading,
    refreshing: loadingState.refreshing,
    selectedProjectId: resolvedProjectId,
    setSelectedProjectId,
    refetch,
    applyLocalReorder,
  };
}
