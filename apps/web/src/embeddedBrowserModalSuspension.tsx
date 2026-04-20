import { useCallback, useEffect, useRef, useState } from "react";

import { warnWebTimeline } from "./timelineLogger";

type OpenChangeHandler<TDetails> = (open: boolean, eventDetails: TDetails) => void;

interface TrackedOverlayOpenInput<TDetails> {
  open: boolean | undefined;
  defaultOpen: boolean | undefined;
  onOpenChange: OpenChangeHandler<TDetails> | undefined;
  enabled: boolean | undefined;
  source: string;
}

let trackedOverlayCount = 0;
let embeddedBrowserMounted = false;
let desiredSuspended = false;
let appliedSuspended = false;
let applyingSuspension = false;
let lastFallbackWarningAt = 0;

function readBrowserBridge() {
  if (typeof window === "undefined") return undefined;
  return window.desktopBridge?.browser;
}

function updateDesiredSuspension(): void {
  desiredSuspended = trackedOverlayCount > 0;
  applyDesiredSuspension();
}

function applyDesiredSuspension(): void {
  const bridge = readBrowserBridge();
  if (!embeddedBrowserMounted || !bridge || applyingSuspension) return;
  if (desiredSuspended === appliedSuspended) return;

  applyingSuspension = true;
  void (async () => {
    try {
      for (;;) {
        if (!embeddedBrowserMounted || desiredSuspended === appliedSuspended) break;
        const nextSuspended = desiredSuspended;
        if (nextSuspended) {
          await bridge.suspendForModal();
        } else {
          await bridge.resumeFromModal();
        }
        appliedSuspended = nextSuspended;
      }
    } catch (error) {
      warnWebTimeline("embedded-browser.modal-suspension-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      applyingSuspension = false;
      if (embeddedBrowserMounted && desiredSuspended !== appliedSuspended) {
        applyDesiredSuspension();
      }
    }
  })();
}

export function registerEmbeddedBrowserOverlay(): () => void {
  trackedOverlayCount += 1;
  updateDesiredSuspension();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    trackedOverlayCount = Math.max(0, trackedOverlayCount - 1);
    updateDesiredSuspension();
  };
}

export function getTrackedEmbeddedBrowserOverlayCountForTests(): number {
  return trackedOverlayCount;
}

export function __resetEmbeddedBrowserModalSuspensionForTests(): void {
  trackedOverlayCount = 0;
  embeddedBrowserMounted = false;
  desiredSuspended = false;
  appliedSuspended = false;
  applyingSuspension = false;
  lastFallbackWarningAt = 0;
}

export function isEmbeddedBrowserSuspendedForModal(): boolean {
  return desiredSuspended;
}

export function setEmbeddedBrowserMountedForModalSuspension(mounted: boolean): void {
  embeddedBrowserMounted = mounted;
  if (!mounted) {
    appliedSuspended = false;
    return;
  }
  applyDesiredSuspension();
}

export function useEmbeddedBrowserOverlayLifecycle(open: boolean, _source: string): void {
  const releaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (open && !releaseRef.current) {
      releaseRef.current = registerEmbeddedBrowserOverlay();
    } else if (!open && releaseRef.current) {
      releaseRef.current();
      releaseRef.current = null;
    }

    return () => {
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [open]);
}

export function useTrackedOverlayOpen<TDetails>({
  open,
  defaultOpen,
  onOpenChange,
  enabled,
  source,
}: TrackedOverlayOpenInput<TDetails>): OpenChangeHandler<TDetails> {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
  const trackedOpen = open ?? uncontrolledOpen;
  const shouldTrack = enabled ?? true;

  useEmbeddedBrowserOverlayLifecycle(shouldTrack && trackedOpen, source);

  return useCallback(
    (nextOpen: boolean, eventDetails: TDetails) => {
      if (open === undefined) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen, eventDetails);
    },
    [onOpenChange, open],
  );
}

function hasOpenOverlayElement(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector('[role="dialog"], [role="menu"], [data-state="open"]'));
}

function maybeWarnForUntrackedOverlay(): void {
  if (!embeddedBrowserMounted || trackedOverlayCount > 0 || !hasOpenOverlayElement()) return;

  const now = Date.now();
  if (now - lastFallbackWarningAt < 1000) return;
  lastFallbackWarningAt = now;
  warnWebTimeline("embedded-browser.modal-not-suspended", {
    trackedOverlayCount,
  });
}

export function EmbeddedBrowserModalFallbackProbe() {
  useEffect(() => {
    const handleKeyDown = () => {
      window.setTimeout(maybeWarnForUntrackedOverlay, 0);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  return null;
}
