/**
 * Normalize CRLF and bare CR to LF in a terminal output chunk.
 */
export function normalizeTerminalOutputChunk(chunk: string): string {
  return chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Given an existing partial-line buffer and a new raw chunk from a PTY,
 * split everything into complete lines (terminated by `\n`) and a remainder
 * that has not yet been terminated.
 */
export function splitCompleteLines(
  existingBuffer: string,
  chunk: string,
): { readonly lines: ReadonlyArray<string>; readonly remainder: string } {
  const normalized = `${existingBuffer}${normalizeTerminalOutputChunk(chunk)}`;
  const parts = normalized.split("\n");
  const remainder = parts.pop() ?? "";
  return { lines: parts, remainder };
}
