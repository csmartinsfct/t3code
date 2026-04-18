import type { ContextMenuItem } from "@t3tools/contracts";
import { create } from "zustand";

interface ContextMenuState {
  open: boolean;
  items: readonly ContextMenuItem<string>[];
  position: { x: number; y: number };
  resolve: ((value: string | null) => void) | null;
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
};

export const useContextMenuStore = create<ContextMenuState & ContextMenuActions>((set, get) => ({
  ...initialState,

  show: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ): Promise<T | null> => {
    const prev = get().resolve;
    if (prev) {
      prev(null);
    }

    return new Promise<T | null>((resolve) => {
      set({
        open: true,
        items,
        position: position ?? { x: 0, y: 0 },
        resolve: resolve as (value: string | null) => void,
      });
    });
  },

  select: (id: string) => {
    const { resolve } = get();
    set(initialState);
    resolve?.(id);
  },

  dismiss: () => {
    const { resolve } = get();
    set(initialState);
    resolve?.(null);
  },
}));
