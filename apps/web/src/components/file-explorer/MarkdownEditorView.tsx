import type { FileExplorerEditorSettings } from "~/fileExplorerEditorSettingsStore";
import { CodeEditorView } from "./CodeEditorView";
import { MarkdownPreview } from "./MarkdownPreview";

interface MarkdownEditorViewProps {
  tabId: string;
  cwd: string;
  relativePath: string;
  initialContent: string;
  viewMode: "raw" | "preview";
  currentContent: string;
  settings: FileExplorerEditorSettings;
  onContentChange: (content: string) => void;
  initialLine?: number | undefined;
  initialColumn?: number | undefined;
}

export function MarkdownEditorView({
  tabId,
  cwd,
  relativePath,
  initialContent,
  viewMode,
  currentContent,
  settings,
  onContentChange,
  initialLine,
  initialColumn,
}: MarkdownEditorViewProps) {
  if (viewMode === "preview") {
    return <MarkdownPreview content={currentContent} />;
  }

  return (
    <CodeEditorView
      tabId={tabId}
      cwd={cwd}
      relativePath={relativePath}
      initialContent={initialContent}
      settings={settings}
      onContentChange={onContentChange}
      initialLine={initialLine}
      initialColumn={initialColumn}
    />
  );
}
