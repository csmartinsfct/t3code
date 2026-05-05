import { Component, useEffect, useRef, useState } from "react";
import type React from "react";
import type { CSSProperties, MouseEvent } from "react";

import type { OverlayRenderMessage } from "@t3tools/contracts";
import type { OverlayAnchorRect } from "@t3tools/contracts";

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

class OverlayErrorBoundary extends Component<
  { children: React.ReactNode; onError: () => void; resetKey: unknown },
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
    this.props.onError();
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
  const bridge = getBridge();

  useEffect(() => {
    if (!bridge) return;
    const unsubRender = bridge.onRender((msg) => setMessage(msg));
    const unsubClear = bridge.onClear(() => setMessage(null));
    return () => {
      unsubRender();
      unsubClear();
    };
  }, [bridge]);

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      bridge?.requestDismiss();
    }
  };

  const messageAnchor = getMessageAnchor(message);

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
    >
      {/* Virtual anchor — positioned at the trigger element's DOMRect.
          Base UI Positioner receives this as its `anchor` prop so it can
          apply smart flip/collision-avoidance without touching the host DOM. */}
      <div ref={virtualAnchorRef} aria-hidden="true" style={anchorStyle} />

      {message && bridge && (
        <OverlayErrorBoundary
          resetKey={message}
          onError={() => {
            setMessage(null);
            bridge.requestDismiss();
          }}
        >
          <OverlayContent message={message} anchorRef={virtualAnchorRef} bridge={bridge} />
        </OverlayErrorBoundary>
      )}
    </div>
  );
}
