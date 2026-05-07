import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { cn } from "~/lib/utils";

import {
  clampDimension,
  effectiveDimensions,
  effectiveMobile,
  effectiveZoom,
  type TabEmulation,
} from "./devicePresets";

type Axis = "right" | "bottom" | "corner";

interface ViewportResizeHandlesProps {
  emulation: TabEmulation;
  onChange: (next: TabEmulation) => void;
}

interface DragState {
  pointerId: number;
  axis: Axis;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  mobile: boolean;
  zoom: number;
}

// Pointer-driven resize handles that peek out from the right edge, bottom
// edge, and bottom-right corner of the emulated viewport. Each handle is
// drawn in HTML and sits OUTSIDE the WebContentsView's geometry — the OS
// view paints over the rect, so anything overlapping it would be invisible.
// A drag flips the active emulation into `kind: "custom"` and updates
// dimensions live; the parent throttles the IPC side via rAF so trackpad
// movements don't flood the main process.
export function ViewportResizeHandles({ emulation, onChange }: ViewportResizeHandlesProps) {
  const dragRef = useRef<DragState | null>(null);

  const onPointerDown = useCallback(
    (axis: Axis) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || emulation.kind === "off") return;
      const dims = effectiveDimensions(emulation);
      if (dims.width === null || dims.height === null) return;
      // Use the *actually displayed* rect dimensions (read from the wrapper,
      // which is the handle's offset parent) rather than the unclamped state
      // value. When the simulated viewport is larger than the pane, the rect
      // is clamped on screen via `min(emulation, 100%)` but the state still
      // carries the full value — capturing the state value here would put the
      // handle's drag origin off the visible bottom/right by the clamp delta,
      // producing a dead-zone before the cursor "catches up" to the rect.
      const zoom = effectiveZoom(emulation);
      const wrapper = event.currentTarget.parentElement;
      const wrapperRect = wrapper?.getBoundingClientRect();
      const startWidth =
        wrapperRect && zoom > 0 ? Math.round(wrapperRect.width / zoom) : dims.width;
      const startHeight =
        wrapperRect && zoom > 0 ? Math.round(wrapperRect.height / zoom) : dims.height;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        axis,
        startX: event.clientX,
        startY: event.clientY,
        startWidth,
        startHeight,
        mobile: effectiveMobile(emulation),
        zoom,
      };
      document.body.style.cursor =
        axis === "right" ? "ew-resize" : axis === "bottom" ? "ns-resize" : "nwse-resize";
      document.body.style.userSelect = "none";
    },
    [emulation],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      // Cursor delta is in CSS pixels; the rect's CSS dimensions are
      // `viewport * zoom`, so divide by zoom so the user-facing dimensions
      // grow at the same rate as the cursor.
      //
      // The wrapper is `justify-center` horizontally, so growing/shrinking
      // the width moves BOTH edges symmetrically — the right edge only
      // tracks at half the rate of the width change. We multiply the width
      // delta by 2 so the right edge (and therefore the handle) keeps up
      // with the cursor. The wrapper is `items-start` vertically so the
      // bottom edge already tracks 1:1; no compensation needed there.
      const dx = ((event.clientX - drag.startX) / drag.zoom) * 2;
      const dy = (event.clientY - drag.startY) / drag.zoom;
      const nextWidth =
        drag.axis === "bottom"
          ? drag.startWidth
          : (clampDimension(drag.startWidth + dx) ?? drag.startWidth);
      const nextHeight =
        drag.axis === "right"
          ? drag.startHeight
          : (clampDimension(drag.startHeight + dy) ?? drag.startHeight);
      onChange({
        kind: "custom",
        width: nextWidth,
        height: nextHeight,
        mobile: drag.mobile,
        rotated: false,
        zoom: drag.zoom,
      });
    },
    [onChange],
  );

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  if (emulation.kind === "off") return null;

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize viewport width"
        className={cn(
          "group absolute top-1/2 right-0 z-10 flex h-16 w-3 translate-x-full -translate-y-1/2 items-center justify-center",
          "cursor-ew-resize touch-none",
        )}
        onPointerDown={onPointerDown("right")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="h-12 w-1 rounded-full bg-foreground/40 transition-colors group-hover:bg-foreground/70" />
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize viewport height"
        className={cn(
          "group absolute bottom-0 left-1/2 z-10 flex h-3 w-16 -translate-x-1/2 translate-y-full items-center justify-center",
          "cursor-ns-resize touch-none",
        )}
        onPointerDown={onPointerDown("bottom")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="h-1 w-12 rounded-full bg-foreground/40 transition-colors group-hover:bg-foreground/70" />
      </div>
      <div
        role="separator"
        aria-label="Resize viewport"
        className={cn(
          "group absolute right-0 bottom-0 z-10 flex size-3 translate-x-full translate-y-full items-end justify-end",
          "cursor-nwse-resize touch-none",
        )}
        onPointerDown={onPointerDown("corner")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
          className="text-foreground/40 transition-colors group-hover:text-foreground/70"
        >
          <path
            d="M11 1 L1 11 M11 5 L5 11 M11 9 L9 11"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </>
  );
}
