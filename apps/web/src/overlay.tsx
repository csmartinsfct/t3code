import "./index.css";

import React from "react";
import { createRoot } from "react-dom/client";

import { OverlayShell } from "./components/overlay/OverlayShell";
import { createWsNativeApi } from "./wsNativeApi";
import "./overlayRoutes";

// Apply theme immediately before first render to avoid any flash.
const config = window.overlayBridge?.getConfig();
const theme = config?.theme ?? "dark";
document.documentElement.classList.toggle("dark", theme === "dark");

// Routed overlays need the same NativeApi shape as the host app. The overlay
// WebContentsView intentionally does not expose the full desktopBridge, so this
// API is backed by the WebSocket RPC client and the serverUrl from overlay
// config.
window.nativeApi = createWsNativeApi();

// Keep in sync with the main app's theme changes.
window.overlayBridge?.onThemeChange((t) => {
  document.documentElement.classList.toggle("dark", t === "dark");
});

const root = document.getElementById("overlay-root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <OverlayShell />
    </React.StrictMode>,
  );
}
