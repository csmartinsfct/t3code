import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { ProviderRateLimitsCache } from "../Services/ProviderRateLimitsCache";
import { ProviderRateLimitsCacheLive } from "./ProviderRateLimitsCache";

describe("ProviderRateLimitsCache", () => {
  it("preserves reset credits across sparse usage updates and clears them explicitly", async () => {
    const snapshots = await Effect.runPromise(
      Effect.gen(function* () {
        const cache = yield* ProviderRateLimitsCache;
        yield* cache.setResetCredits("codex", {
          availableCount: 1,
          credits: [
            {
              id: "credit-1",
              resetType: "codexRateLimits",
              status: "available",
              grantedAt: 1_784_000_000,
              expiresAt: 1_786_000_000,
              title: "Full reset",
              description: null,
            },
          ],
        });
        yield* cache.set("codex", {
          status: "allowed_warning",
          utilization: 0.94,
        });
        const preserved = yield* cache.getAll;
        yield* cache.setResetCredits("codex", null);
        const cleared = yield* cache.getAll;
        return { preserved, cleared };
      }).pipe(Effect.provide(ProviderRateLimitsCacheLive), Effect.scoped),
    );

    expect(snapshots.preserved[0]?.resetCredits).toMatchObject({
      availableCount: 1,
      credits: [{ id: "credit-1" }],
    });
    expect(snapshots.cleared[0]).not.toHaveProperty("resetCredits");
  });

  it("updates reset credits without changing cached usage warnings", async () => {
    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const cache = yield* ProviderRateLimitsCache;
        yield* cache.set("codex", {
          status: "allowed_warning",
          utilization: 0.94,
        });
        yield* cache.setOAuthTiers(
          "codex",
          [{ tier: "five_hour", utilization: 0.94, resetsAt: null }],
          "Usage refresh is temporarily degraded",
        );
        yield* cache.setResetCredits("codex", {
          availableCount: 1,
          credits: null,
        });
        return (yield* cache.getAll)[0];
      }).pipe(Effect.provide(ProviderRateLimitsCacheLive), Effect.scoped),
    );

    expect(snapshot).toMatchObject({
      rateLimitInfo: {
        status: "allowed_warning",
        utilization: 0.94,
      },
      fetchWarning: "Usage refresh is temporarily degraded",
      resetCredits: {
        availableCount: 1,
        credits: null,
      },
    });
  });

  it("does not create a usage snapshot when clearing absent reset credits", async () => {
    const snapshots = await Effect.runPromise(
      Effect.gen(function* () {
        const cache = yield* ProviderRateLimitsCache;
        yield* cache.setResetCredits("codex", null);
        return yield* cache.getAll;
      }).pipe(Effect.provide(ProviderRateLimitsCacheLive), Effect.scoped),
    );

    expect(snapshots).toEqual([]);
  });
});
