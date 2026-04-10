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
}): ServerProvider {
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
        slug:
          input.provider === "codex"
            ? (input.defaultCodexModelSlug ?? "gpt-5.4")
            : (input.defaultClaudeModelSlug ?? "claude-opus-4-6"),
        name:
          input.provider === "codex"
            ? (input.defaultCodexModelName ?? "GPT-5.4")
            : (input.defaultClaudeModelName ?? "Claude Opus 4.6"),
        isCustom: false,
        capabilities: null,
      },
    ],
  };
}
