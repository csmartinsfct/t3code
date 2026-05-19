import type { Artifact, MermaidPayload } from "@t3tools/contracts";
import {
  CheckIcon,
  Code2Icon,
  EyeIcon,
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import mermaid from "mermaid";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { ensureNativeApi } from "../../nativeApi";
import { Button } from "../ui/button";
import {
  clampMermaidZoom,
  getMermaidRenderSources,
  type MermaidViewTransform,
  zoomMermaidTransformAtPoint,
} from "./TicketMermaidArtifactView.logic";

const ZOOM_STEP = 1.2;

interface MermaidPayloadShape {
  readonly source?: string;
}

function getMermaidSource(artifact: Artifact): string {
  const payload = (artifact.payload ?? {}) as MermaidPayloadShape;
  return typeof payload.source === "string" ? payload.source : "";
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

function buildRenderId(prefix: string, counter: number): string {
  return `${prefix.replace(/[^a-zA-Z0-9_-]/g, "")}-${counter}`;
}

export function TicketMermaidArtifactView({
  artifact,
  onUpdated,
}: {
  readonly artifact: Artifact;
  readonly onUpdated: (artifact: Artifact) => void;
}) {
  const renderPrefix = useId();
  const renderCounterRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const diagramRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const source = getMermaidSource(artifact);
  const [draft, setDraft] = useState(source);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renderedSvg, setRenderedSvg] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [transform, setTransform] = useState<MermaidViewTransform>({ scale: 1, x: 0, y: 0 });

  const title = artifact.title ?? "Mermaid diagram";
  const visibleSource = editing ? draft : source;
  const hasChanges = draft !== source;

  useEffect(() => {
    setDraft(source);
    setEditing(false);
    setRenderError(null);
  }, [artifact.id, source]);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      if (!visibleSource.trim()) {
        setRenderedSvg("");
        setRenderError("This Mermaid attachment has no source.");
        return;
      }
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: isDarkMode() ? "dark" : "default",
          sequence: { useMaxWidth: false },
          flowchart: { useMaxWidth: false },
        });

        let lastError: unknown = null;
        for (const candidate of getMermaidRenderSources(visibleSource)) {
          try {
            const renderId = buildRenderId(renderPrefix, renderCounterRef.current++);
            const result = await mermaid.render(renderId, candidate);
            if (cancelled) return;
            setRenderedSvg(result.svg);
            setRenderError(null);
            return;
          } catch (cause) {
            lastError = cause;
          }
        }

        throw lastError;
      } catch (cause) {
        if (cancelled) return;
        setRenderedSvg("");
        setRenderError(cause instanceof Error ? cause.message : "Failed to render diagram.");
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [renderPrefix, visibleSource]);

  const fitDiagram = useCallback(() => {
    const viewport = viewportRef.current;
    const svg = diagramRef.current?.querySelector("svg");
    if (!viewport || !(svg instanceof SVGSVGElement)) return;

    const viewportRect = viewport.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const width = viewBox?.width || svg.getBoundingClientRect().width;
    const height = viewBox?.height || svg.getBoundingClientRect().height;
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
    if (!renderedSvg) return;
    const frame = requestAnimationFrame(fitDiagram);
    return () => cancelAnimationFrame(frame);
  }, [fitDiagram, renderedSvg]);

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

  const save = useCallback(async () => {
    if (!hasChanges || saving) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const payload: MermaidPayload = { source: draft };
      const updated = await ensureNativeApi().ticketing.updateArtifact({
        id: artifact.id,
        payload,
      });
      onUpdated(updated);
      setEditing(false);
    } catch (cause) {
      console.error("Failed to save Mermaid artifact", cause);
    } finally {
      setSaving(false);
    }
  }, [artifact.id, draft, hasChanges, onUpdated, saving]);

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
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
              mermaid
            </span>
            <h2 className="truncate text-sm font-medium text-foreground">{title}</h2>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
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
          <div className="mx-1 h-4 w-px bg-border" />
          {editing ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  setDraft(source);
                  setEditing(false);
                }}
                disabled={saving}
              >
                <XIcon className="size-3.5" />
                Cancel
              </Button>
              <Button type="button" size="xs" onClick={() => void save()} disabled={saving}>
                <CheckIcon className="size-3.5" />
                {saving ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(true)}>
              <Code2Icon className="size-3.5" />
              Edit
            </Button>
          )}
        </div>
      </div>

      <div
        className={`grid min-h-0 flex-1 ${
          editing
            ? "grid-rows-[minmax(180px,36%)_1fr] lg:grid-cols-[minmax(280px,38%)_1fr] lg:grid-rows-none"
            : ""
        }`}
      >
        {editing ? (
          <div className="flex min-h-0 flex-col border-b border-border bg-muted/20 lg:border-b-0 lg:border-r">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
              <Code2Icon className="size-3.5" />
              Source
            </div>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-5 text-foreground outline-none"
            />
          </div>
        ) : null}

        <div className="flex min-h-0 flex-col">
          {editing ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
              <EyeIcon className="size-3.5" />
              Preview
            </div>
          ) : null}
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
              dangerouslySetInnerHTML={renderedSvg ? { __html: renderedSvg } : undefined}
            />
            {renderError ? (
              <div className="absolute left-4 top-4 max-w-xl rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {renderError}
              </div>
            ) : null}
            <div className="absolute bottom-3 right-3 rounded border border-border bg-background/90 px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {Math.round(transform.scale * 100)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
