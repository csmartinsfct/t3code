import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";

import type { OverlayAnchorRect, OverlayRoutePresentation } from "@t3tools/contracts";

import { useRoutedOverlaySurface } from "./routedOverlayAdapters";

const ZERO_OVERLAY_ANCHOR: OverlayAnchorRect = { x: 0, y: 0, width: 0, height: 0 };
type PopoverPresentation = Extract<OverlayRoutePresentation, { kind: "popover" | "menu" }>;
type RoutedPopoverState = {
  anchor: OverlayAnchorRect | null;
  open: boolean;
};

export function rectForOverlayAnchor(element: HTMLElement | null): OverlayAnchorRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

export function useRoutedPopoverSurface<
  TElement extends HTMLElement = HTMLElement,
  TResult = unknown,
>({
  align,
  enabled = true,
  interaction = "click",
  kind = "popover",
  onResult,
  params,
  routeKey,
  side,
}: {
  align?: PopoverPresentation["align"] | undefined;
  enabled?: boolean | undefined;
  interaction?: PopoverPresentation["interaction"] | undefined;
  kind?: PopoverPresentation["kind"] | undefined;
  onResult?: ((value: TResult) => void | Promise<void>) | undefined;
  params?: Record<string, unknown> | undefined;
  routeKey: string;
  side?: PopoverPresentation["side"] | undefined;
}): {
  domOpen: boolean;
  nativeOpen: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<TElement | null>;
  updateAnchor: () => void;
} {
  const triggerRef = useRef<TElement | null>(null);
  const [state, setState] = useState<RoutedPopoverState>({ anchor: null, open: false });

  const updateAnchor = useCallback(() => {
    const nextAnchor = rectForOverlayAnchor(triggerRef.current);
    setState((current) => ({ ...current, anchor: nextAnchor }));
  }, []);

  const handleRoutedOpenChange = useCallback((nextOpen: boolean) => {
    setState((current) => ({ ...current, open: nextOpen }));
  }, []);

  const routed = useRoutedOverlaySurface<TResult>({
    open: enabled && state.open && state.anchor !== null,
    onOpenChange: handleRoutedOpenChange,
    routeKey,
    params,
    presentation: {
      kind,
      anchor: state.anchor ?? ZERO_OVERLAY_ANCHOR,
      ...(side ? { side } : {}),
      ...(align ? { align } : {}),
      ...(interaction ? { interaction } : {}),
    },
    enabled: enabled && state.anchor !== null,
    onResult,
  });

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        const nextAnchor = rectForOverlayAnchor(triggerRef.current);
        if (!nextAnchor) return;
        setState({ anchor: nextAnchor, open: true });
        return;
      }
      if (interaction === "hover" && routed.nativeOpen) return;
      setState((current) => ({ ...current, open: false }));
      routed.onDomOpenChange(nextOpen);
    },
    [interaction, routed],
  );

  return {
    domOpen: routed.domOpen,
    nativeOpen: routed.nativeOpen,
    onOpenChange,
    triggerRef,
    updateAnchor,
  };
}
