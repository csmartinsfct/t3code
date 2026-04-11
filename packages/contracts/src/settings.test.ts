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

  it("resolves orchestration prompts and immutable shipped defaults by default", () => {
    expect(DEFAULT_SERVER_SETTINGS.prompts.orchestration).toEqual(
      ORCHESTRATION_PROMPT_SHIPPED_DEFAULTS,
    );
    expect(DEFAULT_SERVER_SETTINGS.promptDefaults.orchestration).toEqual(
      ORCHESTRATION_PROMPT_SHIPPED_DEFAULTS,
    );
  });

  it("accepts Claude profile ids in model selection patches", () => {
    const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

    expect(
      decodePatch({
        orchestrationReviewerModelSelection: {
          provider: "claudeAgent",
          profileId: "metric",
          model: "claude-opus-4-6",
        },
      }),
    ).toEqual({
      orchestrationReviewerModelSelection: {
        provider: "claudeAgent",
        profileId: "metric",
        model: "claude-opus-4-6",
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
});
