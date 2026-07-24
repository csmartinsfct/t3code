/**
 * ProviderRateLimitsCache - In-memory cache for account-level rate-limit info.
 *
 * Rate limits are provider-scoped (not thread-scoped).  When any thread
 * receives a `account.rate-limits.updated` runtime event the cache is updated
 * for the originating provider, and all WebSocket subscribers are notified so
 * the UI can display up-to-date utilization across every thread.
 *
 * @module ProviderRateLimitsCache
 */
import type {
  OAuthUsageTier,
  ProviderKind,
  ProviderRateLimitInfo,
  ProviderRateLimitResetCreditsSummary,
  ProviderRateLimitsSnapshot,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

export interface ProviderRateLimitsCacheShape {
  /**
   * Update (or insert) the latest rate-limit info for a provider.
   */
  readonly set: (provider: ProviderKind, info: ProviderRateLimitInfo) => Effect.Effect<void>;

  /**
   * Merge multi-tier OAuth usage data into the existing snapshot for a
   * provider.  Creates a minimal snapshot when none exists.
   *
   * When `warning` is provided it is stored on the snapshot so the client
   * can display a degraded-state message (e.g. API 429 backoff).  Passing
   * `undefined` clears any previous warning.
   */
  readonly setOAuthTiers: (
    provider: ProviderKind,
    tiers: ReadonlyArray<OAuthUsageTier>,
    warning?: string,
  ) => Effect.Effect<void>;

  /**
   * Replace the authoritative earned-reset summary. Passing `null` clears a
   * previously cached summary; sparse provider notifications should not call
   * this method.
   */
  readonly setResetCredits: (
    provider: ProviderKind,
    summary: ProviderRateLimitResetCreditsSummary | null,
  ) => Effect.Effect<void>;

  /**
   * Read all cached rate-limit snapshots.
   */
  readonly getAll: Effect.Effect<ReadonlyArray<ProviderRateLimitsSnapshot>>;

  /**
   * Stream that emits the full snapshot array whenever any provider's
   * rate-limit info changes.
   */
  readonly streamChanges: Stream.Stream<ReadonlyArray<ProviderRateLimitsSnapshot>>;
}

export class ProviderRateLimitsCache extends ServiceMap.Service<
  ProviderRateLimitsCache,
  ProviderRateLimitsCacheShape
>()("t3/provider/Services/ProviderRateLimitsCache") {}
