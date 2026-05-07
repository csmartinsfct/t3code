export function isFullPageSurfaceOverEmbeddedBrowser(): boolean {
  if (typeof window === "undefined") return false;
  return (window.location?.pathname ?? "/").startsWith("/settings");
}

export function isEmbeddedBrowserOverlayRelevant(): boolean {
  return !isFullPageSurfaceOverEmbeddedBrowser();
}
