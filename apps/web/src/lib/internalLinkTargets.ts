export type InternalLinkTarget = { kind: "ticket"; identifier: string };

/**
 * Models sometimes wrap ticket markdown links in backticks, e.g.
 *   `[METR-39](t3://ticket/METR-39)`
 * which react-markdown treats as inline code (literal text) instead of a link.
 * Strip the surrounding backticks so the link syntax is parsed normally.
 */
const BACKTICKED_TICKET_LINK_RE = /`(\[[^\]]+\]\(t3:\/\/ticket\/[^)]+\))`/g;

export function unwrapBacktickedTicketLinks(text: string): string {
  return text.replace(BACKTICKED_TICKET_LINK_RE, "$1");
}

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
