import "../index.css";

import type { NativeApi, ProjectId, ServerProvider, ThreadId } from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ReactNode } from "react";

import { __resetNativeApiForTests } from "~/nativeApi";
import { findButtonByText, waitForElement } from "~/test-utils/browser";
import { seedSidebarTestStores } from "~/test-utils/sidebar";
import { resolveThreadBoardContextSourceThreadId } from "../lib/threadBoardContext";
import { SidebarProvider } from "./ui/sidebar";

const { contextMenuShowSpy } = vi.hoisted(() => ({
  contextMenuShowSpy: vi.fn(),
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
  buildMoveThreadConfirmationMessage,
  buildThreadContextMenuItems,
  default: Sidebar,
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
    },
  } as unknown as NativeApi;
}

describe("Sidebar fork board-context continuity", () => {
  it("reuses the active route thread when forking within the same project", () => {
    expect(
      resolveThreadBoardContextSourceThreadId({
        routeThreadId: "thread-active" as ThreadId,
        targetProjectId: "project-1" as ProjectId,
        activeThreadProjectId: "project-1" as ProjectId,
      }),
    ).toBe("thread-active");
  });

  it("drops cross-project board context when the active route belongs to another project", () => {
    expect(
      resolveThreadBoardContextSourceThreadId({
        routeThreadId: "thread-active" as ThreadId,
        targetProjectId: "project-2" as ProjectId,
        activeThreadProjectId: "project-1" as ProjectId,
      }),
    ).toBeNull();
  });

  it("falls back to the active draft thread project when it matches the fork target", () => {
    expect(
      resolveThreadBoardContextSourceThreadId({
        routeThreadId: "thread-draft" as ThreadId,
        targetProjectId: "project-2" as ProjectId,
        activeDraftThreadProjectId: "project-2" as ProjectId,
      }),
    ).toBe("thread-draft");
  });
});

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
    ]);
    expect(moveItem?.disabled).toBe(false);
    expect(moveItem?.children).toEqual([{ id: "move::project-2", label: "Beta" }]);
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
    __resetNativeApiForTests();
    delete window.nativeApi;
    toastAddSpy.mockReset();
    seedSidebarTestStores();
    installNativeApi();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    __resetNativeApiForTests();
    delete window.nativeApi;
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
});
