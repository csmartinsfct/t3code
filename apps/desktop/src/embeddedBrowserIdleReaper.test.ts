import { describe, expect, it } from "vitest";

import { shouldSuspendForIdle } from "./embeddedBrowserIdleReaper";

describe("shouldSuspendForIdle", () => {
  const now = 1_700_000_000_000;
  const thresholdMs = 30 * 60 * 1000;

  it("returns false when the project is mounted, regardless of idle time", () => {
    expect(
      shouldSuspendForIdle({
        project: { mounted: true, suspended: false, lastActivityAt: now - 60 * 60 * 1000 },
        thresholdMs,
        now,
      }),
    ).toBe(false);
  });

  it("returns false when the project is already suspended", () => {
    expect(
      shouldSuspendForIdle({
        project: { mounted: false, suspended: true, lastActivityAt: now - 60 * 60 * 1000 },
        thresholdMs,
        now,
      }),
    ).toBe(false);
  });

  it("returns false when activity is fresh (idle < threshold)", () => {
    expect(
      shouldSuspendForIdle({
        project: { mounted: false, suspended: false, lastActivityAt: now - 5 * 60 * 1000 },
        thresholdMs,
        now,
      }),
    ).toBe(false);
  });

  it("returns true when an unmounted project's activity is older than the threshold", () => {
    expect(
      shouldSuspendForIdle({
        project: { mounted: false, suspended: false, lastActivityAt: now - 31 * 60 * 1000 },
        thresholdMs,
        now,
      }),
    ).toBe(true);
  });

  it("returns false when threshold is 0 (suspension disabled)", () => {
    expect(
      shouldSuspendForIdle({
        project: { mounted: false, suspended: false, lastActivityAt: 0 },
        thresholdMs: 0,
        now,
      }),
    ).toBe(false);
  });

  it("returns false at the exact threshold boundary", () => {
    expect(
      shouldSuspendForIdle({
        project: { mounted: false, suspended: false, lastActivityAt: now - thresholdMs },
        thresholdMs,
        now,
      }),
    ).toBe(false);
  });
});
