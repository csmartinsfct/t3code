import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { getCustomModelOptionsByProvider, resolveAppModelSelectionState } from "./modelSelection";

const TEST_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.118.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-10T00:00:00.000Z",
    models: [
      {
        slug: "gpt-5.4",
        name: "GPT-5.4",
        isCustom: false,
        capabilities: null,
      },
    ],
  },
  {
    provider: "claudeAgent",
    displayName: "Claude",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-10T00:00:00.000Z",
    models: [
      {
        slug: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        isCustom: false,
        capabilities: null,
      },
    ],
  },
  {
    provider: "claudeAgent:metric" as never,
    displayName: "Claude (metric)",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-10T00:00:00.000Z",
    models: [
      {
        slug: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        isCustom: false,
        capabilities: null,
      },
    ],
  },
];

describe("resolveAppModelSelectionState", () => {
  it("preserves Claude profile ids for profiled providers", () => {
    const selection = resolveAppModelSelectionState(
      {
        ...DEFAULT_UNIFIED_SETTINGS,
        textGenerationModelSelection: {
          provider: "claudeAgent",
          profileId: "metric",
          model: "claude-opus-4-6",
        },
      },
      TEST_PROVIDERS,
    );

    expect(selection).toMatchObject({
      provider: "claudeAgent",
      profileId: "metric",
      model: "claude-opus-4-6",
    });
  });
});

describe("getCustomModelOptionsByProvider", () => {
  it("treats profiled Claude providers as Claude when preserving ad hoc selections", () => {
    const options = getCustomModelOptionsByProvider(
      DEFAULT_UNIFIED_SETTINGS,
      TEST_PROVIDERS,
      "claudeAgent:metric",
      "claude-special-preview",
    );

    expect(options.claudeAgent).toContainEqual({
      slug: "claude-special-preview",
      name: "claude-special-preview",
    });
  });
});
