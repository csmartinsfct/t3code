import { describe, expect, it } from "vitest";

import {
  DYNAMIC_CHAT_UI_BUILDER_OUTPUT_END,
  DYNAMIC_CHAT_UI_BUILDER_PROMPT_DEFAULT,
  renderDynamicChatUiBuilderPromptTemplate,
  validateDynamicChatUiBuilderPromptTemplate,
} from "./dynamicChatUiBuilderPrompt";

describe("dynamic chat UI builder prompt", () => {
  it("ships with every required placeholder", () => {
    expect(
      validateDynamicChatUiBuilderPromptTemplate(DYNAMIC_CHAT_UI_BUILDER_PROMPT_DEFAULT),
    ).toEqual([]);
  });

  it("renders dynamic builder context into the prompt template", () => {
    const rendered = renderDynamicChatUiBuilderPromptTemplate(
      DYNAMIC_CHAT_UI_BUILDER_PROMPT_DEFAULT,
      {
        modeInstruction: "Generate a fresh artifact.",
        userPrompt: "Build a compact pricing simulator.",
        extraContext: "Structured data: {}",
        preferences: '{ "title": "Pricing" }',
        previousArtifact: "",
        designGuide: "Use compact spacing.",
      },
    );

    expect(rendered).toContain("Generate a fresh artifact.");
    expect(rendered).toContain("Build a compact pricing simulator.");
    expect(rendered).toContain('{ "title": "Pricing" }');
    expect(rendered).toContain("Use compact spacing.");
    expect(rendered).toContain(DYNAMIC_CHAT_UI_BUILDER_OUTPUT_END);
    expect(rendered).not.toContain("{{userPrompt}}");
  });
});
