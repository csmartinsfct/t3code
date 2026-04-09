import type {
  OrchestrationRun,
  OrchestrationRunStreamEvent,
  ProjectId,
  ThreadId,
  TicketSummary,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ensureNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { logWebTimeline, warnWebTimeline } from "../timelineLogger";
import type { Thread } from "../types";
import { getWsRpcClient } from "../wsRpcClient";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface OrchestrationSwitcherItem {
  id: string;
  kind: "timeline" | "working-thread";
  label: string;
  sublabel: string;
  isActive: boolean;
  isStarted: boolean;
  threadId: string;
}

export interface UseOrchestrationSwitcherReturn {
  visible: boolean;
  items: OrchestrationSwitcherItem[];
  currentLabel: string;
  loading: boolean;
}

const EMPTY: UseOrchestrationSwitcherReturn = {
  visible: false,
  items: [],
  currentLabel: "",
  loading: false,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOrchestrationSwitcher(
  activeThread: Thread | null | undefined,
  projectId: string | null | undefined,
): UseOrchestrationSwitcherReturn {
  const [run, setRun] = useState<OrchestrationRun | null>(null);
  const [childThreadIds, setChildThreadIds] = useState<string[]>([]);
  const [tickets, setTickets] = useState<ReadonlyArray<TicketSummary>>([]);
  const [loading, setLoading] = useState(false);
  const fetchIdRef = useRef(0);

  // Determine orchestration role
  const isParent = activeThread?.isOrchestrationThread === true;
  const isChild = !isParent && activeThread?.parentThreadId != null;
  const parentThreadId = isParent ? activeThread?.id : activeThread?.parentThreadId;
  const isInOrchestration = isParent || isChild;

  // Read child threads from the Zustand store
  const threadsById = useStore((s) => s.threadsById);
  const childThreads = useMemo(
    () => childThreadIds.map((id) => threadsById[id]).filter((t): t is Thread => t != null),
    [childThreadIds, threadsById],
  );

  // Read parent thread title from store (for the "Timeline" sublabel)
  const parentTitle = useStore(
    useCallback(
      (s) => (parentThreadId ? (s.threadsById[parentThreadId]?.title ?? "Orchestration") : ""),
      [parentThreadId],
    ),
  );

  // ── Fetch run + child thread IDs + ticket summaries ──────────────
  const fetchData = useCallback(async () => {
    if (!parentThreadId || !projectId || !isInOrchestration) return;

    const currentFetchId = ++fetchIdRef.current;
    setLoading(true);

    try {
      const rpc = getWsRpcClient();

      // Find the run for this orchestration thread
      const runs = await rpc.orchestration.listRuns({
        projectId: projectId as ProjectId,
      });
      if (fetchIdRef.current !== currentFetchId) return;

      const matchingRun = runs.find((r) => r.orchestrationThreadId === parentThreadId);
      if (!matchingRun) {
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
      setChildThreadIds(children.map((c) => c.id));
      setTickets(ticketList);

      logWebTimeline("orchestration.switcher.fetch.success", {
        parentThreadId,
        runId: fullRun.id,
        runStatus: fullRun.status,
        childThreadCount: children.length,
        ticketCount: ticketList.length,
      });
    } catch (err) {
      if (fetchIdRef.current !== currentFetchId) return;
      warnWebTimeline("orchestration.switcher.fetch.error", {
        parentThreadId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (fetchIdRef.current === currentFetchId) {
        setLoading(false);
      }
    }
  }, [parentThreadId, projectId, isInOrchestration]);

  useEffect(() => {
    if (isInOrchestration) {
      void fetchData();
    } else {
      setRun(null);
      setChildThreadIds([]);
      setTickets([]);
    }
  }, [fetchData, isInOrchestration]);

  // ── Subscribe to run events ──────────────────────────────────────
  useEffect(() => {
    if (!projectId || !isInOrchestration || !parentThreadId) return;

    const rpc = getWsRpcClient();
    const unsubscribe = rpc.orchestration.onRunEvent(
      projectId as ProjectId,
      (event: OrchestrationRunStreamEvent) => {
        if (event.type === "run.updated" && event.run.orchestrationThreadId === parentThreadId) {
          logWebTimeline("orchestration.switcher.run-updated", {
            runId: event.run.id,
            status: event.run.status,
            currentTicketIndex: event.run.currentTicketIndex,
          });
          setRun(event.run);
        } else if (
          event.type === "run.created" &&
          event.run.orchestrationThreadId === parentThreadId
        ) {
          logWebTimeline("orchestration.switcher.run-created", {
            runId: event.run.id,
          });
          setRun(event.run);
          void fetchData();
        }
      },
    );

    return unsubscribe;
  }, [projectId, parentThreadId, isInOrchestration, fetchData]);

  // ── Build ticket lookup ──────────────────────────────────────────
  const ticketById = useMemo(() => {
    const map = new Map<string, TicketSummary>();
    for (const t of tickets) {
      map.set(t.id, t);
    }
    return map;
  }, [tickets]);

  // ── Build items ──────────────────────────────────────────────────
  const items = useMemo((): OrchestrationSwitcherItem[] => {
    if (!run || !parentThreadId) return [];

    const result: OrchestrationSwitcherItem[] = [
      {
        id: "timeline",
        kind: "timeline",
        label: "Timeline",
        sublabel: parentTitle,
        isActive: isParent,
        isStarted: true,
        threadId: parentThreadId,
      },
    ];

    for (let i = 0; i < run.ticketOrder.length; i++) {
      const entry = run.ticketOrder[i]!;
      const child = childThreads.find((t) => t.id === entry.workingThreadId);
      const ticket = ticketById.get(entry.ticketId);
      const isStarted = i <= run.currentTicketIndex && run.status !== "pending";

      result.push({
        id: entry.workingThreadId,
        kind: "working-thread",
        label: ticket?.identifier ?? `Ticket ${i + 1}`,
        sublabel: child?.title ?? ticket?.title ?? "",
        isActive: activeThread?.id === entry.workingThreadId,
        isStarted,
        threadId: entry.workingThreadId,
      });
    }

    return result;
  }, [run, parentThreadId, parentTitle, isParent, childThreads, ticketById, activeThread?.id]);

  // ── Determine current label ──────────────────────────────────────
  const currentLabel = useMemo(() => {
    if (isParent) return "Timeline";
    const active = items.find((i) => i.isActive);
    return active?.label ?? "Timeline";
  }, [isParent, items]);

  if (!isInOrchestration || !run) return EMPTY;

  return {
    visible: true,
    items,
    currentLabel,
    loading,
  };
}
