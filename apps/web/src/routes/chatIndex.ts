export function resolveInitialManagementProjectId(input: {
  orderedProjectIds: readonly string[];
  managementLastProjectId: string | null;
}): string | null {
  return (
    input.orderedProjectIds.find((projectId) => projectId === input.managementLastProjectId) ??
    input.orderedProjectIds[0] ??
    null
  );
}
