/**
 * ProviderRateLimitsCacheLive - In-memory Ref + PubSub implementation.
 *
 * @module ProviderRateLimitsCacheLive
 */
import {
  asProviderInput,
  type OAuthUsageTier,
  type ProviderKind,
  type ProviderRateLimitInfo,
  type ProviderRateLimitsSnapshot,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, Ref, Stream } from "effect";

import {
  ProviderRateLimitsCache,
  type ProviderRateLimitsCacheShape,
} from "../Services/ProviderRateLimitsCache";

export const ProviderRateLimitsCacheLive = Layer.effect(
  ProviderRateLimitsCache,
  Effect.gen(function* () {
    const cacheRef = yield* Ref.make<Map<string, ProviderRateLimitsSnapshot>>(new Map());
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ReadonlyArray<ProviderRateLimitsSnapshot>>(),
      PubSub.shutdown,
    );

    const snapshotArray = (
      map: Map<string, ProviderRateLimitsSnapshot>,
    ): ReadonlyArray<ProviderRateLimitsSnapshot> => Array.from(map.values());

    /**
     * Merge `incoming` rate-limit info with an optional `existing` snapshot,
     * keeping previously known fields that the new event omits (e.g.
     * `utilization` is only sent for `allowed_warning`/`rejected` by the
     * Claude SDK; we don't want to lose it on the next `allowed` event).
     */
    const mergeRateLimitInfo = (
      incoming: ProviderRateLimitInfo,
      existing: ProviderRateLimitInfo | undefined,
    ): ProviderRateLimitInfo => {
      if (!existing) return incoming;
      return {
        status: incoming.status,
        rateLimitType: incoming.rateLimitType ?? existing.rateLimitType,
        utilization: incoming.utilization ?? existing.utilization,
        resetsAt: incoming.resetsAt ?? existing.resetsAt,
        isUsingOverage: incoming.isUsingOverage ?? existing.isUsingOverage,
        overageStatus: incoming.overageStatus ?? existing.overageStatus,
        overageResetsAt: incoming.overageResetsAt ?? existing.overageResetsAt,
        overageDisabledReason: incoming.overageDisabledReason ?? existing.overageDisabledReason,
        surpassedThreshold: incoming.surpassedThreshold ?? existing.surpassedThreshold,
      };
    };

    const set: ProviderRateLimitsCacheShape["set"] = (
      provider: ProviderKind,
      info: ProviderRateLimitInfo,
    ) =>
      Effect.gen(function* () {
        const nextMap = yield* Ref.updateAndGet(cacheRef, (map) => {
          const existing = map.get(provider);
          const merged = mergeRateLimitInfo(info, existing?.rateLimitInfo);
          const snapshot: ProviderRateLimitsSnapshot = {
            provider: asProviderInput(provider),
            rateLimitInfo: merged,
            updatedAt: new Date().toISOString(),
            // Preserve OAuth tiers from a previous fetch.
            ...(existing?.oauthUsageTiers ? { oauthUsageTiers: existing.oauthUsageTiers } : {}),
          };
          const next = new Map(map);
          next.set(provider, snapshot);
          return next;
        });
        yield* PubSub.publish(changesPubSub, snapshotArray(nextMap));
      });

    const setOAuthTiers: ProviderRateLimitsCacheShape["setOAuthTiers"] = (
      provider: ProviderKind,
      tiers: ReadonlyArray<OAuthUsageTier>,
      warning?: string,
    ) =>
      Effect.gen(function* () {
        const nextMap = yield* Ref.updateAndGet(cacheRef, (map) => {
          const existing = map.get(provider);
          const snapshot: ProviderRateLimitsSnapshot = existing
            ? {
                ...existing,
                oauthUsageTiers: [...tiers],
                updatedAt: new Date().toISOString(),
                ...(warning !== undefined
                  ? { fetchWarning: warning }
                  : { fetchWarning: undefined }),
              }
            : {
                provider: asProviderInput(provider),
                rateLimitInfo: { status: "allowed" },
                updatedAt: new Date().toISOString(),
                oauthUsageTiers: [...tiers],
                ...(warning !== undefined ? { fetchWarning: warning } : {}),
              };
          const next = new Map(map);
          next.set(provider, snapshot);
          return next;
        });
        yield* PubSub.publish(changesPubSub, snapshotArray(nextMap));
      });

    return {
      set,
      setOAuthTiers,
      get getAll() {
        return Ref.get(cacheRef).pipe(Effect.map(snapshotArray));
      },
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies ProviderRateLimitsCacheShape;
  }),
);
