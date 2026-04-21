import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { Effect, FileSystem, Path } from "effect";

import {
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "../attachmentPaths.ts";
import { parseBase64DataUrl } from "../imageMime.ts";
import {
  DEFAULT_MAX_ATTACHMENT_BYTES,
  IMAGE_ONLY_VALIDATION,
  type MimeValidation,
  validateByteLength,
  validateMime,
} from "./mimeValidation.ts";

export const TICKETING_ATTACHMENT_MAX_BYTES = DEFAULT_MAX_ATTACHMENT_BYTES;

const OWNER_ID_SEGMENT_MAX_CHARS = 40;

const toSafeOwnerSegment = (value: string): string | null => {
  const segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, OWNER_ID_SEGMENT_MAX_CHARS)
    .replace(/[-_]+$/g, "");
  return segment.length > 0 ? segment : null;
};

export type AttachmentOwnerKind = "ticket" | "comment";

export interface AttachmentOwner {
  readonly kind: AttachmentOwnerKind;
  readonly id: string;
}

export interface IngestedAttachmentFile {
  readonly id: string;
  readonly relativePath: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export class AttachmentIngestError extends Error {
  readonly _tag = "AttachmentIngestError";
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AttachmentIngestError";
  }
}

export function buildAttachmentId(owner: AttachmentOwner): string | null {
  const ownerSegment = toSafeOwnerSegment(owner.id);
  if (!ownerSegment) return null;
  return `${owner.kind}-${ownerSegment}-${randomUUID()}`;
}

export function buildAttachmentRelativePath(input: {
  readonly id: string;
  readonly extension: string;
}): string {
  return `${input.id}${input.extension}`;
}

/**
 * Ingest a base64 data URL as a new attachment file. Validates MIME, decodes
 * bytes, writes them under the server's attachments dir, and returns the
 * metadata needed for the DB row.
 */
export const ingestDataUrl = (input: {
  readonly attachmentsDir: string;
  readonly owner: AttachmentOwner;
  readonly dataUrl: string;
  readonly name: string;
  readonly validation?: MimeValidation;
}): Effect.Effect<
  IngestedAttachmentFile,
  AttachmentIngestError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const validation = input.validation ?? IMAGE_ONLY_VALIDATION;
    const parsed = parseBase64DataUrl(input.dataUrl);
    if (!parsed) {
      return yield* Effect.fail(new AttachmentIngestError("Invalid data URL"));
    }

    const validated = validateMime({
      mimeType: parsed.mimeType,
      fileName: input.name,
      validation,
    });
    if (!validated) {
      return yield* Effect.fail(
        new AttachmentIngestError(`Unsupported MIME type: ${parsed.mimeType}`),
      );
    }

    const bytes = Buffer.from(parsed.base64, "base64");
    if (!validateByteLength(bytes.byteLength, validation)) {
      return yield* Effect.fail(
        new AttachmentIngestError(
          `Attachment is empty or exceeds ${validation.maxBytes} bytes (got ${bytes.byteLength}).`,
        ),
      );
    }

    const id = buildAttachmentId(input.owner);
    if (!id) {
      return yield* Effect.fail(new AttachmentIngestError("Failed to derive a safe attachment id"));
    }

    const relativePath = buildAttachmentRelativePath({ id, extension: validated.extension });
    const absolutePath = resolveAttachmentRelativePath({
      attachmentsDir: input.attachmentsDir,
      relativePath,
    });
    if (!absolutePath) {
      return yield* Effect.fail(new AttachmentIngestError("Failed to resolve attachment path"));
    }

    const fs = yield* FileSystem.FileSystem;
    const pathSvc = yield* Path.Path;

    yield* fs
      .makeDirectory(pathSvc.dirname(absolutePath), { recursive: true })
      .pipe(
        Effect.mapError(
          (cause) => new AttachmentIngestError("Failed to create attachments directory", cause),
        ),
      );
    yield* fs
      .writeFile(absolutePath, bytes)
      .pipe(
        Effect.mapError(
          (cause) => new AttachmentIngestError("Failed to write attachment bytes", cause),
        ),
      );

    return {
      id,
      relativePath,
      name: input.name,
      mimeType: validated.mimeType,
      sizeBytes: bytes.byteLength,
    } satisfies IngestedAttachmentFile;
  });

/**
 * Copy an existing attachment file (identified by its source id/relative path)
 * into a new attachment owned by `owner`. The source file is left untouched.
 */
export const copyExistingAttachment = (input: {
  readonly attachmentsDir: string;
  readonly owner: AttachmentOwner;
  readonly sourceAttachmentId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly validation?: MimeValidation;
}): Effect.Effect<
  IngestedAttachmentFile,
  AttachmentIngestError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const validation = input.validation ?? IMAGE_ONLY_VALIDATION;
    const validated = validateMime({
      mimeType: input.mimeType,
      fileName: input.name,
      validation,
    });
    if (!validated) {
      return yield* Effect.fail(
        new AttachmentIngestError(`Unsupported MIME type: ${input.mimeType}`),
      );
    }

    const sourcePath = resolveExistingAttachmentByIdSync({
      attachmentsDir: input.attachmentsDir,
      attachmentId: input.sourceAttachmentId,
    });
    if (!sourcePath) {
      return yield* Effect.fail(
        new AttachmentIngestError(`Source attachment not found: ${input.sourceAttachmentId}`),
      );
    }

    const id = buildAttachmentId(input.owner);
    if (!id) {
      return yield* Effect.fail(new AttachmentIngestError("Failed to derive a safe attachment id"));
    }
    const relativePath = buildAttachmentRelativePath({ id, extension: validated.extension });
    const destPath = resolveAttachmentRelativePath({
      attachmentsDir: input.attachmentsDir,
      relativePath,
    });
    if (!destPath) {
      return yield* Effect.fail(new AttachmentIngestError("Failed to resolve destination path"));
    }

    const fs = yield* FileSystem.FileSystem;
    const pathSvc = yield* Path.Path;

    yield* fs
      .makeDirectory(pathSvc.dirname(destPath), { recursive: true })
      .pipe(
        Effect.mapError(
          (cause) => new AttachmentIngestError("Failed to create attachments directory", cause),
        ),
      );
    yield* fs
      .copyFile(sourcePath, destPath)
      .pipe(
        Effect.mapError(
          (cause) => new AttachmentIngestError("Failed to copy attachment bytes", cause),
        ),
      );

    const stats = yield* fs
      .stat(destPath)
      .pipe(
        Effect.mapError(
          (cause) => new AttachmentIngestError("Failed to stat copied attachment", cause),
        ),
      );

    const size = Number(stats.size);
    if (!validateByteLength(size, validation)) {
      return yield* Effect.fail(
        new AttachmentIngestError(
          `Copied attachment is empty or exceeds ${validation.maxBytes} bytes (got ${size}).`,
        ),
      );
    }

    return {
      id,
      relativePath,
      name: input.name,
      mimeType: validated.mimeType,
      sizeBytes: size,
    } satisfies IngestedAttachmentFile;
  });

/**
 * Delete a stored attachment file by its relative path. Missing files are
 * treated as a no-op so re-deletes and cascade deletes stay idempotent.
 */
export const deleteAttachmentFile = (input: {
  readonly attachmentsDir: string;
  readonly relativePath: string;
}): Effect.Effect<void, AttachmentIngestError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const absolutePath = resolveAttachmentRelativePath({
      attachmentsDir: input.attachmentsDir,
      relativePath: input.relativePath,
    });
    if (!absolutePath) return;

    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(absolutePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return;
    yield* fs
      .remove(absolutePath)
      .pipe(
        Effect.mapError(
          (cause) => new AttachmentIngestError("Failed to remove attachment file", cause),
        ),
      );
  });

/**
 * Resolve an attachment file on disk by id, trying known safe extensions.
 * Used for the chat→ticket promotion path where the source id lives under the
 * legacy thread-scoped layout; filename resolution is MIME-aware and works for
 * both the legacy and the new polymorphic schemes.
 */
function resolveExistingAttachmentByIdSync(input: {
  readonly attachmentsDir: string;
  readonly attachmentId: string;
}): string | null {
  const normalizedId = normalizeAttachmentRelativePath(input.attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) return null;

  const candidateExtensions = [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".heic",
    ".heif",
    ".avif",
    ".bmp",
    ".tiff",
    ".ico",
    ".bin",
  ];
  for (const ext of candidateExtensions) {
    const maybe = resolveAttachmentRelativePath({
      attachmentsDir: input.attachmentsDir,
      relativePath: `${normalizedId}${ext}`,
    });
    if (maybe && existsSync(maybe)) return maybe;
  }
  return null;
}
