import { useDndMonitor } from "@dnd-kit/core";
import { useCallback, useRef, useState } from "react";

import { useFileExplorerStore, selectWorkspaceState } from "~/fileExplorerStore";
import type { PaneId } from "~/fileExplorerStore";

import { EditorPane } from "./EditorPane";
import { SplitDropZones } from "./SplitDropZones";

const MIN_PANE_PERCENT = 20; // neither pane can go below 20% width

interface FileEditorAreaProps {
  cwd: string;
  modifiedPaths: Set<string>;
  markdownViewMode: "raw" | "preview";
  onMarkdownViewModeChange: (mode: "raw" | "preview") => void;
}

export function FileEditorArea({
  cwd,
  modifiedPaths,
  markdownViewMode,
  onMarkdownViewModeChange,
}: FileEditorAreaProps) {
  const ws = useFileExplorerStore((s) => selectWorkspaceState(s, cwd));
  const { hasSplit, activePaneId } = ws;
  const { setActivePaneId } = useFileExplorerStore();

  // Percentage width of the primary pane (0-100); secondary gets the rest.
  const [splitPercent, setSplitPercent] = useState(50);

  // Track whether a file/tab drag is in progress to show drop zones.
  const [isDragging, setIsDragging] = useState(false);
  useDndMonitor({
    onDragStart: () => setIsDragging(true),
    onDragEnd: () => setIsDragging(false),
    onDragCancel: () => setIsDragging(false),
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const percent = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.max(MIN_PANE_PERCENT, Math.min(100 - MIN_PANE_PERCENT, percent)));
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  const handlePaneFocus = (paneId: PaneId) => {
    if (activePaneId !== paneId) setActivePaneId(paneId, cwd);
  };

  return (
    <div ref={containerRef} className="relative flex min-h-0 min-w-0 flex-1">
      {/* Drop zones shown during file/tab drag (only when not already split) */}
      {isDragging && !hasSplit && <SplitDropZones />}

      {hasSplit ? (
        <>
          {/* Primary pane */}
          <div style={{ width: `${splitPercent}%` }} className="flex min-h-0 min-w-0 flex-col">
            <EditorPane
              cwd={cwd}
              paneId="primary"
              modifiedPaths={modifiedPaths}
              markdownViewMode={activePaneId === "primary" ? markdownViewMode : "raw"}
              onMarkdownViewModeChange={
                activePaneId === "primary" ? onMarkdownViewModeChange : () => {}
              }
              onFocus={() => handlePaneFocus("primary")}
            />
          </div>

          {/* Draggable divider */}
          <div
            className="group relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-border transition-colors hover:bg-primary/50 active:bg-primary/70"
            onMouseDown={handleDividerMouseDown}
            aria-hidden
          >
            {/* Visual grab indicator */}
            <div className="absolute h-8 w-1 rounded-full bg-border group-hover:bg-primary/60" />
          </div>

          {/* Secondary pane */}
          <div
            style={{ width: `${100 - splitPercent}%` }}
            className="flex min-h-0 min-w-0 flex-col"
          >
            <EditorPane
              cwd={cwd}
              paneId="secondary"
              modifiedPaths={modifiedPaths}
              markdownViewMode={activePaneId === "secondary" ? markdownViewMode : "raw"}
              onMarkdownViewModeChange={
                activePaneId === "secondary" ? onMarkdownViewModeChange : () => {}
              }
              onFocus={() => handlePaneFocus("secondary")}
            />
          </div>
        </>
      ) : (
        <EditorPane
          cwd={cwd}
          paneId="primary"
          modifiedPaths={modifiedPaths}
          markdownViewMode={markdownViewMode}
          onMarkdownViewModeChange={onMarkdownViewModeChange}
          onFocus={() => handlePaneFocus("primary")}
        />
      )}
    </div>
  );
}
