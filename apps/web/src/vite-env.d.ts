/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge, OverlayRenderMessage } from "@t3tools/contracts";

interface ImportMetaEnv {
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
    overlayBridge?: {
      onRender(handler: (msg: OverlayRenderMessage) => void): () => void;
      onClear(handler: () => void): () => void;
      emitEvent(type: string, payload: unknown): void;
      requestDismiss(): void;
      getConfig(): { theme: "light" | "dark"; serverUrl: string | null };
      onThemeChange(handler: (theme: "light" | "dark") => void): () => void;
    };
  }
}
