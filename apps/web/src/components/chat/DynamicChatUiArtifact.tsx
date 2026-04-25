import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import type { DynamicChatUiPayload } from "../../lib/dynamicChatUiParser";

const RESIZE_MESSAGE_SOURCE = "t3-dynamic-chat-ui";
const HOST_MESSAGE_SOURCE = "t3-dynamic-chat-ui-host";
const MIN_IFRAME_HEIGHT_PX = 120;
const IFRAME_RESIZE_JITTER_PX = 3;

interface DynamicChatUiArtifactProps {
  artifact: DynamicChatUiPayload;
  isStreaming?: boolean;
  onResize?: () => void;
}

function normalizeIframeHeight(height: number): number {
  if (!Number.isFinite(height)) return 320;
  return Math.max(Math.ceil(height), MIN_IFRAME_HEIGHT_PX);
}

function buildBridgeScript(artifactId: string): string {
  return `
(() => {
  const artifactId = ${JSON.stringify(artifactId)};
  const resizeJitterPx = ${IFRAME_RESIZE_JITTER_PX};
  let lastPostedHeight = null;
  let manualHeight = null;
  let pendingMeasureFrame = null;
  const post = (type, payload = {}) => {
    window.parent.postMessage({ source: ${JSON.stringify(RESIZE_MESSAGE_SOURCE)}, artifactId, type, ...payload }, "*");
  };
  const postResize = (height) => {
    const nextHeight = Math.ceil(height);
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
    if (lastPostedHeight !== null && Math.abs(nextHeight - lastPostedHeight) <= resizeJitterPx) return;
    lastPostedHeight = nextHeight;
    post("resize", { height: nextHeight });
  };
  const measureContentHeight = () => {
    const body = document.body;
    const root = document.documentElement;
    const candidates = [];

    if (body) {
      for (const child of Array.from(body.children)) {
        if (["SCRIPT", "STYLE", "TEMPLATE"].includes(child.tagName)) continue;
        const rect = child.getBoundingClientRect();
        if (!Number.isFinite(rect.height) || rect.height <= 0) continue;
        const style = window.getComputedStyle(child);
        const marginBottom = Number.parseFloat(style.marginBottom) || 0;
        candidates.push(rect.bottom + marginBottom);
      }

      const range = document.createRange();
      range.selectNodeContents(body);
      const rect = range.getBoundingClientRect();
      range.detach();
      if (Number.isFinite(rect.height) && rect.height > 0) {
        candidates.push(rect.bottom);
      }
    }

    const viewportHeight = window.innerHeight || root?.clientHeight || 0;
    const documentHeight = Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0);
    const contentHeight = Math.max(...candidates, 0);
    if (documentHeight > viewportHeight + 1 && documentHeight > contentHeight) {
      return documentHeight;
    }
    return contentHeight || documentHeight;
  };
  const measure = () => {
    pendingMeasureFrame = null;
    if (manualHeight !== null) return;
    postResize(measureContentHeight());
  };
  const requestMeasure = () => {
    if (pendingMeasureFrame !== null) return;
    pendingMeasureFrame = requestAnimationFrame(measure);
  };
  window.t3ChatUi = {
    artifactId,
    postHeight: (height) => {
      if (!Number.isFinite(height) || height <= 0) return;
      manualHeight = Math.ceil(height);
      lastPostedHeight = null;
      postResize(manualHeight);
    },
    emit: (name, payload) => post("event", { name, payload })
  };
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== ${JSON.stringify(HOST_MESSAGE_SOURCE)}) return;
    if (data.type === "theme" && typeof data.theme === "string") {
      document.documentElement.dataset.theme = data.theme;
      document.documentElement.classList.toggle("dark", data.theme === "dark");
      requestMeasure();
    }
  });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(requestMeasure) : null;
  if (observer && document.body) {
    observer.observe(document.body);
    for (const child of Array.from(document.body.children)) {
      if (["SCRIPT", "STYLE", "TEMPLATE"].includes(child.tagName)) continue;
      observer.observe(child);
    }
  }
  window.addEventListener("load", requestMeasure);
  requestMeasure();
  setTimeout(requestMeasure, 60);
})();
`;
}

function injectBridge(html: string, artifactId: string): string {
  const bridge = `<script>${buildBridgeScript(artifactId)}</script>`;
  const baseStyle = `<style>
	:root {
	  --t3-background: #ffffff;
	  --t3-card: #ffffff;
	  --t3-muted: rgba(0, 0, 0, 0.04);
	  --t3-border: rgba(0, 0, 0, 0.08);
	  --t3-foreground: #262626;
	  --t3-muted-foreground: #666666;
	  --t3-primary: oklch(0.488 0.217 264);
	  --t3-primary-foreground: #ffffff;
	  --t3-info: #3b82f6;
	  --t3-success: #10b981;
	  --t3-warning: #f59e0b;
	  --t3-destructive: #ef4444;
	}
	:root.dark {
	  --t3-background: color-mix(in srgb, #0a0a0a 95%, #ffffff);
	  --t3-card: color-mix(in srgb, var(--t3-background) 98%, #ffffff);
	  --t3-muted: rgba(255, 255, 255, 0.04);
	  --t3-border: rgba(255, 255, 255, 0.06);
	  --t3-foreground: #f5f5f5;
	  --t3-muted-foreground: #a3a3a3;
	  --t3-primary: oklch(0.588 0.217 264);
	  --t3-info: #60a5fa;
	  --t3-success: #34d399;
	  --t3-warning: #fbbf24;
	  --t3-destructive: #f87171;
	}
	html, body { margin: 0; min-width: 0; min-height: 0 !important; height: auto !important; background: transparent; color-scheme: light dark; }
	*, *::before, *::after { box-sizing: border-box; }
	body { overflow-x: hidden; }
	</style>`;

  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${baseStyle}</head>`);
  } else {
    html = `${baseStyle}${html}`;
  }

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${bridge}</body>`);
  }
  return `${html}${bridge}`;
}

interface DynamicChatUiFrameCacheEntry {
  artifactId: string;
  height: number;
  iframe: HTMLIFrameElement;
  lastUsedAt: number;
  srcDoc: string;
}

const MAX_DYNAMIC_CHAT_UI_FRAME_CACHE_ENTRIES = 8;
const dynamicChatUiFrameCache = new Map<string, DynamicChatUiFrameCacheEntry>();
let dynamicChatUiFrameParkingLot: HTMLDivElement | null = null;

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function createFrameCacheKey(artifact: DynamicChatUiPayload): string {
  return `${artifact.id}:${artifact.html.length}:${hashString(artifact.html)}`;
}

function getFrameParkingLot(): HTMLDivElement {
  if (dynamicChatUiFrameParkingLot?.isConnected) return dynamicChatUiFrameParkingLot;

  const parkingLot = document.createElement("div");
  parkingLot.setAttribute("aria-hidden", "true");
  parkingLot.dataset.dynamicChatUiFrameParkingLot = "true";
  Object.assign(parkingLot.style, {
    height: "0",
    left: "-10000px",
    overflow: "hidden",
    position: "fixed",
    top: "-10000px",
    width: "0",
  });
  document.body.append(parkingLot);
  dynamicChatUiFrameParkingLot = parkingLot;
  return parkingLot;
}

function createArtifactFrame(title: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.title = title;
  iframe.sandbox.add("allow-scripts");
  iframe.referrerPolicy = "no-referrer";
  iframe.setAttribute("scrolling", "no");
  iframe.style.border = "0";
  iframe.style.width = "100%";
  return iframe;
}

function touchFrameCacheEntry(cacheKey: string, entry: DynamicChatUiFrameCacheEntry) {
  entry.lastUsedAt = Date.now();
  dynamicChatUiFrameCache.delete(cacheKey);
  dynamicChatUiFrameCache.set(cacheKey, entry);
}

function evictStaleFrameCacheEntries(activeCacheKey: string) {
  if (dynamicChatUiFrameCache.size <= MAX_DYNAMIC_CHAT_UI_FRAME_CACHE_ENTRIES) return;

  const staleEntries = [...dynamicChatUiFrameCache.entries()]
    .filter(([cacheKey]) => cacheKey !== activeCacheKey)
    .toSorted(([, a], [, b]) => a.lastUsedAt - b.lastUsedAt);
  for (const [cacheKey, entry] of staleEntries) {
    if (dynamicChatUiFrameCache.size <= MAX_DYNAMIC_CHAT_UI_FRAME_CACHE_ENTRIES) break;
    entry.iframe.remove();
    dynamicChatUiFrameCache.delete(cacheKey);
  }
}

export function __clearDynamicChatUiFrameCacheForTests() {
  for (const entry of dynamicChatUiFrameCache.values()) {
    entry.iframe.remove();
  }
  dynamicChatUiFrameCache.clear();
  dynamicChatUiFrameParkingLot?.remove();
  dynamicChatUiFrameParkingLot = null;
}

function DynamicChatUiArtifactInner({ artifact, onResize }: DynamicChatUiArtifactProps) {
  const frameCacheKey = createFrameCacheKey(artifact);
  const cachedFrame = dynamicChatUiFrameCache.get(frameCacheKey);
  const iframeHostRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const heightRef = useRef(
    cachedFrame
      ? normalizeIframeHeight(cachedFrame.height)
      : normalizeIframeHeight(artifact.initialHeight),
  );
  const onResizeRef = useRef(onResize);
  const [height, setHeight] = useState(() => heightRef.current);
  const srcDoc = useMemo(
    () => injectBridge(artifact.html, artifact.id),
    [artifact.html, artifact.id],
  );

  const postTheme = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    iframe.contentWindow.postMessage({ source: HOST_MESSAGE_SOURCE, type: "theme", theme }, "*");
  }, []);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    const nextHeight =
      dynamicChatUiFrameCache.get(frameCacheKey)?.height ??
      normalizeIframeHeight(artifact.initialHeight);
    heightRef.current = normalizeIframeHeight(nextHeight);
    setHeight(heightRef.current);
  }, [artifact.initialHeight, frameCacheKey]);

  useLayoutEffect(() => {
    const host = iframeHostRef.current;
    if (!host) return;

    let cacheEntry = dynamicChatUiFrameCache.get(frameCacheKey);
    if (!cacheEntry || cacheEntry.srcDoc !== srcDoc) {
      cacheEntry?.iframe.remove();
      cacheEntry = {
        artifactId: artifact.id,
        height: heightRef.current,
        iframe: createArtifactFrame(artifact.title),
        lastUsedAt: Date.now(),
        srcDoc,
      };
      dynamicChatUiFrameCache.set(frameCacheKey, cacheEntry);
    }
    touchFrameCacheEntry(frameCacheKey, cacheEntry);
    evictStaleFrameCacheEntries(frameCacheKey);

    const iframe = cacheEntry.iframe;
    iframeRef.current = iframe;
    iframe.title = artifact.title;
    iframe.dataset.dynamicChatUiArtifactId = artifact.id;
    if (iframe.parentElement !== host) {
      host.append(iframe);
    }
    if (iframe.srcdoc !== srcDoc) {
      iframe.srcdoc = srcDoc;
    }
    postTheme();
    iframe.addEventListener("load", postTheme);

    return () => {
      iframe.removeEventListener("load", postTheme);
      cacheEntry.height = normalizeIframeHeight(heightRef.current);
      if (iframe.isConnected) {
        getFrameParkingLot().append(iframe);
      }
      if (iframeRef.current === iframe) {
        iframeRef.current = null;
      }
    };
  }, [artifact.id, artifact.title, frameCacheKey, postTheme, srcDoc]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (
        typeof data !== "object" ||
        data === null ||
        data.source !== RESIZE_MESSAGE_SOURCE ||
        data.artifactId !== artifact.id
      ) {
        return;
      }
      if (data.type === "resize" && typeof data.height === "number") {
        if (!Number.isFinite(data.height) || data.height <= 0) return;
        setHeight((currentHeight) => {
          const nextHeight = normalizeIframeHeight(data.height);
          if (Math.abs(nextHeight - currentHeight) <= IFRAME_RESIZE_JITTER_PX) {
            return currentHeight;
          }
          heightRef.current = nextHeight;
          const cacheEntry = dynamicChatUiFrameCache.get(frameCacheKey);
          if (cacheEntry) {
            cacheEntry.height = nextHeight;
          }
          return nextHeight === currentHeight ? currentHeight : nextHeight;
        });
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [artifact.id, frameCacheKey]);

  useEffect(() => {
    postTheme();
  }, [postTheme, srcDoc]);

  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    heightRef.current = height;
    iframe.className = cn("block w-full min-w-0 bg-background");
    iframe.style.border = "0";
    iframe.style.height = `${height}px`;
    iframe.style.width = "100%";
  }, [height]);

  useEffect(() => {
    onResizeRef.current?.();
  }, [height]);

  return (
    <section className="my-2 w-full min-w-0 max-w-[800px] overflow-hidden rounded-2xl border border-border bg-card shadow-xs/5">
      <div ref={iframeHostRef} className="w-full min-w-0" />
    </section>
  );
}

export const DynamicChatUiArtifact = memo(
  DynamicChatUiArtifactInner,
  (previous, next) =>
    previous.isStreaming === next.isStreaming &&
    previous.onResize === next.onResize &&
    previous.artifact.id === next.artifact.id &&
    previous.artifact.title === next.artifact.title &&
    previous.artifact.description === next.artifact.description &&
    previous.artifact.initialHeight === next.artifact.initialHeight &&
    previous.artifact.maxHeight === next.artifact.maxHeight &&
    previous.artifact.html === next.artifact.html,
);
