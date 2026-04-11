import type { OrchestrationRun, OrchestrationRunStreamEvent, ProjectId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getWsRpcClient } from "../wsRpcClient";
import { useStore } from "../store";
import { logWebTimeline, warnWebTimeline } from "../timelineLogger";
import type { Thread } from "../types";
import {
  buildOrchestrationTimelineRows,
  type OrchestrationTimelineRow,
} from "./useOrchestrationTimeline.logic";

const orchestrationTimelineCache = new Map<
  string,
  {
    run: OrchestrationRun | null;
    childThreadIds: string[];
  }
>();

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface UseOrchestrationTimelineReturn {
  loading: boolean;
  error: string | null;
  run: OrchestrationRun | null;
  childThreads: Thread[];
  timelineRows: OrchestrationTimelineRow[];
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOrchestrationTimeline(
  thread: Thread | null | undefined,
  projectId: string | null | undefined,
): UseOrchestrationTimelineReturn {
  const [run, setRun] = useState<OrchestrationRun | null>(null);
  const [childThreadIds, setChildThreadIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);
  const parentThreadId =
    thread?.isOrchestrationThread === true ? thread.id : (thread?.parentThreadId ?? null);
  const cachedTimeline =
    parentThreadId !== null ? (orchestrationTimelineCache.get(parentThreadId) ?? null) : null;
  const hasCachedTimeline = cachedTimeline !== null;

  // Read child threads from the Zustand store (they're already there via event processing)
  const threadsById = useStore((s) => s.threadsById);
  const childThreads = useMemo(
    () => childThreadIds.map((id) => threadsById[id]).filter((t): t is Thread => t !== undefined),
    [childThreadIds, threadsById],
  );

  // Also read the parent thread from the store to get latest activities
  const parentThread = useStore(
    useCallback(
      (s) => (parentThreadId !== null ? s.threadsById[parentThreadId] : undefined),
      [parentThreadId],
    ),
  );

  useEffect(() => {
    fetchIdRef.current += 1;
    setRun(cachedTimeline?.run ?? null);
    setChildThreadIds(cachedTimeline?.childThreadIds ?? []);
    setError(null);
    setLoading(Boolean(parentThreadId && projectId && !cachedTimeline));
  }, [cachedTimeline, parentThreadId, projectId]);

  // ── Fetch run + child thread IDs ──────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!parentThreadId || !projectId) return;

    const currentFetchId = ++fetchIdRef.current;
    setLoading((existing) => existing || !hasCachedTimeline);
    setError(null);

    try {
      const rpc = getWsRpcClient();

      logWebTimeline("orchestration.timeline.fetch.start", {
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
        logWebTimeline("orchestration.timeline.fetch.no-run", { threadId: parentThreadId });
        orchestrationTimelineCache.delete(parentThreadId);
        setRun(null);
        setChildThreadIds([]);
        setLoading(false);
        return;
      }

      // Get full run details
      const fullRun = await rpc.orchestration.getRun({ runId: matchingRun.id });
      if (fetchIdRef.current !== currentFetchId) return;
      setRun(fullRun);

      // Get child threads (ordered by ticket plan)
      const children = await rpc.orchestration.getChildThreads({
        parentThreadId: parentThreadId as Thread["id"],
      });
      if (fetchIdRef.current !== currentFetchId) return;
      setChildThreadIds(children.map((c) => c.id));
      orchestrationTimelineCache.set(parentThreadId, {
        run: fullRun,
        childThreadIds: children.map((c) => c.id),
      });

      logWebTimeline("orchestration.timeline.fetch.success", {
        threadId: parentThreadId,
        runId: fullRun.id,
        runStatus: fullRun.status,
        childThreadCount: children.length,
        currentTicketIndex: fullRun.currentTicketIndex,
      });
    } catch (err) {
      if (fetchIdRef.current !== currentFetchId) return;
      const message = err instanceof Error ? err.message : "Failed to load orchestration data";
      warnWebTimeline("orchestration.timeline.fetch.error", {
        threadId: parentThreadId,
        error: message,
      });
      setError(message);
    } finally {
      if (fetchIdRef.current === currentFetchId) {
        setLoading(false);
      }
    }
  }, [hasCachedTimeline, parentThreadId, projectId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // ── Subscribe to run events ───────────────────────────────────────
  useEffect(() => {
    if (!projectId) return;

    const rpc = getWsRpcClient();
    const unsubscribe = rpc.orchestration.onRunEvent(
      projectId as ProjectId,
      (event: OrchestrationRunStreamEvent) => {
        if (
          event.type === "run.updated" &&
          parentThreadId &&
          event.run.orchestrationThreadId === parentThreadId
        ) {
          logWebTimeline("orchestration.timeline.run-updated", {
            runId: event.run.id,
            status: event.run.status,
            currentTicketIndex: event.run.currentTicketIndex,
            currentPhase: event.run.currentPhase,
          });
          setRun(event.run);
          orchestrationTimelineCache.set(parentThreadId, {
            run: event.run,
            childThreadIds,
          });
        } else if (
          event.type === "run.created" &&
          parentThreadId &&
          event.run.orchestrationThreadId === parentThreadId
        ) {
          logWebTimeline("orchestration.timeline.run-created", {
            runId: event.run.id,
            status: event.run.status,
          });
          setRun(event.run);
          orchestrationTimelineCache.set(parentThreadId, {
            run: event.run,
            childThreadIds,
          });
          // Re-fetch child threads when a new run is created
          void fetchData();
        }
      },
    );

    return unsubscribe;
  }, [childThreadIds, fetchData, parentThreadId, projectId]);

  // ── Build timeline rows ───────────────────────────────────────────
  const timelineRows = useMemo((): OrchestrationTimelineRow[] => {
    if (loading) return [{ kind: "loading", id: "loading" }];
    if (!run) return [{ kind: "empty", id: "empty" }];

    const rows = buildOrchestrationTimelineRows({
      parentActivities: parentThread?.activities ?? [],
      childThreads,
      run,
    });

    return rows.length > 0 ? rows : [{ kind: "empty", id: "empty" }];
  }, [loading, run, parentThread?.activities, childThreads]);

  return {
    loading,
    error,
    run,
    childThreads,
    timelineRows,
    refresh: fetchData,
  };
}
