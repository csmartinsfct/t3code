import { describe, expect, it } from "vitest";

import { isBrowserNavigationAbortError } from "./browserNavigationErrors";

describe("isBrowserNavigationAbortError", () => {
  it("detects Chromium ERR_ABORTED errors by code, errno, and IPC message", () => {
    expect(isBrowserNavigationAbortError({ code: "ERR_ABORTED" })).toBe(true);
    expect(isBrowserNavigationAbortError({ errno: -3 })).toBe(true);
    expect(isBrowserNavigationAbortError({ message: "ERR_ABORTED (-3) loading" })).toBe(true);
    expect(
      isBrowserNavigationAbortError(
        new Error(
          "Error invoking remote method 'browser:navigate': Error: ERR_ABORTED (-3) loading 'https://example.com'",
        ),
      ),
    ).toBe(true);
  });

  it("does not classify unrelated navigation failures as aborts", () => {
    expect(isBrowserNavigationAbortError({ code: "ERR_NAME_NOT_RESOLVED" })).toBe(false);
    expect(isBrowserNavigationAbortError(new Error("certificate failure"))).toBe(false);
    expect(isBrowserNavigationAbortError(null)).toBe(false);
  });
});
