import type { ToolDefinition } from "../restResponse";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "create_dynamic_chat_ui_from_prompt",
    title: "Create Dynamic Chat UI From Prompt",
    description:
      "Call the configured secondary model with the T3 design guide and chat artifact constraints, then insert the generated UI directly into this chat timeline.",
    inputSchema: {
      prompt: {
        type: "string",
        description:
          "Natural-language UI request, for example: 'Build a slider-based pricing simulator for the chat timeline'.",
      },
      data: {
        type: "object",
        optional: true,
        description: "Optional structured data the generated UI should visualize or simulate.",
      },
      context: {
        type: "string",
        optional: true,
        description: "Optional extra product/domain context for the UI builder.",
      },
      sourceArtifactId: {
        type: "string",
        optional: true,
        description:
          "Existing dynamic chat UI artifact id to revise. When provided, the builder resumes the hidden artifact session when possible and receives the prior artifact context.",
      },
      sourceMessageId: {
        type: "string",
        optional: true,
        description:
          "Optional assistant message id containing the source artifact. Use with sourceArtifactId when the thread contains multiple artifact revisions.",
      },
      id: {
        type: "string",
        optional: true,
        description:
          "Stable artifact id for the returned block. Defaults to sourceArtifactId for revisions or a server-generated id for new artifacts.",
      },
      title: {
        type: "string",
        description: "Required short artifact title shown immediately in the generating card.",
      },
      description: {
        type: "string",
        description:
          "Required brief description of what is being built, shown immediately in the generating card.",
      },
      initialHeight: {
        type: "number",
        optional: true,
        description:
          "Preferred initial iframe height in pixels. The iframe will continue autosizing to its measured content height.",
      },
    },
  },
];

export function readTrimmed(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readDynamicChatUiPromptRequest(input: Record<string, unknown>):
  | {
      readonly userPrompt: string;
      readonly title: string;
      readonly description: string;
    }
  | { readonly error: string } {
  const userPrompt = readTrimmed(input, "prompt");
  if (!userPrompt) return { error: "prompt is required." };

  const title = readTrimmed(input, "title");
  if (!title) {
    return {
      error:
        "title is required for Dynamic Chat UI generation. Pass a short, user-visible title for the generating card.",
    };
  }

  const description = readTrimmed(input, "description");
  if (!description) {
    return {
      error:
        "description is required for Dynamic Chat UI generation. Pass a brief description of what is being built.",
    };
  }

  return { userPrompt, title, description };
}
