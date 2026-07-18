import { MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
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

  const zoomAtCenter = useCallback((factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const point = { x: rect.width / 2, y: rect.height / 2 };
    setTransform((current) => zoomMermaidTransformAtPoint(current, current.scale * factor, point));
  }, []);

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

  const controls = useMemo(
    () => [
      {
        label: "Zoom out",
        icon: <MinusIcon className="size-3.5" />,
        onClick: () => zoomAtCenter(1 / ZOOM_STEP),
      },
      {
        label: "Zoom in",
        icon: <PlusIcon className="size-3.5" />,
        onClick: () => zoomAtCenter(ZOOM_STEP),
      },
      {
        label: "Reset view",
        icon: <RotateCcwIcon className="size-3.5" />,
        onClick: fitDiagram,
      },
    ],
    [fitDiagram, zoomAtCenter],
  );

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
      <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded border border-border bg-background/90 p-1">
        {controls.map((control) => (
          <Button
            key={control.label}
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={control.onClick}
            aria-label={control.label}
            title={control.label}
          >
            {control.icon}
          </Button>
        ))}
      </div>
      <div className="absolute bottom-3 right-3 rounded border border-border bg-background/90 px-2 py-1 font-mono text-[11px] text-muted-foreground">
        {Math.round(transform.scale * 100)}%
      </div>
    </div>
  );
}
