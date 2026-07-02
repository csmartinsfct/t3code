import type { ServerProvider } from "@t3tools/contracts";

export function createReadyServerProvider(input: {
  provider: string;
  checkedAt: string;
  displayName?: string;
  models?: ServerProvider["models"];
  defaultCodexModelSlug?: string;
  defaultCodexModelName?: string;
  defaultClaudeModelSlug?: string;
  defaultClaudeModelName?: string;
  defaultGeminiModelSlug?: string;
  defaultGeminiModelName?: string;
}): ServerProvider {
  const baseProvider = input.provider.includes(":")
    ? input.provider.slice(0, input.provider.indexOf(":"))
    : input.provider;
  const defaultModel =
    baseProvider === "codex"
      ? {
          slug: input.defaultCodexModelSlug ?? "gpt-5.4",
          name: input.defaultCodexModelName ?? "GPT-5.4",
        }
      : baseProvider === "gemini"
        ? {
            slug: input.defaultGeminiModelSlug ?? "gemini-3.1-pro-preview",
            name: input.defaultGeminiModelName ?? "Gemini 3.1 Pro Preview",
          }
        : {
            slug: input.defaultClaudeModelSlug ?? "claude-sonnet-5",
            name: input.defaultClaudeModelName ?? "Claude Sonnet 5",
          };
  return {
    provider: input.provider as never,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: input.checkedAt,
    models: input.models ?? [
      {
        slug: defaultModel.slug,
        name: defaultModel.name,
        isCustom: false,
        capabilities: null,
      },
    ],
  };
}
