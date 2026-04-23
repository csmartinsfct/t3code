/**
 * ProviderMcpStatusCache - Project-scoped MCP status snapshots.
 *
 * Claude MCP status is live SDK state, not just parsed config. This cache
 * owns short-lived background probes and shares their results across all
 * threads in the same project/workspace.
 *
 * @module ProviderMcpStatusCache
 */
import type { ProjectId, ProviderKind, ResolvedMcpProviderSnapshot } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

export type ProviderMcpStatusInvalidationReason = "mcp-config" | "provider-settings";

export interface ProviderMcpStatusCacheShape {
  readonly ensureClaudeProject: (input: {
    readonly projectId: ProjectId;
    readonly cwd: string;
    readonly selectedProvider: ProviderKind;
    readonly forceRefresh?: boolean;
  }) => Effect.Effect<{
    readonly selected: ResolvedMcpProviderSnapshot;
    readonly snapshots: ReadonlyArray<ResolvedMcpProviderSnapshot>;
  }>;

  readonly invalidateAll: (reason: ProviderMcpStatusInvalidationReason) => Effect.Effect<void>;

  readonly getAll: Effect.Effect<ReadonlyArray<ResolvedMcpProviderSnapshot>>;

  readonly streamChanges: Stream.Stream<ReadonlyArray<ResolvedMcpProviderSnapshot>>;
}

export class ProviderMcpStatusCache extends ServiceMap.Service<
  ProviderMcpStatusCache,
  ProviderMcpStatusCacheShape
>()("t3/provider/Services/ProviderMcpStatusCache") {}
