import { useCallback, useMemo } from "react";

import { useStore } from "../store";
import type { Thread } from "../types";
import type { UseOrchestrationDataReturn } from "./useOrchestrationData";
import {
  buildOrchestrationTimelineRows,
  type OrchestrationTimelineRow,
} from "./useOrchestrationTimeline.logic";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface UseOrchestrationTimelineRowsReturn {
  loading: boolean;
  timelineRows: OrchestrationTimelineRow[];
}

// ---------------------------------------------------------------------------
// Pure derivation hook — no RPCs, no subscriptions
// ---------------------------------------------------------------------------

export function useOrchestrationTimelineRows(
  data: UseOrchestrationDataReturn,
): UseOrchestrationTimelineRowsReturn {
  const { loading, run, childThreads, parentThreadId } = data;

  const parentThread = useStore(
    useCallback(
      (s) => (parentThreadId !== null ? s.threadsById[parentThreadId] : undefined),
      [parentThreadId],
    ),
  );

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

  return { loading, timelineRows };
}
