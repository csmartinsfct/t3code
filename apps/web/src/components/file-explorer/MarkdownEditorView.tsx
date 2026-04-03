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
    />
  );
}
