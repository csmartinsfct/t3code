const CANONICAL_TICKET_IDENTIFIER_REGEX = /\b([A-Z][A-Z0-9]*-\d+)\b/gi;

export function normalizeTicketIdentifier(identifier: string): string {
  return identifier.trim().toUpperCase();
}

export function extractCanonicalTicketIdentifierCandidates(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const identifiers = new Set<string>();
  for (const match of text.matchAll(CANONICAL_TICKET_IDENTIFIER_REGEX)) {
    const identifier = match[1];
    if (!identifier) continue;
    identifiers.add(normalizeTicketIdentifier(identifier));
  }
  return [...identifiers];
}
