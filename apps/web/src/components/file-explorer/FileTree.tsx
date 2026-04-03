import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { fileExplorerDirQueryOptions } from "~/lib/fileExplorerReactQuery";
import { useFileExplorerStore, selectWorkspaceState, type PaneId } from "~/fileExplorerStore";

import { FileTreeNodeList } from "./FileTreeNodeList";
import { type TreeNode } from "./FileTreeNode";

const MIN_TREE_WIDTH = 160;
const MAX_TREE_WIDTH = 500;

interface FileTreeProps {
  cwd: string;
  activePaneId: PaneId;
  activeTabPath: string | null;
  modifiedPaths: Set<string>;
}

export function FileTree({ cwd, activePaneId, activeTabPath, modifiedPaths }: FileTreeProps) {
  const ws = useFileExplorerStore((s) => selectWorkspaceState(s, cwd));
  const { expandedDirs, treeWidth } = ws;
  const { toggleDirectory, openFile, setTreeWidth } = useFileExplorerStore();

  // ── Subscribe to root dir + all expanded dirs reactively ─────────────────
  // useQueries makes the component re-render whenever any directory data
  // arrives, so the flat nodes list always reflects the latest cache state.
  const dirPaths = useMemo(() => ["", ...expandedDirs], [expandedDirs]);

  const dirResults = useQueries({
    queries: dirPaths.map((path) => fileExplorerDirQueryOptions({ cwd, path })),
  });

  // ── Build flat visible node array from query results ──────────────────────
  const nodes = useMemo<TreeNode[]>(() => {
    // Build a lookup: dirPath → entries array
    const dirDataByPath = new Map<
      string,
      Array<{ name: string; path: string; kind: "file" | "directory" }>
    >();
    for (let i = 0; i < dirPaths.length; i++) {
      const data = dirResults[i]?.data;
      if (data)
        dirDataByPath.set(
          dirPaths[i] ?? "",
          data.entries as Array<{ name: string; path: string; kind: "file" | "directory" }>,
        );
    }

    const result: TreeNode[] = [];

    function addChildren(parentPath: string, depth: number) {
      const entries = dirDataByPath.get(parentPath);
      if (!entries) return;

      for (const entry of entries) {
        const isExpanded = expandedDirs.includes(entry.path);
        const node: TreeNode = {
          id: entry.path,
          kind: entry.kind,
          name: entry.name,
          depth,
          isGitModified: modifiedPaths.has(entry.path),
        };
        if (entry.kind === "directory") {
          node.isExpanded = isExpanded;
        }
        result.push(node);
        if (entry.kind === "directory" && isExpanded) {
          addChildren(entry.path, depth + 1);
        }
      }
    }

    addChildren("", 0);
    return result;
  }, [dirPaths, dirResults, expandedDirs, modifiedPaths]);

  // ── Node click handler ────────────────────────────────────────────────────
  const handleNodeClick = useCallback(
    (node: TreeNode) => {
      if (node.kind === "directory") {
        toggleDirectory(cwd, node.id);
      } else {
        openFile(cwd, node.id, activePaneId);
      }
    },
    [cwd, openFile, toggleDirectory, activePaneId],
  );

  // ── Resizable handle ──────────────────────────────────────────────────────
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = treeWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = ev.clientX - startXRef.current;
        const newWidth = Math.max(
          MIN_TREE_WIDTH,
          Math.min(MAX_TREE_WIDTH, startWidthRef.current + delta),
        );
        setTreeWidth(cwd, newWidth);
      };

      const onMouseUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [cwd, treeWidth, setTreeWidth],
  );

  return (
    <div
      className="relative flex min-h-0 flex-col border-r border-border bg-background"
      style={{ width: treeWidth, flexShrink: 0 }}
    >
      {/* Tree header */}
      <div className="flex h-8 shrink-0 items-center px-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Files
        </span>
      </div>

      {/* Virtual node list */}
      <FileTreeNodeList
        nodes={nodes}
        activeTabPath={activeTabPath}
        cwd={cwd}
        onNodeClick={handleNodeClick}
      />

      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/40 active:bg-primary/60"
        onMouseDown={handleMouseDown}
        aria-hidden
      />
    </div>
  );
}
