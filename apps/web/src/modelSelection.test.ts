import { BASE_PROVIDER_KINDS, type ServerProvider } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vitest";

import {
  getSecondaryInferenceProviders,
  getCustomModelOptionsByProvider,
  MODEL_PROVIDER_SETTINGS,
  resolveSecondaryInferenceModelSelectionState,
  resolveAppModelSelectionState,
} from "./modelSelection";

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
  {
    provider: "cursor",
    displayName: "Cursor",
    enabled: true,
    installed: true,
    version: "2026.05.01-eea359f",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-10T00:00:00.000Z",
    models: [
      {
        slug: "composer-2",
        name: "Composer 2",
        isCustom: false,
        capabilities: null,
      },
    ],
  },
  {
    provider: "cursor:metric" as never,
    displayName: "Cursor (metric)",
    enabled: true,
    installed: true,
    version: "2026.05.01-eea359f",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-10T00:00:00.000Z",
    models: [
      {
        slug: "claude-sonnet-4-6",
        name: "Sonnet 4.6",
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

  it("preserves Cursor profile ids for profiled providers", () => {
    const selection = resolveAppModelSelectionState(
      {
        ...DEFAULT_UNIFIED_SETTINGS,
        textGenerationModelSelection: {
          provider: "cursor",
          profileId: "metric",
          model: "claude-sonnet-4-6",
        },
      },
      TEST_PROVIDERS,
    );

    expect(selection).toMatchObject({
      provider: "cursor",
      profileId: "metric",
      model: "claude-sonnet-4-6",
    });
  });
});

describe("secondary inference model selection", () => {
  it("excludes Cursor base and profile providers", () => {
    expect(
      getSecondaryInferenceProviders(TEST_PROVIDERS).map((provider) => provider.provider),
    ).toEqual(["codex", "claudeAgent", "claudeAgent:metric"]);
  });

  it("falls back from Cursor to a structured-output provider", () => {
    const selection = resolveSecondaryInferenceModelSelectionState(
      {
        ...DEFAULT_UNIFIED_SETTINGS,
        textGenerationModelSelection: {
          provider: "cursor",
          model: "composer-2",
        },
      },
      TEST_PROVIDERS,
    );

    expect(selection).toMatchObject({
      provider: "codex",
      model: "gpt-5.4-mini",
    });
  });

  it("preserves non-Cursor selections", () => {
    const selection = resolveSecondaryInferenceModelSelectionState(
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
  it("covers every base provider in custom model settings", () => {
    const configuredProviders = MODEL_PROVIDER_SETTINGS.map((entry) => entry.provider);

    expect(configuredProviders.toSorted()).toEqual([...BASE_PROVIDER_KINDS].toSorted());
  });

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
