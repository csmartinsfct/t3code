import "../index.css";

import type { NativeApi, ProjectId, ServerProvider } from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ReactNode } from "react";

import { __resetNativeApiForTests } from "~/nativeApi";
import { findButtonByText, waitForElement } from "~/test-utils/browser";
import { seedSidebarTestStores } from "~/test-utils/sidebar";
import { SidebarProvider } from "./ui/sidebar";

const { contextMenuShowSpy, openInEditorSpy } = vi.hoisted(() => ({
  contextMenuShowSpy: vi.fn(),
  openInEditorSpy: vi.fn(async () => undefined),
}));
const toastAddSpy = vi.fn();

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQueries: vi.fn(() => []),
  };
});

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({ children, to: _to, ...props }: { children: ReactNode; to: string }) => (
      <a href="#" {...props}>
        {children}
      </a>
    ),
    useNavigate: () => vi.fn(),
    useLocation: ({ select }: { select?: (value: { pathname: string }) => string } = {}) =>
      select ? select({ pathname: "/" }) : { pathname: "/" },
    useSearch: ({ select }: { select?: (value: Record<string, unknown>) => unknown } = {}) =>
      select ? select({}) : {},
    useParams: ({ select }: { select?: (value: { threadId?: string }) => unknown } = {}) =>
      select ? select({}) : {},
  };
});

vi.mock("../env", () => ({
  isElectron: false,
}));

vi.mock("./ProjectFavicon", () => ({
  ProjectFavicon: () => <div data-testid="project-favicon" />,
}));

vi.mock("./sidebar/SidebarUpdatePill", () => ({
  SidebarUpdatePill: () => null,
}));

const newThreadHookMock = {
  useHandleNewThread: () => ({
    activeDraftThread: null,
    activeThread: null,
    handleNewThread: vi.fn(async () => undefined),
  }),
};
vi.mock("../hooks/useHandleNewThread", () => newThreadHookMock);
vi.mock("../hooks/useHandleNewThread.ts", () => newThreadHookMock);

const threadActionsMock = {
  useThreadActions: () => ({
    archiveThread: vi.fn(async () => undefined),
    deleteThread: vi.fn(async () => undefined),
  }),
};
vi.mock("../hooks/useThreadActions", () => threadActionsMock);
vi.mock("../hooks/useThreadActions.ts", () => threadActionsMock);

vi.mock("../hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({
    copyToClipboard: vi.fn(),
    isCopied: false,
  }),
}));

const settingsHookMock = {
  useSettings: () => ({
    confirmThreadArchive: false,
    confirmThreadDelete: false,
    defaultThreadEnvMode: "local",
    sidebarProjectSortOrder: "updated_at",
    sidebarThreadSortOrder: "updated_at",
  }),
  useUpdateSettings: () => ({
    updateSettings: vi.fn(),
  }),
};
vi.mock("../hooks/useSettings", () => settingsHookMock);
vi.mock("../hooks/useSettings.ts", () => settingsHookMock);

vi.mock("../rpc/serverState", () => ({
  resetServerStateForTests: vi.fn(),
  useServerAvailableEditors: () => ["vscode"],
  useServerKeybindings: () => [],
  useServerProviders: () => [],
}));

const runStatusSyncHookMock = {
  useOrchestrationRunStatusSync: () => undefined,
};
vi.mock("../hooks/useOrchestrationRunStatusSync", () => runStatusSyncHookMock);
vi.mock("../hooks/useOrchestrationRunStatusSync.ts", () => runStatusSyncHookMock);

vi.mock("./ui/toast", () => ({
  toastManager: {
    add: toastAddSpy,
  },
}));

const {
  buildForkModelSelection,
  buildMoveThreadConfirmationMessage,
  buildProjectContextMenuItems,
  buildThreadContextMenuItems,
  default: Sidebar,
  resolveOpenInEditorContextMenuLabel,
} = await import("./Sidebar");

function createProvider(input: {
  provider: string;
  displayName?: string;
  status?: ServerProvider["status"];
  enabled?: boolean;
  models?: ServerProvider["models"];
}): ServerProvider {
  return {
    // Runtime provider IDs can include profile suffixes like `claudeAgent:metric`,
    // even though the contracts type currently only models the base providers.
    provider: input.provider as never,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    enabled: input.enabled ?? true,
    installed: true,
    version: "1.0.0",
    status: input.status ?? "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-11T00:00:00.000Z",
    models: input.models ?? [],
  };
}

// Audit traceability: be79d4b, 90a6727, c6cb176, caeb52a, eb37ddb.

function installNativeApi() {
  contextMenuShowSpy.mockReset();
  openInEditorSpy.mockReset();
  window.nativeApi = {
    contextMenu: {
      show: contextMenuShowSpy,
    },
    dialogs: {
      pickFolder: vi.fn(async () => null),
      confirm: vi.fn(async () => true),
    },
    orchestration: {
      dispatchCommand: vi.fn(async () => undefined),
    },
    projects: {
      enhanceSystemPrompt: vi.fn(async () => ({
        enhancedPrompt: "Honor the project conventions.",
      })),
    },
    shell: {
      openExternal: vi.fn(async () => undefined),
      openInEditor: openInEditorSpy,
    },
    server: {
      getConfig: vi.fn(async () => ({
        availableEditors: ["vscode"],
      })),
    },
  } as unknown as NativeApi;
}

describe("Sidebar thread context menu helpers", () => {
  it("builds fork and move children with the expected availability rules", () => {
    const items = buildThreadContextMenuItems({
      serverProviders: [
        createProvider({
          provider: "claudeAgent:metric",
          displayName: "Claude (metric)",
          models: [
            {
              slug: "claude-opus-4-6",
              name: "Claude Opus 4.6",
              isCustom: false,
              capabilities: {
                reasoningEffortLevels: [],
                supportsFastMode: false,
                supportsThinkingToggle: false,
                supportsPlan: true,
                contextWindowOptions: [],
                promptInjectedEffortLevels: [],
              },
            },
          ],
        }),
        createProvider({
          provider: "gemini",
          displayName: "Gemini",
          models: [
            {
              slug: "gemini-2.5-pro",
              name: "Gemini 2.5 Pro",
              isCustom: false,
              capabilities: {
                reasoningEffortLevels: [],
                supportsFastMode: false,
                supportsThinkingToggle: false,
                supportsPlan: true,
                contextWindowOptions: [],
                promptInjectedEffortLevels: [],
              },
            },
          ],
        }),
        createProvider({
          provider: "cursor",
          displayName: "Cursor",
          models: [
            {
              slug: "composer-2",
              name: "Composer 2",
              isCustom: false,
              capabilities: {
                reasoningEffortLevels: [],
                supportsFastMode: false,
                supportsThinkingToggle: false,
                supportsPlan: true,
                contextWindowOptions: [],
                promptInjectedEffortLevels: [],
              },
            },
          ],
        }),
        createProvider({
          provider: "cursor:profile",
          displayName: "Cursor (profile)",
          models: [
            {
              slug: "claude-sonnet-4-6",
              name: "Sonnet 4.6",
              isCustom: false,
              capabilities: {
                reasoningEffortLevels: [],
                supportsFastMode: false,
                supportsThinkingToggle: false,
                supportsPlan: true,
                contextWindowOptions: [],
                promptInjectedEffortLevels: [],
              },
            },
          ],
        }),
      ],
      projects: [
        { id: "project-1" as ProjectId, name: "Alpha" },
        { id: "project-2" as ProjectId, name: "Beta" },
      ],
      threadProjectId: "project-1" as ProjectId,
      hasActiveSession: false,
    });

    const forkItem = items.find((item) => item.id === "fork");
    const moveItem = items.find((item) => item.id === "move");

    expect(forkItem?.disabled).toBe(false);
    expect(forkItem?.children).toEqual([
      {
        id: "fork::claudeAgent:metric::claude-opus-4-6",
        label: "Claude (metric) — Claude Opus 4.6",
      },
      {
        id: "fork::gemini::gemini-2.5-pro",
        label: "Gemini — Gemini 2.5 Pro",
      },
      {
        id: "fork::cursor::composer-2",
        label: "Cursor — Composer 2",
      },
    ]);
    expect(moveItem?.disabled).toBe(false);
    expect(moveItem?.children).toEqual([{ id: "move::project-2", label: "Beta" }]);
  });

  it("builds fork model selections for each provider family", () => {
    expect(buildForkModelSelection("codex", "gpt-5.4")).toEqual({
      provider: "codex",
      model: "gpt-5.4",
    });
    expect(buildForkModelSelection("claudeAgent:metric", "claude-opus-4-6")).toEqual({
      provider: "claudeAgent",
      profileId: "metric",
      model: "claude-opus-4-6",
    });
    expect(buildForkModelSelection("gemini", "gemini-2.5-pro")).toEqual({
      provider: "gemini",
      model: "gemini-2.5-pro",
    });
  });

  it("disables Move to when no target project exists or the thread is active", () => {
    const noTargetItems = buildThreadContextMenuItems({
      serverProviders: [],
      projects: [{ id: "project-1" as ProjectId, name: "Alpha" }],
      threadProjectId: "project-1" as ProjectId,
      hasActiveSession: false,
    });
    const activeThreadItems = buildThreadContextMenuItems({
      serverProviders: [],
      projects: [
        { id: "project-1" as ProjectId, name: "Alpha" },
        { id: "project-2" as ProjectId, name: "Beta" },
      ],
      threadProjectId: "project-1" as ProjectId,
      hasActiveSession: true,
    });

    expect(noTargetItems.find((item) => item.id === "move")?.disabled).toBe(true);
    expect(activeThreadItems.find((item) => item.id === "move")?.disabled).toBe(true);
  });

  it("adds open-in-editor entries with preferred editor and worktree context", () => {
    window.localStorage.setItem("t3code:last-editor", JSON.stringify("cursor"));

    const items = buildThreadContextMenuItems({
      serverProviders: [],
      projects: [{ id: "project-1" as ProjectId, name: "Alpha" }],
      threadProjectId: "project-1" as ProjectId,
      hasActiveSession: false,
      openInEditorLabel: resolveOpenInEditorContextMenuLabel({
        availableEditors: ["cursor", "vscode"],
        worktreePath: "/repo/alpha/.worktrees/feature-ticket",
      }),
      canOpenInEditor: true,
    });
    const projectItems = buildProjectContextMenuItems({
      openInEditorLabel: resolveOpenInEditorContextMenuLabel({
        availableEditors: ["cursor", "vscode"],
      }),
      canOpenInEditor: true,
    });

    expect(items.find((item) => item.id === "open-in-editor")).toMatchObject({
      label: "Open in Cursor (worktree: feature-ticket)",
      disabled: false,
    });
    expect(projectItems.find((item) => item.id === "open-in-editor")).toMatchObject({
      label: "Open in Cursor",
      disabled: false,
    });
    window.localStorage.removeItem("t3code:last-editor");
  });

  it("mentions cleared worktree and branch associations only when needed", () => {
    expect(
      buildMoveThreadConfirmationMessage({
        threadTitle: "Main thread",
        targetProjectName: "Beta",
        clearsWorkspaceAssociation: true,
      }),
    ).toContain("The thread's worktree and branch association will be cleared.");

    expect(
      buildMoveThreadConfirmationMessage({
        threadTitle: "Main thread",
        targetProjectName: "Beta",
        clearsWorkspaceAssociation: false,
      }),
    ).toBe('Move thread "Main thread" to project "Beta"?');
  });
});

describe("Sidebar project system prompt entry", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.localStorage.removeItem("t3code:last-editor");
    __resetNativeApiForTests();
    delete window.nativeApi;
    toastAddSpy.mockReset();
    seedSidebarTestStores();
    installNativeApi();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.removeItem("t3code:last-editor");
    __resetNativeApiForTests();
    delete window.nativeApi;
  });

  it("opens the project cwd from the project context menu", async () => {
    contextMenuShowSpy.mockImplementation(async (items: Array<{ id: string; label: string }>) => {
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "open-in-editor", label: "Open in VS Code" }),
        ]),
      );
      return "open-in-editor";
    });

    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <SidebarProvider defaultOpen>
          <Sidebar />
        </SidebarProvider>
      </QueryClientProvider>,
    );

    try {
      const projectButton = await waitForElement(
        () => findButtonByText(document.body, "Alpha"),
        "Unable to find the Alpha project row.",
      );
      projectButton.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 24,
          clientY: 24,
        }),
      );

      await vi.waitFor(() => {
        expect(openInEditorSpy).toHaveBeenCalledWith("/repo/alpha", "vscode");
      });
    } finally {
      await screen.unmount();
    }
  });

  it("opens a thread worktree from the thread context menu when present", async () => {
    seedSidebarTestStores({
      sidebarThreadsById: {
        "thread-worktree": {
          id: "thread-worktree",
          projectId: "project-1",
          title: "Feature ticket",
          interactionMode: "default",
          session: null,
          createdAt: "2026-04-11T00:00:00.000Z",
          archivedAt: null,
          updatedAt: "2026-04-11T00:00:00.000Z",
          latestTurn: null,
          branch: null,
          worktreePath: "/repo/alpha/.worktrees/feature-ticket",
          latestUserMessageAt: null,
          hasPendingApprovals: false,
          hasPendingUserInput: false,
          hasActionableProposedPlan: false,
          isOrchestrationThread: false,
          parentThreadId: null,
        },
      },
      threadIdsByProjectId: {
        "project-1": ["thread-worktree"],
      },
    });
    contextMenuShowSpy.mockImplementation(async (items: Array<{ id: string; label: string }>) => {
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "open-in-editor",
            label: "Open in VS Code (worktree: feature-ticket)",
          }),
        ]),
      );
      return "open-in-editor";
    });

    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <SidebarProvider defaultOpen>
          <Sidebar />
        </SidebarProvider>
      </QueryClientProvider>,
    );

    try {
      const threadButton = await waitForElement(
        () => findButtonByText(document.body, "Feature ticket"),
        "Unable to find the worktree thread row.",
      );
      threadButton.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 32,
          clientY: 48,
        }),
      );

      await vi.waitFor(() => {
        expect(openInEditorSpy).toHaveBeenCalledWith(
          "/repo/alpha/.worktrees/feature-ticket",
          "vscode",
        );
      });
    } finally {
      await screen.unmount();
    }
  });

  it("offers the project system prompt action and opens the hydrated dialog", async () => {
    contextMenuShowSpy.mockImplementation(async (items: Array<{ id: string; label: string }>) => {
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "system-prompt", label: "Manage system prompt" }),
        ]),
      );
      return "system-prompt";
    });

    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <SidebarProvider defaultOpen>
          <Sidebar />
        </SidebarProvider>
      </QueryClientProvider>,
    );

    try {
      const projectButton = await waitForElement(
        () => findButtonByText(document.body, "Alpha"),
        "Unable to find the Alpha project row.",
      );
      projectButton.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 24,
          clientY: 24,
        }),
      );

      await vi.waitFor(() => {
        expect(contextMenuShowSpy).toHaveBeenCalledTimes(1);
      });

      const textarea = await waitForElement(
        () =>
          document.querySelector<HTMLTextAreaElement>(
            'textarea[placeholder*="Always use TypeScript strict mode"]',
          ),
        "Unable to find the system prompt textarea.",
      );
      expect(textarea.value).toBe("Honor the project conventions.");
    } finally {
      await screen.unmount();
    }
  });

  it("hides orchestration child threads from the main sidebar list", async () => {
    // Audit traceability: 3b13b26.
    seedSidebarTestStores({
      sidebarThreadsById: {
        "thread-parent": {
          id: "thread-parent",
          projectId: "project-1",
          title: "Orchestration parent",
          interactionMode: "default",
          session: null,
          createdAt: "2026-04-11T00:00:00.000Z",
          archivedAt: null,
          updatedAt: "2026-04-11T00:00:00.000Z",
          latestTurn: null,
          branch: null,
          worktreePath: null,
          latestUserMessageAt: null,
          hasPendingApprovals: false,
          hasPendingUserInput: false,
          hasActionableProposedPlan: false,
          isOrchestrationThread: true,
          parentThreadId: null,
        },
        "thread-child": {
          id: "thread-child",
          projectId: "project-1",
          title: "Hidden child thread",
          interactionMode: "default",
          session: null,
          createdAt: "2026-04-11T00:00:00.000Z",
          archivedAt: null,
          updatedAt: "2026-04-11T00:00:00.000Z",
          latestTurn: null,
          branch: null,
          worktreePath: null,
          latestUserMessageAt: null,
          hasPendingApprovals: false,
          hasPendingUserInput: false,
          hasActionableProposedPlan: false,
          isOrchestrationThread: false,
          parentThreadId: "thread-parent",
        },
      },
      threadIdsByProjectId: {
        "project-1": ["thread-parent", "thread-child"],
      },
    });

    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <SidebarProvider defaultOpen>
          <Sidebar />
        </SidebarProvider>
      </QueryClientProvider>,
    );

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Orchestration parent");
      });
      expect(document.body.textContent ?? "").not.toContain("Hidden child thread");
    } finally {
      await screen.unmount();
    }
  });
});
