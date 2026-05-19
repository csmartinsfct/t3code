import type { Artifact, ArtifactType } from "@t3tools/contracts";
import type { ComponentType } from "react";

import { FigmaUrlArtifact } from "./FigmaUrlArtifact";
import { ImageArtifact } from "./ImageArtifact";
import { MermaidArtifact } from "./MermaidArtifact";
import { UnknownArtifact } from "./UnknownArtifact";

export interface AttachmentRendererProps {
  readonly artifact: Artifact;
  readonly onDelete?: () => void;
  readonly onOpen?: (artifact: Artifact) => void;
}

export type AttachmentRenderer = ComponentType<AttachmentRendererProps>;

export const attachmentRenderers: Record<ArtifactType, AttachmentRenderer> = {
  image: ImageArtifact,
  mermaid: MermaidArtifact,
  figma_url: FigmaUrlArtifact,
};

export function resolveAttachmentRenderer(type: ArtifactType | string): AttachmentRenderer {
  return (attachmentRenderers as Record<string, AttachmentRenderer>)[type] ?? UnknownArtifact;
}
