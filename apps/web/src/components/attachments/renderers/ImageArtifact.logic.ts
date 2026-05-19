import type { Artifact } from "@t3tools/contracts";

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

export function resolveImageUrl(payload: ImagePayloadShape): string | null {
  if (payload.storage === "local" && typeof payload.attachmentId === "string") {
    return `/attachments/${encodeURIComponent(payload.attachmentId)}`;
  }
  if (typeof payload.url === "string" && payload.url.length > 0) return payload.url;
  return null;
}

export function getImagePayload(artifact: Artifact): ImagePayloadShape {
  return (artifact.payload ?? {}) as ImagePayloadShape;
}

export function resolveImageArtifactPreview(
  artifact: Artifact,
): { id: string; name: string; previewUrl: string } | null {
  if (artifact.type !== "image") return null;
  const payload = getImagePayload(artifact);
  const previewUrl = resolveImageUrl(payload);
  if (!previewUrl) return null;
  return {
    id: artifact.id,
    name: artifact.title ?? payload.name ?? "Image",
    previewUrl,
  };
}
