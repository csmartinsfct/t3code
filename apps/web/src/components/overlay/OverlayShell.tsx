import { Component, useEffect, useRef, useState } from "react";
import type React from "react";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";

import type { OverlayRenderMessage } from "@t3tools/contracts";
import type { OverlayAnchorRect } from "@t3tools/contracts";

import { logWebTimeline } from "~/timelineLogger";

import { OverlayContent } from "./OverlayContent";

// ---------------------------------------------------------------------------
// Typed access to the overlay bridge exposed by overlay-preload.ts
// ---------------------------------------------------------------------------
interface OverlayBridge {
  onRender(handler: (msg: OverlayRenderMessage) => void): () => void;
  onClear(handler: () => void): () => void;
  requestDismiss(): void;
  emitEvent(type: string, payload: unknown): void;
}

function getBridge(): OverlayBridge | null {
  return (window as Window & { overlayBridge?: OverlayBridge }).overlayBridge ?? null;
}

function getMessageAnchor(message: OverlayRenderMessage | null): OverlayAnchorRect | null {
  if (!message) return null;
  if ("anchor" in message && message.anchor) return message.anchor;
  if (
    message.type === "route" &&
    (message.presentation.kind === "popover" || message.presentation.kind === "menu")
  ) {
    return message.presentation.anchor;
  }
  return null;
}

function isHoverRouteMessage(message: OverlayRenderMessage | null): boolean {
  return (
    message?.type === "route" &&
    (message.presentation.kind === "popover" || message.presentation.kind === "menu") &&
    message.presentation.interaction === "hover"
  );
}

function containsPoint(rect: DOMRect | OverlayAnchorRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

class OverlayErrorBoundary extends Component<
  { children: React.ReactNode; onError: (error: unknown) => void; resetKey: unknown },
  { hasError: boolean; resetKey: unknown }
> {
  override state = { hasError: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  static getDerivedStateFromProps(
    props: { resetKey: unknown },
    state: { hasError: boolean; resetKey: unknown },
  ) {
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, resetKey: props.resetKey };
    }
    return null;
  }

  override componentDidCatch(error: unknown) {
    console.error("[overlay] render failed", error);
    this.props.onError(error);
  }

  override render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Root component — full-window transparent container.
// When a render message arrives, positions a zero-size virtual-anchor div at
// the trigger's screen coordinates and renders the overlay relative to it.
// Outside clicks on the transparent backdrop call requestDismiss().
// ---------------------------------------------------------------------------
export function OverlayShell() {
  const [message, setMessage] = useState<OverlayRenderMessage | null>(null);
  const virtualAnchorRef = useRef<HTMLDivElement>(null);
  const hoverDismissTimerRef = useRef<number | null>(null);
  const bridge = getBridge();

  const clearHoverDismissTimer = () => {
    if (hoverDismissTimerRef.current === null) return;
    window.clearTimeout(hoverDismissTimerRef.current);
    hoverDismissTimerRef.current = null;
  };

  const scheduleHoverDismiss = () => {
    if (hoverDismissTimerRef.current !== null) return;
    hoverDismissTimerRef.current = window.setTimeout(() => {
      hoverDismissTimerRef.current = null;
      logWebTimeline("overlay-shell.hover-dismiss", {
        messageType: message?.type,
        routeKey: message?.type === "route" ? message.routeKey : undefined,
      });
      bridge?.requestDismiss();
    }, 120);
  };

  useEffect(() => {
    if (!bridge) return;
    const unsubRender = bridge.onRender((msg) => {
      logWebTimeline("overlay-shell.render-message", {
        type: msg.type,
        ...(msg.type === "route"
          ? { routeKey: msg.routeKey, presentation: msg.presentation.kind }
          : {}),
      });
      setMessage(msg);
    });
    const unsubClear = bridge.onClear(() => {
      logWebTimeline("overlay-shell.clear");
      setMessage(null);
    });
    return () => {
      unsubRender();
      unsubClear();
    };
  }, [bridge]);

  useEffect(() => {
    clearHoverDismissTimer();
    return clearHoverDismissTimer;
  }, [message]);

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      logWebTimeline("overlay-shell.backdrop-dismiss", {
        messageType: message?.type,
        routeKey: message?.type === "route" ? message.routeKey : undefined,
      });
      bridge?.requestDismiss();
    }
  };

  const messageAnchor = getMessageAnchor(message);

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isHoverRouteMessage(message)) return;

    const { clientX, clientY } = e;
    if (messageAnchor && containsPoint(messageAnchor, clientX, clientY)) {
      clearHoverDismissTimer();
      return;
    }

    const popupElements = document.querySelectorAll<HTMLElement>('[data-slot="popover-popup"]');
    for (const popup of popupElements) {
      if (containsPoint(popup.getBoundingClientRect(), clientX, clientY)) {
        clearHoverDismissTimer();
        return;
      }
    }

    scheduleHoverDismiss();
  };

  const handlePointerLeave = () => {
    if (isHoverRouteMessage(message)) scheduleHoverDismiss();
  };

  const anchorStyle: CSSProperties = messageAnchor
    ? {
        position: "fixed",
        left: messageAnchor.x,
        top: messageAnchor.y,
        width: messageAnchor.width,
        height: messageAnchor.height,
        pointerEvents: "none",
      }
    : { position: "fixed", left: -9999, top: -9999, width: 0, height: 0, pointerEvents: "none" };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        pointerEvents: message ? "auto" : "none",
      }}
      onClick={handleBackdropClick}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
    >
      {/* Virtual anchor — positioned at the trigger element's DOMRect.
          Base UI Positioner receives this as its `anchor` prop so it can
          apply smart flip/collision-avoidance without touching the host DOM. */}
      <div ref={virtualAnchorRef} aria-hidden="true" style={anchorStyle} />

      {message && bridge && (
        <OverlayErrorBoundary
          resetKey={message}
          onError={(error) => {
            const messageText = error instanceof Error ? error.message : String(error);
            logWebTimeline("overlay-shell.error-boundary-dismiss", {
              messageType: message.type,
              routeKey: message.type === "route" ? message.routeKey : undefined,
              error: messageText,
            });
            setMessage(null);
            bridge.emitEvent("bootstrap-error", { message: messageText });
            bridge.requestDismiss();
          }}
        >
          <OverlayContent message={message} anchorRef={virtualAnchorRef} bridge={bridge} />
        </OverlayErrorBoundary>
      )}
    </div>
  );
}
