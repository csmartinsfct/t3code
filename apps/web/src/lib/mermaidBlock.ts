const FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;

export function isMermaidBlock(className: string | undefined): boolean {
  const match = className?.match(FENCE_LANGUAGE_REGEX);
  return match?.[1] === "mermaid";
}

export function shouldRenderMermaidDiagram(isStreaming: boolean, hasError: boolean): boolean {
  return !isStreaming && !hasError;
}
