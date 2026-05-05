import type { ContextMenuItem, OverlayMenuItem } from "@t3tools/contracts";
import { create } from "zustand";

import {
  isEmbeddedBrowserMounted,
  registerEmbeddedBrowserOverlay,
} from "./embeddedBrowserModalSuspension";
import { isNativeOverlayAvailable, openNativeOverlay } from "./nativeOverlayBridge";

function toOverlayMenuItems(items: readonly ContextMenuItem<string>[]): OverlayMenuItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    destructive: item.destructive,
    disabled: item.disabled,
    children: item.children ? toOverlayMenuItems(item.children) : undefined,
  }));
}

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
    if (isNativeOverlayAvailable() && isEmbeddedBrowserMounted()) {
      return openNativeOverlay<T | null>(
        {
          type: "context-menu",
          anchor: { x: position?.x ?? 0, y: position?.y ?? 0, width: 0, height: 0 },
          items: toOverlayMenuItems(items as readonly ContextMenuItem<string>[]),
        },
        {
          dismissValue: null,
          resolveEvent: (type, payload) => {
            if (type !== "select") return null;
            return { value: ((payload as { id?: string })?.id ?? null) as T | null };
          },
        },
      ).then((session) => {
        if (!session) {
          // Fallback to suspension path if acquire failed.
          return suspensionShow<T>(items, position, set);
        }
        return session.result;
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
