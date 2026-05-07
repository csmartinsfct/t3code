export function resolveInitialManagementProjectId(input: {
  orderedProjectIds: readonly string[];
  latestManagementBoardProjectId: string | null;
}): string | null {
  return (
    input.orderedProjectIds.find(
      (projectId) => projectId === input.latestManagementBoardProjectId,
    ) ??
    input.orderedProjectIds[0] ??
    null
  );
}
