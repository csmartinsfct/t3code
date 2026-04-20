import type { ContextMenuItem } from "@t3tools/contracts";
import { create } from "zustand";

import { registerEmbeddedBrowserOverlay } from "./embeddedBrowserModalSuspension";

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

    return new Promise<T | null>((resolve) => {
      const releaseBrowserOverlay = registerEmbeddedBrowserOverlay();
      set({
        open: true,
        items,
        position: position ?? { x: 0, y: 0 },
        resolve: resolve as (value: string | null) => void,
        releaseBrowserOverlay,
      });
    });
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
