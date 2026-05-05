import { createContext, useContext } from "react";
import type React from "react";

import type { OverlayRouteMessage } from "@t3tools/contracts";

import type { OverlayBridgeHandle } from "./overlayTypes";

export type OverlayRouteResult<TResult = unknown> =
  | { status: "submitted"; value: TResult }
  | { status: "cancelled"; reason?: string | undefined }
  | { status: "error"; message: string };

export interface OverlayRouteController {
  message: OverlayRouteMessage;
  bridge: OverlayBridgeHandle;
  submit(value?: unknown): void;
  cancel(reason?: string): void;
  fail(error: unknown): void;
}

const OverlayRouteContext = createContext<OverlayRouteController | null>(null);

export function OverlayRouteControllerProvider({
  value,
  children,
}: {
  value: OverlayRouteController;
  children: React.ReactNode;
}) {
  return <OverlayRouteContext.Provider value={value}>{children}</OverlayRouteContext.Provider>;
}

export function useOverlayRouteController(): OverlayRouteController {
  const controller = useContext(OverlayRouteContext);
  if (!controller) {
    throw new Error("useOverlayRouteController must be used inside an overlay route");
  }
  return controller;
}
