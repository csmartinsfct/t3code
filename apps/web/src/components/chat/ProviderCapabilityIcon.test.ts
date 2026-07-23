import { describe, expect, it } from "vitest";

import { resolveProviderCapabilityIconSource } from "./ProviderCapabilityIcon";

describe("resolveProviderCapabilityIconSource", () => {
  it("prefers web-safe icon URLs", () => {
    expect(
      resolveProviderCapabilityIconSource({
        kind: "plugin",
        displayName: "Gmail",
        iconPath: "/plugin/icon.png",
        iconUrl: "https://example.com/gmail.png",
      }),
    ).toBe("https://example.com/gmail.png");
  });

  it("uses web-safe icon paths when no icon URL is available", () => {
    expect(
      resolveProviderCapabilityIconSource({
        kind: "skill",
        displayName: "Brainstorming",
        iconPath: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
      }),
    ).toBe("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E");
  });

  it("ignores local filesystem icon paths that the browser cannot load", () => {
    expect(
      resolveProviderCapabilityIconSource({
        kind: "plugin",
        displayName: "Superpowers",
        iconPath: "/Users/me/.codex/plugins/superpowers/icon.png",
      }),
    ).toBeNull();
  });
});
