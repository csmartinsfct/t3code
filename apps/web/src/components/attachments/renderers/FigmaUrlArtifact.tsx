import { ExternalLinkIcon, Trash2Icon } from "lucide-react";

import type { AttachmentRendererProps } from "./index";

interface FigmaUrlPayloadShape {
  readonly url?: string;
  readonly nodeId?: string;
}

export function FigmaUrlArtifact({ artifact, onDelete }: AttachmentRendererProps) {
  const payload = (artifact.payload ?? {}) as FigmaUrlPayloadShape;
  const url = typeof payload.url === "string" && payload.url.length > 0 ? payload.url : null;
  return (
    <div className="group relative flex items-center gap-2 overflow-hidden rounded-md border border-border bg-muted/30 p-2 text-xs">
      <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
        figma
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{artifact.title ?? "Figma link"}</span>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="truncate text-[11px] text-primary hover:underline"
          >
            {url}
          </a>
        ) : null}
      </div>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Open in Figma"
        >
          <ExternalLinkIcon className="size-3.5" />
        </a>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          onClick={onDelete}
          aria-label="Delete Figma link"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
