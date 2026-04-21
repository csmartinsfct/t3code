import { Trash2Icon } from "lucide-react";

import type { AttachmentRendererProps } from "./index";

export function UnknownArtifact({ artifact, onDelete }: AttachmentRendererProps) {
  return (
    <div className="group relative flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 p-2 text-xs text-muted-foreground">
      <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase">
        {artifact.type}
      </span>
      <span className="truncate font-medium">{artifact.title ?? "Attachment"}</span>
      {onDelete ? (
        <button
          type="button"
          className="ml-auto rounded p-0.5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          onClick={onDelete}
          aria-label="Delete attachment"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
