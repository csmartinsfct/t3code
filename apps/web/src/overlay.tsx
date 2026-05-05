import "./index.css";

import React from "react";
import { createRoot } from "react-dom/client";

import { OverlayShell } from "./components/overlay/OverlayShell";

// Apply theme immediately before first render to avoid any flash.
const config = (
  window as Window & { overlayBridge?: { getConfig(): { theme: string } } }
).overlayBridge?.getConfig();
const theme = config?.theme ?? "dark";
document.documentElement.classList.toggle("dark", theme === "dark");

// Keep in sync with the main app's theme changes.
(
  window as Window & {
    overlayBridge?: { onThemeChange(h: (t: "light" | "dark") => void): () => void };
  }
).overlayBridge?.onThemeChange((t) => {
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
