import "../../index.css";

import type { NativeApi } from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "~/nativeApi";
import { makeTabIdFromPath, useFileExplorerStore } from "~/fileExplorerStore";
import { waitForElement } from "../../test-utils/browser";

import { FileExplorerPanelShell, type FileExplorerPanelMode } from "../FileExplorerPanelShell";
import FileExplorer from "./FileExplorer";

const CWD = "/repo/project";

const DIRECTORY_ENTRIES: Record<
  string,
  Array<{ name: string; path: string; kind: "file" | "directory" }>
> = {
  "": [
    { name: "docs", path: "docs", kind: "directory" },
    { name: "README.md", path: "README.md", kind: "file" },
    { name: "src", path: "src", kind: "directory" },
  ],
  docs: [{ name: "guide.md", path: "docs/guide.md", kind: "file" }],
  src: [{ name: "app.ts", path: "src/app.ts", kind: "file" }],
};

const FILE_CONTENTS: Record<string, string> = {
  "README.md": "# README\n\nSee the docs.",
  "docs/guide.md": "# Guide\n\nVisit [app](../src/app.ts#L7C3).",
  "src/app.ts": "export const answer = 42;\nconsole.log(answer);\n",
};

function resetFileExplorerStore() {
  localStorage.clear();
  useFileExplorerStore.setState({
    workspaceStatesByCwd: {},
    runtimeTabStateByTabId: {},
    pendingScrollTargetByTabId: {},
    pendingRevealPathByCwd: {},
  });
}

function installFileExplorerNativeApi(input?: {
  searchEntries?: Array<{ path: string; kind: "file" | "directory"; parentPath?: string }>;
  writeFile?: ReturnType<typeof vi.fn>;
}) {
  const writeFile =
    input?.writeFile ??
    vi.fn(async ({ relativePath }: { relativePath: string }) => ({ relativePath }));
  window.nativeApi = {
    projects: {
      listDirectory: vi.fn(async ({ path }: { path: string }) => ({
        entries: DIRECTORY_ENTRIES[path] ?? [],
      })),
      readFile: vi.fn(async ({ relativePath }: { relativePath: string }) => ({
        contents: FILE_CONTENTS[relativePath] ?? "",
        sizeBytes: (FILE_CONTENTS[relativePath] ?? "").length,
      })),
      searchEntries: vi.fn(async () => ({
        entries: input?.searchEntries ?? [
          { path: "README.md", kind: "file" as const },
          { path: "src/app.ts", kind: "file" as const, parentPath: "src" },
        ],
        truncated: false,
      })),
      writeFile,
      enhanceSystemPrompt: vi.fn(),
    },
    git: {
      status: vi.fn(async () => ({
        isRepo: true,
        hasOriginRemote: true,
        isDefaultBranch: true,
        branch: "main",
        hasWorkingTreeChanges: false,
        workingTree: { files: [], insertions: 0, deletions: 0 },
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        pr: null,
      })),
    },
  } as unknown as NativeApi;
  return { writeFile };
}

async function renderExplorer(mode: FileExplorerPanelMode, onClose = vi.fn()) {
  const queryClient = new QueryClient();
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <FileExplorerPanelShell mode={mode}>
        <FileExplorer cwd={CWD} mode={mode} onClose={onClose} />
      </FileExplorerPanelShell>
    </QueryClientProvider>,
  );

  return {
    unmount: () => screen.unmount(),
    onClose,
  };
}

describe("FileExplorer", () => {
  beforeEach(() => {
    __resetNativeApiForTests();
    delete window.nativeApi;
    document.body.innerHTML = "";
    resetFileExplorerStore();
  });

  afterEach(() => {
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("renders inline and sheet shells differently and forwards close actions", async () => {
    // Audit traceability: 216652d, aba3612.
    installFileExplorerNativeApi();

    const inline = await renderExplorer("inline");
    try {
      const inlineShell = document.querySelector(".w-\\[60vw\\]") as HTMLElement | null;
      expect(inlineShell).toBeTruthy();
      await page.getByRole("button", { name: "Close file explorer" }).click();
      expect(inline.onClose).toHaveBeenCalledTimes(1);
    } finally {
      await inline.unmount();
    }

    document.body.innerHTML = "";
    resetFileExplorerStore();
    installFileExplorerNativeApi();

    const sheet = await renderExplorer("sheet");
    try {
      const inlineShell = document.querySelector(".w-\\[60vw\\]");
      expect(inlineShell).toBeNull();
      expect(await page.getByText("Files").element()).toBeTruthy();
    } finally {
      await sheet.unmount();
    }
  });

  it("covers tree navigation, splits, quick open, and markdown preview", async () => {
    installFileExplorerNativeApi();
    const mounted = await renderExplorer("inline");

    try {
      await page.getByRole("button", { name: "docs" }).click();
      await page.getByRole("button", { name: "guide.md" }).click();
      await page.getByRole("button", { name: "Preview" }).click();

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Visit");
        expect(document.body.textContent ?? "").toContain("app");
      });

      const guideTabId = makeTabIdFromPath(CWD, "docs/guide.md");
      useFileExplorerStore.getState().createSplit("right", guideTabId, CWD);
      useFileExplorerStore.getState().openFile(CWD, "README.md", "primary");

      await vi.waitFor(() => {
        const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map(
          (element) => element.textContent ?? "",
        );
        expect(tabs.some((label) => label.includes("guide.md"))).toBe(true);
        expect(tabs.some((label) => label.includes("README.md"))).toBe(true);
      });

      const primaryPaneState = useFileExplorerStore.getState().workspaceStatesByCwd[CWD];
      expect(primaryPaneState?.hasSplit).toBe(true);

      const previewToggle = await waitForElement(
        () => document.querySelector<HTMLElement>('[aria-label="Preview"]'),
        "Unable to find markdown preview toggle before quick-open.",
      );
      previewToggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "p",
          bubbles: true,
          cancelable: true,
          [navigator.platform.toLowerCase().includes("mac") ? "metaKey" : "ctrlKey"]: true,
        }),
      );
      await page.getByPlaceholder("Search files…").fill("src/app");
      const quickOpenItem = await waitForElement(
        () =>
          Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((element) =>
            element.textContent?.includes("app.ts"),
          ) ?? null,
        "Unable to find quick-open result for src/app.ts.",
      );
      quickOpenItem.click();

      await vi.waitFor(() => {
        const workspace = useFileExplorerStore.getState().workspaceStatesByCwd[CWD];
        expect(workspace?.panes.primary.activeTabId).toBe(makeTabIdFromPath(CWD, "src/app.ts"));
      });
    } finally {
      await mounted.unmount();
    }
  });
});
