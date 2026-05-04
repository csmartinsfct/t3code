import { describe, expect, it } from "vitest";
import {
  DEFAULT_IDLE_BROWSER_SUSPEND_MINUTES,
  extractPersistedServerObservabilitySettings,
  normalizePersistedServerSettingString,
  parsePersistedBrowserSuspendMinutes,
  parsePersistedServerObservabilitySettings,
} from "./serverSettings";

describe("serverSettings helpers", () => {
  it("normalizes optional persisted strings", () => {
    expect(normalizePersistedServerSettingString(undefined)).toBeUndefined();
    expect(normalizePersistedServerSettingString("   ")).toBeUndefined();
    expect(normalizePersistedServerSettingString("  http://localhost:4318/v1/traces  ")).toBe(
      "http://localhost:4318/v1/traces",
    );
  });

  it("extracts persisted observability settings", () => {
    expect(
      extractPersistedServerObservabilitySettings({
        observability: {
          otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
          otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
        },
      }),
    ).toEqual({
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpMetricsUrl: "http://localhost:4318/v1/metrics",
    });
  });

  it("parses lenient persisted settings JSON", () => {
    expect(
      parsePersistedServerObservabilitySettings(
        JSON.stringify({
          observability: {
            otlpTracesUrl: "http://localhost:4318/v1/traces",
            otlpMetricsUrl: "http://localhost:4318/v1/metrics",
          },
        }),
      ),
    ).toEqual({
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpMetricsUrl: "http://localhost:4318/v1/metrics",
    });
  });

  it("falls back cleanly when persisted settings are invalid", () => {
    expect(parsePersistedServerObservabilitySettings("{")).toEqual({
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
    });
  });
});

describe("parsePersistedBrowserSuspendMinutes", () => {
  it("returns the value from valid settings.json", () => {
    expect(
      parsePersistedBrowserSuspendMinutes(JSON.stringify({ idleBrowserSuspendMinutes: 5 })),
    ).toBe(5);
  });

  it("preserves an explicit 0 (suspension disabled)", () => {
    expect(
      parsePersistedBrowserSuspendMinutes(JSON.stringify({ idleBrowserSuspendMinutes: 0 })),
    ).toBe(0);
  });

  it("returns the default when the field is missing", () => {
    expect(parsePersistedBrowserSuspendMinutes(JSON.stringify({}))).toBe(
      DEFAULT_IDLE_BROWSER_SUSPEND_MINUTES,
    );
  });

  it("returns the default when JSON is corrupt", () => {
    expect(parsePersistedBrowserSuspendMinutes("not json{")).toBe(
      DEFAULT_IDLE_BROWSER_SUSPEND_MINUTES,
    );
  });

  it("returns the default when the field is the wrong type", () => {
    expect(
      parsePersistedBrowserSuspendMinutes(JSON.stringify({ idleBrowserSuspendMinutes: "thirty" })),
    ).toBe(DEFAULT_IDLE_BROWSER_SUSPEND_MINUTES);
  });
});
