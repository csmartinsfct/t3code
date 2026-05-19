const MIN_SCALE = 0.1;
const MAX_SCALE = 6;

export interface MermaidViewTransform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export function clampMermaidZoom(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export function zoomMermaidTransformAtPoint(
  transform: MermaidViewTransform,
  nextScale: number,
  point: { x: number; y: number },
): MermaidViewTransform {
  const scale = clampMermaidZoom(nextScale);
  const ratio = scale / transform.scale;
  return {
    scale,
    x: point.x - (point.x - transform.x) * ratio,
    y: point.y - (point.y - transform.y) * ratio,
  };
}

export function getMermaidRenderSources(source: string): readonly string[] {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith("sequenceDiagram") || !source.includes(";")) {
    return [source];
  }

  // Mermaid Live has historically tolerated semicolons in sequence text, but
  // Mermaid 11.15 rejects them during parse. Keep saved source intact and use
  // this only as a render fallback.
  return [source, source.replaceAll(";", ",")];
}
