import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";

import {
  buildDynamicChatUiBlock,
  parseDynamicChatUiBuilderTextOutput,
  readDynamicChatUiPromptRequest,
  resolveDynamicChatUiBuilderModelSelection,
  resolveDynamicChatUiDesignGuidePath,
} from "./http";

describe("dynamic chat UI HTTP helpers", () => {
  it("builds a durable dynamic chat UI fenced block", () => {
    const result = buildDynamicChatUiBlock({
      id: "test-artifact",
      title: "Test artifact",
      description: "A compact artifact.",
      initialHeight: 260,
      maxHeight: 520,
      html: "<!doctype html><html><body><button>Run</button></body></html>",
    });

    expect(result).toMatchObject({
      payload: {
        version: 1,
        id: "test-artifact",
        title: "Test artifact",
        description: "A compact artifact.",
        initialHeight: 260,
        maxHeight: 520,
      },
    });
    expect("block" in result ? result.block : "").toContain("```t3:dynamic-chat-ui");
    expect("block" in result ? result.block : "").not.toContain("<!doctype html>");
  });

  it("rejects incomplete HTML artifacts", () => {
    expect(buildDynamicChatUiBlock({ title: "No HTML" })).toEqual({ error: "html is required." });
    expect(buildDynamicChatUiBlock({ html: "<div />" })).toEqual({ error: "title is required." });
  });

  it("requires parent agents to provide status title and description", () => {
    expect(readDynamicChatUiPromptRequest({ prompt: "Build a pricing simulator." })).toEqual({
      error:
        "title is required for Dynamic Chat UI generation. Pass a short, user-visible title for the generating card.",
    });
    expect(
      readDynamicChatUiPromptRequest({
        prompt: "Build a pricing simulator.",
        title: "Pricing simulator",
      }),
    ).toEqual({
      error:
        "description is required for Dynamic Chat UI generation. Pass a brief description of what is being built.",
    });
    expect(
      readDynamicChatUiPromptRequest({
        prompt: "Build a pricing simulator.",
        title: "Pricing simulator",
        description: "Interactive simulator for pricing assumptions.",
      }),
    ).toEqual({
      userPrompt: "Build a pricing simulator.",
      title: "Pricing simulator",
      description: "Interactive simulator for pricing assumptions.",
    });
  });

  it("resolves the design guide from a package-level server cwd", async () => {
    const resolved = await resolveDynamicChatUiDesignGuidePath(process.cwd());

    expect(resolved.endsWith("docs/design-language.md")).toBe(true);
  });

  it("parses delimiter-based builder output without JSON-escaping HTML", () => {
    expect(
      parseDynamicChatUiBuilderTextOutput(`T3_DYNAMIC_CHAT_UI_META_JSON
{"initialHeight":420,"maxHeight":700}
T3_DYNAMIC_CHAT_UI_HTML
<!doctype html><html><body><script>const label = "SEV-1";</script></body></html>
T3_DYNAMIC_CHAT_UI_END`),
    ).toEqual({
      initialHeight: 420,
      maxHeight: 700,
      html: '<!doctype html><html><body><script>const label = "SEV-1";</script></body></html>',
    });
  });

  it("prefers the calling thread model selection over global text generation settings", () => {
    const threadModelSelection = {
      provider: "claudeAgent" as const,
      profileId: "metric",
      model: "claude-opus-4-8",
      options: { effort: "xhigh" as const, contextWindow: "1m" },
    };

    expect(
      resolveDynamicChatUiBuilderModelSelection({
        serverSettings: DEFAULT_SERVER_SETTINGS,
        threadModelSelection,
      }),
    ).toEqual({
      ...threadModelSelection,
      options: { effort: "high", contextWindow: "1m" },
    });
  });
});
