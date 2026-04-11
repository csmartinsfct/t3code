import { beforeEach, describe, expect, it } from "vitest";

import { makeTabIdFromPath, selectWorkspaceState, useFileExplorerStore } from "./fileExplorerStore";

const CWD = "/repo/project";

function resetFileExplorerStore() {
  useFileExplorerStore.setState({
    workspaceStatesByCwd: {},
    runtimeTabStateByTabId: {},
    pendingScrollTargetByTabId: {},
    pendingRevealPathByCwd: {},
  });
}

describe("fileExplorerStore", () => {
  beforeEach(() => {
    resetFileExplorerStore();
  });

  it("opens file links at line and column while revealing ancestor directories", () => {
    // Audit traceability: 216652d, aba3612.
    useFileExplorerStore.getState().openFileAtLine(CWD, "docs/guides/setup.md", 27, 4, "primary");

    const state = useFileExplorerStore.getState();
    const workspace = selectWorkspaceState(state, CWD);
    const tabId = makeTabIdFromPath(CWD, "docs/guides/setup.md");

    expect(workspace.activePaneId).toBe("primary");
    expect(workspace.panes.primary.activeTabId).toBe(tabId);
    expect(workspace.panes.primary.tabIds).toEqual([tabId]);
    expect(workspace.expandedDirs).toEqual(["docs", "docs/guides"]);
    expect(state.pendingRevealPathByCwd[CWD]).toBe("docs/guides/setup.md");
    expect(state.pendingScrollTargetByTabId[tabId]).toEqual({ line: 27, column: 4 });
  });

  it("reveals already-open tabs in their existing pane instead of duplicating them", () => {
    const store = useFileExplorerStore.getState();
    store.openFile(CWD, "src/app.ts", "primary");

    const tabId = makeTabIdFromPath(CWD, "src/app.ts");
    store.createSplit("right", tabId, CWD);

    let workspace = selectWorkspaceState(useFileExplorerStore.getState(), CWD);
    expect(workspace.hasSplit).toBe(true);
    expect(workspace.panes.secondary.tabIds).toEqual([tabId]);
    expect(workspace.panes.primary.tabIds).toEqual([]);

    store.openFileAtLine(CWD, "src/app.ts", 9, 2, "primary");

    const state = useFileExplorerStore.getState();
    workspace = selectWorkspaceState(state, CWD);

    expect(workspace.activePaneId).toBe("secondary");
    expect(workspace.panes.primary.tabIds).toEqual([]);
    expect(workspace.panes.secondary.tabIds).toEqual([tabId]);
    expect(workspace.panes.secondary.activeTabId).toBe(tabId);
    expect(state.pendingRevealPathByCwd[CWD]).toBe("src/app.ts");
    expect(state.pendingScrollTargetByTabId[tabId]).toEqual({ line: 9, column: 2 });
  });

  it("merges tabs back into the primary pane when closing a split", () => {
    const store = useFileExplorerStore.getState();
    store.openFile(CWD, "src/app.ts", "primary");
    store.openFile(CWD, "README.md", "primary");

    const primaryTabId = makeTabIdFromPath(CWD, "README.md");
    store.createSplit("right", primaryTabId, CWD);
    store.openFile(CWD, "docs/guide.md", "secondary");

    store.closeSplit(CWD);

    const workspace = selectWorkspaceState(useFileExplorerStore.getState(), CWD);

    expect(workspace.hasSplit).toBe(false);
    expect(workspace.activePaneId).toBe("primary");
    expect(workspace.panes.secondary.tabIds).toEqual([]);
    expect(workspace.panes.primary.tabIds).toEqual([
      makeTabIdFromPath(CWD, "src/app.ts"),
      makeTabIdFromPath(CWD, "README.md"),
      makeTabIdFromPath(CWD, "docs/guide.md"),
    ]);
  });
});
