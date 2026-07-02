import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_BY_PROVIDER, type ModelCapabilities } from "@t3tools/contracts";

import {
  applyClaudePromptEffortPrefix,
  contextWindowOptionToTokens,
  getDefaultContextWindow,
  getDefaultEffort,
  hasContextWindowOption,
  hasEffortLevel,
  inferBaseProviderKindFromModelSlug,
  isClaudeUltrathinkPrompt,
  makeProviderModelSelection,
  normalizeClaudeModelOptionsWithCapabilities,
  normalizeCodexModelOptionsWithCapabilities,
  normalizeModelSelectionProvider,
  normalizeModelSlug,
  resolveKnownProviderModelName,
  resolveApiModelId,
  resolveContextWindow,
  resolveEffort,
  resolveModelSlug,
  resolveModelSlugForProvider,
  resolveSelectableModel,
  trimOrNull,
} from "./model";

const codexCaps: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "xhigh", label: "Extra High" },
    { value: "high", label: "High", isDefault: true },
  ],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  supportsPlan: true,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const claudeCaps: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "medium", label: "Medium" },
    { value: "high", label: "High", isDefault: true },
    { value: "xhigh", label: "Extra High" },
    { value: "ultrathink", label: "Ultrathink" },
  ],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  supportsPlan: true,
  contextWindowOptions: [
    { value: "200k", label: "200k" },
    { value: "1m", label: "1M", isDefault: true },
  ],
  promptInjectedEffortLevels: ["ultrathink"],
};

describe("makeProviderModelSelection", () => {
  it("preserves provider profiles for Codex, Claude, Gemini, and Cursor selections", () => {
    expect(makeProviderModelSelection("codex:metric", "gpt-5.4")).toEqual({
      provider: "codex",
      profileId: "metric",
      model: "gpt-5.4",
    });
    expect(makeProviderModelSelection("claudeAgent:metric", "claude-opus-4-8")).toEqual({
      provider: "claudeAgent",
      profileId: "metric",
      model: "claude-opus-4-8",
    });
    expect(makeProviderModelSelection("gemini:preview", "gemini-2.5-pro")).toEqual({
      provider: "gemini",
      profileId: "preview",
      model: "gemini-2.5-pro",
    });
    expect(makeProviderModelSelection("cursor:metric", "claude-sonnet-5")).toEqual({
      provider: "cursor",
      profileId: "metric",
      model: "claude-sonnet-5",
    });
  });
});

describe("normalizeModelSlug", () => {
  it("maps known aliases to canonical slugs", () => {
    expect(normalizeModelSlug("5.3")).toBe("gpt-5.3-codex");
    expect(normalizeModelSlug("fable", "claudeAgent")).toBe("claude-fable-5");
    expect(normalizeModelSlug("opus", "claudeAgent")).toBe("claude-opus-4-8");
    expect(normalizeModelSlug("sonnet", "claudeAgent")).toBe("claude-sonnet-5");
    expect(normalizeModelSlug("2.5-pro", "gemini")).toBe("gemini-2.5-pro");
    expect(normalizeModelSlug("composer", "cursor")).toBe("composer-2");
    expect(normalizeModelSlug("composer-fast", "cursor")).toBe("composer-2");
    expect(normalizeModelSlug("cursor-gpt5", "cursor")).toBe("gpt-5.5");
    expect(normalizeModelSlug("cursor-thinking", "cursor")).toBe("claude-sonnet-5");
  });

  it("returns null for empty or missing values", () => {
    expect(normalizeModelSlug("")).toBeNull();
    expect(normalizeModelSlug("   ")).toBeNull();
    expect(normalizeModelSlug(null)).toBeNull();
    expect(normalizeModelSlug(undefined)).toBeNull();
  });
});

describe("model provider inference", () => {
  it("recognizes built-in provider slugs and aliases", () => {
    expect(inferBaseProviderKindFromModelSlug("gemini-2.5-pro")).toBe("gemini");
    expect(inferBaseProviderKindFromModelSlug("2.5-pro")).toBe("gemini");
    expect(inferBaseProviderKindFromModelSlug("claude-fable-5")).toBe("claudeAgent");
    expect(inferBaseProviderKindFromModelSlug("claude-opus-4-8")).toBe("claudeAgent");
    expect(inferBaseProviderKindFromModelSlug("claude-sonnet-5")).toBe("claudeAgent");
    expect(inferBaseProviderKindFromModelSlug("gpt-5.4")).toBe("codex");
    expect(inferBaseProviderKindFromModelSlug("cursor-special-model")).toBe("cursor");
  });

  it("repairs known provider/model mismatches without carrying stale options", () => {
    expect(
      normalizeModelSelectionProvider({
        provider: "claudeAgent",
        profileId: "metric",
        model: "gemini-2.5-pro",
        options: { effort: "max" },
      }),
    ).toEqual({
      provider: "gemini",
      model: "gemini-2.5-pro",
    });
  });

  it("preserves explicit Cursor selections for ambiguous model slugs", () => {
    expect(
      normalizeModelSelectionProvider({
        provider: "cursor",
        profileId: "metric",
        model: "gpt-5.5",
      }),
    ).toEqual({
      provider: "cursor",
      profileId: "metric",
      model: "gpt-5.5",
    });
  });
});

describe("resolveModelSlug", () => {
  it("returns defaults when the model is missing", () => {
    expect(resolveModelSlug(undefined, "codex")).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);

    expect(resolveModelSlugForProvider("claudeAgent", undefined)).toBe(
      DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
    );
    expect(resolveModelSlug(undefined, "cursor")).toBe(DEFAULT_MODEL_BY_PROVIDER.cursor);
  });

  it("preserves normalized unknown models", () => {
    expect(resolveModelSlug("custom/internal-model", "codex")).toBe("custom/internal-model");
  });
});

describe("resolveKnownProviderModelName", () => {
  it("resolves built-in labels before live provider snapshots are available", () => {
    expect(resolveKnownProviderModelName("codex", "gpt-5.5")).toBe("GPT-5.5");
    expect(resolveKnownProviderModelName("claudeAgent", "claude-fable-5")).toBe("Claude Fable 5");
    expect(resolveKnownProviderModelName("claudeAgent", "claude-opus-4-8")).toBe("Claude Opus 4.8");
    expect(resolveKnownProviderModelName("claudeAgent", "claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(resolveKnownProviderModelName("gemini", "auto")).toBe("Auto (Gemini 3)");
    expect(resolveKnownProviderModelName("cursor", "composer-2")).toBe("Composer 2");
  });

  it("uses provider-specific labels for ambiguous slugs", () => {
    expect(resolveKnownProviderModelName("codex", "gpt-5.3-codex")).toBe("GPT-5.3 Codex");
    expect(resolveKnownProviderModelName("cursor", "gpt-5.3-codex")).toBe("Codex 5.3");
    expect(resolveKnownProviderModelName("cursor:metric", "claude-sonnet-5")).toBe("Sonnet 5");
  });

  it("returns null for unknown models", () => {
    expect(resolveKnownProviderModelName("cursor", "some-new-model")).toBeNull();
  });
});

describe("resolveSelectableModel", () => {
  it("resolves exact slugs, labels, and aliases", () => {
    const options = [
      { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
      { slug: "claude-sonnet-5", name: "Claude Sonnet 5" },
    ];
    expect(resolveSelectableModel("codex", "gpt-5.3-codex", options)).toBe("gpt-5.3-codex");
    expect(resolveSelectableModel("codex", "gpt-5.3 codex", options)).toBe("gpt-5.3-codex");
    expect(resolveSelectableModel("claudeAgent", "sonnet", options)).toBe("claude-sonnet-5");
  });
});

describe("capability helpers", () => {
  it("reads default efforts", () => {
    expect(getDefaultEffort(codexCaps)).toBe("high");
    expect(getDefaultEffort(claudeCaps)).toBe("high");
  });

  it("checks effort support", () => {
    expect(hasEffortLevel(codexCaps, "xhigh")).toBe(true);
    expect(hasEffortLevel(codexCaps, "max")).toBe(false);
  });
});

describe("resolveEffort", () => {
  it("returns the explicit value when supported and not prompt-injected", () => {
    expect(resolveEffort(codexCaps, "xhigh")).toBe("xhigh");
    expect(resolveEffort(codexCaps, "high")).toBe("high");
    expect(resolveEffort(claudeCaps, "medium")).toBe("medium");
    expect(resolveEffort(claudeCaps, "xhigh")).toBe("xhigh");
  });

  it("falls back to default when value is unsupported", () => {
    expect(resolveEffort(codexCaps, "bogus")).toBe("high");
    expect(resolveEffort(claudeCaps, "bogus")).toBe("high");
  });

  it("returns the default when no value is provided", () => {
    expect(resolveEffort(codexCaps, undefined)).toBe("high");
    expect(resolveEffort(codexCaps, null)).toBe("high");
    expect(resolveEffort(codexCaps, "")).toBe("high");
    expect(resolveEffort(codexCaps, "  ")).toBe("high");
  });

  it("excludes prompt-injected efforts and falls back to default", () => {
    expect(resolveEffort(claudeCaps, "ultrathink")).toBe("high");
  });

  it("returns undefined for models with no effort levels", () => {
    const noCaps: ModelCapabilities = {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      supportsPlan: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    };
    expect(resolveEffort(noCaps, undefined)).toBeUndefined();
    expect(resolveEffort(noCaps, "high")).toBeUndefined();
  });
});

describe("misc helpers", () => {
  it("detects ultrathink prompts", () => {
    expect(isClaudeUltrathinkPrompt("Ultrathink:\nInvestigate")).toBe(true);
    expect(isClaudeUltrathinkPrompt("Investigate")).toBe(false);
  });

  it("prefixes ultrathink prompts once", () => {
    expect(applyClaudePromptEffortPrefix("Investigate", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate",
    );
    expect(applyClaudePromptEffortPrefix("Ultrathink:\nInvestigate", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate",
    );
  });

  it("trims strings to null", () => {
    expect(trimOrNull("  hi  ")).toBe("hi");
    expect(trimOrNull("   ")).toBeNull();
  });
});

describe("context window helpers", () => {
  it("reads default context window", () => {
    expect(getDefaultContextWindow(claudeCaps)).toBe("1m");
  });

  it("returns null for models without context window options", () => {
    expect(getDefaultContextWindow(codexCaps)).toBeNull();
  });

  it("checks context window support", () => {
    expect(hasContextWindowOption(claudeCaps, "1m")).toBe(true);
    expect(hasContextWindowOption(claudeCaps, "200k")).toBe(true);
    expect(hasContextWindowOption(claudeCaps, "bogus")).toBe(false);
    expect(hasContextWindowOption(codexCaps, "1m")).toBe(false);
  });
});

describe("resolveContextWindow", () => {
  it("returns the explicit value when supported", () => {
    expect(resolveContextWindow(claudeCaps, "200k")).toBe("200k");
    expect(resolveContextWindow(claudeCaps, "1m")).toBe("1m");
  });

  it("falls back to default when value is unsupported", () => {
    expect(resolveContextWindow(claudeCaps, "bogus")).toBe("1m");
  });

  it("returns the default when no value is provided", () => {
    expect(resolveContextWindow(claudeCaps, undefined)).toBe("1m");
    expect(resolveContextWindow(claudeCaps, null)).toBe("1m");
    expect(resolveContextWindow(claudeCaps, "")).toBe("1m");
  });

  it("returns undefined for models with no context window options", () => {
    expect(resolveContextWindow(codexCaps, undefined)).toBeUndefined();
    expect(resolveContextWindow(codexCaps, "1m")).toBeUndefined();
  });
});

describe("contextWindowOptionToTokens", () => {
  it("converts k-suffixed values", () => {
    expect(contextWindowOptionToTokens("200k")).toBe(200_000);
    expect(contextWindowOptionToTokens("128k")).toBe(128_000);
  });

  it("converts m-suffixed values", () => {
    expect(contextWindowOptionToTokens("1m")).toBe(1_000_000);
    expect(contextWindowOptionToTokens("2m")).toBe(2_000_000);
  });

  it("handles plain numeric strings", () => {
    expect(contextWindowOptionToTokens("100000")).toBe(100_000);
  });

  it("returns undefined for null/undefined/empty", () => {
    expect(contextWindowOptionToTokens(null)).toBeUndefined();
    expect(contextWindowOptionToTokens(undefined)).toBeUndefined();
    expect(contextWindowOptionToTokens("")).toBeUndefined();
  });

  it("returns undefined for invalid values", () => {
    expect(contextWindowOptionToTokens("abc")).toBeUndefined();
    expect(contextWindowOptionToTokens("0k")).toBeUndefined();
    expect(contextWindowOptionToTokens("-1m")).toBeUndefined();
  });
});

describe("resolveApiModelId", () => {
  it("appends [1m] suffix for 1m context window", () => {
    expect(
      resolveApiModelId({
        provider: "claudeAgent",
        model: "claude-opus-4-5",
        options: { contextWindow: "1m" },
      }),
    ).toBe("claude-opus-4-5[1m]");
  });

  it("returns the model as-is for 200k context window", () => {
    expect(
      resolveApiModelId({
        provider: "claudeAgent",
        model: "claude-opus-4-5",
        options: { contextWindow: "200k" },
      }),
    ).toBe("claude-opus-4-5");
  });

  it("returns the model as-is when no context window is set", () => {
    expect(resolveApiModelId({ provider: "claudeAgent", model: "claude-opus-4-5" })).toBe(
      "claude-opus-4-5",
    );
    expect(
      resolveApiModelId({ provider: "claudeAgent", model: "claude-opus-4-5", options: {} }),
    ).toBe("claude-opus-4-5");
  });

  it("returns the model as-is for Codex selections", () => {
    expect(resolveApiModelId({ provider: "codex", model: "gpt-5.4" })).toBe("gpt-5.4");
  });

  it("keeps Opus 4.8 at its canonical API id for the native 1m window", () => {
    expect(
      resolveApiModelId({
        provider: "claudeAgent",
        model: "claude-opus-4-8",
        options: { contextWindow: "1m" },
      }),
    ).toBe("claude-opus-4-8");
  });

  it("keeps Fable 5 at its canonical API id for the native 1m window", () => {
    expect(
      resolveApiModelId({
        provider: "claudeAgent",
        model: "claude-fable-5",
        options: { contextWindow: "1m" },
      }),
    ).toBe("claude-fable-5");
  });

  it("keeps Sonnet 5 at its canonical API id for the native 1m window", () => {
    expect(
      resolveApiModelId({
        provider: "claudeAgent",
        model: "claude-sonnet-5",
        options: { contextWindow: "1m" },
      }),
    ).toBe("claude-sonnet-5");
  });
});

describe("normalize*ModelOptionsWithCapabilities", () => {
  it("preserves explicit false codex fast mode", () => {
    expect(
      normalizeCodexModelOptionsWithCapabilities(codexCaps, {
        reasoningEffort: "high",
        fastMode: false,
      }),
    ).toEqual({
      reasoningEffort: "high",
      fastMode: false,
    });
  });

  it("preserves the default Claude context window explicitly", () => {
    expect(
      normalizeClaudeModelOptionsWithCapabilities(
        {
          ...claudeCaps,
          contextWindowOptions: [
            { value: "200k", label: "200k", isDefault: true },
            { value: "1m", label: "1M" },
          ],
        },
        {
          effort: "high",
          contextWindow: "200k",
        },
      ),
    ).toEqual({
      effort: "high",
      contextWindow: "200k",
    });
  });

  it("omits unsupported Claude context window options", () => {
    expect(
      normalizeClaudeModelOptionsWithCapabilities(
        {
          ...claudeCaps,
          reasoningEffortLevels: [],
          supportsThinkingToggle: true,
          contextWindowOptions: [],
        },
        {
          thinking: true,
          contextWindow: "1m",
        },
      ),
    ).toEqual({
      thinking: true,
    });
  });
});
