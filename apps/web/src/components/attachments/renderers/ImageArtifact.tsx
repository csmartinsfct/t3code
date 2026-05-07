import { Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ensureNativeApi } from "../../../nativeApi";
import { resolveInlineEditBlurAction } from "../../management/KanbanTicketDetail";
import { ImageExtensionConfirmDialog } from "../ImageExtensionConfirmDialog";
import { extensionFromMimeType, extractExtension } from "../extension";
import type { AttachmentRendererProps } from "./index";

interface ImagePayloadShape {
  readonly storage?: string;
  readonly attachmentId?: string;
  readonly url?: string;
  readonly name?: string;
  readonly mimeType?: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
}

function resolveImageUrl(payload: ImagePayloadShape): string | null {
  if (payload.storage === "local" && typeof payload.attachmentId === "string") {
    return `/attachments/${encodeURIComponent(payload.attachmentId)}`;
  }
  if (typeof payload.url === "string" && payload.url.length > 0) return payload.url;
  return null;
}

export function ImageArtifact({ artifact, onDelete }: AttachmentRendererProps) {
  const payload = (artifact.payload ?? {}) as ImagePayloadShape;
  const src = resolveImageUrl(payload);
  const displayName = artifact.title ?? payload.name ?? "Image";
  const label = payload.alt ?? displayName;

  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);
  const [saving, setSaving] = useState(false);
  const [pendingExtChange, setPendingExtChange] = useState<{
    from: string;
    to: string;
    title: string;
  } | null>(null);
  const cancelEditRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(displayName);
  }, [displayName, editing]);

  const currentExtension =
    extensionFromMimeType(payload.mimeType) ??
    (typeof payload.name === "string" ? extractExtension(payload.name) : null);

  const commitTitle = useCallback(
    async (nextTitle: string | null) => {
      setSaving(true);
      try {
        await ensureNativeApi().ticketing.updateArtifact({
          id: artifact.id,
          title: nextTitle,
        });
      } catch (cause) {
        console.error("Failed to rename attachment", cause);
      } finally {
        setSaving(false);
        setEditing(false);
      }
    },
    [artifact.id],
  );

  const handleSave = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed === displayName) {
      setEditing(false);
      return;
    }
    const nextTitle = trimmed.length === 0 ? null : trimmed;

    if (nextTitle !== null && currentExtension) {
      const newExtension = extractExtension(nextTitle);
      if (newExtension && newExtension !== currentExtension) {
        setPendingExtChange({
          from: currentExtension,
          to: newExtension,
          title: nextTitle,
        });
        return;
      }
    }

    void commitTitle(nextTitle);
  }, [draft, displayName, currentExtension, commitTitle]);

  const handleKeep = useCallback(() => {
    setPendingExtChange(null);
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const handleUse = useCallback(() => {
    const title = pendingExtChange?.title ?? null;
    setPendingExtChange(null);
    if (title !== null) void commitTitle(title);
  }, [pendingExtChange, commitTitle]);

  if (!src) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
        <span>Unresolved image</span>
      </div>
    );
  }

  return (
    <>
      <div className="group relative flex items-center gap-2 overflow-hidden rounded-md border border-border bg-muted/30">
        <button
          type="button"
          className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden bg-background"
          onClick={() => setExpanded(true)}
          aria-label={`Preview ${label}`}
        >
          <img src={src} alt={label} className="h-full w-full object-cover" loading="lazy" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pr-8 text-xs">
          <input
            ref={inputRef}
            type="text"
            value={editing ? draft : displayName}
            disabled={saving}
            className="min-w-0 cursor-text truncate bg-transparent font-[inherit]! font-medium outline-none"
            onFocus={() => {
              cancelEditRef.current = false;
              setDraft(displayName);
              setEditing(true);
            }}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                cancelEditRef.current = true;
                e.currentTarget.blur();
              }
            }}
            onBlur={() => {
              const blurAction = resolveInlineEditBlurAction({
                cancelRequested: cancelEditRef.current,
                isEditing: editing,
              });
              if (blurAction === "cancel") {
                cancelEditRef.current = false;
                setEditing(false);
                setDraft(displayName);
              } else if (blurAction === "save") {
                handleSave();
              }
            }}
          />
          {typeof payload.width === "number" && typeof payload.height === "number" ? (
            <span className="text-muted-foreground">
              {payload.width}×{payload.height}
            </span>
          ) : null}
        </div>
        {onDelete ? (
          <button
            type="button"
            className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            onClick={onDelete}
            aria-label={`Delete ${label}`}
          >
            <Trash2Icon className="size-3.5" />
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setExpanded(false)}
        >
          <img
            src={src}
            alt={label}
            className="max-h-full max-w-full rounded-md object-contain shadow-2xl"
          />
        </div>
      ) : null}
      <ImageExtensionConfirmDialog
        open={pendingExtChange !== null}
        onOpenChange={(open) => {
          if (!open) setPendingExtChange(null);
        }}
        from={pendingExtChange?.from ?? ""}
        to={pendingExtChange?.to ?? ""}
        onKeep={handleKeep}
        onUse={handleUse}
      />
    </>
  );
}
