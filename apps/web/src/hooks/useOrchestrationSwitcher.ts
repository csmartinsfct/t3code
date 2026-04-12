import type { OrchestrationRun, TicketSummary } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { useStore } from "../store";
import type { Thread } from "../types";
import type { UseOrchestrationDataReturn } from "./useOrchestrationData";
import { buildOrchestrationSwitcherItems } from "./useOrchestrationSwitcher.logic";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface OrchestrationSwitcherItem {
  id: string;
  kind: "timeline" | "working-thread" | "review-thread";
  label: string;
  sublabel: string;
  isActive: boolean;
  isStarted: boolean;
  threadId: string;
}

export interface UseOrchestrationSwitcherReturn {
  visible: boolean;
  run: OrchestrationRun | null;
  items: OrchestrationSwitcherItem[];
  currentLabel: string;
  loading: boolean;
  ticketById: ReadonlyMap<string, TicketSummary>;
}

const EMPTY: UseOrchestrationSwitcherReturn = {
  visible: false,
  run: null,
  items: [],
  currentLabel: "",
  loading: false,
  ticketById: new Map(),
};

// ---------------------------------------------------------------------------
// Pure derivation hook — no RPCs, no subscriptions
// ---------------------------------------------------------------------------

export function useOrchestrationSwitcherDerived(
  data: UseOrchestrationDataReturn,
  activeThread: Thread | null | undefined,
): UseOrchestrationSwitcherReturn {
  const { run, tickets, loading, isInOrchestration, isParent, parentThreadId, childThreads } = data;

  // Read parent thread title from store (for the "Timeline" sublabel)
  const parentTitle = useStore(
    useCallback(
      (s) => (parentThreadId ? (s.threadsById[parentThreadId]?.title ?? "Orchestration") : ""),
      [parentThreadId],
    ),
  );

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
    return buildOrchestrationSwitcherItems({
      run,
      parentThreadId,
      parentTitle,
      isParent,
      childThreads,
      ticketById,
      activeThreadId: activeThread?.id,
    });
  }, [run, parentThreadId, parentTitle, isParent, childThreads, ticketById, activeThread?.id]);

  // ── Determine current label ──────────────────────────────────────
  const currentLabel = useMemo(() => {
    if (isParent) return parentTitle || "Timeline";
    const active = items.find((i) => i.isActive);
    return active?.label ?? (parentTitle || "Timeline");
  }, [isParent, parentTitle, items]);

  if (!isInOrchestration || !run) return EMPTY;

  return {
    visible: true,
    run,
    items,
    currentLabel,
    loading,
    ticketById,
  };
}
