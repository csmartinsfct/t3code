import { Component, useEffect, useMemo } from "react";
import type React from "react";

import type { OverlayRouteMessage } from "@t3tools/contracts";

import type { OverlayBridgeHandle } from "./overlayTypes";
import { OverlayRouteControllerProvider, type OverlayRouteController } from "./OverlayRouteContext";
import { OverlayRouteProviders } from "./OverlayRouteProviders";
import { getOverlayRoute, listOverlayRoutes } from "./overlayRouteRegistry";

interface OverlayRouteProps {
  message: OverlayRouteMessage;
  bridge: OverlayBridgeHandle;
}

class OverlayRouteErrorBoundary extends Component<
  {
    children: React.ReactNode;
    controller: OverlayRouteController;
    resetKey: unknown;
  },
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
    this.props.controller.fail(error);
  }

  override render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function OverlayRoute({ message, bridge }: OverlayRouteProps) {
  const controller = useMemo<OverlayRouteController>(
    () => ({
      message,
      bridge,
      submit(value?: unknown) {
        bridge.emitEvent("result", { value });
        bridge.requestDismiss();
      },
      cancel(reason?: string) {
        bridge.emitEvent("cancel", { reason });
        bridge.requestDismiss();
      },
      fail(error: unknown) {
        const messageText = error instanceof Error ? error.message : String(error);
        bridge.emitEvent("bootstrap-error", { message: messageText });
        bridge.requestDismiss();
      },
    }),
    [bridge, message],
  );

  const RouteComponent = getOverlayRoute(message.routeKey);

  useEffect(() => {
    if (RouteComponent) {
      bridge.emitEvent("ready", { routeKey: message.routeKey });
      return;
    }

    bridge.emitEvent("bootstrap-error", {
      message: `No overlay route registered for ${message.routeKey}`,
      routeKey: message.routeKey,
      registeredRoutes: listOverlayRoutes(),
    });
    bridge.requestDismiss();
  }, [RouteComponent, bridge, message.routeKey]);

  if (!RouteComponent) return null;

  return (
    <OverlayRouteProviders>
      <OverlayRouteControllerProvider value={controller}>
        <OverlayRouteErrorBoundary controller={controller} resetKey={message}>
          <RouteComponent message={message} controller={controller} />
        </OverlayRouteErrorBoundary>
      </OverlayRouteControllerProvider>
    </OverlayRouteProviders>
  );
}
