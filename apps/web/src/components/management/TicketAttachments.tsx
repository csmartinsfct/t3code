import type { Artifact, ArtifactId, TicketId } from "@t3tools/contracts";
import { PaperclipIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { ensureNativeApi } from "../../nativeApi";
import { useFileDropTarget } from "../../hooks/useFileDropTarget";
import { resolveAttachmentRenderer } from "../attachments/renderers";

interface TicketAttachmentsProps {
  readonly ticketId: TicketId;
  readonly artifacts: ReadonlyArray<Artifact>;
  readonly onUpdated: () => void;
  readonly onOpenArtifact?: (artifact: Artifact) => void;
}

const MAX_INFLIGHT_UPLOADS = 4;

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("Unexpected file reader result"));
    };
    reader.readAsDataURL(file);
  });
}

export function TicketAttachments({
  ticketId,
  artifacts,
  onUpdated,
  onOpenArtifact,
}: TicketAttachmentsProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const accepted = files.filter((f) => f.type.startsWith("image/"));
      const rejected = files.length - accepted.length;
      if (rejected > 0 && accepted.length === 0) {
        setError("Only image files are supported right now.");
        return;
      }
      if (rejected > 0) {
        setError(
          `${rejected} file${rejected === 1 ? "" : "s"} skipped (only images are supported right now).`,
        );
      } else {
        setError(null);
      }

      const api = ensureNativeApi();
      setPending((p) => p + accepted.length);
      const queue = [...accepted];
      const worker = async () => {
        while (queue.length > 0) {
          const file = queue.shift();
          if (!file) break;
          try {
            const dataUrl = await readFileAsDataUrl(file);
            await api.ticketing.createArtifact({
              ticketId,
              type: "image",
              payload: {
                dataUrl,
                name: file.name,
                mimeType: file.type || "application/octet-stream",
              },
            });
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Upload failed");
          } finally {
            setPending((p) => Math.max(0, p - 1));
          }
        }
      };
      const workers = Array.from(
        { length: Math.min(MAX_INFLIGHT_UPLOADS, accepted.length) },
        worker,
      );
      await Promise.all(workers);
      onUpdated();
    },
    [onUpdated, ticketId],
  );

  const { isActive, bindProps } = useFileDropTarget({
    onFiles: (files) => void uploadFiles(files),
  });

  const handlePickerChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length > 0) void uploadFiles(files);
    },
    [uploadFiles],
  );

  const handleDelete = useCallback(
    async (artifactId: ArtifactId) => {
      try {
        await ensureNativeApi().ticketing.deleteArtifact({ id: artifactId });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Delete failed");
      } finally {
        onUpdated();
      }
    },
    [onUpdated],
  );

  return (
    <section
      {...bindProps}
      className={`flex flex-col gap-2 rounded-md border border-transparent p-2 transition-colors ${isActive ? "border-dashed border-primary bg-primary/5" : ""}`}
      aria-label="Attachments"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">
          Attachments
          {artifacts.length > 0 ? ` (${artifacts.length})` : ""}
        </h3>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => inputRef.current?.click()}
          disabled={pending > 0}
        >
          <PaperclipIcon className="size-3.5" />
          {pending > 0 ? `Uploading ${pending}…` : "Attach"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handlePickerChange}
        />
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {artifacts.length === 0 ? (
        <p className="rounded border border-dashed border-border bg-muted/30 px-2 py-3 text-center text-xs text-muted-foreground">
          Drop images here or click Attach to upload.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {artifacts.map((artifact) => {
            const Renderer = resolveAttachmentRenderer(artifact.type);
            return (
              <Renderer
                key={artifact.id}
                artifact={artifact}
                onDelete={() => void handleDelete(artifact.id)}
                {...(onOpenArtifact ? { onOpen: onOpenArtifact } : {})}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
