import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { RateLimitSnapshot } from "../../lib/rateLimit";
import { RateLimitMeter } from "./RateLimitMeter";

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
  };
}

async function mountMeter(rateLimit = createRateLimitSnapshot()) {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(<RateLimitMeter rateLimit={rateLimit} />, { container: host });

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("RateLimitMeter", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses the primary tier for the trigger label and popover ordering", async () => {
    const mounted = await mountMeter();

    try {
      const trigger = page.getByRole("button", { name: "Rate limit 82% used" });
      await trigger.hover();

      await expect.element(page.getByText("Usage")).toBeInTheDocument();
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
});
