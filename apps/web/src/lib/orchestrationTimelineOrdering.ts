import type { OrchestrationThreadActivity } from "@t3tools/contracts";

export interface OrchestrationTimelineInstant {
  createdAt: string;
  phaseRank: number;
  stableId: string;
}

export function activityLifecycleRank(kind: string): number {
  if (kind.endsWith(".started") || kind === "tool.started") {
    return 0;
  }
  if (
    kind.endsWith(".completed") ||
    kind.endsWith(".resolved") ||
    kind.endsWith(".requested-changes") ||
    kind.endsWith(".approved") ||
    kind.endsWith(".exhausted")
  ) {
    return 3;
  }
  if (kind.endsWith(".progress") || kind.endsWith(".updated")) {
    return 2;
  }
  return 2;
}

export function compareOrchestrationActivities(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const lifecycleRankComparison =
    activityLifecycleRank(left.kind) - activityLifecycleRank(right.kind);
  if (lifecycleRankComparison !== 0) {
    return lifecycleRankComparison;
  }

  return left.id.localeCompare(right.id);
}

export function compareOrchestrationTimelineInstants(
  left: OrchestrationTimelineInstant,
  right: OrchestrationTimelineInstant,
): number {
  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const phaseComparison = left.phaseRank - right.phaseRank;
  if (phaseComparison !== 0) {
    return phaseComparison;
  }

  return left.stableId.localeCompare(right.stableId);
}
