import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";

import type { OverlayRouteContext, OverlayRoutePresentation } from "@t3tools/contracts";

import {
  createOverlayRouteMessage,
  openNativeOverlayRoute,
  type NativeOverlayRouteInput,
  type NativeOverlayRouteResult,
  type NativeOverlaySession,
  useNativeOverlayActive,
} from "~/nativeOverlayBridge";
import { logWebTimeline } from "~/timelineLogger";
import { Dialog } from "~/components/ui/dialog";
import { AlertDialog } from "~/components/ui/alert-dialog";
import { Sheet, SheetPopup } from "~/components/ui/sheet";
import { CommandDialog } from "~/components/ui/command";
import { Popover, PopoverPopup } from "~/components/ui/popover";
import { Menu, MenuPopup } from "~/components/ui/menu";
import { useOverlayRouteController } from "~/components/overlay/OverlayRouteContext";

type OpenChangeHandler<TDetails> = (open: boolean, eventDetails?: TDetails) => void;

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

export interface UseRoutedOverlaySurfaceOptions<TResult = unknown, TDetails = unknown> {
  open: boolean;
  onOpenChange?: OpenChangeHandler<TDetails> | undefined;
  enabled?: boolean | undefined;
  routeKey: string;
  params?: Record<string, unknown> | undefined;
  context?: OverlayRouteContext | undefined;
  presentation: OverlayRoutePresentation;
  fallback?: (() => void | Promise<void>) | undefined;
  onEvent?: ((type: string, payload: unknown) => void | Promise<void>) | undefined;
  onResult?: ((value: TResult) => void | Promise<void>) | undefined;
  onCancel?: ((reason?: string) => void | Promise<void>) | undefined;
  onError?: ((message: string) => void | Promise<void>) | undefined;
}

export interface RoutedOverlaySurfaceState<TDetails = unknown> {
  domOpen: boolean;
  nativeActive: boolean;
  nativeOpen: boolean;
  fallbackOpen: boolean;
  onDomOpenChange: OpenChangeHandler<TDetails>;
}

export function useRoutedOverlaySurface<TResult = unknown, TDetails = unknown>({
  open,
  onOpenChange,
  enabled = true,
  routeKey,
  params,
  context,
  presentation,
  fallback,
  onEvent,
  onResult,
  onCancel,
  onError,
}: UseRoutedOverlaySurfaceOptions<TResult, TDetails>): RoutedOverlaySurfaceState<TDetails> {
  const nativeActive = useNativeOverlayActive();
  const shouldUseNative = enabled && nativeActive;
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const sessionRef = useRef<NativeOverlaySession<NativeOverlayRouteResult<TResult>> | null>(null);
  const requestIdRef = useRef(0);

  const callbacksRef = useLatest({
    fallback,
    onEvent,
    onCancel,
    onError,
    onOpenChange,
    onResult,
  });

  const routeInputRef = useLatest<NativeOverlayRouteInput>({
    routeKey,
    ...(params ? { params } : {}),
    ...(context ? { context } : {}),
    presentation,
  });
  // Params/context/presentation are IPC payloads and should be JSON-stable.
  // This lets callers pass fresh object literals without reopening the route
  // on every render.
  const routeInputKey = [
    routeKey,
    safeStringify(params),
    safeStringify(context),
    safeStringify(presentation),
  ].join("\n");

  useEffect(() => {
    if (!open) setFallbackOpen(false);
  }, [open]);

  useEffect(() => {
    logWebTimeline("routed-overlay.surface.effect", {
      routeKey,
      open,
      shouldUseNative,
      fallbackOpen,
      hasSession: Boolean(sessionRef.current),
    });
    if (!open || !shouldUseNative || fallbackOpen) {
      if (sessionRef.current) {
        logWebTimeline("routed-overlay.surface.release", { routeKey });
        sessionRef.current.release();
        sessionRef.current = null;
      }
      return;
    }

    if (sessionRef.current) {
      logWebTimeline("routed-overlay.surface.rerender-existing", { routeKey });
      void sessionRef.current.render(createOverlayRouteMessage(routeInputRef.current));
      return;
    }

    let disposed = false;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    void (async () => {
      logWebTimeline("routed-overlay.surface.open-native.start", { routeKey, requestId });
      const session = await openNativeOverlayRoute<TResult>(routeInputRef.current, {
        fallback: async () => {
          if (disposed || requestIdRef.current !== requestId) return;
          logWebTimeline("routed-overlay.surface.fallback", { routeKey, requestId });
          setFallbackOpen(true);
          await callbacksRef.current.fallback?.();
        },
      });

      if (disposed || requestIdRef.current !== requestId) {
        logWebTimeline("routed-overlay.surface.open-native.stale", { routeKey, requestId });
        session?.release();
        return;
      }

      if (!session) {
        logWebTimeline("routed-overlay.surface.open-native.null-session", { routeKey, requestId });
        return;
      }

      sessionRef.current = session;
      session.onEvent((type, payload) => {
        if (
          type === "ready" ||
          type === "result" ||
          type === "cancel" ||
          type === "bootstrap-error"
        ) {
          return;
        }
        void callbacksRef.current.onEvent?.(type, payload);
      });
      logWebTimeline("routed-overlay.surface.open-native.success", { routeKey, requestId });
      const result = await session.result;

      if (disposed || requestIdRef.current !== requestId) return;
      if (sessionRef.current === session) sessionRef.current = null;
      logWebTimeline("routed-overlay.surface.result", {
        routeKey,
        requestId,
        status: result.status,
        reason: result.status === "cancelled" ? result.reason : undefined,
        message: result.status === "error" ? result.message : undefined,
      });

      if (result.status === "submitted") {
        await callbacksRef.current.onResult?.(result.value);
        callbacksRef.current.onOpenChange?.(false);
      } else if (result.status === "cancelled") {
        await callbacksRef.current.onCancel?.(result.reason);
        callbacksRef.current.onOpenChange?.(false);
      } else {
        await callbacksRef.current.onError?.(result.message);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [callbacksRef, fallbackOpen, open, routeInputRef, routeKey, shouldUseNative]);

  useEffect(() => {
    if (!open || !shouldUseNative || fallbackOpen || !sessionRef.current) return;
    void sessionRef.current.render(createOverlayRouteMessage(routeInputRef.current));
  }, [fallbackOpen, open, routeInputKey, routeInputRef, shouldUseNative]);

  const onDomOpenChange = useCallback<OpenChangeHandler<TDetails>>(
    (nextOpen, eventDetails) => {
      if (!nextOpen) setFallbackOpen(false);
      onOpenChange?.(nextOpen, eventDetails);
    },
    [onOpenChange],
  );

  const nativeOpen = open && shouldUseNative && !fallbackOpen;

  return {
    domOpen: open && (!shouldUseNative || fallbackOpen),
    nativeActive: shouldUseNative,
    nativeOpen,
    fallbackOpen,
    onDomOpenChange,
  };
}

type RouteRootProps<TComponent extends React.ElementType> = Omit<
  React.ComponentProps<TComponent>,
  "defaultOpen" | "onOpenChange" | "open"
> & {
  cancelReason?: string | undefined;
};

function useRouteDismiss(cancelReason = "dismissed") {
  const controller = useOverlayRouteController();
  return useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) controller.cancel(cancelReason);
    },
    [cancelReason, controller],
  );
}

function getOpenChangeReason(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

export function shouldDismissOverlayRouteMenu(reason: string | null): boolean {
  return reason === "outside-press" || reason === "escape-key" || reason === "close-press";
}

function useRouteMenuDismiss(cancelReason = "dismissed") {
  const controller = useOverlayRouteController();
  return useCallback(
    (nextOpen: boolean, details?: unknown) => {
      if (nextOpen) return;
      if (!shouldDismissOverlayRouteMenu(getOpenChangeReason(details))) return;
      controller.cancel(cancelReason);
    },
    [cancelReason, controller],
  );
}

export function OverlayRouteDialog({ cancelReason, ...props }: RouteRootProps<typeof Dialog>) {
  const handleOpenChange = useRouteDismiss(cancelReason);
  return <Dialog open onOpenChange={handleOpenChange} {...props} />;
}

export function OverlayRouteAlertDialog({
  cancelReason,
  ...props
}: RouteRootProps<typeof AlertDialog>) {
  const handleOpenChange = useRouteDismiss(cancelReason);
  return <AlertDialog open onOpenChange={handleOpenChange} {...props} />;
}

export function OverlayRouteCommandDialog({
  cancelReason,
  ...props
}: RouteRootProps<typeof CommandDialog>) {
  const handleOpenChange = useRouteDismiss(cancelReason);
  return <CommandDialog open onOpenChange={handleOpenChange} {...props} />;
}

export function OverlayRouteSheet({ cancelReason, ...props }: RouteRootProps<typeof Sheet>) {
  const handleOpenChange = useRouteDismiss(cancelReason);
  return <Sheet open onOpenChange={handleOpenChange} {...props} />;
}

export function OverlayRouteSheetPopup({
  side,
  ...props
}: React.ComponentProps<typeof SheetPopup>) {
  const { message } = useOverlayRouteController();
  const presentationSide =
    message.presentation.kind === "sheet" ? message.presentation.side : "right";

  return <SheetPopup side={side ?? presentationSide} {...props} />;
}

export function OverlayRoutePopover({ cancelReason, ...props }: RouteRootProps<typeof Popover>) {
  const handleOpenChange = useRouteDismiss(cancelReason);
  return <Popover open onOpenChange={handleOpenChange} {...props} />;
}

export function OverlayRoutePopoverPopup({
  anchor,
  align,
  side,
  ...props
}: React.ComponentProps<typeof PopoverPopup>) {
  const { anchorRef, message } = useOverlayRouteController();
  const presentation = message.presentation;
  const routeSide =
    presentation.kind === "popover" || presentation.kind === "menu" ? presentation.side : undefined;
  const routeAlign =
    presentation.kind === "popover" || presentation.kind === "menu"
      ? presentation.align
      : undefined;

  return (
    <PopoverPopup
      anchor={anchor ?? anchorRef}
      align={align ?? routeAlign}
      positionerClassName="transition-none"
      side={side ?? routeSide}
      {...props}
    />
  );
}

export { OverlayRoutePopoverPopup as OverlayRoutePopoverContent };

export function OverlayRouteMenu({ cancelReason, ...props }: RouteRootProps<typeof Menu>) {
  const handleOpenChange = useRouteMenuDismiss(cancelReason);
  return (
    <Menu open onOpenChange={handleOpenChange} trackEmbeddedBrowserOverlay={false} {...props} />
  );
}

export function OverlayRouteMenuPopup({
  anchor,
  align,
  side,
  ...props
}: React.ComponentProps<typeof MenuPopup>) {
  const { anchorRef, message } = useOverlayRouteController();
  const presentation = message.presentation;
  const routeSide =
    presentation.kind === "popover" || presentation.kind === "menu" ? presentation.side : undefined;
  const routeAlign =
    presentation.kind === "popover" || presentation.kind === "menu"
      ? presentation.align
      : undefined;

  return (
    <MenuPopup
      anchor={anchor ?? anchorRef}
      align={align ?? routeAlign}
      side={side ?? routeSide}
      {...props}
    />
  );
}
