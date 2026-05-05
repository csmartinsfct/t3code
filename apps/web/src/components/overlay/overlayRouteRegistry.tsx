import type React from "react";

import type { OverlayRouteMessage } from "@t3tools/contracts";

import type { OverlayRouteController } from "./OverlayRouteContext";

export interface OverlayRouteComponentProps<
  TParams extends Record<string, unknown> = Record<string, unknown>,
> {
  message: OverlayRouteMessage & { params: TParams };
  controller: OverlayRouteController;
}

export type OverlayRouteComponent<
  TParams extends Record<string, unknown> = Record<string, unknown>,
> = (props: OverlayRouteComponentProps<TParams>) => React.ReactNode;

const overlayRouteRegistry = new Map<string, OverlayRouteComponent>();

export function registerOverlayRoute<TParams extends Record<string, unknown>>(
  routeKey: string,
  component: OverlayRouteComponent<TParams>,
): void {
  overlayRouteRegistry.set(routeKey, component as OverlayRouteComponent);
}

export function getOverlayRoute(routeKey: string): OverlayRouteComponent | null {
  return overlayRouteRegistry.get(routeKey) ?? null;
}

export function listOverlayRoutes(): string[] {
  return [...overlayRouteRegistry.keys()].toSorted();
}
