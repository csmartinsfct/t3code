export interface CursorAcpModelOption {
  readonly slug: string;
  readonly name: string;
}

export const CURSOR_ACP_BUILT_IN_MODELS: ReadonlyArray<CursorAcpModelOption> = [
  { slug: "composer-2", name: "Composer 2" },
  { slug: "composer-1.5", name: "Composer 1.5" },
  { slug: "auto", name: "Auto" },
  { slug: "gpt-5.5", name: "GPT-5.5" },
  { slug: "gpt-5.4", name: "GPT-5.4" },
  { slug: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
  { slug: "gpt-5.4-nano", name: "GPT-5.4 Nano" },
  { slug: "gpt-5.3-codex", name: "Codex 5.3" },
  { slug: "gpt-5.3-codex-spark", name: "Codex 5.3 Spark" },
  { slug: "gpt-5.2", name: "GPT-5.2" },
  { slug: "gpt-5.2-codex", name: "Codex 5.2" },
  { slug: "gpt-5.1", name: "GPT-5.1" },
  { slug: "gpt-5.1-codex-max", name: "Codex 5.1 Max" },
  { slug: "gpt-5.1-codex-mini", name: "Codex 5.1 Mini" },
  { slug: "gpt-5-mini", name: "GPT-5 Mini" },
  { slug: "claude-fable-5", name: "Fable 5" },
  { slug: "claude-opus-4-8", name: "Opus 4.8" },
  { slug: "claude-opus-4-7", name: "Opus 4.7" },
  { slug: "claude-opus-4-6", name: "Opus 4.6" },
  { slug: "claude-opus-4-5", name: "Opus 4.5" },
  { slug: "claude-sonnet-4-6", name: "Sonnet 4.6" },
  { slug: "claude-sonnet-4-5", name: "Sonnet 4.5" },
  { slug: "claude-sonnet-4", name: "Sonnet 4" },
  { slug: "claude-haiku-4-5", name: "Haiku 4.5" },
  { slug: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
  { slug: "gemini-3-flash", name: "Gemini 3 Flash" },
  { slug: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { slug: "grok-4-20", name: "Grok 4.20" },
  { slug: "kimi-k2.5", name: "Kimi K2.5" },
];

const LABEL_BY_CURSOR_ACP_MODEL = new Map(
  CURSOR_ACP_BUILT_IN_MODELS.map((model) => [model.slug, model.name]),
);

export function cursorAcpModelLabel(slug: string): string {
  return LABEL_BY_CURSOR_ACP_MODEL.get(slug) ?? slug;
}

export function normalizeCursorModelForAcp(model: string): string {
  const trimmed = model.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "auto" || lower === "default" || lower === "default[]") return "auto";
  if (lower.startsWith("composer-2")) return "composer-2";
  if (lower.startsWith("composer-1.5")) return "composer-1.5";

  if (lower.startsWith("gpt-5.3-codex-spark")) return "gpt-5.3-codex-spark";
  if (lower.startsWith("gpt-5.3-codex")) return "gpt-5.3-codex";
  if (lower.startsWith("gpt-5.2-codex")) return "gpt-5.2-codex";
  if (lower.startsWith("gpt-5.1-codex-max")) return "gpt-5.1-codex-max";
  if (lower.startsWith("gpt-5.1-codex-mini")) return "gpt-5.1-codex-mini";
  if (lower.startsWith("gpt-5.5")) return "gpt-5.5";
  if (lower.startsWith("gpt-5.4-mini")) return "gpt-5.4-mini";
  if (lower.startsWith("gpt-5.4-nano")) return "gpt-5.4-nano";
  if (lower.startsWith("gpt-5.4")) return "gpt-5.4";
  if (lower.startsWith("gpt-5.2")) return "gpt-5.2";
  if (lower.startsWith("gpt-5.1")) return "gpt-5.1";
  if (lower === "gpt-5-mini") return "gpt-5-mini";

  if (lower.startsWith("claude-fable-5")) return "claude-fable-5";
  if (lower.startsWith("claude-4.8-opus")) return "claude-opus-4-8";
  if (lower.startsWith("claude-opus-4-8")) return "claude-opus-4-8";
  if (lower.startsWith("claude-4.7-opus")) return "claude-opus-4-7";
  if (lower.startsWith("claude-opus-4-7")) return "claude-opus-4-7";
  if (lower.startsWith("claude-4.6-opus")) return "claude-opus-4-6";
  if (lower.startsWith("claude-opus-4-6")) return "claude-opus-4-6";
  if (lower.startsWith("claude-4.5-opus")) return "claude-opus-4-5";
  if (lower.startsWith("claude-opus-4-5")) return "claude-opus-4-5";
  if (lower.startsWith("claude-4.6-sonnet")) return "claude-sonnet-4-6";
  if (lower.startsWith("claude-sonnet-4-6")) return "claude-sonnet-4-6";
  if (lower.startsWith("claude-4.5-sonnet")) return "claude-sonnet-4-5";
  if (lower.startsWith("claude-sonnet-4-5")) return "claude-sonnet-4-5";
  if (lower.startsWith("claude-4-sonnet")) return "claude-sonnet-4";
  if (lower.startsWith("claude-sonnet-4")) return "claude-sonnet-4";
  if (lower.startsWith("claude-haiku-4-5")) return "claude-haiku-4-5";
  if (lower === "sonnet-4" || lower === "sonnet-4-thinking") return "claude-sonnet-4";

  if (lower.startsWith("gemini-3.1-pro")) return "gemini-3.1-pro";
  if (lower.startsWith("gemini-3-flash")) return "gemini-3-flash";
  if (lower.startsWith("gemini-2.5-flash")) return "gemini-2.5-flash";
  if (lower.startsWith("grok-4-20")) return "grok-4-20";
  if (lower === "kimi-k2.5") return "kimi-k2.5";

  return trimmed;
}

export function resolveCursorAcpModelId(
  model: string,
  availableModels: ReadonlyArray<{ readonly modelId: string; readonly name?: string }>,
): string {
  const normalized = normalizeCursorModelForAcp(model);
  const normalizedLower = normalized.toLowerCase();
  const label = cursorAcpModelLabel(normalized);
  const labelLower = label.toLowerCase();

  return (
    availableModels.find((candidate) => candidate.modelId === model)?.modelId ??
    availableModels.find((candidate) => candidate.modelId === normalized)?.modelId ??
    availableModels.find((candidate) => candidate.name === model)?.modelId ??
    availableModels.find((candidate) => candidate.name === normalized)?.modelId ??
    availableModels.find((candidate) => candidate.name?.toLowerCase() === normalizedLower)
      ?.modelId ??
    availableModels.find((candidate) => candidate.name?.toLowerCase() === labelLower)?.modelId ??
    availableModels.find((candidate) => candidate.modelId.startsWith(`${normalized}[`))?.modelId ??
    (normalized === "auto"
      ? availableModels.find(
          (candidate) =>
            candidate.modelId === "default[]" || candidate.name?.toLowerCase() === "auto",
        )?.modelId
      : undefined) ??
    normalized
  );
}
