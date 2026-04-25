import { createHash } from "node:crypto";

import type { TicketBodyOperation, TicketBodySection } from "@t3tools/contracts";

export const TICKET_BODY_SIZE_CAP_BYTES = 1024 * 1024;
export const EMPTY_TICKET_BODY_HASH = createContentHash("");
export const DEFAULT_TICKET_BODY_READ_LIMIT = 120;
export const TICKET_BODY_PREVIEW_LINE_LIMIT = 20;
export const TICKET_BODY_PATCH_EXCERPT_LIMIT = 2_000;

export function createContentHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function bodySizeBytes(body: string): number {
  return Buffer.byteLength(body, "utf8");
}

export function splitLines(body: string): string[] {
  if (body === "") return [];
  return body.split(/\r?\n/);
}

export function lineCount(body: string): number {
  return splitLines(body).length;
}

export function makeBodyMetadata(body: string, revision: number) {
  return {
    revision,
    contentHash: createContentHash(body) as never,
    sizeBytes: bodySizeBytes(body),
    lineCount: lineCount(body),
  };
}

type InternalSection = TicketBodySection & { readonly bodyStartLine: number };

export function markdownSections(body: string, maxDepth?: number): InternalSection[] {
  const lines = splitLines(body);
  const headings: Array<{
    heading: string;
    level: number;
    line: number;
    charOffset: number;
    path: string[];
  }> = [];
  let charOffset = 0;
  const stack: Array<{ level: number; heading: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index]!;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(text);
    if (match) {
      const level = match[1]!.length;
      if (maxDepth === undefined || level <= maxDepth) {
        while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
        const heading = match[2]!;
        stack.push({ level, heading });
        headings.push({
          heading,
          level,
          line: index + 1,
          charOffset,
          path: stack.map((entry) => entry.heading),
        });
      }
    }
    charOffset += text.length + 1;
  }

  return headings.map((heading, index) => {
    const next = headings.find((candidate, candidateIndex) => {
      return candidateIndex > index && candidate.level <= heading.level;
    });
    const endLine = next ? next.line - 1 : lines.length;
    const startChar = heading.charOffset;
    const endChar = next ? next.charOffset - 1 : body.length;
    const sectionText = lines.slice(heading.line - 1, endLine).join("\n");
    return {
      path: heading.path,
      heading: heading.heading,
      level: heading.level,
      startLine: heading.line,
      endLine,
      bodyStartLine: heading.line + 1,
      startChar,
      endChar,
      sectionHash: createContentHash(sectionText) as never,
    };
  });
}

export function findSection(
  body: string,
  sectionPath: readonly string[],
): InternalSection | undefined {
  const normalized = sectionPath.map((part) => part.trim()).filter(Boolean);
  return markdownSections(body).find((section) => {
    return (
      section.path.length === normalized.length &&
      section.path.every((part, index) => part === normalized[index])
    );
  });
}

export function countChangedLines(before: string, after: string): number {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const max = Math.max(beforeLines.length, afterLines.length);
  let changed = 0;
  for (let index = 0; index < max; index += 1) {
    if (beforeLines[index] !== afterLines[index]) changed += 1;
  }
  return changed;
}

export function makePatchExcerpt(before: string, after: string): string {
  const excerpt = `--- before\n${before.slice(0, 900)}\n--- after\n${after.slice(0, 900)}`;
  return excerpt.slice(0, TICKET_BODY_PATCH_EXCERPT_LIMIT);
}

export function summarizeBodyOperation(operation: TicketBodyOperation): string {
  switch (operation) {
    case "str_replace":
      return "Replaced text in ticket body";
    case "insert":
      return "Inserted text in ticket body";
    case "replace_section":
      return "Replaced ticket body section";
    case "append_section":
      return "Appended ticket body section";
    case "replace_body":
      return "Replaced full ticket body";
  }
}
