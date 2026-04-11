import { describe, expect, it } from "vitest";

import {
  formatModelSelectionSummary,
  resolveReviewerConfigurationSummary,
} from "./orchestrationModelDisplay";

// Audit traceability: 3be0c6e, 0d23345, 6abc967.
describe("OrchestrateConfirmDialog model labels", () => {
  it("formats implementer and reviewer defaults using provider display names", () => {
    expect(
      formatModelSelectionSummary({
        provider: "codex",
        model: "gpt-5.4-mini",
      }),
    ).toBe("Codex / gpt-5.4-mini");

    expect(
      resolveReviewerConfigurationSummary(2, {
        provider: "claudeAgent",
        model: "claude-sonnet-4-6",
      }),
    ).toBe("Claude / claude-sonnet-4-6");
  });

  it("shows the settings hint when automated review is disabled", () => {
    expect(
      resolveReviewerConfigurationSummary(0, {
        provider: "codex",
        model: "gpt-5.4-mini",
      }),
    ).toBe("Enable in the settings");
  });
});
