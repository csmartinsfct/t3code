import type { ProjectListDirectoryResult } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const fileExplorerQueryKeys = {
  all: ["file-explorer"] as const,
  dir: (cwd: string | null, path: string) => ["file-explorer", "dir", cwd, path] as const,
  file: (cwd: string | null, relativePath: string | null) =>
    ["file-explorer", "file", cwd, relativePath] as const,
};

const DEFAULT_DIR_STALE_TIME = 10_000;
const DEFAULT_FILE_STALE_TIME = 30_000;
const EMPTY_DIR_RESULT: ProjectListDirectoryResult = { entries: [] };

export function fileExplorerDirQueryOptions(input: {
  cwd: string | null;
  path: string;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: fileExplorerQueryKeys.dir(input.cwd, input.path),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Directory listing unavailable: no workspace root.");
      }
      return api.projects.listDirectory({ cwd: input.cwd, path: input.path });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: input.staleTime ?? DEFAULT_DIR_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_DIR_RESULT,
  });
}

export function fileExplorerReadFileQueryOptions(input: {
  cwd: string | null;
  relativePath: string | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: fileExplorerQueryKeys.file(input.cwd, input.relativePath),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd || !input.relativePath) {
        throw new Error("File read unavailable: missing cwd or path.");
      }
      return api.projects.readFile({ cwd: input.cwd, relativePath: input.relativePath });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.relativePath !== null,
    staleTime: input.staleTime ?? DEFAULT_FILE_STALE_TIME,
    retry: false,
  });
}
