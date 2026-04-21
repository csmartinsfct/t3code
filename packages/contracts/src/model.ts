import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";
import type { BaseProviderKind, ProviderKind } from "./orchestration";

export const CODEX_REASONING_EFFORT_OPTIONS = ["xhigh", "high", "medium", "low"] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORT_OPTIONS)[number];
export const CLAUDE_CODE_EFFORT_OPTIONS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultrathink",
] as const;
export type ClaudeCodeEffort = (typeof CLAUDE_CODE_EFFORT_OPTIONS)[number];
export type ProviderReasoningEffort = CodexReasoningEffort | ClaudeCodeEffort;

export const CodexModelOptions = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
});
export type CodexModelOptions = typeof CodexModelOptions.Type;

export const ClaudeModelOptions = Schema.Struct({
  thinking: Schema.optional(Schema.Boolean),
  effort: Schema.optional(Schema.Literals(CLAUDE_CODE_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
  contextWindow: Schema.optional(Schema.String),
});
export type ClaudeModelOptions = typeof ClaudeModelOptions.Type;

export const GeminiModelOptions = Schema.Struct({});
export type GeminiModelOptions = typeof GeminiModelOptions.Type;

export const ProviderModelOptions = Schema.Struct({
  codex: Schema.optional(CodexModelOptions),
  claudeAgent: Schema.optional(ClaudeModelOptions),
  gemini: Schema.optional(GeminiModelOptions),
});
export type ProviderModelOptions = typeof ProviderModelOptions.Type;

export const EffortOption = Schema.Struct({
  value: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  isDefault: Schema.optional(Schema.Boolean),
});
export type EffortOption = typeof EffortOption.Type;

export const ContextWindowOption = Schema.Struct({
  value: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  isDefault: Schema.optional(Schema.Boolean),
});
export type ContextWindowOption = typeof ContextWindowOption.Type;

export const ModelCapabilities = Schema.Struct({
  reasoningEffortLevels: Schema.Array(EffortOption),
  supportsFastMode: Schema.Boolean,
  supportsThinkingToggle: Schema.Boolean,
  supportsPlan: Schema.Boolean,
  contextWindowOptions: Schema.Array(ContextWindowOption),
  promptInjectedEffortLevels: Schema.Array(TrimmedNonEmptyString),
});
export type ModelCapabilities = typeof ModelCapabilities.Type;

export const DEFAULT_MODEL_BY_PROVIDER: Record<BaseProviderKind, string> = {
  codex: "gpt-5.4",
  claudeAgent: "claude-sonnet-4-6",
  gemini: "auto-gemini-3",
};

export const DEFAULT_MODEL = DEFAULT_MODEL_BY_PROVIDER.codex;

/** Per-provider text generation model defaults. */
export const DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER: Record<BaseProviderKind, string> = {
  codex: "gpt-5.4-mini",
  claudeAgent: "claude-haiku-4-5",
  gemini: "gemini-2.5-flash",
};

export const MODEL_SLUG_ALIASES_BY_PROVIDER: Record<BaseProviderKind, Record<string, string>> = {
  codex: {
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  claudeAgent: {
    opus: "claude-opus-4-7",
    "opus-4.7": "claude-opus-4-7",
    "claude-opus-4.7": "claude-opus-4-7",
    "opus-4.6": "claude-opus-4-6",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-opus-4-6-20251117": "claude-opus-4-6",
    sonnet: "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4-6-20251117": "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
    "haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  },
  gemini: {
    auto: "auto-gemini-3",
    "auto-3": "auto-gemini-3",
    "auto-gemini": "auto-gemini-3",
    "auto-2.5": "auto-gemini-2.5",
    pro: "gemini-3.1-pro-preview",
    "3-pro": "gemini-3.1-pro-preview",
    "3.1-pro": "gemini-3.1-pro-preview",
    "gemini-pro": "gemini-3.1-pro-preview",
    flash: "gemini-3-flash-preview",
    "3-flash": "gemini-3-flash-preview",
    "gemini-flash": "gemini-3-flash-preview",
    "flash-lite": "gemini-3.1-flash-lite-preview",
    "3-flash-lite": "gemini-3.1-flash-lite-preview",
    "3.1-flash-lite": "gemini-3.1-flash-lite-preview",
    "gemini-flash-lite": "gemini-3.1-flash-lite-preview",
    "2.5-pro": "gemini-2.5-pro",
    "2.5-flash": "gemini-2.5-flash",
    "2.5-flash-lite": "gemini-2.5-flash-lite",
  },
};

// ── Provider display names ────────────────────────────────────────────

export const PROVIDER_DISPLAY_NAMES: Record<BaseProviderKind, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
  gemini: "Gemini",
};

/** Resolve display name for any ProviderKind, including profiled ones like "claudeAgent:zbd". */
export function providerDisplayName(kind: ProviderKind, overrideDisplayName?: string): string {
  if (overrideDisplayName) return overrideDisplayName;
  const separatorIndex = kind.indexOf(":");
  const base = (separatorIndex === -1 ? kind : kind.slice(0, separatorIndex)) as BaseProviderKind;
  const profile = separatorIndex === -1 ? undefined : kind.slice(separatorIndex + 1);
  if (!profile) return PROVIDER_DISPLAY_NAMES[base];
  return `${PROVIDER_DISPLAY_NAMES[base]} (${profile})`;
}
