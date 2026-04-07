/**
 * File Explorer + Editor Zustand store.
 *
 * Persisted state: structural layout (open tabs, pane assignments, split,
 * tree expanded directories, tree width) keyed by workspace root (cwd).
 *
 * Runtime-only state: current file contents and dirty tracking — excluded
 * from localStorage via `partialize`.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PaneId = "primary" | "secondary";

export interface FileTab {
  /** Composite stable id: `${cwd}::${relativePath}` */
  id: string;
  cwd: string;
  relativePath: string;
}

export interface PaneState {
  tabIds: string[];
  activeTabId: string | null;
}

export interface WorkspaceEditorState {
  tabsById: Record<string, FileTab>;
  panes: Record<PaneId, PaneState>;
  hasSplit: boolean;
  activePaneId: PaneId;
  expandedDirs: string[];
  treeWidth: number;
}

export interface RuntimeTabState {
  currentContent: string;
  savedContent: string;
  isDirty: boolean;
}

export interface ScrollTarget {
  line: number;
  column?: number | undefined;
}

// ─── Store Interface ─────────────────────────────────────────────────────────

interface FileExplorerStoreState {
  // Persisted: structural state per workspace
  workspaceStatesByCwd: Record<string, WorkspaceEditorState>;

  // Runtime only (not persisted)
  runtimeTabStateByTabId: Record<string, RuntimeTabState>;
  pendingScrollTargetByTabId: Record<string, ScrollTarget>;
  pendingRevealPathByCwd: Record<string, string>;

  // ── Persisted actions ──
  openFile: (cwd: string, relativePath: string, targetPane?: PaneId) => void;
  closeTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string, paneId: PaneId, cwd: string) => void;
  closeTabsToRight: (tabId: string, paneId: PaneId, cwd: string) => void;
  closeSavedTabs: (paneId: PaneId, cwd: string) => void;
  closeAllTabs: (paneId: PaneId, cwd: string) => void;
  setActiveTab: (paneId: PaneId, tabId: string, cwd: string) => void;
  moveTabToPane: (
    tabId: string,
    fromPane: PaneId,
    toPane: PaneId,
    insertAfterTabId?: string,
    cwd?: string,
  ) => void;
  reorderTabsInPane: (paneId: PaneId, tabIds: string[], cwd: string) => void;
  createSplit: (side: "left" | "right", triggerTabId?: string, cwd?: string) => void;
  closeSplit: (cwd: string) => void;
  setActivePaneId: (paneId: PaneId, cwd: string) => void;
  toggleDirectory: (cwd: string, dirPath: string) => void;
  setTreeWidth: (cwd: string, width: number) => void;

  // ── Combined actions ──
  openFileAtLine: (
    cwd: string,
    relativePath: string,
    line?: number,
    column?: number,
    targetPane?: PaneId,
  ) => void;

  // ── Tree reveal ──
  revealFileInTree: (cwd: string, relativePath: string) => void;
  setPendingRevealPath: (cwd: string, relativePath: string) => void;
  clearPendingRevealPath: (cwd: string) => void;

  // ── Scroll target ──
  setPendingScrollTarget: (tabId: string, target: ScrollTarget) => void;
  clearPendingScrollTarget: (tabId: string) => void;

  // ── Runtime-only actions ──
  initTabContent: (tabId: string, content: string) => void;
  setTabCurrentContent: (tabId: string, content: string) => void;
  markTabSaved: (tabId: string) => void;
  clearTabRuntime: (tabId: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTabId(cwd: string, relativePath: string): string {
  return `${cwd}::${relativePath}`;
}

const DEFAULT_TREE_WIDTH = 240;

// Stable singleton — must never be mutated. Used as the fallback when a
// workspace root hasn't been opened yet so Zustand selectors always return
// the same reference and don't trigger spurious re-renders.
const EMPTY_PANE_STATE: PaneState = { tabIds: [], activeTabId: null };
const DEFAULT_WORKSPACE_STATE: WorkspaceEditorState = {
  tabsById: {},
  panes: { primary: EMPTY_PANE_STATE, secondary: EMPTY_PANE_STATE },
  hasSplit: false,
  activePaneId: "primary",
  expandedDirs: [],
  treeWidth: DEFAULT_TREE_WIDTH,
};

function getOrCreateWorkspaceState(
  workspaceStatesByCwd: Record<string, WorkspaceEditorState>,
  cwd: string,
): WorkspaceEditorState {
  return workspaceStatesByCwd[cwd] ?? DEFAULT_WORKSPACE_STATE;
}

function findTabPane(ws: WorkspaceEditorState, tabId: string): PaneId | null {
  if (ws.panes.primary.tabIds.includes(tabId)) return "primary";
  if (ws.panes.secondary.tabIds.includes(tabId)) return "secondary";
  return null;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

const FILE_EXPLORER_STORE_KEY = "t3code:file-explorer:v1";
const FILE_EXPLORER_STORE_VERSION = 1;

function createFileExplorerStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useFileExplorerStore = create<FileExplorerStoreState>()(
  persist(
    (set, get) => ({
      workspaceStatesByCwd: {},
      runtimeTabStateByTabId: {},
      pendingScrollTargetByTabId: {},
      pendingRevealPathByCwd: {},

      openFile: (cwd, relativePath, targetPane) => {
        const tabId = makeTabId(cwd, relativePath);
        set((state) => {
          const ws = getOrCreateWorkspaceState(state.workspaceStatesByCwd, cwd);

          // Deduplicate: if already open anywhere, just activate it
          const existingPane = findTabPane(ws, tabId);
          if (existingPane) {
            return {
              workspaceStatesByCwd: {
                ...state.workspaceStatesByCwd,
                [cwd]: {
                  ...ws,
                  activePaneId: existingPane,
                  panes: {
                    ...ws.panes,
                    [existingPane]: {
                      ...ws.panes[existingPane],
                      activeTabId: tabId,
                    },
                  },
                },
              },
            };
          }

          // Add to target pane (or active pane if not specified)
          const pane = targetPane ?? ws.activePaneId;
          const tab: FileTab = { id: tabId, cwd, relativePath };
          const updatedPane: PaneState = {
            tabIds: [...ws.panes[pane].tabIds, tabId],
            activeTabId: tabId,
          };

          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [cwd]: {
                ...ws,
                tabsById: { ...ws.tabsById, [tabId]: tab },
                activePaneId: pane,
                panes: { ...ws.panes, [pane]: updatedPane },
              },
            },
          };
        });
      },

      closeTab: (tabId) => {
        set((state) => {
          // Find which workspace and pane this tab belongs to
          for (const [cwd, ws] of Object.entries(state.workspaceStatesByCwd)) {
            const pane = findTabPane(ws, tabId);
            if (!pane) continue;

            const paneState = ws.panes[pane];
            const newTabIds = paneState.tabIds.filter((id) => id !== tabId);

            // Determine new active tab
            const closedIndex = paneState.tabIds.indexOf(tabId);
            let newActiveTabId: string | null = null;
            if (newTabIds.length > 0) {
              newActiveTabId = newTabIds[Math.min(closedIndex, newTabIds.length - 1)] ?? null;
            }

            const newTabsById = { ...ws.tabsById };
            delete newTabsById[tabId];

            let newWs: WorkspaceEditorState = {
              ...ws,
              tabsById: newTabsById,
              panes: {
                ...ws.panes,
                [pane]: { tabIds: newTabIds, activeTabId: newActiveTabId },
              },
            };

            // Auto-collapse split if secondary pane becomes empty
            if (pane === "secondary" && newTabIds.length === 0 && ws.hasSplit) {
              newWs = {
                ...newWs,
                hasSplit: false,
                activePaneId: "primary",
                panes: {
                  ...newWs.panes,
                  secondary: { tabIds: [], activeTabId: null },
                },
              };
            }

            // Clear runtime state
            const newRuntime = { ...state.runtimeTabStateByTabId };
            delete newRuntime[tabId];

            return {
              workspaceStatesByCwd: {
                ...state.workspaceStatesByCwd,
                [cwd]: newWs,
              },
              runtimeTabStateByTabId: newRuntime,
            };
          }
          return state;
        });
      },

      closeOtherTabs: (tabId, paneId, cwd) => {
        set((state) => {
          const ws = state.workspaceStatesByCwd[cwd];
          if (!ws) return state;

          const pane = ws.panes[paneId];
          if (!pane.tabIds.includes(tabId)) return state;

          const removedIds = pane.tabIds.filter((id) => id !== tabId);
          const newTabsById = { ...ws.tabsById };
          for (const id of removedIds) delete newTabsById[id];

          const newRuntime = { ...state.runtimeTabStateByTabId };
          for (const id of removedIds) delete newRuntime[id];

          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [cwd]: {
                ...ws,
                tabsById: newTabsById,
                panes: {
                  ...ws.panes,
                  [paneId]: { tabIds: [tabId], activeTabId: tabId },
                },
              },
            },
            runtimeTabStateByTabId: newRuntime,
          };
        });
      },

      closeTabsToRight: (tabId, paneId, cwd) => {
        set((state) => {
          const ws = state.workspaceStatesByCwd[cwd];
          if (!ws) return state;

          const pane = ws.panes[paneId];
          const idx = pane.tabIds.indexOf(tabId);
          if (idx === -1) return state;

          const removedIds = pane.tabIds.slice(idx + 1);
          const newTabIds = pane.tabIds.slice(0, idx + 1);
          const newTabsById = { ...ws.tabsById };
          for (const id of removedIds) delete newTabsById[id];

          const newRuntime = { ...state.runtimeTabStateByTabId };
          for (const id of removedIds) delete newRuntime[id];

          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [cwd]: {
                ...ws,
                tabsById: newTabsById,
                panes: {
                  ...ws.panes,
                  [paneId]: {
                    tabIds: newTabIds,
                    activeTabId: newTabIds.includes(pane.activeTabId ?? "")
                      ? pane.activeTabId
                      : (newTabIds[newTabIds.length - 1] ?? null),
                  },
                },
              },
            },
            runtimeTabStateByTabId: newRuntime,
          };
        });
      },

      closeSavedTabs: (paneId, cwd) => {
        set((state) => {
          const ws = state.workspaceStatesByCwd[cwd];
          if (!ws) return state;

          const pane = ws.panes[paneId];
          const runtime = state.runtimeTabStateByTabId;
          const tabsToClose = pane.tabIds.filter((id) => !runtime[id]?.isDirty);
          if (tabsToClose.length === 0) return state;

          const newTabIds = pane.tabIds.filter((id) => !tabsToClose.includes(id));
          const newTabsById = { ...ws.tabsById };
          for (const id of tabsToClose) delete newTabsById[id];

          const newRuntime = { ...runtime };
          for (const id of tabsToClose) delete newRuntime[id];

          const newActiveTabId =
            pane.activeTabId && !tabsToClose.includes(pane.activeTabId)
              ? pane.activeTabId
              : (newTabIds[newTabIds.length - 1] ?? null);

          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [cwd]: {
                ...ws,
                tabsById: newTabsById,
                panes: {
                  ...ws.panes,
                  [paneId]: { tabIds: newTabIds, activeTabId: newActiveTabId },
                },
              },
            },
            runtimeTabStateByTabId: newRuntime,
          };
        });
      },

      closeAllTabs: (paneId, cwd) => {
        set((state) => {
          const ws = state.workspaceStatesByCwd[cwd];
          if (!ws) return state;

          const removedIds = ws.panes[paneId].tabIds;
          const newTabsById = { ...ws.tabsById };
          for (const id of removedIds) delete newTabsById[id];

          const newRuntime = { ...state.runtimeTabStateByTabId };
          for (const id of removedIds) delete newRuntime[id];

          let newWs: WorkspaceEditorState = {
            ...ws,
            tabsById: newTabsById,
            panes: {
              ...ws.panes,
              [paneId]: { tabIds: [], activeTabId: null },
            },
          };

          if (paneId === "secondary" && ws.hasSplit) {
            newWs = { ...newWs, hasSplit: false, activePaneId: "primary" };
          }

          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [cwd]: newWs,
            },
            runtimeTabStateByTabId: newRuntime,
          };
        });
      },

      setActiveTab: (paneId, tabId, cwd) => {
        set((state) => {
          const ws = state.workspaceStatesByCwd[cwd];
          if (!ws) return state;
          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [cwd]: {
                ...ws,
                activePaneId: paneId,
                panes: {
                  ...ws.panes,
                  [paneId]: { ...ws.panes[paneId], activeTabId: tabId },
                },
              },
            },
          };
        });
      },

      moveTabToPane: (tabId, fromPane, toPane, insertAfterTabId, cwd) => {
        if (fromPane === toPane && !insertAfterTabId) return;
        set((state) => {
          // Find cwd if not provided
          let resolvedCwd = cwd;
          if (!resolvedCwd) {
            for (const [c, ws] of Object.entries(state.workspaceStatesByCwd)) {
              if (findTabPane(ws, tabId)) {
                resolvedCwd = c;
                break;
              }
            }
          }
          if (!resolvedCwd) return state;

          const ws = state.workspaceStatesByCwd[resolvedCwd];
          if (!ws) return state;

          // Remove from source pane
          const srcPane = ws.panes[fromPane];
          const newSrcTabIds = srcPane.tabIds.filter((id) => id !== tabId);
          const newSrcActiveTabId =
            srcPane.activeTabId === tabId
              ? (newSrcTabIds[newSrcTabIds.length - 1] ?? null)
              : srcPane.activeTabId;

          // Insert into target pane
          const dstPane = ws.panes[toPane];
          let newDstTabIds: string[];
          if (insertAfterTabId) {
            const insertIdx = dstPane.tabIds.indexOf(insertAfterTabId);
            newDstTabIds =
              insertIdx === -1
                ? [...dstPane.tabIds, tabId]
                : [
                    ...dstPane.tabIds.slice(0, insertIdx + 1),
                    tabId,
                    ...dstPane.tabIds.slice(insertIdx + 1),
                  ];
          } else {
            newDstTabIds = [...dstPane.tabIds, tabId];
          }

          let newWs: WorkspaceEditorState = {
            ...ws,
            activePaneId: toPane,
            panes: {
              ...ws.panes,
              [fromPane]: { tabIds: newSrcTabIds, activeTabId: newSrcActiveTabId },
              [toPane]: { tabIds: newDstTabIds, activeTabId: tabId },
            },
          };

          // Auto-collapse split if secondary is empty
          if (fromPane === "secondary" && newSrcTabIds.length === 0 && ws.hasSplit) {
            newWs = { ...newWs, hasSplit: false, activePaneId: "primary" };
          }

          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [resolvedCwd]: newWs,
            },
          };
        });
      },

      reorderTabsInPane: (paneId, tabIds, cwd) => {
        set((state) => {
          const ws = state.workspaceStatesByCwd[cwd];
          if (!ws) return state;
          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [cwd]: {
                ...ws,
                panes: {
                  ...ws.panes,
                  [paneId]: { ...ws.panes[paneId], tabIds },
                },
              },
            },
          };
        });
      },

      createSplit: (side, triggerTabId, cwd) => {
        set((state) => {
          let resolvedCwd = cwd;
          if (!resolvedCwd) {
            resolvedCwd = Object.keys(state.workspaceStatesByCwd)[0];
          }
          if (!resolvedCwd) return state;

          const ws = state.workspaceStatesByCwd[resolvedCwd] ?? DEFAULT_WORKSPACE_STATE;
          if (ws.hasSplit) return state;

          let newWs: WorkspaceEditorState = {
            ...ws,
            hasSplit: true,
            activePaneId: "secondary",
          };

          // Move trigger tab to secondary pane
          if (triggerTabId && ws.panes.primary.tabIds.includes(triggerTabId)) {
            const newPrimaryTabIds = ws.panes.primary.tabIds.filter((id) => id !== triggerTabId);
            const newPrimaryActiveTabId =
              ws.panes.primary.activeTabId === triggerTabId
                ? (newPrimaryTabIds[newPrimaryTabIds.length - 1] ?? null)
                : ws.panes.primary.activeTabId;

            newWs = {
              ...newWs,
              panes: {
                primary: { tabIds: newPrimaryTabIds, activeTabId: newPrimaryActiveTabId },
                secondary: { tabIds: [triggerTabId], activeTabId: triggerTabId },
              },
            };
          }

          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [resolvedCwd]: newWs,
            },
          };
        });
      },

      closeSplit: (cwd) => {
        set((state) => {
          const ws = state.workspaceStatesByCwd[cwd];
          if (!ws || !ws.hasSplit) return state;

          // Move secondary tabs to end of primary
          const mergedTabIds = [...ws.panes.primary.tabIds, ...ws.panes.secondary.tabIds];
          const activeTabId =
            ws.activePaneId === "secondary"
              ? ws.panes.secondary.activeTabId
              : ws.panes.primary.activeTabId;

          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [cwd]: {
                ...ws,
                hasSplit: false,
                activePaneId: "primary",
                panes: {
                  primary: { tabIds: mergedTabIds, activeTabId },
                  secondary: { tabIds: [], activeTabId: null },
                },
              },
            },
          };
        });
      },

      setActivePaneId: (paneId, cwd) => {
        set((state) => {
          const ws = state.workspaceStatesByCwd[cwd];
          if (!ws) return state;
          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [cwd]: { ...ws, activePaneId: paneId },
            },
          };
        });
      },

      toggleDirectory: (cwd, dirPath) => {
        set((state) => {
          const ws = getOrCreateWorkspaceState(state.workspaceStatesByCwd, cwd);
          const isExpanded = ws.expandedDirs.includes(dirPath);
          const newExpandedDirs = isExpanded
            ? ws.expandedDirs.filter((d) => d !== dirPath && !d.startsWith(`${dirPath}/`))
            : [...ws.expandedDirs, dirPath];
          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [cwd]: { ...ws, expandedDirs: newExpandedDirs },
            },
          };
        });
      },

      setTreeWidth: (cwd, width) => {
        set((state) => {
          const ws = getOrCreateWorkspaceState(state.workspaceStatesByCwd, cwd);
          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [cwd]: { ...ws, treeWidth: width },
            },
          };
        });
      },

      // ── Combined actions ─────────────────────────────────────────────────

      openFileAtLine: (cwd, relativePath, line, column, targetPane) => {
        const { openFile, revealFileInTree, setPendingRevealPath, setPendingScrollTarget } = get();
        openFile(cwd, relativePath, targetPane);
        revealFileInTree(cwd, relativePath);
        setPendingRevealPath(cwd, relativePath);
        if (line != null && line > 0) {
          const tabId = makeTabId(cwd, relativePath);
          setPendingScrollTarget(tabId, { line, column });
        }
      },

      // ── Tree reveal ─────────────────────────────────────────────────────

      revealFileInTree: (cwd, relativePath) => {
        set((state) => {
          const ws = getOrCreateWorkspaceState(state.workspaceStatesByCwd, cwd);
          const parts = relativePath.split("/");
          const ancestorDirs: string[] = [];
          for (let i = 1; i < parts.length; i++) {
            ancestorDirs.push(parts.slice(0, i).join("/"));
          }
          const currentSet = new Set(ws.expandedDirs);
          let changed = false;
          for (const dir of ancestorDirs) {
            if (!currentSet.has(dir)) {
              currentSet.add(dir);
              changed = true;
            }
          }
          if (!changed) return state;
          return {
            workspaceStatesByCwd: {
              ...state.workspaceStatesByCwd,
              [cwd]: { ...ws, expandedDirs: Array.from(currentSet) },
            },
          };
        });
      },

      setPendingRevealPath: (cwd, relativePath) => {
        set((state) => ({
          pendingRevealPathByCwd: { ...state.pendingRevealPathByCwd, [cwd]: relativePath },
        }));
      },

      clearPendingRevealPath: (cwd) => {
        set((state) => {
          const next = { ...state.pendingRevealPathByCwd };
          delete next[cwd];
          return { pendingRevealPathByCwd: next };
        });
      },

      // ── Scroll target ──────────────────────────────────────────────────

      setPendingScrollTarget: (tabId, target) => {
        set((state) => ({
          pendingScrollTargetByTabId: { ...state.pendingScrollTargetByTabId, [tabId]: target },
        }));
      },

      clearPendingScrollTarget: (tabId) => {
        set((state) => {
          const next = { ...state.pendingScrollTargetByTabId };
          delete next[tabId];
          return { pendingScrollTargetByTabId: next };
        });
      },

      // ── Runtime-only ──────────────────────────────────────────────────────

      initTabContent: (tabId, content) => {
        set((state) => ({
          runtimeTabStateByTabId: {
            ...state.runtimeTabStateByTabId,
            [tabId]: { currentContent: content, savedContent: content, isDirty: false },
          },
        }));
      },

      setTabCurrentContent: (tabId, content) => {
        set((state) => {
          const existing = state.runtimeTabStateByTabId[tabId];
          if (!existing) return state;
          return {
            runtimeTabStateByTabId: {
              ...state.runtimeTabStateByTabId,
              [tabId]: {
                ...existing,
                currentContent: content,
                isDirty: content !== existing.savedContent,
              },
            },
          };
        });
      },

      markTabSaved: (tabId) => {
        set((state) => {
          const existing = state.runtimeTabStateByTabId[tabId];
          if (!existing) return state;
          return {
            runtimeTabStateByTabId: {
              ...state.runtimeTabStateByTabId,
              [tabId]: {
                ...existing,
                savedContent: existing.currentContent,
                isDirty: false,
              },
            },
          };
        });
      },

      clearTabRuntime: (tabId) => {
        set((state) => {
          const newRuntime = { ...state.runtimeTabStateByTabId };
          delete newRuntime[tabId];
          return { runtimeTabStateByTabId: newRuntime };
        });
      },
    }),
    {
      name: FILE_EXPLORER_STORE_KEY,
      version: FILE_EXPLORER_STORE_VERSION,
      storage: createJSONStorage(createFileExplorerStorage),
      partialize: (state) => ({
        workspaceStatesByCwd: state.workspaceStatesByCwd,
      }),
      migrate: (_state, _version) => {
        // Future migrations go here
        return { workspaceStatesByCwd: {} };
      },
    },
  ),
);

// ─── Selectors ────────────────────────────────────────────────────────────────

export function selectWorkspaceState(
  state: FileExplorerStoreState,
  cwd: string,
): WorkspaceEditorState {
  return state.workspaceStatesByCwd[cwd] ?? DEFAULT_WORKSPACE_STATE;
}

export function selectActiveTab(
  state: FileExplorerStoreState,
  cwd: string,
  paneId: PaneId,
): FileTab | null {
  const ws = selectWorkspaceState(state, cwd);
  const activeTabId = ws.panes[paneId].activeTabId;
  if (!activeTabId) return null;
  return ws.tabsById[activeTabId] ?? null;
}

export function makeTabIdFromPath(cwd: string, relativePath: string): string {
  return makeTabId(cwd, relativePath);
}
