import { Settings2Icon, XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";

interface FileExplorerToolbarProps {
  /** Relative path of the active file, if any */
  activeFilePath: string | null;
  /** Whether the active file is markdown (shows RAW/Preview toggle) */
  isMarkdown: boolean;
  /** Current markdown view mode */
  markdownViewMode: "raw" | "preview";
  onMarkdownViewModeChange: (mode: "raw" | "preview") => void;
  /** Whether the settings panel is currently open */
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  onClose: () => void;
}

export function FileExplorerToolbar({
  activeFilePath,
  isMarkdown,
  markdownViewMode,
  onMarkdownViewModeChange,
  isSettingsOpen,
  onToggleSettings,
  onClose,
}: FileExplorerToolbarProps) {
  // Build breadcrumb from path
  const breadcrumbParts = activeFilePath ? activeFilePath.split("/").filter(Boolean) : [];

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      {/* Breadcrumb */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {breadcrumbParts.length > 0 && !isSettingsOpen ? (
          <span className="truncate text-xs text-muted-foreground" title={activeFilePath ?? ""}>
            {breadcrumbParts.map((part, i) => (
              <span key={i}>
                {i > 0 && <span className="mx-0.5 text-muted-foreground/40">/</span>}
                <span
                  className={cn(
                    i === breadcrumbParts.length - 1
                      ? "text-foreground"
                      : "text-muted-foreground/60",
                  )}
                >
                  {part}
                </span>
              </span>
            ))}
          </span>
        ) : (
          <span className="text-sm font-medium text-foreground">
            {isSettingsOpen ? "Editor Settings" : "Explorer"}
          </span>
        )}
      </div>

      {/* Markdown RAW/Preview toggle — only shown for .md files when settings is closed */}
      {isMarkdown && !isSettingsOpen && (
        <ToggleGroup
          variant="outline"
          size="xs"
          value={[markdownViewMode]}
          onValueChange={(values) => {
            const v = values[0];
            if (v === "raw" || v === "preview") onMarkdownViewModeChange(v);
          }}
        >
          <Toggle value="raw" aria-label="Raw view">
            <span className="text-[11px]">RAW</span>
          </Toggle>
          <Toggle value="preview" aria-label="Preview">
            <span className="text-[11px]">Preview</span>
          </Toggle>
        </ToggleGroup>
      )}

      {/* Settings button — left of close */}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={isSettingsOpen ? "Close editor settings" : "Open editor settings"}
        onClick={onToggleSettings}
        className={cn(isSettingsOpen && "bg-accent text-accent-foreground")}
      >
        <Settings2Icon className="size-3" />
      </Button>

      {/* Close button */}
      <Button variant="ghost" size="icon-xs" aria-label="Close file explorer" onClick={onClose}>
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}
