import { describe, expect, it } from "vitest";

import { normalizeTerminalOutputChunk, splitCompleteLines } from "./utils";

// ---------------------------------------------------------------------------
// normalizeTerminalOutputChunk
// ---------------------------------------------------------------------------

describe("normalizeTerminalOutputChunk", () => {
  it("replaces CRLF with LF", () => {
    expect(normalizeTerminalOutputChunk("hello\r\nworld\r\n")).toBe("hello\nworld\n");
  });

  it("replaces bare CR with LF", () => {
    expect(normalizeTerminalOutputChunk("hello\rworld\r")).toBe("hello\nworld\n");
  });

  it("leaves plain LF untouched", () => {
    expect(normalizeTerminalOutputChunk("hello\nworld\n")).toBe("hello\nworld\n");
  });

  it("handles mixed line endings", () => {
    expect(normalizeTerminalOutputChunk("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeTerminalOutputChunk("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// splitCompleteLines
// ---------------------------------------------------------------------------

describe("splitCompleteLines", () => {
  it("empty buffer + single complete line", () => {
    const result = splitCompleteLines("", "hello\n");
    expect(result.lines).toEqual(["hello"]);
    expect(result.remainder).toBe("");
  });

  it("empty buffer + multiple lines", () => {
    const result = splitCompleteLines("", "line1\nline2\nline3\n");
    expect(result.lines).toEqual(["line1", "line2", "line3"]);
    expect(result.remainder).toBe("");
  });

  it("partial line (no newline) goes to remainder", () => {
    const result = splitCompleteLines("", "partial");
    expect(result.lines).toEqual([]);
    expect(result.remainder).toBe("partial");
  });

  it("existing buffer + new data merges correctly", () => {
    const result = splitCompleteLines("hel", "lo world\n");
    expect(result.lines).toEqual(["hello world"]);
    expect(result.remainder).toBe("");
  });

  it("existing buffer merges into remainder when no newline arrives", () => {
    const result = splitCompleteLines("hel", "lo");
    expect(result.lines).toEqual([]);
    expect(result.remainder).toBe("hello");
  });

  it("CRLF normalization", () => {
    const result = splitCompleteLines("", "line1\r\nline2\r\n");
    expect(result.lines).toEqual(["line1", "line2"]);
    expect(result.remainder).toBe("");
  });

  it("bare CR normalization", () => {
    const result = splitCompleteLines("", "line1\rline2\r");
    expect(result.lines).toEqual(["line1", "line2"]);
    expect(result.remainder).toBe("");
  });

  it("mixed complete and partial lines", () => {
    const result = splitCompleteLines("buf", "fer complete\nnext partial");
    expect(result.lines).toEqual(["buffer complete"]);
    expect(result.remainder).toBe("next partial");
  });
});
