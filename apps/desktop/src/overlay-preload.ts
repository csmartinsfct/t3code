import { contextBridge, ipcRenderer } from "electron";

import type { OverlayRenderMessage } from "@t3tools/contracts";

// Channel constants — must match overlayPool.ts
const OVERLAY_RENDER_CHANNEL = "overlay:render";
const OVERLAY_CLEAR_CHANNEL = "overlay:clear";
const OVERLAY_EVENT_CHANNEL = "overlay:event";
const OVERLAY_DISMISS_CHANNEL = "overlay:dismiss";
const OVERLAY_GET_CONFIG_CHANNEL = "overlay:get-config";
const OVERLAY_THEME_CHANGE_CHANNEL = "overlay:theme-change";

interface OverlayConfig {
  theme: "light" | "dark";
  serverUrl: string | null;
}

interface OverlayBridge {
  onRender: (handler: (msg: OverlayRenderMessage) => void) => () => void;
  onClear: (handler: () => void) => () => void;
  emitEvent: (type: string, payload: unknown) => void;
  requestDismiss: () => void;
  getConfig: () => OverlayConfig;
  onThemeChange: (handler: (theme: "light" | "dark") => void) => () => void;
}

contextBridge.exposeInMainWorld("overlayBridge", {
  onRender: (handler: (msg: OverlayRenderMessage) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, msg: unknown) => {
      handler(msg as OverlayRenderMessage);
    };
    ipcRenderer.on(OVERLAY_RENDER_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(OVERLAY_RENDER_CHANNEL, wrapped);
  },

  onClear: (handler: () => void) => {
    ipcRenderer.on(OVERLAY_CLEAR_CHANNEL, handler);
    return () => ipcRenderer.removeListener(OVERLAY_CLEAR_CHANNEL, handler);
  },

  emitEvent: (type: string, payload: unknown) => {
    ipcRenderer.send(OVERLAY_EVENT_CHANNEL, null, type, payload);
  },

  requestDismiss: () => {
    ipcRenderer.send(OVERLAY_DISMISS_CHANNEL);
  },

  getConfig: (): OverlayConfig => {
    const result = ipcRenderer.sendSync(OVERLAY_GET_CONFIG_CHANNEL);
    if (typeof result === "object" && result !== null) {
      return result as OverlayConfig;
    }
    return { theme: "dark", serverUrl: null };
  },

  onThemeChange: (handler: (theme: "light" | "dark") => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, theme: unknown) => {
      if (theme === "light" || theme === "dark") handler(theme);
    };
    ipcRenderer.on(OVERLAY_THEME_CHANGE_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(OVERLAY_THEME_CHANGE_CHANNEL, wrapped);
  },
} satisfies OverlayBridge);
