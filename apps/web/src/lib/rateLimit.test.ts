import { describe, expect, it } from "vitest";

import type { ProviderRateLimitsSnapshot } from "@t3tools/contracts";

import { deriveRateLimitSnapshot } from "./rateLimit";

describe("deriveRateLimitSnapshot", () => {
  it("labels Gemini model quota tiers and uses the first tier as primary", () => {
    const snapshot = deriveRateLimitSnapshot({
      provider: "gemini",
      rateLimitInfo: { status: "allowed" },
      updatedAt: "2026-04-18T12:00:00.000Z",
      oauthUsageTiers: [
        {
          tier: "gemini-3.1-pro-preview",
          utilization: 0.18666667,
          resetsAt: "2026-04-19T02:04:33Z",
        },
        {
          tier: "gemini-2.5-flash",
          utilization: 0.043,
          resetsAt: "2026-04-19T01:47:09Z",
        },
      ],
    } satisfies ProviderRateLimitsSnapshot);

    expect(snapshot.primaryTier?.tierLabel).toBe("3.1 Pro");
    expect(snapshot.primaryTier?.usedPercentage).toBeCloseTo(18.666667);
    expect(snapshot.oauthTiers.map((tier) => tier.tierLabel)).toEqual(["3.1 Pro", "2.5 Flash"]);
  });

  it("uses the friendly Claude Design label for the omelette quota tier", () => {
    const snapshot = deriveRateLimitSnapshot({
      provider: "claudeAgent",
      rateLimitInfo: { status: "allowed" },
      updatedAt: "2026-04-18T12:00:00.000Z",
      oauthUsageTiers: [
        {
          tier: "seven_day_omelette",
          utilization: 0.78,
          resetsAt: "2026-04-21T08:00:00Z",
        },
      ],
    } satisfies ProviderRateLimitsSnapshot);

    expect(snapshot.primaryTier?.tierLabel).toBe("Claude Design");
    expect(snapshot.oauthTiers.map((tier) => tier.tierLabel)).toEqual(["Claude Design"]);
  });
});
