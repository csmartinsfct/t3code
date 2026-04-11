import "../index.css";

import { TurnId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { consumeClipboardSnippet } from "../clipboardSnippetRegistry";
import { useStore } from "../store";
import { createTextClipboardData, waitForElement } from "../test-utils/browser";
import type { Project, Thread } from "../types";

const openInPreferredEditorSpy = vi.hoisted(() => vi.fn());
const resolvePathLinkTargetSpy = vi.hoisted(() =>
  vi.fn((filePath: string, cwd: string) => `${cwd}/${filePath}`),
);

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");

  return {
    ...actual,
    useQueries: vi.fn(() => [
      {
        data: {
          branch: "feature/app",
          hasWorkingTreeChanges: true,
          workingTree: { files: [], insertions: 0, deletions: 0 },
          hasUpstream: true,
          aheadCount: 0,
          behindCount: 0,
          hasOriginRemote: true,
          isDefaultBranch: false,
          pr: null,
        },
        isLoading: false,
      },
      {
        data: {
          branch: "feature/docs",
          hasWorkingTreeChanges: false,
          workingTree: { files: [], insertions: 0, deletions: 0 },
          hasUpstream: true,
          aheadCount: 1,
          behindCount: 0,
          hasOriginRemote: true,
          isDefaultBranch: false,
          pr: null,
        },
        isLoading: false,
      },
    ]),
    useQuery: vi.fn((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === "git" && options.queryKey?.[1] === "discoverRepos") {
        return {
          data: {
            repos: [
              { cwd: "/repo/app", relativePath: "app", label: "app" },
              { cwd: "/repo/docs", relativePath: "docs", label: "docs" },
            ],
          },
          isLoading: false,
          error: null,
        };
      }

      return {
        data: {
          diff: "all repos patch",
          repoDiffs: [
            { repoRoot: "/repo/app", diff: "repo app patch" },
            { repoRoot: "/repo/docs", diff: "repo docs patch" },
          ],
        },
        isLoading: false,
        error: null,
      };
    }),
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useParams: vi.fn(() => "thread-diff-browser-test"),
  useSearch: vi.fn(() => ({ diff: "1", diffTurnId: null, diffFilePath: null })),
}));

vi.mock("@pierre/diffs", () => ({
  parsePatchFiles: vi.fn((patch: string) => [
    {
      files: [
        {
          name: patch.includes("docs")
            ? "b/docs/guide.md"
            : patch.includes("app")
              ? "b/src/app.ts"
              : "b/src/all.ts",
          prevName: patch.includes("docs")
            ? "a/docs/guide.md"
            : patch.includes("app")
              ? "a/src/app.ts"
              : "a/src/all.ts",
          cacheKey: patch,
        },
      ],
    },
  ]),
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff }: { fileDiff: { cacheKey?: string; name?: string } }) => (
    <div>
      <button data-title type="button">
        {fileDiff.name}
      </button>
      <div>{fileDiff.cacheKey}</div>
    </div>
  ),
  Virtualizer: ({ children }: { children: import("react").ReactNode }) => <div>{children}</div>,
  WorkerPoolContextProvider: ({ children }: { children: import("react").ReactNode }) => (
    <>{children}</>
  ),
  useWorkerPool: () => ({ workerPool: null }),
}));

vi.mock("../editorPreferences", () => ({
  openInPreferredEditor: openInPreferredEditorSpy,
}));

function mockUseTurnDiffSummaries() {
  return {
    useTurnDiffSummaries: vi.fn(() => ({
      turnDiffSummaries: [
        {
          turnId: "turn-1",
          completedAt: "2026-04-11T10:00:00.000Z",
          checkpointTurnCount: 1,
        },
      ],
      inferredCheckpointTurnCountByTurnId: {},
    })),
  };
}

vi.mock("../hooks/useTurnDiffSummaries", mockUseTurnDiffSummaries);
vi.mock("../hooks/useTurnDiffSummaries.ts", mockUseTurnDiffSummaries);

function mockUseTheme() {
  return {
    useTheme: vi.fn(() => ({ resolvedTheme: "light" })),
  };
}

vi.mock("../hooks/useTheme", mockUseTheme);
vi.mock("../hooks/useTheme.ts", mockUseTheme);

function mockUseSettings() {
  return {
    useSettings: vi.fn(() => ({ diffWordWrap: false, timestampFormat: "absolute" })),
  };
}

vi.mock("../hooks/useSettings", mockUseSettings);
vi.mock("../hooks/useSettings.ts", mockUseSettings);

function mockNativeApi() {
  return {
    readNativeApi: vi.fn(() => ({ shell: "native-api" })),
  };
}

vi.mock("../nativeApi", mockNativeApi);
vi.mock("../nativeApi.ts", mockNativeApi);

vi.mock("../store", async () => vi.importActual("../store"));
vi.mock("../store.ts", async () => vi.importActual("../store"));

function mockTerminalLinks() {
  return {
    resolvePathLinkTarget: resolvePathLinkTargetSpy,
  };
}

vi.mock("../terminal-links", mockTerminalLinks);
vi.mock("../terminal-links.ts", mockTerminalLinks);

import { DiffPanelShell } from "./DiffPanelShell";
import DiffPanel, { resolveDiffEditorTarget } from "./DiffPanel";

const NOW_ISO = "2026-04-11T10:00:00.000Z";
const DIFF_TEXT = [
  "diff --git a/src/app.ts b/src/app.ts",
  "@@ -1,1 +1,1 @@",
  "-const before = 1;",
  "+const after = 2;",
].join("\n");

const DIFF_PROJECT: Project = {
  id: "project-1" as never,
  name: "Project",
  cwd: "/repo/root",
  defaultModelSelection: {
    provider: "codex",
    model: "gpt-5",
  },
  systemPrompt: null,
  promptOverrides: { orchestration: {} },
  scripts: [],
};

const DIFF_THREAD: Thread = {
  id: "thread-diff-browser-test" as never,
  codexThreadId: null,
  projectId: DIFF_PROJECT.id,
  title: "Diff browser test thread",
  modelSelection: {
    provider: "codex",
    model: "gpt-5",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  session: null,
  messages: [],
  proposedPlans: [],
  error: null,
  createdAt: NOW_ISO,
  archivedAt: null,
  updatedAt: NOW_ISO,
  latestTurn: null,
  branch: null,
  worktreePath: null,
  turnDiffSummaries: [
    {
      turnId: TurnId.makeUnsafe("turn-1"),
      completedAt: NOW_ISO,
      files: [],
      checkpointTurnCount: 1,
    },
  ],
  activities: [],
  isOrchestrationThread: false,
  parentThreadId: null,
  ticketId: null,
};

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

describe("DiffPanel multi-repo coverage", () => {
  beforeEach(() => {
    useStore.setState({
      bootstrapComplete: true,
      projects: [DIFF_PROJECT],
      threads: [DIFF_THREAD],
      threadsById: {
        [DIFF_THREAD.id]: DIFF_THREAD,
      },
      sidebarThreadsById: {},
      threadIdsByProjectId: {
        [DIFF_PROJECT.id]: [DIFF_THREAD.id],
      },
      orchestrationRunStatusByThreadId: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("switches repo tabs, renders per-repo diff content, and opens files from the selected repo cwd", async () => {
    // Audit traceability: 7d32356, b984bf3.
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<DiffPanel mode="inline" />, { container: host });

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("All repos");
        expect(document.body.textContent).toContain("all repos patch");
      });

      const docsRepoButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((element) =>
            element.textContent?.includes("docs"),
          ) ?? null,
        "Unable to find the docs repo tab.",
      );
      docsRepoButton.click();

      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("repo docs patch");
        expect(document.body.textContent).not.toContain("all repos patch");
      });

      expect(
        resolveDiffEditorTarget({
          activeCwd: "/repo/root",
          filePath: "docs/guide.md",
          selectedRepoCwd: "/repo/docs",
        }),
      ).toBe("/repo/docs/docs/guide.md");
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
