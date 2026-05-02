import type { Ticket, TicketId } from "@t3tools/contracts";
import { GripIcon, MoveIcon } from "lucide-react";
import {
  type CSSProperties,
  type MouseEventHandler,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { setLocalStorageItem, useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";

import { SubTicketPreviewContent } from "./SubTicketPreviewContent";
import {
  SUB_TICKET_PREVIEW_DEFAULT_POSITION,
  SUB_TICKET_PREVIEW_DEFAULT_SIZE,
  SUB_TICKET_PREVIEW_POSITION_STORAGE_KEY,
  SUB_TICKET_PREVIEW_SIZE_STORAGE_KEY,
  SUB_TICKET_PREVIEW_VIEWPORT_PADDING,
  SubTicketPreviewPositionSchema,
  SubTicketPreviewSizeSchema,
  clampSubTicketPreviewSize,
  createSubTicketPreviewPosition,
  getSubTicketPreviewViewport,
  type SubTicketPreviewSize,
} from "./subTicketPreviewSize";

type PreviewPoint = { x: number; y: number };
type PreviewGeometry = PreviewPoint & SubTicketPreviewSize;

export interface SubTicketPreviewTarget {
  anchorElement: Element;
  ticketId: TicketId;
}

interface SubTicketPreviewPlacementProps {
  align?: "start" | "center" | "end";
  alignOffset?: number;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}

interface SharedSubTicketPreviewPopupProps extends SubTicketPreviewPlacementProps {
  anchorElement: Element | null;
  collisionPadding?: number;
  fetchPreview: (id: TicketId) => Promise<Ticket | null>;
  getCached: (id: TicketId) => Ticket | undefined;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
  ticketId: TicketId | null;
}

export function useSubTicketPreviewHoverTarget({
  closeDelayMs,
  openDelayMs,
}: {
  closeDelayMs: number;
  openDelayMs: number;
}) {
  const [previewTarget, setPreviewTarget] = useState<SubTicketPreviewTarget | null>(null);
  const targetRef = useRef(previewTarget);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    targetRef.current = previewTarget;
  }, [previewTarget]);

  const cancelPreviewTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useEffect(() => cancelPreviewTimers, [cancelPreviewTimers]);

  const handlePreviewMouseEnter = useCallback(
    (ticketId: TicketId, anchorElement: Element) => {
      cancelPreviewTimers();

      if (targetRef.current !== null) {
        setPreviewTarget({ anchorElement, ticketId });
        return;
      }

      openTimerRef.current = setTimeout(() => {
        openTimerRef.current = null;
        setPreviewTarget({ anchorElement, ticketId });
      }, openDelayMs);
    },
    [cancelPreviewTimers, openDelayMs],
  );

  const handlePreviewMouseLeave = useCallback(() => {
    cancelPreviewTimers();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setPreviewTarget(null);
    }, closeDelayMs);
  }, [cancelPreviewTimers, closeDelayMs]);

  return {
    cancelPreviewTimers,
    handlePreviewMouseEnter,
    handlePreviewMouseLeave,
    previewTarget,
  };
}

export function SharedSubTicketPreviewPopup({
  anchorElement,
  ticketId,
  fetchPreview,
  getCached,
  onMouseEnter,
  onMouseLeave,
  align = "end",
  alignOffset = -190,
  collisionPadding = SUB_TICKET_PREVIEW_VIEWPORT_PADDING,
  side = "bottom",
  sideOffset = 4,
}: SharedSubTicketPreviewPopupProps) {
  const [storedSize, setStoredSize] = useLocalStorage(
    SUB_TICKET_PREVIEW_SIZE_STORAGE_KEY,
    { version: 1, ...SUB_TICKET_PREVIEW_DEFAULT_SIZE },
    SubTicketPreviewSizeSchema,
  );
  const [storedPosition, setStoredPosition] = useLocalStorage(
    SUB_TICKET_PREVIEW_POSITION_STORAGE_KEY,
    { version: 1, ...SUB_TICKET_PREVIEW_DEFAULT_POSITION },
    SubTicketPreviewPositionSchema,
  );
  const [hasManualPosition, setHasManualPosition] = useState(() =>
    hasStoredSubTicketPreviewPosition(),
  );
  const [lastTicketId, setLastTicketId] = useState<TicketId | null>(ticketId);
  const [geometry, setGeometry] = useState<PreviewGeometry | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const geometryRef = useRef<PreviewGeometry | null>(geometry);
  const hasManualPositionRef = useRef(hasManualPosition);
  const storedPositionRef = useRef(storedPosition);
  const storedSizeRef = useRef(storedSize);
  const wasOpenRef = useRef(false);

  geometryRef.current = geometry;
  hasManualPositionRef.current = hasManualPosition;
  storedPositionRef.current = storedPosition;
  storedSizeRef.current = storedSize;

  const renderedTicketId = ticketId ?? lastTicketId;
  const isOpen = ticketId !== null;

  useEffect(() => {
    if (ticketId !== null) {
      setLastTicketId(ticketId);
    }
  }, [ticketId]);

  const persistSize = useCallback(
    (size: SubTicketPreviewSize) => {
      const nextSize = clampSubTicketPreviewSize(size, getSubTicketPreviewViewport());
      setLocalStorageItem(
        SUB_TICKET_PREVIEW_SIZE_STORAGE_KEY,
        nextSize,
        SubTicketPreviewSizeSchema,
      );
      storedSizeRef.current = nextSize;
      setStoredSize(nextSize);
    },
    [setStoredSize],
  );

  const persistPosition = useCallback(
    (position: PreviewPoint) => {
      const viewport = getSubTicketPreviewViewport();
      const nextPosition = createSubTicketPreviewPosition(position, viewport);
      setLocalStorageItem(
        SUB_TICKET_PREVIEW_POSITION_STORAGE_KEY,
        nextPosition,
        SubTicketPreviewPositionSchema,
      );
      hasManualPositionRef.current = true;
      storedPositionRef.current = nextPosition;
      setHasManualPosition(true);
      setStoredPosition(nextPosition);
    },
    [setStoredPosition],
  );

  const updateGeometry = useCallback((nextGeometry: PreviewGeometry) => {
    const clampedGeometry = clampPreviewGeometry(nextGeometry, getSubTicketPreviewViewport());
    geometryRef.current = clampedGeometry;
    setGeometry(clampedGeometry);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen || !anchorElement) {
      wasOpenRef.current = isOpen;
      return;
    }

    if (wasOpenRef.current && geometryRef.current !== null) {
      wasOpenRef.current = true;
      return;
    }

    const size = clampSubTicketPreviewSize(storedSizeRef.current, getSubTicketPreviewViewport());
    const nextGeometry = hasManualPositionRef.current
      ? clampPreviewGeometry(
          {
            ...size,
            x: storedPositionRef.current.x,
            y: storedPositionRef.current.y,
          },
          getSubTicketPreviewViewport(),
        )
      : createAnchoredGeometry({
          align,
          alignOffset,
          anchorElement,
          collisionPadding,
          side,
          sideOffset,
          size,
        });

    geometryRef.current = nextGeometry;
    setGeometry(nextGeometry);
    wasOpenRef.current = true;
  }, [align, alignOffset, anchorElement, collisionPadding, isOpen, side, sideOffset]);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    const handleWindowResize = () => {
      const currentGeometry = geometryRef.current;
      if (!currentGeometry) return;
      updateGeometry(currentGeometry);
    };

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isOpen, updateGeometry]);

  if (
    !isOpen ||
    renderedTicketId === null ||
    geometry === null ||
    typeof document === "undefined"
  ) {
    return null;
  }

  return createPortal(
    <div
      ref={popupRef}
      data-slot="popover-popup"
      className={cn(
        "fixed z-50 flex rounded-lg border bg-popover text-popover-foreground shadow-lg/5 outline-none",
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)]",
        "dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
        "group/sub-ticket-preview isolate overflow-clip p-4 [contain:layout_paint]",
      )}
      style={previewStyle(geometry)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-clip overflow-y-auto pr-1 [contain:layout_paint]"
        data-sub-ticket-preview-scroll
      >
        <SubTicketPreviewContent
          ticketId={renderedTicketId}
          fetchPreview={fetchPreview}
          getCached={getCached}
        />
      </div>
      <SubTicketPreviewResizeHandle
        geometryRef={geometryRef}
        popupRef={popupRef}
        onGeometryChange={updateGeometry}
        onPositionCommit={persistPosition}
        onPreviewSizeCommit={persistSize}
      />
      <SubTicketPreviewDragHandle
        geometryRef={geometryRef}
        popupRef={popupRef}
        onGeometryChange={updateGeometry}
        onPositionCommit={persistPosition}
      />
    </div>,
    document.body,
  );
}

function SubTicketPreviewResizeHandle({
  geometryRef,
  popupRef,
  onGeometryChange,
  onPositionCommit,
  onPreviewSizeCommit,
}: {
  geometryRef: RefObject<PreviewGeometry | null>;
  popupRef: RefObject<HTMLDivElement | null>;
  onGeometryChange: (geometry: PreviewGeometry) => void;
  onPositionCommit: (position: PreviewPoint) => void;
  onPreviewSizeCommit: (size: SubTicketPreviewSize) => void;
}) {
  const resizeStateRef = useRef<{
    latestGeometry: PreviewGeometry;
    pointerId: number;
    startGeometry: PreviewGeometry;
    startX: number;
    startY: number;
  } | null>(null);

  const endResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;

      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      releasePointerCaptureSafely(event.currentTarget, event.pointerId);

      onPreviewSizeCommit(resizeState.latestGeometry);
      onPositionCommit(resizeState.latestGeometry);
    },
    [onPositionCommit, onPreviewSizeCommit],
  );

  return (
    <button
      type="button"
      aria-label="Resize sub-ticket preview"
      title="Drag to resize preview"
      className={cn(
        "absolute right-0 bottom-0 z-20 flex size-7 cursor-nwse-resize touch-none select-none items-center justify-center rounded-br-lg rounded-tl-md border-t border-l border-border/70 bg-popover/95 text-muted-foreground/80 shadow-sm transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "before:absolute before:right-0 before:bottom-0 before:size-10 before:content-['']",
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || geometryRef.current === null) return;

        event.preventDefault();
        event.stopPropagation();
        setPointerCaptureSafely(event.currentTarget, event.pointerId);
        document.body.style.cursor = "nwse-resize";
        document.body.style.userSelect = "none";

        resizeStateRef.current = {
          latestGeometry: geometryRef.current,
          pointerId: event.pointerId,
          startGeometry: geometryRef.current,
          startX: event.clientX,
          startY: event.clientY,
        };
      }}
      onPointerMove={(event) => {
        const resizeState = resizeStateRef.current;
        if (!resizeState || resizeState.pointerId !== event.pointerId) return;

        event.preventDefault();
        event.stopPropagation();
        const nextGeometry = clampPreviewGeometry(
          {
            ...resizeState.startGeometry,
            width: resizeState.startGeometry.width + event.clientX - resizeState.startX,
            maxHeight: resizeState.startGeometry.maxHeight + event.clientY - resizeState.startY,
          },
          getSubTicketPreviewViewport(),
        );
        resizeState.latestGeometry = nextGeometry;
        applyPreviewGeometry(popupRef.current, nextGeometry);
        onGeometryChange(nextGeometry);
      }}
      onPointerUp={endResize}
      onPointerCancel={endResize}
    >
      <GripIcon className="size-3 rotate-45" />
    </button>
  );
}

function SubTicketPreviewDragHandle({
  geometryRef,
  popupRef,
  onGeometryChange,
  onPositionCommit,
}: {
  geometryRef: RefObject<PreviewGeometry | null>;
  popupRef: RefObject<HTMLDivElement | null>;
  onGeometryChange: (geometry: PreviewGeometry) => void;
  onPositionCommit: (position: PreviewPoint) => void;
}) {
  const dragStateRef = useRef<{
    latestGeometry: PreviewGeometry;
    pointerId: number;
    startGeometry: PreviewGeometry;
    startX: number;
    startY: number;
  } | null>(null);

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      dragStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      releasePointerCaptureSafely(event.currentTarget, event.pointerId);

      onPositionCommit(dragState.latestGeometry);
    },
    [onPositionCommit],
  );

  return (
    <button
      type="button"
      aria-label="Move sub-ticket preview"
      title="Drag to move preview"
      className={cn(
        "absolute bottom-0 left-0 z-20 flex size-7 cursor-move touch-none select-none items-center justify-center rounded-tr-md rounded-bl-lg border-t border-r border-border/70 bg-popover/95 text-muted-foreground/80 shadow-sm transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "before:absolute before:bottom-0 before:left-0 before:size-10 before:content-['']",
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || geometryRef.current === null) return;

        event.preventDefault();
        event.stopPropagation();
        setPointerCaptureSafely(event.currentTarget, event.pointerId);
        document.body.style.cursor = "move";
        document.body.style.userSelect = "none";

        dragStateRef.current = {
          latestGeometry: geometryRef.current,
          pointerId: event.pointerId,
          startGeometry: geometryRef.current,
          startX: event.clientX,
          startY: event.clientY,
        };
      }}
      onPointerMove={(event) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId) return;

        event.preventDefault();
        event.stopPropagation();
        const nextGeometry = clampPreviewGeometry(
          {
            ...dragState.startGeometry,
            x: dragState.startGeometry.x + event.clientX - dragState.startX,
            y: dragState.startGeometry.y + event.clientY - dragState.startY,
          },
          getSubTicketPreviewViewport(),
        );
        dragState.latestGeometry = nextGeometry;
        applyPreviewGeometry(popupRef.current, nextGeometry);
        onGeometryChange(nextGeometry);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <MoveIcon className="size-3.5" />
    </button>
  );
}

function createAnchoredGeometry({
  align,
  alignOffset,
  anchorElement,
  collisionPadding,
  side,
  sideOffset,
  size,
}: Required<SubTicketPreviewPlacementProps> & {
  anchorElement: Element;
  collisionPadding: number;
  size: SubTicketPreviewSize;
}): PreviewGeometry {
  const anchorRect = anchorElement.getBoundingClientRect();
  const baseGeometry = {
    ...size,
    x: anchorRect.left,
    y: anchorRect.bottom + sideOffset,
  };

  if (side === "top") {
    baseGeometry.y = anchorRect.top - sideOffset - size.maxHeight;
  } else if (side === "right") {
    baseGeometry.x = anchorRect.right + sideOffset;
    baseGeometry.y = anchorRect.top;
  } else if (side === "left") {
    baseGeometry.x = anchorRect.left - sideOffset - size.width;
    baseGeometry.y = anchorRect.top;
  }

  if (side === "top" || side === "bottom") {
    if (align === "center") {
      baseGeometry.x = anchorRect.left + anchorRect.width / 2 - size.width / 2 + alignOffset;
    } else if (align === "end") {
      baseGeometry.x = anchorRect.right - size.width + alignOffset;
    } else {
      baseGeometry.x = anchorRect.left + alignOffset;
    }
  } else if (align === "center") {
    baseGeometry.y = anchorRect.top + anchorRect.height / 2 - size.maxHeight / 2 + alignOffset;
  } else if (align === "end") {
    baseGeometry.y = anchorRect.bottom - size.maxHeight + alignOffset;
  } else {
    baseGeometry.y = anchorRect.top + alignOffset;
  }

  return clampPreviewGeometry(baseGeometry, getSubTicketPreviewViewport(), collisionPadding);
}

function clampPreviewGeometry(
  geometry: Pick<PreviewGeometry, "maxHeight" | "width" | "x" | "y">,
  viewport: { width: number; height: number },
  padding = SUB_TICKET_PREVIEW_VIEWPORT_PADDING,
): PreviewGeometry {
  const size = clampSubTicketPreviewSize(geometry, viewport);
  const maxX = viewport.width - padding - size.width;
  const maxY = viewport.height - padding - size.maxHeight;

  return {
    ...size,
    x: clampAxis(geometry.x, padding, maxX),
    y: clampAxis(geometry.y, padding, maxY),
  };
}

function previewStyle(geometry: PreviewGeometry): CSSProperties {
  return {
    height: `${geometry.maxHeight}px`,
    left: `${geometry.x}px`,
    top: `${geometry.y}px`,
    width: `${geometry.width}px`,
  };
}

function applyPreviewGeometry(element: HTMLElement | null, geometry: PreviewGeometry): void {
  if (!element) return;
  element.style.height = `${geometry.maxHeight}px`;
  element.style.left = `${geometry.x}px`;
  element.style.top = `${geometry.y}px`;
  element.style.width = `${geometry.width}px`;
}

function clampAxis(value: number, min: number, max: number): number {
  if (min > max) {
    return Math.round((min + max) / 2);
  }
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.round(Math.max(min, Math.min(value, max)));
}

function hasStoredSubTicketPreviewPosition(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(SUB_TICKET_PREVIEW_POSITION_STORAGE_KEY) !== null;
}

function setPointerCaptureSafely(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Synthetic browser-test PointerEvents are not always backed by an active pointer.
  }
}

function releasePointerCaptureSafely(element: HTMLElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // A missing capture should not prevent committing the final drag/resize state.
  }
}
