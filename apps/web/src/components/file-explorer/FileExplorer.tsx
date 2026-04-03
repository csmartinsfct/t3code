/**
 * FileExplorer — root component for the file explorer + editor panel.
 *
 * Hosts the DndContext for all drag-and-drop within the panel.
 * Wires Cmd+S (save), Cmd+W (close tab), and git status.
 */
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { gitStatusQueryOptions } from "~/lib/gitReactQuery";
import { fileExplorerReadFileQueryOptions } from "~/lib/fileExplorerReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { useFileExplorerStore, selectActiveTab, selectWorkspaceState } from "~/fileExplorerStore";
import type { PaneId } from "~/fileExplorerStore";

import type { FileExplorerPanelMode } from "../FileExplorerPanelShell";
import { FileTree } from "./FileTree";
import { FileEditorArea } from "./FileEditorArea";
import { FileExplorerToolbar } from "./FileExplorerToolbar";
import { FileSearchModal } from "./FileSearchModal";
import { FileExplorerSettingsPanel } from "./FileExplorerSettingsPanel";

export interface FileExplorerProps {
  cwd: string;
  mode: FileExplorerPanelMode;
  onClose: () => void;
}

export default function FileExplorer({ cwd, mode: _mode, onClose }: FileExplorerProps) {
  const queryClient = useQueryClient();

  // ── Store ─────────────────────────────────────────────────────────────────
  const ws = useFileExplorerStore((s) => selectWorkspaceState(s, cwd));
  const { activePaneId } = ws;
  const activeTab = useFileExplorerStore((s) => selectActiveTab(s, cwd, activePaneId));
  const runtime = useFileExplorerStore((s) =>
    activeTab ? s.runtimeTabStateByTabId[activeTab.id] : undefined,
  );
  const { openFile, closeTab, createSplit, moveTabToPane, reorderTabsInPane, markTabSaved } =
    useFileExplorerStore();

  // ── File search (Cmd+P) ───────────────────────────────────────────────────
  const [isFileSearchOpen, setIsFileSearchOpen] = useState(false);
  // ── Settings panel ────────────────────────────────────────────────────────
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Root container ref — used for focus detection in the capture-phase handler
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Markdown view mode (local — not persisted) ────────────────────────────
  const [markdownViewMode, setMarkdownViewMode] = useState<"raw" | "preview">("raw");
  // Reset markdown view mode when active tab changes
  const prevTabIdRef = useRef<string | null>(null);
  if (activeTab?.id !== prevTabIdRef.current) {
    prevTabIdRef.current = activeTab?.id ?? null;
    // Only reset if changing to a different file
    if (activeTab) setMarkdownViewMode("raw");
  }

  // ── Git status ────────────────────────────────────────────────────────────
  const gitStatusQuery = useQuery(gitStatusQueryOptions(cwd));
  const modifiedPaths = useMemo(
    () => new Set<string>(gitStatusQuery.data?.workingTree.files.map((f) => f.path) ?? []),
    [gitStatusQuery.data],
  );

  // ── DnD sensors ──────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null);
      const { active, over } = event;
      if (!over) return;

      const activeId = String(active.id);
      const overId = String(over.id);
      const draggableType = active.data.current?.type as string | undefined;

      // ── Drop on split zone ────────────────────────────────────────────────
      if (overId === "split-zone-left" || overId === "split-zone-right") {
        const splitSide = overId === "split-zone-left" ? "left" : "right";
        const targetPane: PaneId = splitSide === "left" ? "primary" : "secondary";
        if (!ws.hasSplit) {
          if (draggableType === "tab") {
            const fromPane = active.data.current?.paneId as PaneId;
            createSplit(splitSide, activeId, cwd);
            if (fromPane !== targetPane) {
              moveTabToPane(activeId, fromPane, targetPane, undefined, cwd);
            }
          } else if (draggableType === "file-tree-node") {
            const { relativePath } = active.data.current as { relativePath: string };
            createSplit(splitSide, undefined, cwd);
            openFile(cwd, relativePath, targetPane);
          }
        }
        return;
      }

      // ── Drop on tab bar (cross-pane or open in pane) ──────────────────────
      if (overId.startsWith("tab-bar-")) {
        const targetPane = overId.replace("tab-bar-", "") as PaneId;
        if (draggableType === "tab") {
          const fromPane = active.data.current?.paneId as PaneId;
          if (fromPane !== targetPane) {
            moveTabToPane(activeId, fromPane, targetPane, undefined, cwd);
          }
        } else if (draggableType === "file-tree-node") {
          const { relativePath } = active.data.current as { relativePath: string };
          openFile(cwd, relativePath, targetPane);
        }
        return;
      }

      // ── Tab reorder within same pane ──────────────────────────────────────
      if (draggableType === "tab") {
        const fromPane = active.data.current?.paneId as PaneId;
        const overPaneId = over.data.current?.paneId as PaneId | undefined;
        const samePane = overPaneId === fromPane;
        if (samePane && activeId !== overId) {
          const pane = ws.panes[fromPane];
          const oldIdx = pane.tabIds.indexOf(activeId);
          const newIdx = pane.tabIds.indexOf(overId);
          if (oldIdx !== -1 && newIdx !== -1) {
            reorderTabsInPane(fromPane, arrayMove(pane.tabIds, oldIdx, newIdx), cwd);
          }
        }
      }
    },
    [ws, cwd, createSplit, moveTabToPane, openFile, reorderTabsInPane],
  );

  // ── Cmd+P — capture phase so we win over ChatView's bubble handler ────────
  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const captureHandler = (e: KeyboardEvent) => {
      const meta = isMac ? e.metaKey : e.ctrlKey;
      if (!meta || e.key !== "p" || e.shiftKey || e.altKey) return;

      // Only intercept when focus is inside this panel, or the search is already open
      const withinExplorer =
        containerRef.current?.contains(document.activeElement as Node) ?? false;
      if (!withinExplorer && !isFileSearchOpen) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      setIsFileSearchOpen(true);
    };
    window.addEventListener("keydown", captureHandler, true);
    return () => window.removeEventListener("keydown", captureHandler, true);
  }, [isFileSearchOpen]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes("mac");

    const handler = (e: KeyboardEvent) => {
      const meta = isMac ? e.metaKey : e.ctrlKey;

      // Cmd+S — save active file
      if (meta && e.key === "s" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (!activeTab || !runtime) return;
        const api = ensureNativeApi();
        const content = runtime.currentContent;
        api.projects
          .writeFile({ cwd, relativePath: activeTab.relativePath, contents: content })
          .then(() => {
            markTabSaved(activeTab.id);
            // Invalidate file cache
            void queryClient.invalidateQueries({
              queryKey: fileExplorerReadFileQueryOptions({
                cwd,
                relativePath: activeTab.relativePath,
              }).queryKey,
            });
          })
          .catch(console.error);
        return;
      }

      // Cmd+W — close active tab
      if (meta && e.key === "w" && !e.shiftKey && !e.altKey) {
        if (!activeTab) return;
        e.preventDefault();
        closeTab(activeTab.id);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, cwd, runtime, closeTab, markTabSaved, queryClient]);

  // ── Active file path for toolbar breadcrumb ───────────────────────────────
  const activeFilePath = activeTab?.relativePath ?? null;
  const isMd = activeFilePath
    ? ["md", "mdx", "mdc"].includes(activeFilePath.split(".").pop()?.toLowerCase() ?? "")
    : false;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const pointer = pointerWithin(args);
        return pointer.length > 0 ? pointer : closestCenter(args);
      }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div ref={containerRef} className="flex h-full min-w-0 flex-col">
        {/* Cmd+P file search */}
        <FileSearchModal
          cwd={cwd}
          open={isFileSearchOpen}
          onOpenChange={setIsFileSearchOpen}
          onSelectFile={(relativePath) => {
            openFile(cwd, relativePath, activePaneId);
          }}
        />

        {/* Toolbar / header */}
        <FileExplorerToolbar
          activeFilePath={activeFilePath}
          isMarkdown={isMd}
          markdownViewMode={markdownViewMode}
          onMarkdownViewModeChange={setMarkdownViewMode}
          isSettingsOpen={isSettingsOpen}
          onToggleSettings={() => setIsSettingsOpen((v) => !v)}
          onClose={onClose}
        />

        {/* Main content: settings panel OR tree + editor */}
        <div className="flex min-h-0 flex-1">
          {isSettingsOpen ? (
            <FileExplorerSettingsPanel />
          ) : (
            <>
              <FileTree
                cwd={cwd}
                activePaneId={activePaneId}
                activeTabPath={activeTab?.relativePath ?? null}
                modifiedPaths={modifiedPaths}
              />
              <FileEditorArea
                cwd={cwd}
                modifiedPaths={modifiedPaths}
                markdownViewMode={markdownViewMode}
                onMarkdownViewModeChange={setMarkdownViewMode}
              />
            </>
          )}
        </div>
      </div>

      {/* DragOverlay: ghost element while dragging */}
      <DragOverlay>
        {draggingId ? (
          <div className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground shadow-md opacity-80">
            {draggingId.includes("::")
              ? draggingId.split("::")[1]?.split("/").pop()
              : draggingId.startsWith("tree-node-")
                ? draggingId.replace("tree-node-", "").split("/").pop()
                : draggingId}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
