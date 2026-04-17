import { useCallback, useMemo } from "react";

import { isThreadContentLoaded, useStore } from "../store";
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
    if (!parentThread || !isThreadContentLoaded(parentThread)) {
      return [{ kind: "loading", id: "loading" }];
    }

    const childThreadsById = new Map(childThreads.map((thread) => [thread.id, thread]));
    const requiredChildThreadIds = run.ticketOrder.flatMap((entry) =>
      entry.reviewThreadId
        ? [entry.workingThreadId, entry.reviewThreadId]
        : [entry.workingThreadId],
    );
    const hasUnhydratedRequiredChild = requiredChildThreadIds.some((threadId) => {
      const thread = childThreadsById.get(threadId);
      return !thread || !isThreadContentLoaded(thread);
    });
    if (hasUnhydratedRequiredChild) {
      return [{ kind: "loading", id: "loading" }];
    }

    const rows = buildOrchestrationTimelineRows({
      parentActivities: parentThread?.activities ?? [],
      childThreads,
      run,
    });

    return rows.length > 0 ? rows : [{ kind: "empty", id: "empty" }];
  }, [loading, run, parentThread, childThreads]);

  return { loading, timelineRows };
}
