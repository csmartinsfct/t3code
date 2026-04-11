export function resolveInitialManagementProjectId(input: {
  orderedProjectIds: readonly string[];
  managementBoardProjectId: string | null;
}): string | null {
  return (
    input.orderedProjectIds.find((projectId) => projectId === input.managementBoardProjectId) ??
    input.orderedProjectIds[0] ??
    null
  );
}
