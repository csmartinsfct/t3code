import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { RateLimitSnapshot } from "../../lib/rateLimit";
import { RateLimitMeter } from "./RateLimitMeter";

const nativeApiMocks = vi.hoisted(() => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
}));

vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({
    server: {
      consumeCodexRateLimitResetCredit: nativeApiMocks.consumeCodexRateLimitResetCredit,
    },
  }),
}));

function createRateLimitSnapshot(): RateLimitSnapshot {
  const resetsAt = new Date("2026-04-11T12:30:00.000Z");
  return {
    status: "allowed",
    usedPercentage: 82,
    utilization: 0.82,
    rateLimitTypeLabel: "5h",
    rateLimitType: "five_hour",
    resetsAt,
    isUsingOverage: false,
    overageStatus: null,
    overageResetsAt: null,
    overageDisabledReason: null,
    updatedAt: "2026-04-11T12:00:00.000Z",
    provider: "claudeAgent:metric",
    oauthTiers: [
      {
        tier: "five_hour",
        tierLabel: "5h",
        utilization: 0.82,
        usedPercentage: 82,
        resetsAt,
      },
      {
        tier: "seven_day_sonnet",
        tierLabel: "Weekly (Sonnet)",
        utilization: 0.21,
        usedPercentage: 21,
        resetsAt: new Date("2026-04-18T12:00:00.000Z"),
      },
    ],
    primaryTier: {
      tier: "five_hour",
      tierLabel: "5h",
      utilization: 0.82,
      usedPercentage: 82,
      resetsAt,
    },
    fetchWarning: "Usage data is temporarily unavailable while the provider backs off.",
    resetCredits: null,
  };
}

async function mountMeter(rateLimit = createRateLimitSnapshot()) {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(<RateLimitMeter rateLimit={rateLimit} />, { container: host });

  return {
    rerender: async (nextRateLimit: RateLimitSnapshot) => {
      await screen.rerender(<RateLimitMeter rateLimit={nextRateLimit} />);
    },
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("RateLimitMeter", () => {
  beforeEach(() => {
    nativeApiMocks.consumeCodexRateLimitResetCredit.mockReset();
    nativeApiMocks.consumeCodexRateLimitResetCredit.mockResolvedValue({ outcome: "reset" });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses the primary tier for the trigger label and popover ordering", async () => {
    const mounted = await mountMeter();

    try {
      const trigger = page.getByRole("button", { name: "Rate limit 82% used" });
      await trigger.hover();

      await expect.element(page.getByText("Usage", { exact: true })).toBeInTheDocument();
      const content = document.body.textContent ?? "";
      expect(content).toContain("5h");
      expect(content).toContain("Weekly (Sonnet)");
      expect(content.indexOf("5h")).toBeLessThan(content.indexOf("Weekly (Sonnet)"));
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows the fetch warning inside the popover", async () => {
    const mounted = await mountMeter();

    try {
      const trigger = page.getByRole("button", { name: "Rate limit 82% used" });
      await trigger.click();

      await expect
        .element(
          page.getByText("Usage data is temporarily unavailable while the provider backs off."),
        )
        .toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows earned Codex resets with the soonest expiration and consumes that credit", async () => {
    const snapshot = createRateLimitSnapshot();
    const mounted = await mountMeter({
      ...snapshot,
      provider: "codex:metric",
      resetCredits: {
        availableCount: 2,
        credits: [
          {
            id: "later-reset",
            status: "available",
            expiresAt: new Date("2026-08-22T12:00:00.000Z"),
            title: null,
            description: null,
          },
          {
            id: "next-reset",
            status: "available",
            expiresAt: new Date("2026-08-12T12:00:00.000Z"),
            title: null,
            description: null,
          },
        ],
      },
    });

    try {
      await page.getByRole("button", { name: "Rate limit 82% used" }).hover();

      await expect.element(page.getByText("2 resets available")).toBeInTheDocument();
      await expect.element(page.getByText(/^Expires /)).toBeInTheDocument();

      await page.getByRole("button", { name: "Use Codex usage reset" }).click();

      await vi.waitFor(() => {
        expect(nativeApiMocks.consumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(1);
      });
      expect(nativeApiMocks.consumeCodexRateLimitResetCredit).toHaveBeenCalledWith({
        provider: "codex:metric",
        creditId: "next-reset",
        idempotencyKey: expect.any(String),
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("omits a credit id when Codex only reports the authoritative count", async () => {
    const snapshot = createRateLimitSnapshot();
    const mounted = await mountMeter({
      ...snapshot,
      provider: "codex",
      resetCredits: {
        availableCount: 1,
        credits: null,
      },
    });

    try {
      await page.getByRole("button", { name: "Rate limit 82% used" }).click();
      await page.getByRole("button", { name: "Use Codex usage reset" }).click();

      await vi.waitFor(() => {
        expect(nativeApiMocks.consumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(1);
      });
      expect(nativeApiMocks.consumeCodexRateLimitResetCredit).toHaveBeenCalledWith({
        provider: "codex",
        idempotencyKey: expect.any(String),
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("retries the exact redemption attempt when refreshed credit details change", async () => {
    nativeApiMocks.consumeCodexRateLimitResetCredit
      .mockRejectedValueOnce(new Error("Temporary connection failure"))
      .mockResolvedValueOnce({ outcome: "reset" });
    const snapshot = createRateLimitSnapshot();
    const initialRateLimit: RateLimitSnapshot = {
      ...snapshot,
      provider: "codex",
      resetCredits: {
        availableCount: 2,
        credits: [
          {
            id: "retry-reset",
            status: "available",
            expiresAt: new Date("2026-08-12T12:00:00.000Z"),
            title: null,
            description: null,
          },
          {
            id: "later-reset",
            status: "available",
            expiresAt: new Date("2026-08-22T12:00:00.000Z"),
            title: null,
            description: null,
          },
        ],
      },
    };
    const mounted = await mountMeter(initialRateLimit);

    try {
      await page.getByRole("button", { name: "Rate limit 82% used" }).click();
      const consumeButton = page.getByRole("button", { name: "Use Codex usage reset" });
      await consumeButton.click();
      await vi.waitFor(() => {
        expect(nativeApiMocks.consumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(1);
      });

      await mounted.rerender({
        ...initialRateLimit,
        resetCredits: {
          availableCount: 1,
          credits: [
            {
              id: "refreshed-reset",
              status: "available",
              expiresAt: new Date("2026-08-10T12:00:00.000Z"),
              title: null,
              description: null,
            },
          ],
        },
      });
      await consumeButton.click();
      await vi.waitFor(() => {
        expect(nativeApiMocks.consumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(2);
      });

      const [firstAttempt, retryAttempt] =
        nativeApiMocks.consumeCodexRateLimitResetCredit.mock.calls;
      expect(firstAttempt?.[0].creditId).toBe("retry-reset");
      expect(retryAttempt?.[0].creditId).toBe("retry-reset");
      expect(retryAttempt?.[0].idempotencyKey).toBe(firstAttempt?.[0].idempotencyKey);
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not show reset controls for non-Codex providers", async () => {
    const snapshot = createRateLimitSnapshot();
    const mounted = await mountMeter({
      ...snapshot,
      resetCredits: {
        availableCount: 1,
        credits: null,
      },
    });

    try {
      await page.getByRole("button", { name: "Rate limit 82% used" }).click();
      await expect
        .element(page.getByRole("button", { name: "Use Codex usage reset" }))
        .not.toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });
});
