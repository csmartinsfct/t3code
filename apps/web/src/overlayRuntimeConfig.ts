interface OverlayRuntimeConfig {
  theme: "light" | "dark";
  serverUrl: string | null;
}

interface OverlayRuntimeBridge {
  getConfig(): OverlayRuntimeConfig;
}

export function getOverlayRuntimeConfig(): OverlayRuntimeConfig | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window & { overlayBridge?: OverlayRuntimeBridge }).overlayBridge;
  return bridge?.getConfig() ?? null;
}

export function getOverlayServerUrl(): string | null {
  return getOverlayRuntimeConfig()?.serverUrl ?? null;
}
