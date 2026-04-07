import { describe, expect, it } from "vitest";

import { DEFAULT_CLIENT_SETTINGS, DEFAULT_UNIFIED_SETTINGS } from "./settings";

describe("settings defaults", () => {
  it("enables diff line wrapping by default", () => {
    expect(DEFAULT_CLIENT_SETTINGS.diffWordWrap).toBe(true);
    expect(DEFAULT_UNIFIED_SETTINGS.diffWordWrap).toBe(true);
  });
});
