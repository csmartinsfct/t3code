import type { Artifact, MermaidPayload } from "@t3tools/contracts";
import { CheckIcon, Code2Icon, EyeIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ensureNativeApi } from "../../nativeApi";
import { MermaidZoomPanViewer } from "~/components/mermaid/MermaidZoomPanViewer";
import { useMermaidSvg } from "~/components/mermaid/useMermaidSvg";
import { Button } from "../ui/button";

interface MermaidPayloadShape {
  readonly source?: string;
}

function getMermaidSource(artifact: Artifact): string {
  const payload = (artifact.payload ?? {}) as MermaidPayloadShape;
  return typeof payload.source === "string" ? payload.source : "";
}

export function TicketMermaidArtifactView({
  artifact,
  onUpdated,
}: {
  readonly artifact: Artifact;
  readonly onUpdated: (artifact: Artifact) => void;
}) {
  const source = getMermaidSource(artifact);
  const [draft, setDraft] = useState(source);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const title = artifact.title ?? "Mermaid diagram";
  const visibleSource = editing ? draft : source;
  const hasChanges = draft !== source;
  const { svg, error } = useMermaidSvg(visibleSource);

  useEffect(() => {
    setDraft(source);
    setEditing(false);
  }, [artifact.id, source]);

  const save = useCallback(async () => {
    if (!hasChanges || saving) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const payload: MermaidPayload = { source: draft };
      const updated = await ensureNativeApi().ticketing.updateArtifact({
        id: artifact.id,
        payload,
      });
      onUpdated(updated);
      setEditing(false);
    } catch (cause) {
      console.error("Failed to save Mermaid artifact", cause);
    } finally {
      setSaving(false);
    }
  }, [artifact.id, draft, hasChanges, onUpdated, saving]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
              mermaid
            </span>
            <h2 className="truncate text-sm font-medium text-foreground">{title}</h2>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {editing ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  setDraft(source);
                  setEditing(false);
                }}
                disabled={saving}
              >
                <XIcon className="size-3.5" />
                Cancel
              </Button>
              <Button type="button" size="xs" onClick={() => void save()} disabled={saving}>
                <CheckIcon className="size-3.5" />
                {saving ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(true)}>
              <Code2Icon className="size-3.5" />
              Edit
            </Button>
          )}
        </div>
      </div>

      <div
        className={`grid min-h-0 flex-1 ${
          editing
            ? "grid-rows-[minmax(180px,36%)_1fr] lg:grid-cols-[minmax(280px,38%)_1fr] lg:grid-rows-none"
            : ""
        }`}
      >
        {editing ? (
          <div className="flex min-h-0 flex-col border-b border-border bg-muted/20 lg:border-b-0 lg:border-r">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
              <Code2Icon className="size-3.5" />
              Source
            </div>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-5 text-foreground outline-none"
            />
          </div>
        ) : null}

        <div className="flex min-h-0 flex-col">
          {editing ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
              <EyeIcon className="size-3.5" />
              Preview
            </div>
          ) : null}
          <MermaidZoomPanViewer svg={svg} error={error} />
        </div>
      </div>
    </div>
  );
}
