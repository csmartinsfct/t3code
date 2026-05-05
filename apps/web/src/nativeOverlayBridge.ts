import { useEffect, useState } from "react";

import type { OverlayRenderMessage } from "@t3tools/contracts";

import {
  isEmbeddedBrowserMounted,
  subscribeEmbeddedBrowserMounted,
} from "./embeddedBrowserModalSuspension";

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

function getOverlayBridge() {
  if (typeof window === "undefined") return null;
  return window.desktopBridge?.overlay ?? null;
}

export function isNativeOverlayAvailable(): boolean {
  return getOverlayBridge() !== null;
}

// ---------------------------------------------------------------------------
// Handle — wraps the acquire/render/release lifecycle for a single overlay.
// ---------------------------------------------------------------------------

export interface NativeOverlayHandle {
  render(message: OverlayRenderMessage): void;
  onEvent(handler: (type: string, payload: unknown) => void): () => void;
  onDismiss(handler: () => void): () => void;
  release(): void;
}

export interface NativeOverlaySession<TResult = void> extends NativeOverlayHandle {
  result: Promise<TResult>;
}

export interface NativeOverlayEventResolution<TResult> {
  value: TResult;
}

export interface NativeOverlayOpenOptions<TResult> {
  resolveEvent?: (
    type: string,
    payload: unknown,
  ) => NativeOverlayEventResolution<TResult> | null | undefined;
  dismissValue?: TResult;
}

export async function acquireNativeOverlay(
  initialMessage: OverlayRenderMessage,
): Promise<NativeOverlayHandle | null> {
  const bridge = getOverlayBridge();
  if (!bridge) return null;

  // Save focus so we can restore it when the overlay closes.
  const previousFocus =
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;

  let id: string;
  try {
    id = await bridge.acquire();
  } catch {
    return null;
  }

  // Send initial content immediately.
  try {
    await bridge.render(id, initialMessage);
  } catch {
    void bridge.release(id);
    return null;
  }

  let released = false;
  const eventUnsubs: Array<() => void> = [];
  const dismissUnsubs: Array<() => void> = [];

  const release = () => {
    if (released) return;
    released = true;
    for (const fn of eventUnsubs) fn();
    for (const fn of dismissUnsubs) fn();
    eventUnsubs.length = 0;
    dismissUnsubs.length = 0;
    void bridge.release(id);
    previousFocus?.focus();
  };

  return {
    render(message: OverlayRenderMessage) {
      if (released) return;
      void bridge.render(id, message);
    },

    onEvent(handler: (type: string, payload: unknown) => void) {
      const unsub = bridge.onEvent(id, handler);
      eventUnsubs.push(unsub);
      return unsub;
    },

    onDismiss(handler: () => void) {
      const unsub = bridge.onDismiss(id, handler);
      dismissUnsubs.push(unsub);
      return unsub;
    },

    release,
  };
}

export async function openNativeOverlay<TResult = void>(
  initialMessage: OverlayRenderMessage,
  options: NativeOverlayOpenOptions<TResult> = {},
): Promise<NativeOverlaySession<TResult> | null> {
  const handle = await acquireNativeOverlay(initialMessage);
  if (!handle) return null;

  let settled = false;
  let resolveResult: ((value: TResult) => void) | null = null;
  const result = new Promise<TResult>((resolve) => {
    resolveResult = resolve;
  });

  const settle = (value: TResult) => {
    if (settled) return;
    settled = true;
    handle.release();
    resolveResult?.(value);
  };

  handle.onEvent((type, payload) => {
    const resolution = options.resolveEvent?.(type, payload);
    if (resolution) {
      settle(resolution.value);
    }
  });
  handle.onDismiss(() => {
    settle(options.dismissValue as TResult);
  });

  return {
    ...handle,
    result,
  };
}

// ---------------------------------------------------------------------------
// React hook — true when the native overlay system should be used instead
// of DOM rendering. Conditional: Electron AND embedded browser mounted.
// ---------------------------------------------------------------------------

export function useNativeOverlayActive(): boolean {
  const available = isNativeOverlayAvailable();
  const [mounted, setMounted] = useState(isEmbeddedBrowserMounted);

  useEffect(() => {
    if (!available) return;
    return subscribeEmbeddedBrowserMounted(() => {
      setMounted(isEmbeddedBrowserMounted());
    });
  }, [available]);

  return available && mounted;
}
