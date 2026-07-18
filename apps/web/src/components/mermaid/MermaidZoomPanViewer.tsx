import { useCallback, useEffect, useRef, useState } from "react";

import {
  clampMermaidZoom,
  type MermaidViewTransform,
  zoomMermaidTransformAtPoint,
} from "~/components/mermaid/mermaidViewLogic";

const ZOOM_STEP = 1.2;

export function MermaidZoomPanViewer({
  svg,
  error,
}: {
  readonly svg: string;
  readonly error: string | null;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const diagramRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [transform, setTransform] = useState<MermaidViewTransform>({ scale: 1, x: 0, y: 0 });

  const fitDiagram = useCallback(() => {
    const viewport = viewportRef.current;
    const el = diagramRef.current?.querySelector("svg");
    if (!viewport || !(el instanceof SVGSVGElement)) return;

    const viewportRect = viewport.getBoundingClientRect();
    const viewBox = el.viewBox.baseVal;
    const width = viewBox?.width || el.getBoundingClientRect().width;
    const height = viewBox?.height || el.getBoundingClientRect().height;
    if (width <= 0 || height <= 0 || viewportRect.width <= 0 || viewportRect.height <= 0) return;

    const scale = clampMermaidZoom(
      Math.min(viewportRect.width / width, viewportRect.height / height) * 0.88,
    );
    setTransform({
      scale,
      x: (viewportRect.width - width * scale) / 2,
      y: (viewportRect.height - height * scale) / 2,
    });
  }, []);

  useEffect(() => {
    if (!svg) return;
    const frame = requestAnimationFrame(fitDiagram);
    return () => cancelAnimationFrame(frame);
  }, [fitDiagram, svg]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const factor = event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setTransform((current) => zoomMermaidTransformAtPoint(current, current.scale * factor, point));
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: transform.x,
        originY: transform.y,
      };
    },
    [transform.x, transform.y],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setTransform((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }));
  }, []);

  const stopDragging = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }, []);

  return (
    <div
      ref={viewportRef}
      className="relative min-h-0 flex-1 cursor-grab overflow-hidden bg-background active:cursor-grabbing"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
    >
      <div
        ref={diagramRef}
        data-mermaid-diagram
        className="absolute left-0 top-0 text-foreground [&_svg]:max-w-none"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
        }}
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      {error ? (
        <div className="absolute left-4 top-4 max-w-xl rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      <div className="absolute bottom-3 right-3 rounded border border-border bg-background/90 px-2 py-1 font-mono text-[11px] text-muted-foreground">
        {Math.round(transform.scale * 100)}%
      </div>
    </div>
  );
}
