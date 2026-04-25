export const DYNAMIC_CHAT_UI_BUILDER_META_START = "T3_DYNAMIC_CHAT_UI_META_JSON";
export const DYNAMIC_CHAT_UI_BUILDER_HTML_START = "T3_DYNAMIC_CHAT_UI_HTML";
export const DYNAMIC_CHAT_UI_BUILDER_OUTPUT_END = "T3_DYNAMIC_CHAT_UI_END";

export const DYNAMIC_CHAT_UI_BUILDER_PROMPT_PLACEHOLDERS = [
  "{{modeInstruction}}",
  "{{userPrompt}}",
  "{{extraContext}}",
  "{{preferences}}",
  "{{previousArtifact}}",
  "{{designGuide}}",
] as const;

export type DynamicChatUiBuilderPromptPlaceholder =
  (typeof DYNAMIC_CHAT_UI_BUILDER_PROMPT_PLACEHOLDERS)[number];

export const DYNAMIC_CHAT_UI_BUILDER_PROMPT_DEFAULT = `You are the T3 Code dynamic chat UI builder.

{{modeInstruction}}

Return exactly this delimiter format, with no markdown fences and no extra commentary:
${DYNAMIC_CHAT_UI_BUILDER_META_START}
{"initialHeight":360,"maxHeight":700}
${DYNAMIC_CHAT_UI_BUILDER_HTML_START}
<!doctype html>
<html>...</html>
${DYNAMIC_CHAT_UI_BUILDER_OUTPUT_END}

Hard requirements:
- The metadata block must be valid JSON with initialHeight and maxHeight. \`maxHeight\` is retained for compatibility only; the chat renderer will grow the iframe to the measured content height.
- The HTML must include all CSS and JavaScript inline; do not load external network resources.
- It will run in a sandboxed iframe with scripts enabled and no same-origin access.
- It must work at 320px, 520px, and 800px wide inside a resizable chat column.
- Use compact T3 Code visual language: subtle borders, small type, restrained shadows, semantic status colors, dense but calm layout.
- Use the injected iframe CSS variables for colors: --t3-background, --t3-card, --t3-muted, --t3-border, --t3-foreground, --t3-muted-foreground, --t3-primary, --t3-success, --t3-warning, --t3-destructive.
- Main surfaces must be neutral: transparent, var(--t3-card), or var(--t3-muted). Do not use blue, slate, navy, indigo, or tinted dashboard backgrounds for panels/cards.
- Reserve status colors for narrow accents, badges, lines, dots, and charts. Do not wash whole sections with status colors.
- Treat the design guide and its anti-patterns as mandatory: avoid custom keyframe animations, oversized radii, marketing-like whitespace, and arbitrary one-off color palettes.
- Size the document to its actual content. Do not use viewport-height roots such as height:100vh, min-height:100vh, 100dvh, or full-screen spacer layouts.
- Set initialHeight close to the expected rendered content height. Do not inflate heights to create breathing room; the iframe will autosize to actual content.
- Include interactivity when appropriate: sliders, tabs, sortable/filterable tables, SVG/canvas charts, derived values.
- Call \`window.t3ChatUi?.postHeight?.(height)\` after layout changes if the artifact height changes.
- Prefer native DOM/SVG/canvas. Do not use React, JSX, Tailwind classes, external UI libraries, CDNs, or module imports.
- For revisions, preserve the existing artifact's intent and interaction model unless the user asks to change it. Return the complete final HTML document, not a patch or partial diff.

User request:
{{userPrompt}}

{{extraContext}}

Preferences:
{{preferences}}

{{previousArtifact}}

T3 Code design guide:
{{designGuide}}`;

export interface DynamicChatUiBuilderPromptValues {
  readonly modeInstruction: string;
  readonly userPrompt: string;
  readonly extraContext: string;
  readonly preferences: string;
  readonly previousArtifact: string;
  readonly designGuide: string;
}

export function validateDynamicChatUiBuilderPromptTemplate(
  template: string,
): DynamicChatUiBuilderPromptPlaceholder[] {
  return DYNAMIC_CHAT_UI_BUILDER_PROMPT_PLACEHOLDERS.filter(
    (placeholder) => !template.includes(placeholder),
  );
}

export function renderDynamicChatUiBuilderPromptTemplate(
  template: string,
  values: DynamicChatUiBuilderPromptValues,
): string {
  const replacements = {
    "{{modeInstruction}}": values.modeInstruction,
    "{{userPrompt}}": values.userPrompt,
    "{{extraContext}}": values.extraContext,
    "{{preferences}}": values.preferences,
    "{{previousArtifact}}": values.previousArtifact,
    "{{designGuide}}": values.designGuide,
  } as const satisfies Record<DynamicChatUiBuilderPromptPlaceholder, string>;

  let rendered = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    rendered = rendered.split(placeholder).join(value);
  }
  return rendered;
}
