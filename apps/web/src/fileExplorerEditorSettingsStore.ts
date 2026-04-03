/**
 * fileExplorerEditorSettingsStore — persisted editor preferences for the
 * file explorer's CodeMirror editor (theme, font size, font family).
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";

// ─── Types ───────────────────────────────────────────────────────────────────

export type EditorTheme = "vscode-dark" | "vscode-light" | "one-dark";
export type EditorFontSize = 11 | 12 | 13 | 14 | 16 | 18;
export type EditorFontFamily =
  | "sf-mono"
  | "fira-code"
  | "menlo"
  | "cascadia-code"
  | "jetbrains-mono"
  | "monospace";

export interface FileExplorerEditorSettings {
  theme: EditorTheme;
  fontSize: EditorFontSize;
  fontFamily: EditorFontFamily;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_EDITOR_SETTINGS: FileExplorerEditorSettings = {
  theme: "vscode-dark",
  fontSize: 13,
  fontFamily: "sf-mono",
};

// ─── Display labels ───────────────────────────────────────────────────────────

export const THEME_LABELS: Record<EditorTheme, string> = {
  "vscode-dark": "VS Code Dark",
  "vscode-light": "VS Code Light",
  "one-dark": "One Dark",
};

export const FONT_SIZE_LABELS: Record<EditorFontSize, string> = {
  11: "11px",
  12: "12px",
  13: "13px",
  14: "14px",
  16: "16px",
  18: "18px",
};

export const FONT_FAMILY_LABELS: Record<EditorFontFamily, string> = {
  "sf-mono": "SF Mono",
  "fira-code": "Fira Code",
  menlo: "Menlo",
  "cascadia-code": "Cascadia Code",
  "jetbrains-mono": "JetBrains Mono",
  monospace: "System default",
};

export const FONT_FAMILY_CSS: Record<EditorFontFamily, string> = {
  "sf-mono": "'SF Mono', 'SFMono-Regular', Menlo, monospace",
  "fira-code": "'Fira Code', 'Fira Mono', monospace",
  menlo: "Menlo, Monaco, monospace",
  "cascadia-code": "'Cascadia Code', 'Cascadia Mono', monospace",
  "jetbrains-mono": "'JetBrains Mono', monospace",
  monospace: "monospace",
};

export const FONT_SIZE_OPTIONS: EditorFontSize[] = [11, 12, 13, 14, 16, 18];
export const FONT_FAMILY_OPTIONS: EditorFontFamily[] = [
  "sf-mono",
  "fira-code",
  "menlo",
  "cascadia-code",
  "jetbrains-mono",
  "monospace",
];
export const THEME_OPTIONS: EditorTheme[] = ["vscode-dark", "vscode-light", "one-dark"];

// ─── Store ────────────────────────────────────────────────────────────────────

const FILE_EXPLORER_EDITOR_SETTINGS_KEY = "t3code:file-explorer-editor:v1";
const FILE_EXPLORER_EDITOR_SETTINGS_VERSION = 1;

function createEditorSettingsStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

interface FileExplorerEditorSettingsStore {
  settings: FileExplorerEditorSettings;
  updateSettings: (patch: Partial<FileExplorerEditorSettings>) => void;
  resetSettings: () => void;
}

export const useFileExplorerEditorSettingsStore = create<FileExplorerEditorSettingsStore>()(
  persist(
    (set) => ({
      settings: { ...DEFAULT_EDITOR_SETTINGS },

      updateSettings: (patch) =>
        set((state) => ({
          settings: { ...state.settings, ...patch },
        })),

      resetSettings: () => set({ settings: { ...DEFAULT_EDITOR_SETTINGS } }),
    }),
    {
      name: FILE_EXPLORER_EDITOR_SETTINGS_KEY,
      version: FILE_EXPLORER_EDITOR_SETTINGS_VERSION,
      storage: createJSONStorage(createEditorSettingsStorage),
      migrate: (_state, _version) => ({
        settings: { ...DEFAULT_EDITOR_SETTINGS },
      }),
    },
  ),
);
