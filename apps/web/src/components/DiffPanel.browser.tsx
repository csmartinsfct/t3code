import "../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { consumeClipboardSnippet } from "../clipboardSnippetRegistry";
import { createTextClipboardData, waitForElement } from "../test-utils/browser";

import { DiffPanelShell } from "./DiffPanelShell";

const DIFF_TEXT = [
  "diff --git a/src/app.ts b/src/app.ts",
  "@@ -1,1 +1,1 @@",
  "-const before = 1;",
  "+const after = 2;",
].join("\n");

describe("DiffPanel clipboard copy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    consumeClipboardSnippet(DIFF_TEXT);
    window.getSelection()?.removeAllRanges();
  });

  it("keeps copied diff text out of the snippet registry", async () => {
    // Audit traceability: e2bee71, 877d7ca.
    const screen = await render(
      <DiffPanelShell mode="inline" header={<div>Diff</div>}>
        <div className="p-2">
          <pre>{DIFF_TEXT}</pre>
        </div>
      </DiffPanelShell>,
    );

    try {
      const rawDiff = await waitForElement(
        () => document.querySelector<HTMLElement>("pre"),
        "Unable to find the raw diff block.",
      );
      const selection = window.getSelection();
      expect(selection).toBeTruthy();

      const range = document.createRange();
      range.selectNodeContents(rawDiff);
      selection!.removeAllRanges();
      selection!.addRange(range);

      const copyEvent = new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(copyEvent, "clipboardData", {
        configurable: true,
        value: {
          ...createTextClipboardData(DIFF_TEXT),
          setData: vi.fn(),
        },
      });
      rawDiff.dispatchEvent(copyEvent);

      expect(consumeClipboardSnippet(DIFF_TEXT)).toBeNull();
    } finally {
      await screen.unmount();
    }
  });
});
