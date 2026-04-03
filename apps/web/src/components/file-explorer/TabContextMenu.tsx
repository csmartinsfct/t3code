/**
 * TabContextMenu — shows the OS context menu for a file tab.
 *
 * Uses the same `api.contextMenu.show()` pattern as the thread sidebar.
 */
import { useCallback } from "react";

import { readNativeApi } from "~/nativeApi";
import { useFileExplorerStore } from "~/fileExplorerStore";
import type { PaneId } from "~/fileExplorerStore";

type TabContextMenuId = "close" | "close-others" | "close-to-right" | "close-saved" | "close-all";

interface UseTabContextMenuOptions {
  tabId: string;
  paneId: PaneId;
  cwd: string;
}

export function useTabContextMenu({ tabId, paneId, cwd }: UseTabContextMenuOptions) {
  const { closeTab, closeOtherTabs, closeTabsToRight, closeSavedTabs, closeAllTabs } =
    useFileExplorerStore();

  const show = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;

      const clicked = await api.contextMenu.show<TabContextMenuId>(
        [
          { id: "close", label: "Close" },
          { id: "close-others", label: "Close Others" },
          { id: "close-to-right", label: "Close to the Right" },
          { id: "close-saved", label: "Close Saved" },
          { id: "close-all", label: "Close All" },
        ],
        position,
      );

      switch (clicked) {
        case "close":
          closeTab(tabId);
          break;
        case "close-others":
          closeOtherTabs(tabId, paneId, cwd);
          break;
        case "close-to-right":
          closeTabsToRight(tabId, paneId, cwd);
          break;
        case "close-saved":
          closeSavedTabs(paneId, cwd);
          break;
        case "close-all":
          closeAllTabs(paneId, cwd);
          break;
      }
    },
    [tabId, paneId, cwd, closeTab, closeOtherTabs, closeTabsToRight, closeSavedTabs, closeAllTabs],
  );

  return { show };
}
