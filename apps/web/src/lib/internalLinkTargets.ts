export type InternalLinkTarget = { kind: "ticket"; identifier: string };

export function parseInternalLinkTarget(href: string | undefined): InternalLinkTarget | null {
  if (!href) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (
    url.protocol !== "t3:" ||
    url.hostname !== "ticket" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return null;
  }

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 1) {
    return null;
  }

  try {
    const identifier = decodeURIComponent(segments[0] ?? "").trim();
    if (!identifier) {
      return null;
    }
    return { kind: "ticket", identifier };
  } catch {
    return null;
  }
}
