const IMAGE_EXT_BY_MIME: Record<string, string> = {
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/tiff": ".tiff",
  "image/webp": ".webp",
};

export function extensionFromMimeType(mimeType: string | null | undefined): string | null {
  if (!mimeType) return null;
  const match = IMAGE_EXT_BY_MIME[mimeType.toLowerCase()];
  return match ?? null;
}

/**
 * Extract a trailing `.ext` from a freeform label. Returns the extension
 * (lowercased, including the leading dot) or null when there isn't one.
 * Only accepts 1–8 alphanumeric chars after the dot, matching how OS
 * file explorers treat extensions.
 */
export function extractExtension(label: string): string | null {
  const match = /\.([a-z0-9]{1,8})$/i.exec(label.trim());
  if (!match) return null;
  return `.${match[1]!.toLowerCase()}`;
}
