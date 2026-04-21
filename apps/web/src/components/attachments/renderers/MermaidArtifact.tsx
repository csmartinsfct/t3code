import { Trash2Icon } from "lucide-react";

import type { AttachmentRendererProps } from "./index";

interface MermaidPayloadShape {
  readonly source?: string;
}

export function MermaidArtifact({ artifact, onDelete }: AttachmentRendererProps) {
  const payload = (artifact.payload ?? {}) as MermaidPayloadShape;
  const preview = (payload.source ?? "").split("\n").slice(0, 3).join("\n");
  return (
    <div className="group relative flex flex-col gap-1 overflow-hidden rounded-md border border-border bg-muted/30 p-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
          mermaid
        </span>
        <span className="truncate font-medium">{artifact.title ?? "Diagram"}</span>
      </div>
      {preview ? (
        <pre className="overflow-hidden truncate rounded bg-background/60 p-1.5 text-[11px] text-muted-foreground">
          {preview}
        </pre>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          onClick={onDelete}
          aria-label="Delete diagram"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
