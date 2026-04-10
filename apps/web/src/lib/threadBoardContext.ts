import type { ProjectId, ThreadId } from "@t3tools/contracts";

interface ResolveThreadBoardContextSourceThreadIdInput {
  routeThreadId: ThreadId | null;
  targetProjectId: ProjectId;
  activeThreadProjectId?: ProjectId | null;
  activeDraftThreadProjectId?: ProjectId | null;
}

export function resolveThreadBoardContextSourceThreadId(
  input: ResolveThreadBoardContextSourceThreadIdInput,
): ThreadId | null {
  const {
    routeThreadId,
    targetProjectId,
    activeThreadProjectId = null,
    activeDraftThreadProjectId = null,
  } = input;

  if (!routeThreadId) {
    return null;
  }

  return activeThreadProjectId === targetProjectId || activeDraftThreadProjectId === targetProjectId
    ? routeThreadId
    : null;
}
