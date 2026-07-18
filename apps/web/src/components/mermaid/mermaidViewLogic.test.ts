import { describe, expect, it } from "vitest";

import {
  clampMermaidZoom,
  getMermaidRenderSources,
  zoomMermaidTransformAtPoint,
} from "./mermaidViewLogic";

describe("mermaid view logic", () => {
  it("clamps zoom to the supported diagram scale range", () => {
    expect(clampMermaidZoom(0.01)).toBe(0.1);
    expect(clampMermaidZoom(2)).toBe(2);
    expect(clampMermaidZoom(10)).toBe(6);
  });

  it("zooms around the requested viewport point", () => {
    const next = zoomMermaidTransformAtPoint({ scale: 1, x: 10, y: 20 }, 2, { x: 110, y: 220 });

    expect(next).toEqual({ scale: 2, x: -90, y: -180 });
  });

  it("adds a sequence-diagram fallback for semicolons in text", () => {
    expect(getMermaidRenderSources("sequenceDiagram\nNote over A: Ready; continue")).toEqual([
      "sequenceDiagram\nNote over A: Ready; continue",
      "sequenceDiagram\nNote over A: Ready, continue",
    ]);
  });
});
