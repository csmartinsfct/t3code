import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_MAX_REVIEW_ITERATIONS,
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  ServerSettingsPatch,
} from "./settings";
import { ORCHESTRATION_PROMPT_SHIPPED_DEFAULTS } from "./promptTemplates";

describe("settings defaults", () => {
  it("enables diff line wrapping by default", () => {
    expect(DEFAULT_CLIENT_SETTINGS.diffWordWrap).toBe(true);
    expect(DEFAULT_UNIFIED_SETTINGS.diffWordWrap).toBe(true);
  });

  it("defaults maxReviewIterations to 3", () => {
    expect(DEFAULT_MAX_REVIEW_ITERATIONS).toBe(3);
    expect(DEFAULT_SERVER_SETTINGS.maxReviewIterations).toBe(3);
    expect(DEFAULT_UNIFIED_SETTINGS.maxReviewIterations).toBe(3);
  });

  it("disables startup resume by default", () => {
    expect(DEFAULT_SERVER_SETTINGS.resumeAgentsOnStartup).toBe(false);
    expect(DEFAULT_UNIFIED_SETTINGS.resumeAgentsOnStartup).toBe(false);
  });

  it("defaults Dynamic Chat UI design guide override to null", () => {
    expect(DEFAULT_SERVER_SETTINGS.dynamicChatUi.designGuideOverride).toBeNull();
    expect(DEFAULT_SERVER_SETTINGS.dynamicChatUi.builderPromptOverride).toBeNull();
    expect(DEFAULT_UNIFIED_SETTINGS.dynamicChatUi.designGuideOverride).toBeNull();
    expect(DEFAULT_UNIFIED_SETTINGS.dynamicChatUi.builderPromptOverride).toBeNull();
  });

  it("includes Gemini provider defaults", () => {
    expect(DEFAULT_SERVER_SETTINGS.providers.gemini).toEqual({
      enabled: true,
      binaryPath: "gemini",
      homePath: "",
      customModels: [],
    });
    expect(DEFAULT_UNIFIED_SETTINGS.providers.gemini).toEqual(
      DEFAULT_SERVER_SETTINGS.providers.gemini,
    );
  });

  it("includes Cursor provider defaults", () => {
    expect(DEFAULT_SERVER_SETTINGS.providers.cursor).toEqual({
      enabled: true,
      binaryPath: "agent",
      launchCommand: [],
      homePath: "",
      configDir: "",
      dataDir: "",
      env: {},
      customModels: [],
    });
    expect(DEFAULT_SERVER_SETTINGS.providers.cursorProfiles).toEqual([]);
    expect(DEFAULT_UNIFIED_SETTINGS.providers.cursor).toEqual(
      DEFAULT_SERVER_SETTINGS.providers.cursor,
    );
  });

  it("resolves orchestration prompts and immutable shipped defaults by default", () => {
    expect(DEFAULT_SERVER_SETTINGS.prompts.orchestration).toEqual(
      ORCHESTRATION_PROMPT_SHIPPED_DEFAULTS,
    );
    expect(DEFAULT_SERVER_SETTINGS.promptDefaults.orchestration).toEqual(
      ORCHESTRATION_PROMPT_SHIPPED_DEFAULTS,
    );
  });

  it("accepts Codex, Claude, and Cursor profile ids in model selection patches", () => {
    const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

    expect(
      decodePatch({
        orchestrationImplementerModelSelection: {
          provider: "codex",
          profileId: "metric",
          model: "gpt-5.6-sol",
          options: { reasoningEffort: "ultra" },
        },
      }),
    ).toEqual({
      orchestrationImplementerModelSelection: {
        provider: "codex",
        profileId: "metric",
        model: "gpt-5.6-sol",
        options: { reasoningEffort: "ultra" },
      },
    });

    expect(
      decodePatch({
        orchestrationReviewerModelSelection: {
          provider: "claudeAgent",
          profileId: "metric",
          model: "claude-opus-4-8",
        },
      }),
    ).toEqual({
      orchestrationReviewerModelSelection: {
        provider: "claudeAgent",
        profileId: "metric",
        model: "claude-opus-4-8",
      },
    });

    expect(
      decodePatch({
        textGenerationModelSelection: {
          provider: "cursor",
          profileId: "metric",
          model: "claude-sonnet-5",
        },
      }),
    ).toEqual({
      textGenerationModelSelection: {
        provider: "cursor",
        profileId: "metric",
        model: "claude-sonnet-5",
      },
    });
  });

  it("accepts Gemini provider and model selection patches", () => {
    const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

    expect(
      decodePatch({
        providers: {
          gemini: {
            enabled: true,
            binaryPath: "/opt/bin/gemini",
            homePath: "/tmp/gemini",
            customModels: ["gemini-custom"],
          },
        },
        orchestrationImplementerModelSelection: {
          provider: "gemini",
          model: "gemini-3.1-pro-preview",
        },
      }),
    ).toEqual({
      providers: {
        gemini: {
          enabled: true,
          binaryPath: "/opt/bin/gemini",
          homePath: "/tmp/gemini",
          customModels: ["gemini-custom"],
        },
      },
      orchestrationImplementerModelSelection: {
        provider: "gemini",
        model: "gemini-3.1-pro-preview",
      },
    });
  });

  it("accepts Cursor provider, profile, and model selection patches", () => {
    const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

    expect(
      decodePatch({
        providers: {
          cursor: {
            enabled: true,
            binaryPath: "/opt/bin/agent",
            launchCommand: ["/opt/bin/cursor-metric"],
            homePath: "/tmp/cursor",
            configDir: "/tmp/cursor/.cursor",
            dataDir: "/tmp/cursor/.cursor",
            env: { CURSOR_CONFIG_DIR: "/tmp/cursor/.cursor" },
            customModels: ["cursor-custom"],
          },
          cursorProfiles: [
            {
              profileId: "metric",
              displayName: "Cursor (metric)",
              enabled: true,
              binaryPath: "agent",
              launchCommand: ["cursor-metric"],
              homePath: "/tmp/cursor-metric",
              configDir: "/tmp/cursor-metric/.cursor",
              dataDir: "/tmp/cursor-metric/.cursor",
              env: { CURSOR_DATA_DIR: "/tmp/cursor-metric/.cursor" },
              customModels: ["claude-sonnet-5"],
            },
          ],
        },
        orchestrationImplementerModelSelection: {
          provider: "cursor",
          profileId: "metric",
          model: "claude-sonnet-5",
        },
      }),
    ).toEqual({
      providers: {
        cursor: {
          enabled: true,
          binaryPath: "/opt/bin/agent",
          launchCommand: ["/opt/bin/cursor-metric"],
          homePath: "/tmp/cursor",
          configDir: "/tmp/cursor/.cursor",
          dataDir: "/tmp/cursor/.cursor",
          env: { CURSOR_CONFIG_DIR: "/tmp/cursor/.cursor" },
          customModels: ["cursor-custom"],
        },
        cursorProfiles: [
          {
            profileId: "metric",
            displayName: "Cursor (metric)",
            enabled: true,
            binaryPath: "agent",
            launchCommand: ["cursor-metric"],
            homePath: "/tmp/cursor-metric",
            configDir: "/tmp/cursor-metric/.cursor",
            dataDir: "/tmp/cursor-metric/.cursor",
            env: { CURSOR_DATA_DIR: "/tmp/cursor-metric/.cursor" },
            customModels: ["claude-sonnet-5"],
          },
        ],
      },
      orchestrationImplementerModelSelection: {
        provider: "cursor",
        profileId: "metric",
        model: "claude-sonnet-5",
      },
    });
  });

  it("accepts startup resume patches", () => {
    const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

    expect(
      decodePatch({
        resumeAgentsOnStartup: true,
      }),
    ).toEqual({
      resumeAgentsOnStartup: true,
    });
  });

  it("accepts Dynamic Chat UI design guide patches", () => {
    const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

    expect(
      decodePatch({
        dynamicChatUi: {
          designGuideOverride: "# Design override",
          builderPromptOverride: "Builder prompt override",
        },
      }),
    ).toEqual({
      dynamicChatUi: {
        designGuideOverride: "# Design override",
        builderPromptOverride: "Builder prompt override",
      },
    });

    expect(
      decodePatch({
        dynamicChatUi: {
          designGuideOverride: null,
          builderPromptOverride: null,
        },
      }),
    ).toEqual({
      dynamicChatUi: {
        designGuideOverride: null,
        builderPromptOverride: null,
      },
    });
  });
});
