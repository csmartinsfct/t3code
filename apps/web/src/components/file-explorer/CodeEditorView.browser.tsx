import "../../index.css";

import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  consumeClipboardSnippet,
  type ClipboardSnippetEntry,
} from "../../clipboardSnippetRegistry";
import { DEFAULT_EDITOR_SETTINGS } from "../../fileExplorerEditorSettingsStore";

import { CodeEditorView } from "./CodeEditorView";

const EDITOR_CONTENT = "const answer = 42;\nconsole.log(answer);";
const EXPECTED_ENTRY: ClipboardSnippetEntry = {
  text: EDITOR_CONTENT,
  cwd: "/repo/project",
  relativePath: "src/app.ts",
  startLine: 1,
  endLine: 2,
};

async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string,
): Promise<T> {
  let element: T | null = null;
  await vi.waitFor(
    () => {
      element = query();
      expect(element, errorMessage).toBeTruthy();
    },
    { timeout: 8_000, interval: 16 },
  );
  return element!;
}

describe("CodeEditorView clipboard copy", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    consumeClipboardSnippet(EDITOR_CONTENT);
    document.body.innerHTML = "";
  });

  it("registers copied editor selections as snippet metadata with exact clipboard text", async () => {
    // Audit traceability: e2bee71, 877d7ca.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText,
      },
    });

    const screen = await render(
      <CodeEditorView
        tabId="tab-editor-browser-test"
        cwd="/repo/project"
        relativePath="src/app.ts"
        initialContent={EDITOR_CONTENT}
        settings={DEFAULT_EDITOR_SETTINGS}
        onContentChange={() => undefined}
      />,
    );

    try {
      const editorRoot = await waitForElement(
        () => document.querySelector<HTMLElement>(".cm-editor"),
        "Unable to find the CodeMirror editor root.",
      );
      const view = EditorView.findFromDOM(editorRoot);
      expect(view).toBeTruthy();

      view!.dispatch({
        selection: {
          anchor: 0,
          head: view!.state.doc.length,
        },
      });
      view!.focus();

      const isMac = navigator.platform.toLowerCase().includes("mac");
      view!.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "c",
          metaKey: isMac,
          ctrlKey: !isMac,
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        () => {
          expect(writeText).toHaveBeenCalledWith(EDITOR_CONTENT);
        },
        { timeout: 8_000, interval: 16 },
      );

      expect(consumeClipboardSnippet(EDITOR_CONTENT)).toEqual(EXPECTED_ENTRY);
    } finally {
      await screen.unmount();
    }
  });
});
