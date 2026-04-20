import type { ProjectId } from "@t3tools/contracts";
import { ArrowRightIcon, GlobeIcon, RotateCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../ui/button";

interface EmbeddedBrowserProps {
  projectId: ProjectId;
}

interface BrowserRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_URL = "https://news.ycombinator.com";

function readElementRect(element: HTMLElement): BrowserRect {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function normalizeUrlInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_URL;
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function EmbeddedBrowser({ projectId }: EmbeddedBrowserProps) {
  const rectRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const mountPromiseRef = useRef<Promise<void> | null>(null);
  const disposedRef = useRef(false);
  const [url, setUrl] = useState(DEFAULT_URL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browserBridge = typeof window === "undefined" ? undefined : window.desktopBridge?.browser;

  const syncBounds = useCallback(async () => {
    const element = rectRef.current;
    if (!element || !browserBridge) return;
    const bounds = readElementRect(element);
    if (bounds.width <= 0 || bounds.height <= 0) return;

    if (!mountedRef.current) {
      if (!mountPromiseRef.current) {
        mountPromiseRef.current = browserBridge
          .mount(projectId, bounds)
          .then(async () => {
            if (disposedRef.current) {
              return;
            }
            mountedRef.current = true;
            const currentUrl = await browserBridge.getUrl();
            if (currentUrl) setUrl(currentUrl);
          })
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause));
          })
          .finally(() => {
            mountPromiseRef.current = null;
          });
      }
      await mountPromiseRef.current;
      return;
    }

    try {
      await browserBridge.setBounds(bounds);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [browserBridge, projectId]);

  const scheduleBoundsSync = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      void syncBounds();
    });
  }, [syncBounds]);

  useEffect(() => {
    if (!browserBridge) return;
    const element = rectRef.current;
    if (!element) return;

    disposedRef.current = false;
    scheduleBoundsSync();
    const observer = new ResizeObserver(scheduleBoundsSync);
    observer.observe(element);
    window.addEventListener("resize", scheduleBoundsSync);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleBoundsSync);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      disposedRef.current = true;
      const pendingMount = mountPromiseRef.current;
      const shouldUnmount = mountedRef.current || pendingMount !== null;
      mountedRef.current = false;
      void (async () => {
        await pendingMount?.catch(() => {});
        if (shouldUnmount) {
          await browserBridge.unmount();
        }
      })();
    };
  }, [browserBridge, scheduleBoundsSync]);

  const navigate = useCallback(
    async (targetUrl: string) => {
      if (!browserBridge) return;
      const nextUrl = normalizeUrlInput(targetUrl);
      setLoading(true);
      setError(null);
      try {
        await browserBridge.navigate(nextUrl);
        const currentUrl = await browserBridge.getUrl();
        setUrl(currentUrl || nextUrl);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [browserBridge],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void navigate(url);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <form
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3"
        onSubmit={handleSubmit}
      >
        <GlobeIcon className="size-4 text-muted-foreground" />
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
          placeholder="https://news.ycombinator.com"
          spellCheck={false}
        />
        <Button type="submit" size="icon-xs" variant="outline" disabled={!browserBridge || loading}>
          {loading ? (
            <RotateCwIcon className="size-3 animate-spin" />
          ) : (
            <ArrowRightIcon className="size-3" />
          )}
        </Button>
      </form>
      {error && (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}
      {!browserBridge && (
        <div className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          Embedded browser is available in the desktop app.
        </div>
      )}
      <div ref={rectRef} data-browser-rect className="min-h-0 flex-1 bg-background" />
    </div>
  );
}
