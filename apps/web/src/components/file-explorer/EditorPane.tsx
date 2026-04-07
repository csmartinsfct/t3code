import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import { fileExplorerReadFileQueryOptions } from "~/lib/fileExplorerReactQuery";
import { useFileExplorerStore, selectWorkspaceState, selectActiveTab } from "~/fileExplorerStore";
import type { PaneId } from "~/fileExplorerStore";
import { useFileExplorerEditorSettingsStore } from "~/fileExplorerEditorSettingsStore";

import { TabBar } from "./TabBar";
import { CodeEditorView } from "./CodeEditorView";
import { MarkdownEditorView } from "./MarkdownEditorView";

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "mdc"]);

function isMarkdownFile(relativePath: string): boolean {
  const ext = relativePath.split(".").pop()?.toLowerCase() ?? "";
  return MARKDOWN_EXTENSIONS.has(ext);
}

function isBinaryContent(content: string): boolean {
  // Heuristic: if >5% of the first 512 chars are null/non-printable bytes, it's binary
  const sample = content.slice(0, 512);
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      nonPrintable++;
    }
  }
  return nonPrintable > sample.length * 0.05;
}

interface EditorPaneProps {
  cwd: string;
  paneId: PaneId;
  modifiedPaths: Set<string>;
  markdownViewMode: "raw" | "preview";
  onMarkdownViewModeChange: (mode: "raw" | "preview") => void;
  onFocus: () => void;
}

export function EditorPane({
  cwd,
  paneId,
  modifiedPaths,
  markdownViewMode,
  onMarkdownViewModeChange,
  onFocus,
}: EditorPaneProps) {
  const ws = useFileExplorerStore((s) => selectWorkspaceState(s, cwd));
  const activeTab = useFileExplorerStore((s) => selectActiveTab(s, cwd, paneId));
  const runtime = useFileExplorerStore((s) =>
    activeTab ? s.runtimeTabStateByTabId[activeTab.id] : undefined,
  );
  const { initTabContent, setTabCurrentContent, clearPendingScrollTarget } = useFileExplorerStore();
  const pendingScroll = useFileExplorerStore((s) =>
    activeTab ? s.pendingScrollTargetByTabId[activeTab.id] : undefined,
  );
  const editorSettings = useFileExplorerEditorSettingsStore((s) => s.settings);

  // Load file content
  const fileQuery = useQuery(
    fileExplorerReadFileQueryOptions({
      cwd: activeTab ? cwd : null,
      relativePath: activeTab?.relativePath ?? null,
    }),
  );

  // Initialize runtime content when file loads
  const tabId = activeTab?.id ?? null;
  const fetchedContent = fileQuery.data?.contents ?? null;

  // Track which tab we've already initialized so we only call initTabContent once per tab load.
  // Using a ref avoids causing re-renders and eliminates the setState-during-render issue.
  const initializedTabIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (tabId && fetchedContent !== null && initializedTabIdRef.current !== tabId) {
      initializedTabIdRef.current = tabId;
      initTabContent(tabId, fetchedContent);
    }
  }, [fetchedContent, initTabContent, tabId]);

  const handleContentChange = useCallback(
    (content: string) => {
      if (tabId) setTabCurrentContent(tabId, content);
    },
    [tabId, setTabCurrentContent],
  );

  // Consume and clear the pending scroll target after a frame
  const scrollLine = pendingScroll?.line;
  const scrollColumn = pendingScroll?.column;
  useEffect(() => {
    if (pendingScroll && activeTab) {
      const raf = requestAnimationFrame(() => {
        clearPendingScrollTarget(activeTab.id);
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [pendingScroll, activeTab, clearPendingScrollTarget]);

  const isMd = activeTab ? isMarkdownFile(activeTab.relativePath) : false;
  const currentContent = runtime?.currentContent ?? fetchedContent ?? "";
  const initialContent = fetchedContent ?? "";
  const isBinary = fetchedContent !== null && isBinaryContent(fetchedContent);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" onClick={onFocus}>
      <TabBar cwd={cwd} paneId={paneId} modifiedPaths={modifiedPaths} />

      {/* Editor content area */}
      <div className="relative flex min-h-0 flex-1">
        {!activeTab ? (
          // Empty pane state
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-muted-foreground">
              Drop a file here or click one in the tree
            </span>
          </div>
        ) : fileQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : fileQuery.isError ? (
          <div className="flex flex-1 items-center justify-center px-4">
            <span className="text-center text-sm text-destructive-foreground">
              {fileQuery.error instanceof Error ? fileQuery.error.message : "Failed to load file"}
            </span>
          </div>
        ) : isBinary ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-muted-foreground">Cannot preview binary file</span>
          </div>
        ) : isMd ? (
          <MarkdownEditorView
            tabId={activeTab.id}
            cwd={cwd}
            relativePath={activeTab.relativePath}
            initialContent={initialContent}
            viewMode={markdownViewMode}
            currentContent={currentContent}
            settings={editorSettings}
            onContentChange={handleContentChange}
            initialLine={scrollLine}
            initialColumn={scrollColumn}
          />
        ) : (
          <CodeEditorView
            tabId={activeTab.id}
            cwd={cwd}
            relativePath={activeTab.relativePath}
            initialContent={initialContent}
            settings={editorSettings}
            onContentChange={handleContentChange}
            initialLine={scrollLine}
            initialColumn={scrollColumn}
          />
        )}
      </div>
    </div>
  );
}

export { isMarkdownFile };
