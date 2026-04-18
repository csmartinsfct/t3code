export type InternalLinkTarget = { kind: "ticket"; identifier: string };

/**
 * Models sometimes wrap ticket markdown links in backticks, which react-markdown
 * then renders as inline code instead of a link. Backticks may appear:
 *   - around the whole link:        `[ID](t3://ticket/ID)`
 *   - between the text and url:     `[ID]`(t3://ticket/ID)  |  `[ID]``(t3://ticket/ID)`
 *   - around just the url:          [ID](`t3://ticket/ID`)
 * Strip any such backticks so the link syntax parses normally.
 */
const BACKTICKED_TICKET_LINK_RE = /`?(\[[^\]`]+\])`*\(`?(t3:\/\/ticket\/[^)`]+)`?\)`?/g;

export function unwrapBacktickedTicketLinks(text: string): string {
  return text.replace(BACKTICKED_TICKET_LINK_RE, "$1($2)");
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
