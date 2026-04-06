/**
 * clipboardSnippetRegistry — in-memory store for enriched clipboard entries.
 *
 * When the user presses Cmd+C inside the file editor, CodeEditorView writes
 * the selection's metadata here alongside the plain-text clipboard write.
 * When the composer receives a paste event, it checks this registry and, if
 * the pasted text matches the last registered entry, converts it to a code
 * snippet chip instead of inserting raw text.
 *
 * Why not custom MIME types: `paste` event clipboardData.getData() does not
 * reliably expose custom MIME types written via the async ClipboardItem API
 * across all Chromium/Electron versions. This registry is simpler, reliable,
 * and correctly scoped to single-session use.
 */

export interface ClipboardSnippetEntry {
  text: string;
  cwd: string;
  relativePath: string;
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed
}

interface PendingEntry extends ClipboardSnippetEntry {
  timestamp: number;
}

const TTL_MS = 30_000; // entries expire after 30 seconds

let _pending: PendingEntry | null = null;
let _expireTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeClipboardText(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

/**
 * Register an enriched clipboard entry. Called by CodeEditorView on Cmd+C.
 * Replaces any previously pending entry.
 */
export function registerClipboardSnippet(entry: ClipboardSnippetEntry): void {
  if (_expireTimer !== null) {
    clearTimeout(_expireTimer);
    _expireTimer = null;
  }
  _pending = { ...entry, timestamp: Date.now() };
  _expireTimer = setTimeout(() => {
    _pending = null;
    _expireTimer = null;
  }, TTL_MS);
}

/**
 * Write the exact snippet text to the clipboard when possible, then register
 * the corresponding metadata so composer paste can turn it into an attachment.
 */
export function copyClipboardSnippet(
  entry: ClipboardSnippetEntry,
  clipboardData?: DataTransfer | null,
): void {
  if (clipboardData) {
    clipboardData.setData("text/plain", entry.text);
  } else if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(entry.text);
  }

  registerClipboardSnippet(entry);
}

/**
 * Consume the pending entry if its `text` matches the pasted text.
 * Returns the entry and clears it, or returns null if no match.
 */
export function consumeClipboardSnippet(pastedText: string): ClipboardSnippetEntry | null {
  if (!_pending) return null;

  // Normalize browser clipboard serialization differences such as CRLF vs LF,
  // then allow a trailing newline on either side.
  const registeredTrimmed = normalizeClipboardText(_pending.text);
  const pastedTrimmed = normalizeClipboardText(pastedText);
  const matches =
    registeredTrimmed === pastedTrimmed ||
    pastedTrimmed.startsWith(registeredTrimmed) ||
    registeredTrimmed.startsWith(pastedTrimmed);
  if (!matches || registeredTrimmed.length === 0) return null;

  const entry: ClipboardSnippetEntry = {
    text: _pending.text,
    cwd: _pending.cwd,
    relativePath: _pending.relativePath,
    startLine: _pending.startLine,
    endLine: _pending.endLine,
  };

  // Clear — each entry can only be consumed once
  _pending = null;
  if (_expireTimer !== null) {
    clearTimeout(_expireTimer);
    _expireTimer = null;
  }

  return entry;
}
