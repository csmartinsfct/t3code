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

  // Read child threads from the Zustand store (they're already there via event processing)
  const threadsById = useStore((s) => s.threadsById);
  const childThreads = useMemo(
    () => childThreadIds.map((id) => threadsById[id]).filter((t): t is Thread => t !== undefined),
    [childThreadIds, threadsById],
  );

  // Also read the parent thread from the store to get latest activities
  const parentThread = useStore(
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on thread.id only
    useCallback((s) => (thread ? s.threadsById[thread.id] : undefined), [thread?.id]),
  );

  // ── Fetch run + child thread IDs ──────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!thread || !projectId) return;

    const currentFetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const rpc = getWsRpcClient();

      logWebTimeline("orchestration.timeline.fetch.start", {
        threadId: thread.id,
        projectId,
      });

      // Find the run for this orchestration thread
      const runs = await rpc.orchestration.listRuns({
        projectId: projectId as ProjectId,
      });
      if (fetchIdRef.current !== currentFetchId) return;

      const matchingRun = runs.find((r) => r.orchestrationThreadId === thread.id);
      if (!matchingRun) {
        logWebTimeline("orchestration.timeline.fetch.no-run", { threadId: thread.id });
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
        parentThreadId: thread.id,
      });
      if (fetchIdRef.current !== currentFetchId) return;
      setChildThreadIds(children.map((c) => c.id));

      logWebTimeline("orchestration.timeline.fetch.success", {
        threadId: thread.id,
        runId: fullRun.id,
        runStatus: fullRun.status,
        childThreadCount: children.length,
        currentTicketIndex: fullRun.currentTicketIndex,
      });
    } catch (err) {
      if (fetchIdRef.current !== currentFetchId) return;
      const message = err instanceof Error ? err.message : "Failed to load orchestration data";
      warnWebTimeline("orchestration.timeline.fetch.error", {
        threadId: thread.id,
        error: message,
      });
      setError(message);
    } finally {
      if (fetchIdRef.current === currentFetchId) {
        setLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on thread.id only
  }, [thread?.id, projectId]);

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
          thread &&
          event.run.orchestrationThreadId === thread.id
        ) {
          logWebTimeline("orchestration.timeline.run-updated", {
            runId: event.run.id,
            status: event.run.status,
            currentTicketIndex: event.run.currentTicketIndex,
            currentPhase: event.run.currentPhase,
          });
          setRun(event.run);
        } else if (
          event.type === "run.created" &&
          thread &&
          event.run.orchestrationThreadId === thread.id
        ) {
          logWebTimeline("orchestration.timeline.run-created", {
            runId: event.run.id,
            status: event.run.status,
          });
          setRun(event.run);
          // Re-fetch child threads when a new run is created
          void fetchData();
        }
      },
    );

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on thread.id only
  }, [projectId, thread?.id, fetchData]);

  // ── Build timeline rows ───────────────────────────────────────────
  const childThreadsByTicketId = useMemo(() => {
    const map = new Map<string, Thread>();
    for (const child of childThreads) {
      if (child.ticketId) {
        map.set(child.ticketId, child);
      }
    }
    return map;
  }, [childThreads]);

  const timelineRows = useMemo((): OrchestrationTimelineRow[] => {
    if (loading) return [{ kind: "loading", id: "loading" }];
    if (!run) return [{ kind: "empty", id: "empty" }];

    const rows = buildOrchestrationTimelineRows({
      parentActivities: parentThread?.activities ?? thread?.activities ?? [],
      childThreadsByTicketId,
      run,
    });

    return rows.length > 0 ? rows : [{ kind: "empty", id: "empty" }];
  }, [loading, run, parentThread?.activities, thread?.activities, childThreadsByTicketId]);

  return {
    loading,
    error,
    run,
    childThreads,
    timelineRows,
    refresh: fetchData,
  };
}
