import {
  baseProviderKind,
  type BaseProviderKind,
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  providerProfileId,
  type ClaudeCodeEffort,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type CursorModelOptions,
  type GeminiModelOptions,
  type ModelCapabilities,
  type ModelSelection,
  type ProviderKind,
} from "@t3tools/contracts";

export interface SelectableModelOption {
  slug: string;
  name: string;
}

export const KNOWN_PROVIDER_MODEL_OPTIONS: Record<
  BaseProviderKind,
  ReadonlyArray<SelectableModelOption>
> = {
  codex: [
    { slug: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { slug: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { slug: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { slug: "gpt-5.5", name: "GPT-5.5" },
    { slug: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
  ],
  claudeAgent: [
    { slug: "claude-fable-5", name: "Claude Fable 5" },
    { slug: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { slug: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { slug: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  gemini: [
    { slug: "auto-gemini-3", name: "Auto (Gemini 3)" },
    { slug: "auto-gemini-2.5", name: "Auto (Gemini 2.5)" },
    { slug: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { slug: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { slug: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash-Lite Preview" },
    { slug: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { slug: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { slug: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite" },
  ],
  cursor: [
    { slug: "composer-2", name: "Composer 2" },
    { slug: "composer-1.5", name: "Composer 1.5" },
    { slug: "auto", name: "Auto" },
    { slug: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { slug: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { slug: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { slug: "gpt-5.5", name: "GPT-5.5" },
    { slug: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { slug: "gpt-5.4-nano", name: "GPT-5.4 Nano" },
    { slug: "gpt-5.1", name: "GPT-5.1" },
    { slug: "gpt-5.1-codex-max", name: "Codex 5.1 Max" },
    { slug: "gpt-5.1-codex-mini", name: "Codex 5.1 Mini" },
    { slug: "gpt-5-mini", name: "GPT-5 Mini" },
    { slug: "claude-fable-5", name: "Fable 5" },
    { slug: "claude-opus-4-8", name: "Opus 4.8" },
    { slug: "claude-opus-4-5", name: "Opus 4.5" },
    { slug: "claude-sonnet-5", name: "Sonnet 5" },
    { slug: "claude-sonnet-4-5", name: "Sonnet 4.5" },
    { slug: "claude-sonnet-4", name: "Sonnet 4" },
    { slug: "claude-haiku-4-5", name: "Haiku 4.5" },
    { slug: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { slug: "gemini-3-flash", name: "Gemini 3 Flash" },
    { slug: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { slug: "grok-4-20", name: "Grok 4.20" },
    { slug: "kimi-k2.5", name: "Kimi K2.5" },
  ],
};

export function getKnownProviderModelOptions(
  provider: ProviderKind,
): ReadonlyArray<SelectableModelOption> {
  return KNOWN_PROVIDER_MODEL_OPTIONS[baseProviderKind(provider)];
}

export function makeProviderModelSelection(
  provider: ProviderKind,
  model: string,
  options?: ModelSelection["options"],
): ModelSelection {
  const base = baseProviderKind(provider);
  const profileId = providerProfileId(provider);

  return {
    provider: base,
    model,
    ...((base === "codex" || base === "claudeAgent" || base === "gemini" || base === "cursor") &&
    profileId
      ? { profileId }
      : {}),
    ...(options ? { options } : {}),
  } as ModelSelection;
}

// ── Effort helpers ────────────────────────────────────────────────────

/** Check whether a capabilities object includes a given effort value. */
export function hasEffortLevel(caps: ModelCapabilities, value: string): boolean {
  return caps.reasoningEffortLevels.some((l) => l.value === value);
}

/** Return the default effort value for a capabilities object, or null if none. */
export function getDefaultEffort(caps: ModelCapabilities): string | null {
  return caps.reasoningEffortLevels.find((l) => l.isDefault)?.value ?? null;
}

/**
 * Resolve a raw effort option against capabilities.
 *
 * Returns the effective effort value — the explicit value if supported and not
 * prompt-injected, otherwise the model's default. Returns `undefined` only
 * when the model has no effort levels at all.
 *
 * Prompt-injected efforts (e.g. "ultrathink") are excluded because they are
 * applied via prompt text, not the effort API parameter.
 */
export function resolveEffort(
  caps: ModelCapabilities,
  raw: string | null | undefined,
): string | undefined {
  const defaultValue = getDefaultEffort(caps);
  const trimmed = typeof raw === "string" ? raw.trim() : null;
  if (
    trimmed &&
    !caps.promptInjectedEffortLevels.includes(trimmed) &&
    hasEffortLevel(caps, trimmed)
  ) {
    return trimmed;
  }
  return defaultValue ?? undefined;
}

// ── Context window helpers ───────────────────────────────────────────

/** Check whether a capabilities object includes a given context window value. */
export function hasContextWindowOption(caps: ModelCapabilities, value: string): boolean {
  return caps.contextWindowOptions.some((o) => o.value === value);
}

/** Return the default context window value, or `null` if none is defined. */
export function getDefaultContextWindow(caps: ModelCapabilities): string | null {
  return caps.contextWindowOptions.find((o) => o.isDefault)?.value ?? null;
}

/**
 * Resolve a raw `contextWindow` option against capabilities.
 *
 * Returns the effective context window value — the explicit value if supported,
 * otherwise the model's default. Returns `undefined` only when the model has
 * no context window options at all.
 *
 * Unlike effort levels (where the API has matching defaults), the context
 * window requires an explicit API suffix (e.g. `[1m]`), so we always preserve
 * the resolved value to avoid ambiguity between "user chose the default" and
 * "not specified".
 */
export function resolveContextWindow(
  caps: ModelCapabilities,
  raw: string | null | undefined,
): string | undefined {
  const defaultValue = getDefaultContextWindow(caps);
  if (!raw) return defaultValue ?? undefined;
  return hasContextWindowOption(caps, raw) ? raw : (defaultValue ?? undefined);
}

/**
 * Convert a context window option string (e.g. "200k", "1m") to a token count.
 * Returns `undefined` for unrecognised values.
 */
export function contextWindowOptionToTokens(value: string | null | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const lower = value.trim().toLowerCase();
  if (lower.endsWith("m")) {
    const n = Number(lower.slice(0, -1));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1_000_000) : undefined;
  }
  if (lower.endsWith("k")) {
    const n = Number(lower.slice(0, -1));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1_000) : undefined;
  }
  const n = Number(lower);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

export function normalizeCodexModelOptionsWithCapabilities(
  caps: ModelCapabilities,
  modelOptions: CodexModelOptions | null | undefined,
): CodexModelOptions | undefined {
  const reasoningEffort = resolveEffort(caps, modelOptions?.reasoningEffort);
  const fastMode = caps.supportsFastMode ? modelOptions?.fastMode : undefined;
  const nextOptions: CodexModelOptions = {
    ...(reasoningEffort
      ? { reasoningEffort: reasoningEffort as CodexModelOptions["reasoningEffort"] }
      : {}),
    ...(fastMode !== undefined ? { fastMode } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

export function normalizeClaudeModelOptionsWithCapabilities(
  caps: ModelCapabilities,
  modelOptions: ClaudeModelOptions | null | undefined,
): ClaudeModelOptions | undefined {
  const effort = resolveEffort(caps, modelOptions?.effort);
  const thinking = caps.supportsThinkingToggle ? modelOptions?.thinking : undefined;
  const fastMode = caps.supportsFastMode ? modelOptions?.fastMode : undefined;
  const contextWindow = resolveContextWindow(caps, modelOptions?.contextWindow);
  const nextOptions: ClaudeModelOptions = {
    ...(thinking !== undefined ? { thinking } : {}),
    ...(effort ? { effort: effort as ClaudeModelOptions["effort"] } : {}),
    ...(fastMode !== undefined ? { fastMode } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

export function normalizeGeminiModelOptionsWithCapabilities(
  _caps: ModelCapabilities,
  modelOptions: GeminiModelOptions | null | undefined,
): GeminiModelOptions | undefined {
  return modelOptions && Object.keys(modelOptions).length > 0 ? modelOptions : undefined;
}

export function normalizeCursorModelOptionsWithCapabilities(
  _caps: ModelCapabilities,
  modelOptions: CursorModelOptions | null | undefined,
): CursorModelOptions | undefined {
  return modelOptions && Object.keys(modelOptions).length > 0 ? modelOptions : undefined;
}

export function isClaudeUltrathinkPrompt(text: string | null | undefined): boolean {
  return typeof text === "string" && /\bultrathink\b/i.test(text);
}

export function normalizeModelSlug(
  model: string | null | undefined,
  provider: ProviderKind = "codex",
): string | null {
  if (typeof model !== "string") {
    return null;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  const aliases = MODEL_SLUG_ALIASES_BY_PROVIDER[baseProviderKind(provider)] as Record<
    string,
    string
  >;
  const aliased = Object.prototype.hasOwnProperty.call(aliases, trimmed)
    ? aliases[trimmed]
    : undefined;
  return typeof aliased === "string" ? aliased : trimmed;
}

export function resolveKnownProviderModelName(
  provider: ProviderKind,
  model: string | null | undefined,
): string | null {
  if (typeof model !== "string") {
    return null;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  const options = getKnownProviderModelOptions(provider);
  const direct = options.find(
    (option) => option.slug === trimmed || option.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (direct) {
    return direct.name;
  }

  const normalized = normalizeModelSlug(trimmed, provider);
  return options.find((option) => option.slug === normalized)?.name ?? null;
}

export function inferBaseProviderKindFromModelSlug(
  model: string | null | undefined,
): BaseProviderKind | null {
  if (typeof model !== "string") {
    return null;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  for (const provider of Object.keys(MODEL_SLUG_ALIASES_BY_PROVIDER) as BaseProviderKind[]) {
    const aliases = MODEL_SLUG_ALIASES_BY_PROVIDER[provider] as Record<string, string>;
    for (const [alias, canonical] of Object.entries(aliases)) {
      if (alias.toLowerCase() === lower || canonical.toLowerCase() === lower) {
        return provider;
      }
    }
  }

  if (lower.startsWith("gemini-") || lower.startsWith("auto-gemini-")) {
    return "gemini";
  }
  if (lower.startsWith("cursor-")) {
    return "cursor";
  }
  if (lower.startsWith("claude-")) {
    return "claudeAgent";
  }
  if (lower.startsWith("gpt-") || lower.startsWith("codex-") || lower.includes("-codex")) {
    return "codex";
  }

  return null;
}

export function normalizeModelSelectionProvider(selection: ModelSelection): ModelSelection {
  if (selection.provider === "cursor") {
    return {
      ...selection,
      model: resolveModelSlugForProvider("cursor", selection.model),
    };
  }

  const inferredProvider = inferBaseProviderKindFromModelSlug(selection.model);
  const provider = inferredProvider ?? selection.provider;
  const model = resolveModelSlugForProvider(provider, selection.model);

  if (provider === selection.provider) {
    return {
      ...selection,
      model,
    } as ModelSelection;
  }

  return {
    provider,
    model,
  } as ModelSelection;
}

export function resolveSelectableModel(
  provider: ProviderKind,
  value: string | null | undefined,
  options: ReadonlyArray<SelectableModelOption>,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = options.find((option) => option.slug === trimmed);
  if (direct) {
    return direct.slug;
  }

  const byName = options.find((option) => option.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) {
    return byName.slug;
  }

  const normalized = normalizeModelSlug(trimmed, provider);
  if (!normalized) {
    return null;
  }

  const resolved = options.find((option) => option.slug === normalized);
  return resolved ? resolved.slug : null;
}

export function resolveModelSlug(model: string | null | undefined, provider: ProviderKind): string {
  const normalized = normalizeModelSlug(model, provider);
  if (!normalized) {
    return DEFAULT_MODEL_BY_PROVIDER[baseProviderKind(provider)];
  }
  return normalized;
}

export function resolveModelSlugForProvider(
  provider: ProviderKind,
  model: string | null | undefined,
): string {
  return resolveModelSlug(model, provider);
}

/** Trim a string, returning null for empty/missing values. */
export function trimOrNull<T extends string>(value: T | null | undefined): T | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim() as T;
  return trimmed || null;
}

/**
 * Resolve the actual API model identifier from a model selection.
 *
 * Provider-aware: each provider can map `contextWindow` (or other options)
 * to whatever the API requires — a model-id suffix, a separate parameter, or
 * no model-id change when the selected model already has that context window.
 * The canonical slug stored in the selection stays unchanged so the
 * capabilities system keeps working.
 *
 * Expects `contextWindow` to already be resolved (via `resolveContextWindow`)
 * to the effective value, not stripped to `undefined` for defaults.
 */
export function resolveApiModelId(modelSelection: ModelSelection): string {
  switch (modelSelection.provider) {
    case "claudeAgent": {
      switch (modelSelection.options?.contextWindow) {
        case "1m":
          if (
            modelSelection.model === "claude-fable-5" ||
            modelSelection.model === "claude-opus-4-8" ||
            modelSelection.model === "claude-sonnet-5"
          ) {
            return modelSelection.model;
          }
          return `${modelSelection.model}[1m]`;
        default:
          return modelSelection.model;
      }
    }
    default: {
      return modelSelection.model;
    }
  }
}

export function applyClaudePromptEffortPrefix(
  text: string,
  effort: ClaudeCodeEffort | null | undefined,
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (effort !== "ultrathink") {
    return trimmed;
  }
  if (trimmed.startsWith("Ultrathink:")) {
    return trimmed;
  }
  return `Ultrathink:\n${trimmed}`;
}
