import { ArchiveIcon, PlayIcon, Trash2Icon, XIcon } from "lucide-react";

import { Button } from "../ui/button";

interface KanbanSelectionBarProps {
  selectedCount: number;
  onOrchestrate: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export function KanbanSelectionBar({
  selectedCount,
  onOrchestrate,
  onArchive,
  onDelete,
  onClear,
}: KanbanSelectionBarProps) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-4"
      data-ticket-selectable
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-popover px-2 py-1.5 shadow-lg transition-all duration-200 data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0">
        <span className="pl-2 text-xs font-medium tabular-nums text-foreground">
          {selectedCount} selected
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 rounded-full px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2Icon className="size-3" />
          Delete
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 rounded-full px-3 text-xs"
          onClick={onArchive}
        >
          <ArchiveIcon className="size-3" />
          Archive
        </Button>
        <Button size="sm" className="h-7 gap-1.5 rounded-full px-3 text-xs" onClick={onOrchestrate}>
          <PlayIcon className="size-3" />
          Orchestrate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 rounded-full p-0"
          onClick={onClear}
          aria-label="Clear selection"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
