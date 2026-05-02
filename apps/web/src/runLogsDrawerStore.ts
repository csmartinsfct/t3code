import type { ThreadId } from "@t3tools/contracts";
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

interface ThreadRunLogsDrawerState {
  readonly tabs: ReadonlyArray<RunLogsTab>;
  readonly activeRunId: string | null;
}

interface RunLogsDrawerState {
  readonly tabsByThreadId: Record<string, ThreadRunLogsDrawerState>;
  readonly height: number;
  openTab: (input: {
    threadId: ThreadId;
    runId: string;
    projectId: string;
    scriptId: string;
    label: string;
  }) => void;
  retargetStaleScriptTab: (input: {
    runId: string;
    projectId: string;
    scriptId: string;
    label: string;
    activeRunIds: ReadonlyArray<string>;
  }) => void;
  closeTab: (input: { threadId: ThreadId; runId: string }) => void;
  closeRunEverywhere: (runId: string) => void;
  setActive: (input: { threadId: ThreadId; runId: string }) => void;
  setActiveService: (input: {
    threadId: ThreadId;
    runId: string;
    serviceId: string | null;
  }) => void;
  removeThreadState: (threadId: ThreadId) => void;
  setHeight: (height: number) => void;
}

const EMPTY_THREAD_RUN_LOGS_DRAWER_STATE: ThreadRunLogsDrawerState = Object.freeze({
  tabs: [],
  activeRunId: null,
});

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
  tabsByThreadId: {},
  height: readPersistedHeight(),
  openTab: ({ threadId, runId, projectId, scriptId, label }) =>
    set((state) => {
      const threadState = state.tabsByThreadId[threadId] ?? EMPTY_THREAD_RUN_LOGS_DRAWER_STATE;
      const existing = threadState.tabs.find((tab) => tab.runId === runId);
      if (existing) {
        // Refresh the cached label in case the script was renamed since open.
        const tabs = threadState.tabs.map((tab) =>
          tab.runId === runId ? { ...tab, projectId, scriptId, label } : tab,
        );
        return {
          tabsByThreadId: {
            ...state.tabsByThreadId,
            [threadId]: { tabs, activeRunId: runId },
          },
        };
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
        tabsByThreadId: {
          ...state.tabsByThreadId,
          [threadId]: {
            tabs: [...threadState.tabs, nextTab],
            activeRunId: runId,
          },
        },
      };
    }),
  retargetStaleScriptTab: ({ runId, projectId, scriptId, label, activeRunIds }) =>
    set((state) => {
      const activeRunIdSet = new Set(activeRunIds);
      let changed = false;
      const nextTabsByThreadId: Record<string, ThreadRunLogsDrawerState> = {};

      for (const [threadId, threadState] of Object.entries(state.tabsByThreadId)) {
        const staleTab = threadState.tabs.find(
          (tab) =>
            tab.projectId === projectId &&
            tab.scriptId === scriptId &&
            tab.runId !== runId &&
            !activeRunIdSet.has(tab.runId),
        );
        if (!staleTab) {
          nextTabsByThreadId[threadId] = threadState;
          continue;
        }

        const alreadyOpen = threadState.tabs.some((tab) => tab.runId === runId);
        const tabs = alreadyOpen
          ? threadState.tabs.filter((tab) => tab.runId !== staleTab.runId)
          : threadState.tabs.map((tab) =>
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
        const activeRunId =
          threadState.activeRunId === staleTab.runId ? runId : threadState.activeRunId;
        if (tabs.length > 0) {
          nextTabsByThreadId[threadId] = { tabs, activeRunId };
        }
        changed = true;
      }

      if (!changed) return state;
      return { tabsByThreadId: nextTabsByThreadId };
    }),
  closeTab: ({ threadId, runId }) =>
    set((state) => {
      const threadState = state.tabsByThreadId[threadId];
      if (!threadState || !threadState.tabs.some((tab) => tab.runId === runId)) return state;
      const nextTabs = threadState.tabs.filter((tab) => tab.runId !== runId);
      const wasActive = threadState.activeRunId === runId;
      const nextActive = wasActive
        ? (nextTabs[nextTabs.length - 1]?.runId ?? null)
        : threadState.activeRunId;
      const nextTabsByThreadId = { ...state.tabsByThreadId };
      if (nextTabs.length === 0) {
        delete nextTabsByThreadId[threadId];
      } else {
        nextTabsByThreadId[threadId] = {
          tabs: nextTabs,
          activeRunId: nextActive,
        };
      }
      return {
        tabsByThreadId: nextTabsByThreadId,
      };
    }),
  closeRunEverywhere: (runId) =>
    set((state) => {
      let changed = false;
      const nextTabsByThreadId: Record<string, ThreadRunLogsDrawerState> = {};
      for (const [threadId, threadState] of Object.entries(state.tabsByThreadId)) {
        if (!threadState.tabs.some((tab) => tab.runId === runId)) {
          nextTabsByThreadId[threadId] = threadState;
          continue;
        }
        const nextTabs = threadState.tabs.filter((tab) => tab.runId !== runId);
        if (nextTabs.length > 0) {
          nextTabsByThreadId[threadId] = {
            tabs: nextTabs,
            activeRunId:
              threadState.activeRunId === runId
                ? (nextTabs[nextTabs.length - 1]?.runId ?? null)
                : threadState.activeRunId,
          };
        }
        changed = true;
      }
      if (!changed) return state;
      return { tabsByThreadId: nextTabsByThreadId };
    }),
  setActive: ({ threadId, runId }) =>
    set((state) => {
      const threadState = state.tabsByThreadId[threadId];
      if (!threadState || !threadState.tabs.some((tab) => tab.runId === runId)) return state;
      return {
        tabsByThreadId: {
          ...state.tabsByThreadId,
          [threadId]: { ...threadState, activeRunId: runId },
        },
      };
    }),
  setActiveService: ({ threadId, runId, serviceId }) =>
    set((state) => {
      const threadState = state.tabsByThreadId[threadId];
      if (!threadState) return state;
      const tabs = threadState.tabs.map((tab) =>
        tab.runId === runId ? { ...tab, activeServiceId: serviceId } : tab,
      );
      return {
        tabsByThreadId: {
          ...state.tabsByThreadId,
          [threadId]: { ...threadState, tabs },
        },
      };
    }),
  removeThreadState: (threadId) =>
    set((state) => {
      if (!state.tabsByThreadId[threadId]) return state;
      const nextTabsByThreadId = { ...state.tabsByThreadId };
      delete nextTabsByThreadId[threadId];
      return { tabsByThreadId: nextTabsByThreadId };
    }),
  setHeight: (height) => {
    const clamped = clampBottomDrawerHeight(height, get().height);
    persistHeight(clamped);
    set({ height: clamped });
  },
}));

export function selectThreadRunLogsDrawerState(
  state: RunLogsDrawerState,
  threadId: ThreadId,
): ThreadRunLogsDrawerState {
  if (threadId.length === 0) return EMPTY_THREAD_RUN_LOGS_DRAWER_STATE;
  return state.tabsByThreadId[threadId] ?? EMPTY_THREAD_RUN_LOGS_DRAWER_STATE;
}

export function selectRunLogsDrawerOpen(state: RunLogsDrawerState, threadId: ThreadId): boolean {
  return selectThreadRunLogsDrawerState(state, threadId).tabs.length > 0;
}
