import type { ChangelogAssetFile } from "@t3tools/contracts";
import { ChangelogAssetFile as ChangelogAssetFileSchema } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { Schema } from "effect";

export const changelogQueryKeys = {
  all: ["changelog"] as const,
  asset: () => ["changelog", "asset"] as const,
};

export function changelogQueryOptions() {
  return queryOptions({
    queryKey: changelogQueryKeys.asset(),
    queryFn: async (): Promise<ChangelogAssetFile> => {
      const response = await fetch("/generated/changelog.json", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return Schema.decodeUnknownSync(ChangelogAssetFileSchema)(await response.json());
    },
    staleTime: Infinity,
  });
}
