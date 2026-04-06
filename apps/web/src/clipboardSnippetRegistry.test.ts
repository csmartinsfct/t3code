import { afterEach, describe, expect, it, vi } from "vitest";

import {
  copyClipboardSnippet,
  consumeClipboardSnippet,
  type ClipboardSnippetEntry,
} from "./clipboardSnippetRegistry";

const ENTRY: ClipboardSnippetEntry = {
  text: "const answer = 42;\n",
  cwd: "/workspace",
  relativePath: "src/example.ts",
  startLine: 3,
  endLine: 3,
};

describe("copyClipboardSnippet", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    consumeClipboardSnippet(ENTRY.text);
  });

  it("writes exact text to clipboardData and registers matching snippet metadata", () => {
    const setData = vi.fn();
    const clipboardData = {
      setData,
    } as unknown as DataTransfer;

    copyClipboardSnippet(ENTRY, clipboardData);

    expect(setData).toHaveBeenCalledWith("text/plain", ENTRY.text);
    expect(consumeClipboardSnippet(ENTRY.text)).toEqual(ENTRY);
  });

  it("falls back to navigator.clipboard when clipboardData is unavailable", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText,
      },
    });

    copyClipboardSnippet(ENTRY);

    expect(writeText).toHaveBeenCalledWith(ENTRY.text);
    expect(consumeClipboardSnippet(ENTRY.text)).toEqual(ENTRY);
  });
});
