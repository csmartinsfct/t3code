export interface FileExplorerRouteSearch {
  fileExplorer?: "1" | undefined;
}

function isFileExplorerOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

export function stripFileExplorerSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "fileExplorer"> {
  const { fileExplorer: _fileExplorer, ...rest } = params;
  return rest as Omit<T, "fileExplorer">;
}

export function parseFileExplorerRouteSearch(
  search: Record<string, unknown>,
): FileExplorerRouteSearch {
  const fileExplorer = isFileExplorerOpenValue(search.fileExplorer) ? "1" : undefined;
  return {
    ...(fileExplorer ? { fileExplorer } : {}),
  };
}
