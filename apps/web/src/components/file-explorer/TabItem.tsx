import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { XIcon } from "lucide-react";
import { useCallback } from "react";

import { getVscodeIconUrlForEntry } from "~/vscode-icons";
import { useFileExplorerStore } from "~/fileExplorerStore";
import type { FileTab, PaneId } from "~/fileExplorerStore";
import { cn } from "~/lib/utils";
import { useTabContextMenu } from "./TabContextMenu";

interface TabItemProps {
  tab: FileTab;
  paneId: PaneId;
  isActive: boolean;
  isDirty: boolean;
  isGitModified: boolean;
  cwd: string;
  onClick: () => void;
}

export function TabItem({
  tab,
  paneId,
  isActive,
  isDirty,
  isGitModified,
  cwd,
  onClick,
}: TabItemProps) {
  const { closeTab } = useFileExplorerStore();
  const { show: showContextMenu } = useTabContextMenu({ tabId: tab.id, paneId, cwd });

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    data: { type: "tab", tabId: tab.id, paneId },
  });

  const fileName = tab.relativePath.split("/").pop() ?? tab.relativePath;
  const iconUrl = getVscodeIconUrlForEntry(fileName, "file", "dark");

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      closeTab(tab.id);
    },
    [closeTab, tab.id],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      void showContextMenu({ x: e.clientX, y: e.clientY });
    },
    [showContextMenu],
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      className={cn(
        "group flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 border-b-2 px-2 text-xs transition-colors",
        isActive
          ? "border-primary bg-background text-foreground"
          : "border-transparent bg-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick();
      }}
    >
      {/* File icon */}
      <img src={iconUrl} alt="" aria-hidden className="size-3 shrink-0" />

      {/* Filename */}
      <span className={cn("max-w-32 truncate", isGitModified && !isDirty && "text-success")}>
        {fileName}
      </span>

      {/* Dirty indicator OR close button */}
      <span className="relative ml-auto flex size-3.5 shrink-0 items-center justify-center">
        {isDirty ? (
          <span
            className="size-2 rounded-full bg-muted-foreground/60 group-hover:hidden"
            aria-label="Unsaved changes"
          />
        ) : null}
        <button
          type="button"
          aria-label={`Close ${fileName}`}
          className={cn(
            "flex size-3.5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground",
            isDirty ? "hidden group-hover:flex" : "opacity-0 group-hover:opacity-100",
          )}
          onClick={handleClose}
          tabIndex={-1}
        >
          <XIcon className="size-2.5" />
        </button>
      </span>
    </div>
  );
}
