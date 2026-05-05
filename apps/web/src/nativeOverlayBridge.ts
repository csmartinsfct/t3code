import { useEffect, useState } from "react";

import type {
  OverlayRouteContext,
  OverlayRouteMessage,
  OverlayRoutePresentation,
  OverlayRenderMessage,
} from "@t3tools/contracts";

import {
  isEmbeddedBrowserMounted,
  subscribeEmbeddedBrowserMounted,
} from "./embeddedBrowserModalSuspension";
import { logWebTimeline, warnWebTimeline } from "./timelineLogger";

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

function getOverlayBridge() {
  if (typeof window === "undefined") return null;
  return window.desktopBridge?.overlay ?? null;
}

function describeOverlayMessage(message: OverlayRenderMessage): Record<string, unknown> {
  return {
    type: message.type,
    ...(message.type === "route"
      ? {
          routeKey: message.routeKey,
          presentation: message.presentation.kind,
        }
      : {}),
  };
}

function describeOverlayId(id: string): string {
  return id.slice(0, 8);
}

export function isNativeOverlayAvailable(): boolean {
  return getOverlayBridge() !== null;
}

// ---------------------------------------------------------------------------
// Handle — wraps the acquire/render/release lifecycle for a single overlay.
// ---------------------------------------------------------------------------

export interface NativeOverlayHandle {
  render(message: OverlayRenderMessage): Promise<void>;
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

export type NativeOverlayRouteResult<TResult = unknown> =
  | { status: "submitted"; value: TResult }
  | { status: "cancelled"; reason?: string | undefined }
  | { status: "error"; message: string };

export interface NativeOverlayRouteInput {
  routeKey: string;
  params?: Record<string, unknown> | undefined;
  context?: OverlayRouteContext | undefined;
  presentation: OverlayRoutePresentation;
}

export interface NativeOverlayRouteOptions<TResult> {
  fallback?: () => void | Promise<void>;
  dismissValue?: NativeOverlayRouteResult<TResult>;
}

export function createOverlayRouteMessage(input: NativeOverlayRouteInput): OverlayRouteMessage {
  return {
    type: "route",
    routeKey: input.routeKey,
    params: input.params ?? {},
    ...(input.context ? { context: input.context } : {}),
    presentation: input.presentation,
  };
}

async function acquireNativeOverlayHandle(): Promise<NativeOverlayHandle | null> {
  const bridge = getOverlayBridge();
  if (!bridge) {
    warnWebTimeline("native-overlay.acquire.unavailable");
    return null;
  }

  // Save focus so we can restore it when the overlay closes.
  const previousFocus =
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;

  let id: string;
  try {
    logWebTimeline("native-overlay.acquire.start");
    id = await bridge.acquire();
    logWebTimeline("native-overlay.acquire.success", { overlayId: describeOverlayId(id) });
  } catch {
    warnWebTimeline("native-overlay.acquire.failed");
    return null;
  }

  let released = false;
  const eventUnsubs: Array<() => void> = [];
  const dismissUnsubs: Array<() => void> = [];

  const release = () => {
    if (released) return;
    released = true;
    logWebTimeline("native-overlay.release", { overlayId: describeOverlayId(id) });
    for (const fn of eventUnsubs) fn();
    for (const fn of dismissUnsubs) fn();
    eventUnsubs.length = 0;
    dismissUnsubs.length = 0;
    void bridge.release(id);
    previousFocus?.focus();
  };

  return {
    async render(message: OverlayRenderMessage) {
      if (released) return;
      logWebTimeline("native-overlay.render.start", {
        overlayId: describeOverlayId(id),
        ...describeOverlayMessage(message),
      });
      await bridge.render(id, message);
      logWebTimeline("native-overlay.render.success", {
        overlayId: describeOverlayId(id),
        ...describeOverlayMessage(message),
      });
    },

    onEvent(handler: (type: string, payload: unknown) => void) {
      const unsub = bridge.onEvent(id, (type, payload) => {
        logWebTimeline("native-overlay.event", {
          overlayId: describeOverlayId(id),
          eventType: type,
          payload,
        });
        handler(type, payload);
      });
      eventUnsubs.push(unsub);
      return unsub;
    },

    onDismiss(handler: () => void) {
      const unsub = bridge.onDismiss(id, () => {
        logWebTimeline("native-overlay.dismiss", { overlayId: describeOverlayId(id) });
        handler();
      });
      dismissUnsubs.push(unsub);
      return unsub;
    },

    release,
  };
}

export async function acquireNativeOverlay(
  initialMessage: OverlayRenderMessage,
): Promise<NativeOverlayHandle | null> {
  const handle = await acquireNativeOverlayHandle();
  if (!handle) return null;

  try {
    await handle.render(initialMessage);
  } catch {
    warnWebTimeline("native-overlay.initial-render.failed", describeOverlayMessage(initialMessage));
    handle.release();
    return null;
  }

  return handle;
}

export async function openNativeOverlay<TResult = void>(
  initialMessage: OverlayRenderMessage,
  options: NativeOverlayOpenOptions<TResult> = {},
): Promise<NativeOverlaySession<TResult> | null> {
  const handle = await acquireNativeOverlayHandle();
  if (!handle) return null;
  logWebTimeline("native-overlay.open.start", describeOverlayMessage(initialMessage));

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

  try {
    await handle.render(initialMessage);
  } catch {
    warnWebTimeline(
      "native-overlay.open.initial-render.failed",
      describeOverlayMessage(initialMessage),
    );
    handle.release();
    return null;
  }

  return {
    ...handle,
    result,
  };
}

export async function openNativeOverlayRoute<TResult = unknown>(
  input: NativeOverlayRouteInput,
  options: NativeOverlayRouteOptions<TResult> = {},
): Promise<NativeOverlaySession<NativeOverlayRouteResult<TResult>> | null> {
  const message = createOverlayRouteMessage(input);

  const session = await openNativeOverlay<NativeOverlayRouteResult<TResult>>(message, {
    dismissValue: options.dismissValue ?? { status: "cancelled", reason: "dismissed" },
    resolveEvent: (type, payload) => {
      if (type === "result") {
        return {
          value: {
            status: "submitted",
            value: (payload as { value?: TResult } | null)?.value as TResult,
          },
        };
      }
      if (type === "cancel") {
        const reason = (payload as { reason?: unknown } | null)?.reason;
        return {
          value: {
            status: "cancelled",
            ...(typeof reason === "string" ? { reason } : {}),
          },
        };
      }
      if (type === "bootstrap-error") {
        const message =
          (payload as { message?: unknown } | null)?.message ?? "Overlay route failed to load.";
        return {
          value: {
            status: "error",
            message: String(message),
          },
        };
      }
      return null;
    },
  });

  if (!session) {
    await options.fallback?.();
    return null;
  }

  return {
    ...session,
    result: session.result.then(async (result) => {
      if (result.status === "error") {
        await options.fallback?.();
      }
      return result;
    }),
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
