import type { ContextMenuItem } from "@t3tools/contracts";
import { create } from "zustand";

import { registerEmbeddedBrowserOverlay } from "./embeddedBrowserModalSuspension";
import { openNativeOverlayRoute, shouldUseNativeOverlay } from "./nativeOverlayBridge";

interface ContextMenuState {
  open: boolean;
  items: readonly ContextMenuItem<string>[];
  position: { x: number; y: number };
  resolve: ((value: string | null) => void) | null;
  releaseBrowserOverlay: (() => void) | null;
}

interface ContextMenuActions {
  show: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  select: (id: string) => void;
  dismiss: () => void;
}

const initialState: ContextMenuState = {
  open: false,
  items: [],
  position: { x: 0, y: 0 },
  resolve: null,
  releaseBrowserOverlay: null,
};

export const useContextMenuStore = create<ContextMenuState & ContextMenuActions>((set, get) => ({
  ...initialState,

  show: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ): Promise<T | null> => {
    const previous = get();
    previous.releaseBrowserOverlay?.();
    previous.resolve?.(null);

    // Native overlay path: render in a transparent WebContentsView positioned
    // above the embedded Chromium browser. No suspension required.
    if (shouldUseNativeOverlay()) {
      return openNativeOverlayRoute<T | null>(
        {
          routeKey: "context-menu",
          params: {
            items: items as readonly ContextMenuItem<string>[],
          },
          presentation: {
            kind: "menu",
            anchor: { x: position?.x ?? 0, y: position?.y ?? 0, width: 0, height: 0 },
            side: "bottom",
            align: "start",
          },
        },
        {
          dismissValue: { status: "cancelled", reason: "dismissed" },
        },
      ).then((session) => {
        if (!session) {
          // Fallback to suspension path if acquire failed.
          return suspensionShow<T>(items, position, set);
        }
        return session.result.then((result) => {
          if (result.status === "submitted") return result.value;
          if (result.status === "error") return suspensionShow<T>(items, position, set);
          return null;
        });
      });
    }

    return suspensionShow<T>(items, position, set);
  },

  select: (id: string) => {
    const { releaseBrowserOverlay, resolve } = get();
    releaseBrowserOverlay?.();
    set(initialState);
    resolve?.(id);
  },

  dismiss: () => {
    const { releaseBrowserOverlay, resolve } = get();
    releaseBrowserOverlay?.();
    set(initialState);
    resolve?.(null);
  },
}));

function suspensionShow<T extends string>(
  items: readonly ContextMenuItem<T>[],
  position: { x: number; y: number } | undefined,
  set: (state: Partial<ContextMenuState>) => void,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const releaseBrowserOverlay = registerEmbeddedBrowserOverlay();
    set({
      open: true,
      items: items as readonly ContextMenuItem<string>[],
      position: position ?? { x: 0, y: 0 },
      resolve: resolve as (value: string | null) => void,
      releaseBrowserOverlay,
    });
  });
}
