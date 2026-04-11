import { ThreadId } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");
const GIT_CWD = "/repo/project";
const BRANCH_NAME = "feature/toast-scope";

const {
  invalidateGitQueriesSpy,
  invalidateGitStatusQuerySpy,
  runStackedActionMutateAsyncSpy,
  setThreadBranchSpy,
  toastAddSpy,
  toastCloseSpy,
  toastPromiseSpy,
  toastUpdateSpy,
} = vi.hoisted(() => ({
  invalidateGitQueriesSpy: vi.fn(() => Promise.resolve()),
  invalidateGitStatusQuerySpy: vi.fn(() => Promise.resolve()),
  runStackedActionMutateAsyncSpy: vi.fn(() => new Promise<never>(() => undefined)),
  setThreadBranchSpy: vi.fn(),
  toastAddSpy: vi.fn(() => "toast-1"),
  toastCloseSpy: vi.fn(),
  toastPromiseSpy: vi.fn(),
  toastUpdateSpy: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");

  return {
    ...actual,
    useIsMutating: vi.fn(() => 0),
    useMutation: vi.fn((options: { __kind?: string }) => {
      if (options.__kind === "run-stacked-action") {
        return {
          mutateAsync: runStackedActionMutateAsyncSpy,
          isPending: false,
        };
      }

      if (options.__kind === "pull") {
        return {
          mutateAsync: vi.fn(),
          isPending: false,
        };
      }

      return {
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        isPending: false,
      };
    }),
    useQuery: vi.fn((options: { queryKey?: string[] }) => {
      if (options.queryKey?.[0] === "git-status") {
        return {
          data: {
            isRepo: true,
            branch: BRANCH_NAME,
            hasWorkingTreeChanges: false,
            workingTree: { files: [], insertions: 0, deletions: 0 },
            hasUpstream: true,
            aheadCount: 1,
            behindCount: 0,
            hasOriginRemote: true,
            isDefaultBranch: false,
            pr: null,
          },
          error: null,
        };
      }

      if (options.queryKey?.[0] === "git-branches") {
        return {
          data: {
            isRepo: true,
            hasOriginRemote: true,
            branches: [
              {
                name: BRANCH_NAME,
                current: true,
                isDefault: false,
                worktreePath: null,
              },
            ],
          },
          error: null,
        };
      }

      return { data: null, error: null };
    }),
    useQueryClient: vi.fn(() => ({})),
  };
});

vi.mock("~/components/ui/toast", () => ({
  toastManager: {
    add: toastAddSpy,
    close: toastCloseSpy,
    promise: toastPromiseSpy,
    update: toastUpdateSpy,
  },
}));

vi.mock("~/editorPreferences", () => ({
  openInPreferredEditor: vi.fn(),
}));

vi.mock("~/lib/gitReactQuery", () => ({
  gitBranchesQueryOptions: vi.fn(() => ({ queryKey: ["git-branches"] })),
  gitInitMutationOptions: vi.fn(() => ({ __kind: "init" })),
  gitMutationKeys: {
    pull: vi.fn(() => ["pull"]),
    runStackedAction: vi.fn(() => ["run-stacked-action"]),
  },
  gitPullMutationOptions: vi.fn(() => ({ __kind: "pull" })),
  gitRunStackedActionMutationOptions: vi.fn(() => ({ __kind: "run-stacked-action" })),
  gitStatusQueryOptions: vi.fn(() => ({ queryKey: ["git-status"] })),
  invalidateGitQueries: invalidateGitQueriesSpy,
  invalidateGitStatusQuery: invalidateGitStatusQuerySpy,
}));

vi.mock("~/lib/utils", async () => {
  const actual = await vi.importActual<typeof import("~/lib/utils")>("~/lib/utils");

  return {
    ...actual,
    newCommandId: vi.fn(() => "command-1"),
    randomUUID: vi.fn(() => "action-1"),
  };
});

vi.mock("~/nativeApi", () => ({
  readNativeApi: vi.fn(() => null),
}));

vi.mock("~/store", () => ({
  useStore: (selector: (state: unknown) => unknown) =>
    selector({
      setThreadBranch: setThreadBranchSpy,
      threadsById: {
        [THREAD_A]: { id: THREAD_A, branch: BRANCH_NAME, worktreePath: null },
        [THREAD_B]: { id: THREAD_B, branch: BRANCH_NAME, worktreePath: null },
      },
    }),
}));

vi.mock("~/terminal-links", () => ({
  resolvePathLinkTarget: vi.fn(),
}));

import GitActionsControl from "./GitActionsControl";

function findButtonByText(text: string): HTMLButtonElement | null {
  return (Array.from(document.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  ) ?? null) as HTMLButtonElement | null;
}

function Harness() {
  const [activeThreadId, setActiveThreadId] = useState(THREAD_A);

  return (
    <>
      <button type="button" onClick={() => setActiveThreadId(THREAD_B)}>
        Switch thread
      </button>
      <GitActionsControl
        gitCwd={GIT_CWD}
        multiRepoStatus={{
          repos: [{ cwd: GIT_CWD, relativePath: ".", label: "project" }],
          statusByRepoCwd: new Map([
            [
              GIT_CWD,
              {
                isRepo: true,
                branch: BRANCH_NAME,
                hasWorkingTreeChanges: false,
                workingTree: { files: [], insertions: 0, deletions: 0 },
                hasUpstream: true,
                aheadCount: 1,
                behindCount: 0,
                hasOriginRemote: true,
                isDefaultBranch: false,
                pr: null,
              },
            ],
          ]),
          hasAnyRepo: true,
          hasAnyChanges: false,
          isLoading: false,
        }}
        activeThreadId={activeThreadId}
      />
    </>
  );
}

describe("GitActionsControl thread-scoped progress toast", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("keeps an in-flight git action toast pinned to the thread that started it", async () => {
    vi.useFakeTimers();

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<Harness />, { container: host });

    try {
      const quickActionButton = findButtonByText("Push & create PR");
      expect(quickActionButton, 'Unable to find button containing "Push & create PR"').toBeTruthy();
      if (!(quickActionButton instanceof HTMLButtonElement)) {
        throw new Error('Unable to find button containing "Push & create PR"');
      }
      quickActionButton.click();

      expect(toastAddSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { threadId: THREAD_A },
          title: "Pushing...",
          type: "loading",
        }),
      );

      await vi.advanceTimersByTimeAsync(1_000);

      expect(toastUpdateSpy).toHaveBeenLastCalledWith(
        "toast-1",
        expect.objectContaining({
          data: { threadId: THREAD_A },
          title: "Pushing...",
          type: "loading",
        }),
      );

      const switchThreadButton = findButtonByText("Switch thread");
      expect(switchThreadButton, 'Unable to find button containing "Switch thread"').toBeTruthy();
      if (!(switchThreadButton instanceof HTMLButtonElement)) {
        throw new Error('Unable to find button containing "Switch thread"');
      }
      switchThreadButton.click();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(toastUpdateSpy).toHaveBeenLastCalledWith(
        "toast-1",
        expect.objectContaining({
          data: { threadId: THREAD_A },
          title: "Pushing...",
          type: "loading",
        }),
      );
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("renders bulk and per-repo actions for multi-repo git state", async () => {
    // Audit traceability: c437af0.
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <GitActionsControl
        gitCwd={GIT_CWD}
        multiRepoStatus={{
          repos: [
            { cwd: "/repo/app", relativePath: "app", label: "app" },
            { cwd: "/repo/docs", relativePath: "docs", label: "docs" },
          ],
          statusByRepoCwd: new Map([
            [
              "/repo/app",
              {
                isRepo: true,
                branch: "feature/app",
                hasWorkingTreeChanges: true,
                workingTree: {
                  files: [{ path: "src/app.ts", insertions: 2, deletions: 1 }],
                  insertions: 2,
                  deletions: 1,
                },
                hasUpstream: true,
                aheadCount: 0,
                behindCount: 0,
                hasOriginRemote: true,
                isDefaultBranch: false,
                pr: null,
              },
            ],
            [
              "/repo/docs",
              {
                isRepo: true,
                branch: "feature/docs",
                hasWorkingTreeChanges: false,
                workingTree: { files: [], insertions: 0, deletions: 0 },
                hasUpstream: true,
                aheadCount: 2,
                behindCount: 0,
                hasOriginRemote: true,
                isDefaultBranch: false,
                pr: null,
              },
            ],
          ]),
          hasAnyRepo: true,
          hasAnyChanges: true,
          isLoading: false,
        }}
        activeThreadId={THREAD_A}
      />,
      { container: host },
    );

    try {
      expect(document.body.textContent).toContain("Commit all (1)");

      await page.getByRole("button", { name: "Git action options" }).click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Push all (1)");
        expect(text).toContain("app");
        expect(text).toContain("docs");
        expect(text).toContain("Commit");
        expect(text).toContain("Push");
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
