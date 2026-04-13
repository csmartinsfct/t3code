import type {
  OrchestrationRun,
  OrchestrationRunStreamEvent,
  ProjectId,
  ThreadId,
  TicketSummary,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LRUCache } from "../lib/lruCache";
import { ensureNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { logWebTimeline, warnWebTimeline } from "../timelineLogger";
import type { Thread } from "../types";
import { getWsRpcClient } from "../wsRpcClient";

// ---------------------------------------------------------------------------
// Module-level cache (shared across component instances & remounts)
// ---------------------------------------------------------------------------

type OrchestrationCacheEntry = {
  run: OrchestrationRun | null;
  childThreadIds: string[];
  tickets: ReadonlyArray<TicketSummary>;
};

/** Rough byte estimate for a cache entry (avoids JSON.stringify on hot path). */
function estimateEntrySize(entry: OrchestrationCacheEntry): number {
  return 512 + entry.childThreadIds.length * 64 + entry.tickets.length * 256;
}

const orchestrationDataCache = new LRUCache<OrchestrationCacheEntry>(
  100, // max 100 orchestration threads
  10 * 1024 * 1024, // ~10 MB memory budget
);

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface UseOrchestrationDataReturn {
  loading: boolean;
  error: string | null;
  run: OrchestrationRun | null;
  childThreads: Thread[];
  childThreadIds: string[];
  tickets: ReadonlyArray<TicketSummary>;
  isInOrchestration: boolean;
  isParent: boolean;
  parentThreadId: string | null;
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Hook — single source of truth for orchestration data
// ---------------------------------------------------------------------------

export function useOrchestrationData(
  thread: Thread | null | undefined,
  projectId: string | null | undefined,
): UseOrchestrationDataReturn {
  const [run, setRun] = useState<OrchestrationRun | null>(null);
  const [childThreadIds, setChildThreadIds] = useState<string[]>([]);
  const [tickets, setTickets] = useState<ReadonlyArray<TicketSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  // Determine orchestration role
  const isParent = thread?.isOrchestrationThread === true;
  const isChild = !isParent && thread?.parentThreadId != null;
  const parentThreadId = isParent ? thread?.id : (thread?.parentThreadId ?? null);
  const isInOrchestration = isParent || isChild;

  // Cache lookup
  const cachedData =
    parentThreadId !== null ? (orchestrationDataCache.get(parentThreadId) ?? null) : null;
  const hasCachedData = cachedData !== null;

  // Read child threads from the Zustand store
  const threadsById = useStore((s) => s.threadsById);
  const childThreads = useMemo(
    () => childThreadIds.map((id) => threadsById[id]).filter((t): t is Thread => t !== undefined),
    [childThreadIds, threadsById],
  );

  // Hydrate from cache on mount / identity change
  useEffect(() => {
    fetchIdRef.current += 1;
    setRun(cachedData?.run ?? null);
    setChildThreadIds(cachedData?.childThreadIds ?? []);
    setTickets(cachedData?.tickets ?? []);
    setError(null);
    setLoading(Boolean(parentThreadId && projectId && !cachedData));
  }, [cachedData, parentThreadId, projectId]);

  // ── Fetch run + child threads + tickets ────────────────────────────
  const fetchData = useCallback(async () => {
    if (!parentThreadId || !projectId) return;

    const currentFetchId = ++fetchIdRef.current;
    setLoading((existing) => existing || !hasCachedData);
    setError(null);

    try {
      const rpc = getWsRpcClient();

      logWebTimeline("orchestration.data.fetch.start", {
        threadId: parentThreadId,
        projectId,
      });

      // Find the run for this orchestration thread
      const runs = await rpc.orchestration.listRuns({
        projectId: projectId as ProjectId,
      });
      if (fetchIdRef.current !== currentFetchId) return;

      const matchingRun = runs.find((r) => r.orchestrationThreadId === parentThreadId);
      if (!matchingRun) {
        logWebTimeline("orchestration.data.fetch.no-run", { threadId: parentThreadId });
        orchestrationDataCache.delete(parentThreadId);
        setRun(null);
        setChildThreadIds([]);
        setTickets([]);
        setLoading(false);
        return;
      }

      // Get full run details + child threads + tickets in parallel
      const [fullRun, children, ticketList] = await Promise.all([
        rpc.orchestration.getRun({ runId: matchingRun.id }),
        rpc.orchestration.getChildThreads({ parentThreadId: parentThreadId as ThreadId }),
        ensureNativeApi().ticketing.list({ projectId: projectId as never }),
      ]);
      if (fetchIdRef.current !== currentFetchId) return;

      setRun(fullRun);
      const newChildThreadIds = children.map((c) => c.id);
      setChildThreadIds(newChildThreadIds);
      setTickets(ticketList);
      const cacheEntry: OrchestrationCacheEntry = {
        run: fullRun,
        childThreadIds: newChildThreadIds,
        tickets: ticketList,
      };
      orchestrationDataCache.set(parentThreadId, cacheEntry, estimateEntrySize(cacheEntry));

      logWebTimeline("orchestration.data.fetch.success", {
        threadId: parentThreadId,
        runId: fullRun.id,
        runStatus: fullRun.status,
        childThreadCount: children.length,
        ticketCount: ticketList.length,
        currentTicketIndex: fullRun.currentTicketIndex,
      });
    } catch (err) {
      if (fetchIdRef.current !== currentFetchId) return;
      const message = err instanceof Error ? err.message : "Failed to load orchestration data";
      warnWebTimeline("orchestration.data.fetch.error", {
        threadId: parentThreadId,
        error: message,
      });
      setError(message);
    } finally {
      if (fetchIdRef.current === currentFetchId) {
        setLoading(false);
      }
    }
  }, [hasCachedData, parentThreadId, projectId]);

  useEffect(() => {
    if (isInOrchestration) {
      void fetchData();
    } else {
      setRun(null);
      setChildThreadIds([]);
      setTickets([]);
      setLoading(false);
    }
  }, [fetchData, isInOrchestration]);

  // ── Subscribe to run events (stable deps via ref) ──────────────────
  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;
  const childThreadIdsRef = useRef(childThreadIds);
  childThreadIdsRef.current = childThreadIds;

  useEffect(() => {
    if (!projectId || !isInOrchestration || !parentThreadId) return;

    const rpc = getWsRpcClient();
    const unsubscribe = rpc.orchestration.onRunEvent(
      projectId as ProjectId,
      (event: OrchestrationRunStreamEvent) => {
        if (event.type === "run.updated" && event.run.orchestrationThreadId === parentThreadId) {
          logWebTimeline("orchestration.data.run-updated", {
            runId: event.run.id,
            status: event.run.status,
            currentTicketIndex: event.run.currentTicketIndex,
            currentPhase: event.run.currentPhase,
          });
          setRun(event.run);
          const updatedEntry: OrchestrationCacheEntry = {
            run: event.run,
            childThreadIds: childThreadIdsRef.current,
            tickets: [],
          };
          orchestrationDataCache.set(parentThreadId, updatedEntry, estimateEntrySize(updatedEntry));
        } else if (
          event.type === "run.created" &&
          event.run.orchestrationThreadId === parentThreadId
        ) {
          logWebTimeline("orchestration.data.run-created", {
            runId: event.run.id,
            status: event.run.status,
          });
          setRun(event.run);
          const createdEntry: OrchestrationCacheEntry = {
            run: event.run,
            childThreadIds: childThreadIdsRef.current,
            tickets: [],
          };
          orchestrationDataCache.set(parentThreadId, createdEntry, estimateEntrySize(createdEntry));
          // Re-fetch child threads + tickets when a new run is created
          void fetchDataRef.current();
        }
      },
    );

    return unsubscribe;
    // Stable deps only — fetchData/childThreadIds accessed via refs
  }, [projectId, parentThreadId, isInOrchestration]);

  return {
    loading,
    error,
    run,
    childThreads,
    childThreadIds,
    tickets,
    isInOrchestration,
    isParent,
    parentThreadId,
    refresh: fetchData,
  };
}
