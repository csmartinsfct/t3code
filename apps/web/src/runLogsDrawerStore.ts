import { create } from "zustand";

import {
  TERMINAL_DRAWER_DEFAULT_HEIGHT,
  clampBottomDrawerHeight,
} from "./components/terminal/xtermShared";

const HEIGHT_STORAGE_KEY = "t3code:run-logs-drawer:height:v1";

export interface RunLogsTab {
  readonly runId: string;
  readonly projectId: string;
  readonly scriptId: string;
  readonly openedAt: string;
  /**
   * Display label captured at open time. Persists across run-stop / eviction
   * from `activeManagedRuns` so the tab keeps a meaningful name even after
   * the run is no longer "live" in the popover's run list.
   */
  readonly label: string;
  /**
   * Active sub-tab within this run's viewport. `null` ⇒ the merged "All" view
   * (default for composite runs). For single-service / legacy runs there is no
   * sub-tab strip, and this stays `null`.
   */
  readonly activeServiceId: string | null;
}

interface RunLogsDrawerState {
  readonly tabs: ReadonlyArray<RunLogsTab>;
  readonly activeRunId: string | null;
  readonly height: number;
  openTab: (input: { runId: string; projectId: string; scriptId: string; label: string }) => void;
  retargetStaleScriptTab: (input: {
    runId: string;
    projectId: string;
    scriptId: string;
    label: string;
    activeRunIds: ReadonlyArray<string>;
  }) => void;
  closeTab: (runId: string) => void;
  setActive: (runId: string) => void;
  setActiveService: (runId: string, serviceId: string | null) => void;
  setHeight: (height: number) => void;
}

function readPersistedHeight(): number {
  if (typeof window === "undefined") return TERMINAL_DRAWER_DEFAULT_HEIGHT;
  try {
    const raw = window.localStorage.getItem(HEIGHT_STORAGE_KEY);
    if (!raw) return TERMINAL_DRAWER_DEFAULT_HEIGHT;
    const parsed = Number.parseInt(raw, 10);
    return clampBottomDrawerHeight(parsed, TERMINAL_DRAWER_DEFAULT_HEIGHT);
  } catch {
    return TERMINAL_DRAWER_DEFAULT_HEIGHT;
  }
}

function persistHeight(height: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(height));
  } catch {
    // Ignore quota errors
  }
}

export const useRunLogsDrawerStore = create<RunLogsDrawerState>((set, get) => ({
  tabs: [],
  activeRunId: null,
  height: readPersistedHeight(),
  openTab: ({ runId, projectId, scriptId, label }) =>
    set((state) => {
      const existing = state.tabs.find((tab) => tab.runId === runId);
      if (existing) {
        // Refresh the cached label in case the script was renamed since open.
        const tabs = state.tabs.map((tab) =>
          tab.runId === runId ? { ...tab, projectId, scriptId, label } : tab,
        );
        return { tabs, activeRunId: runId };
      }
      const nextTab: RunLogsTab = {
        runId,
        projectId,
        scriptId,
        openedAt: new Date().toISOString(),
        label,
        activeServiceId: null,
      };
      return {
        tabs: [...state.tabs, nextTab],
        activeRunId: runId,
      };
    }),
  retargetStaleScriptTab: ({ runId, projectId, scriptId, label, activeRunIds }) =>
    set((state) => {
      const activeRunIdSet = new Set(activeRunIds);
      const staleTab = state.tabs.find(
        (tab) =>
          tab.projectId === projectId &&
          tab.scriptId === scriptId &&
          tab.runId !== runId &&
          !activeRunIdSet.has(tab.runId),
      );
      if (!staleTab) return state;

      const alreadyOpen = state.tabs.some((tab) => tab.runId === runId);
      const tabs = alreadyOpen
        ? state.tabs.filter((tab) => tab.runId !== staleTab.runId)
        : state.tabs.map((tab) =>
            tab.runId === staleTab.runId
              ? {
                  ...tab,
                  runId,
                  projectId,
                  scriptId,
                  label,
                  openedAt: new Date().toISOString(),
                  activeServiceId: null,
                }
              : tab,
          );
      return {
        tabs,
        activeRunId: state.activeRunId === staleTab.runId ? runId : state.activeRunId,
      };
    }),
  closeTab: (runId) =>
    set((state) => {
      const nextTabs = state.tabs.filter((tab) => tab.runId !== runId);
      const wasActive = state.activeRunId === runId;
      const nextActive = wasActive
        ? (nextTabs[nextTabs.length - 1]?.runId ?? null)
        : state.activeRunId;
      return {
        tabs: nextTabs,
        activeRunId: nextActive,
      };
    }),
  setActive: (runId) =>
    set((state) => {
      if (!state.tabs.some((tab) => tab.runId === runId)) return state;
      return { activeRunId: runId };
    }),
  setActiveService: (runId, serviceId) =>
    set((state) => {
      const tabs = state.tabs.map((tab) =>
        tab.runId === runId ? { ...tab, activeServiceId: serviceId } : tab,
      );
      return { tabs };
    }),
  setHeight: (height) => {
    const clamped = clampBottomDrawerHeight(height, get().height);
    persistHeight(clamped);
    set({ height: clamped });
  },
}));

export function selectRunLogsDrawerOpen(state: RunLogsDrawerState): boolean {
  return state.tabs.length > 0;
}
