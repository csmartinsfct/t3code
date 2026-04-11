import type { ChangelogAssetFile } from "@t3tools/contracts";
import { ChangelogAssetFile as ChangelogAssetFileSchema } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { Schema } from "effect";

export const changelogQueryKeys = {
  all: ["changelog"] as const,
  asset: () => ["changelog", "asset"] as const,
};

function normalizeLegacyChangelogAsset(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }

  const record = raw as Record<string, unknown>;
  const provenance =
    record.provenance && typeof record.provenance === "object"
      ? ({ ...(record.provenance as Record<string, unknown>) } satisfies Record<string, unknown>)
      : null;

  if (!provenance || "rebuildCommitLimit" in provenance) {
    return raw;
  }

  provenance.rebuildCommitLimit = 50;
  return {
    ...record,
    provenance,
  };
}

export function changelogQueryOptions() {
  return queryOptions({
    queryKey: changelogQueryKeys.asset(),
    queryFn: async (): Promise<ChangelogAssetFile> => {
      const response = await fetch("/generated/changelog.json", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const raw = normalizeLegacyChangelogAsset(await response.json());
      return Schema.decodeUnknownSync(ChangelogAssetFileSchema)(raw);
    },
    staleTime: Infinity,
  });
}
