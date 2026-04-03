/**
 * CodeEditorView — CodeMirror 6 editor component.
 *
 * Mounts a new editor instance on every `tabId` change (clean remount).
 * Also remounts when editor settings (theme/font) change.
 * Reads initial content from the file explorer runtime store; reports
 * content changes up to the store via `onContentChange`.
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { Prec } from "@codemirror/state";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { highlightActiveLine, highlightActiveLineGutter, lineNumbers } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { registerClipboardSnippet } from "~/clipboardSnippetRegistry";
import type { FileExplorerEditorSettings } from "~/fileExplorerEditorSettingsStore";
import { FONT_FAMILY_CSS } from "~/fileExplorerEditorSettingsStore";

// ─── Language detection ───────────────────────────────────────────────────────

type LangFactory = () => Extension;

const EXT_MAP: Record<string, LangFactory> = {
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  mjs: () => javascript(),
  cjs: () => javascript(),
  css: () => css(),
  html: () => html(),
  htm: () => html(),
  py: () => python(),
  rs: () => rust(),
  go: () => go(),
  java: () => java(),
  json: () => json(),
  jsonc: () => json(),
  md: () => markdown(),
  mdx: () => markdown(),
  mdc: () => markdown(),
  yml: () => yaml(),
  yaml: () => yaml(),
  xml: () => xml(),
  svg: () => xml(),
  sql: () => sql(),
  cpp: () => cpp(),
  cc: () => cpp(),
  cxx: () => cpp(),
  c: () => cpp(),
  h: () => cpp(),
  hpp: () => cpp(),
  php: () => javascript(), // close enough for basic syntax
};

function resolveLanguageExtension(relativePath: string): Extension {
  const parts = relativePath.split(".");
  if (parts.length < 2) return [];
  const ext = parts[parts.length - 1]?.toLowerCase() ?? "";
  return EXT_MAP[ext]?.() ?? [];
}

// ─── App theme (used only for "one-dark" — vscode themes are self-contained) ──

const appTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "var(--foreground)",
      height: "100%",
    },
    ".cm-gutters": {
      backgroundColor: "color-mix(in srgb, var(--background) 98%, var(--foreground))",
      color: "var(--muted-foreground)",
      borderRight: "1px solid var(--border)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "color-mix(in srgb, var(--background) 95%, var(--foreground))",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--background) 97%, var(--foreground))",
    },
    ".cm-cursor": { borderLeftColor: "var(--primary)" },
    ".cm-selectionBackground": {
      backgroundColor: "color-mix(in srgb, var(--primary) 22%, transparent) !important",
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "color-mix(in srgb, var(--primary) 28%, transparent) !important",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--popover)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
    },
    ".cm-content": { padding: "4px 0" },
  },
  { dark: true },
);

// ─── Component ────────────────────────────────────────────────────────────────

interface CodeEditorViewProps {
  tabId: string;
  cwd: string;
  relativePath: string;
  initialContent: string;
  isReadOnly?: boolean;
  settings: FileExplorerEditorSettings;
  onContentChange: (content: string) => void;
}

export function CodeEditorView({
  tabId,
  cwd,
  relativePath,
  initialContent,
  isReadOnly = false,
  settings,
  onContentChange,
}: CodeEditorViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  useEffect(() => {
    if (!containerRef.current) return;

    // ── Font override (always applied on top of the color theme) ─────────────
    const fontTheme = EditorView.theme({
      ".cm-scroller": {
        fontFamily: FONT_FAMILY_CSS[settings.fontFamily],
        fontSize: `${settings.fontSize}px`,
        lineHeight: "1.6",
      },
    });

    // ── Color theme — vscode themes are self-contained; one-dark uses appTheme
    const colorTheme: Extension =
      settings.theme === "vscode-dark"
        ? vscodeDark
        : settings.theme === "vscode-light"
          ? vscodeLight
          : [appTheme, oneDark];

    // ── Enriched Cmd+C: captures selection metadata for snippet-paste ─────────
    const cwdAtMount = cwd;
    const relativePathAtMount = relativePath;
    const enrichedCopyKeymap = Prec.highest(
      keymap.of([
        {
          key: "Mod-c",
          run: (view: EditorView): boolean => {
            const selection = view.state.selection.main;
            if (selection.empty) return false;
            const selectedText = view.state.doc.sliceString(selection.from, selection.to);
            const startLine = view.state.doc.lineAt(selection.from).number;
            const endLine = view.state.doc.lineAt(selection.to).number;
            void navigator.clipboard.writeText(selectedText);
            registerClipboardSnippet({
              text: selectedText,
              cwd: cwdAtMount,
              relativePath: relativePathAtMount,
              startLine,
              endLine,
            });
            return true;
          },
        },
      ]),
    );

    const extensions: Extension[] = [
      enrichedCopyKeymap,
      resolveLanguageExtension(relativePath),
      colorTheme,
      fontTheme,
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onContentChangeRef.current(update.state.doc.toString());
        }
      }),
    ];

    if (isReadOnly) {
      extensions.push(EditorState.readOnly.of(true));
    }

    const state = EditorState.create({
      doc: initialContent,
      extensions,
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Remount when tab or editor settings change. initialContent is intentionally
    // excluded to avoid cursor jumps when content updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, relativePath, isReadOnly, settings.theme, settings.fontSize, settings.fontFamily]);

  // Background color for the container — vscode themes use their own bg,
  // so we make it transparent and let the theme handle it.
  const containerBg =
    settings.theme === "one-dark"
      ? "color-mix(in srgb, var(--background) 97%, var(--foreground))"
      : "transparent";

  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-1 overflow-auto"
      style={{ background: containerBg }}
    />
  );
}
