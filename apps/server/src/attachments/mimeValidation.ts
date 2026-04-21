import { inferImageExtension, SAFE_IMAGE_FILE_EXTENSIONS } from "../imageMime.ts";

export const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type AllowedMimeKind = "image";

export interface MimeValidation {
  readonly allow: ReadonlySet<AllowedMimeKind>;
  readonly maxBytes: number;
}

export const IMAGE_ONLY_VALIDATION: MimeValidation = {
  allow: new Set<AllowedMimeKind>(["image"]),
  maxBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
};

export interface ValidatedMime {
  readonly kind: AllowedMimeKind;
  readonly mimeType: string;
  readonly extension: string;
}

export function validateMime(input: {
  readonly mimeType: string;
  readonly fileName?: string;
  readonly validation?: MimeValidation;
}): ValidatedMime | null {
  const validation = input.validation ?? IMAGE_ONLY_VALIDATION;
  const normalized = input.mimeType.trim().toLowerCase();
  if (normalized.length === 0) return null;

  if (validation.allow.has("image") && normalized.startsWith("image/")) {
    const extension = inferImageExtension(
      input.fileName !== undefined
        ? { mimeType: normalized, fileName: input.fileName }
        : { mimeType: normalized },
    );
    if (!SAFE_IMAGE_FILE_EXTENSIONS.has(extension)) return null;
    return { kind: "image", mimeType: normalized, extension };
  }

  return null;
}

export function validateByteLength(
  byteLength: number,
  validation: MimeValidation = IMAGE_ONLY_VALIDATION,
): boolean {
  return byteLength > 0 && byteLength <= validation.maxBytes;
}
