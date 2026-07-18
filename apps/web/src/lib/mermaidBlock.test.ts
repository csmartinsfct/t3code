import { describe, expect, it } from "vitest";

import { isMermaidBlock, shouldRenderMermaidDiagram } from "./mermaidBlock";

describe("isMermaidBlock", () => {
  it("matches a mermaid fence className", () => {
    expect(isMermaidBlock("language-mermaid")).toBe(true);
    expect(isMermaidBlock("hljs language-mermaid")).toBe(true);
  });

  it("rejects non-mermaid or missing classNames", () => {
    expect(isMermaidBlock("language-ts")).toBe(false);
    expect(isMermaidBlock("language-mermaidfoo")).toBe(false);
    expect(isMermaidBlock(undefined)).toBe(false);
  });
});

describe("shouldRenderMermaidDiagram", () => {
  it("renders only when done streaming and no error", () => {
    expect(shouldRenderMermaidDiagram(false, false)).toBe(true);
    expect(shouldRenderMermaidDiagram(true, false)).toBe(false);
    expect(shouldRenderMermaidDiagram(false, true)).toBe(false);
    expect(shouldRenderMermaidDiagram(true, true)).toBe(false);
  });
});
