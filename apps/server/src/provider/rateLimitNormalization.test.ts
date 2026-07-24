import { describe, expect, it } from "vitest";

import { normalizeRateLimitPayload } from "./rateLimitNormalization";

describe("normalizeRateLimitPayload", () => {
  it("normalizes Codex windows and earned reset-credit details from a full read", () => {
    const normalized = normalizeRateLimitPayload({
      rateLimits: {
        rateLimits: {
          primary: {
            usedPercent: 94,
            windowDurationMins: 300,
            resetsAt: 1_785_000_000,
          },
          secondary: {
            usedPercent: 52,
            windowDurationMins: 10_080,
            resetsAt: 1_785_500_000,
          },
        },
        rateLimitResetCredits: {
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
        },
      },
    });

    expect(normalized).toMatchObject({
      info: {
        status: "allowed_warning",
        utilization: 0.94,
        rateLimitType: "five_hour",
        resetsAt: 1_785_000_000,
      },
      tiers: [
        {
          tier: "five_hour",
          utilization: 0.94,
        },
        {
          tier: "seven_day",
          utilization: 0.52,
        },
      ],
      resetCredits: {
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
      },
    });
  });

  it("distinguishes sparse notifications from an authoritative reset-credit clear", () => {
    const sparse = normalizeRateLimitPayload({
      rateLimits: {
        primary: { used_percent: 25, window_minutes: 300 },
      },
    });
    const cleared = normalizeRateLimitPayload({
      rateLimits: {
        primary: { used_percent: 25, window_minutes: 300 },
        rateLimitResetCredits: null,
      },
    });

    expect(sparse).not.toHaveProperty("resetCredits");
    expect(cleared).toHaveProperty("resetCredits", null);
  });

  it("keeps credit details when optional display metadata is omitted", () => {
    const normalized = normalizeRateLimitPayload({
      rateLimits: {
        primary: { usedPercent: 25, windowDurationMins: 300 },
        rateLimitResetCredits: {
          availableCount: 1,
          credits: [
            {
              id: "credit-with-minimal-metadata",
              resetType: "codexRateLimits",
              status: "available",
              grantedAt: 1_784_000_000,
              expiresAt: 1_786_000_000,
            },
          ],
        },
      },
    });

    expect(normalized?.resetCredits).toEqual({
      availableCount: 1,
      credits: [
        {
          id: "credit-with-minimal-metadata",
          resetType: "codexRateLimits",
          status: "available",
          grantedAt: 1_784_000_000,
          expiresAt: 1_786_000_000,
          title: null,
          description: null,
        },
      ],
    });
  });

  it("does not fabricate usage info for a reset-credit-only payload", () => {
    const normalized = normalizeRateLimitPayload({
      rateLimits: {
        rateLimits: {
          primary: null,
          secondary: null,
        },
        rateLimitResetCredits: {
          availableCount: 1,
          credits: null,
        },
      },
    });

    expect(normalized).toEqual({
      tiers: [],
      resetCredits: {
        availableCount: 1,
        credits: null,
      },
    });
  });

  it("does not expose an unsafe available count through the JSON contract", () => {
    const normalized = normalizeRateLimitPayload({
      rateLimits: {
        primary: { used_percent: 25, window_minutes: 300 },
        rateLimitResetCredits: {
          availableCount: Number.MAX_SAFE_INTEGER + 1,
          credits: null,
        },
      },
    });

    expect(normalized).not.toHaveProperty("resetCredits");
  });
});
