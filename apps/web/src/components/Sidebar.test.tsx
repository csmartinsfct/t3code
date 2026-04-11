import "../index.css";

import type { NativeApi, ThreadId } from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ReactNode } from "react";

import { __resetNativeApiForTests } from "~/nativeApi";
import {
  SIDEBAR_TEST_NOW_ISO,
  SIDEBAR_TEST_PROJECT_ID,
  seedSidebarTestStores,
} from "~/test-utils/sidebar";
import { SidebarProvider } from "./ui/sidebar";
import type { SidebarThreadSummary, ThreadSession } from "../types";

const { dispatchCommandSpy, confirmSpy } = vi.hoisted(() => ({
  dispatchCommandSpy: vi.fn(async () => undefined),
  confirmSpy: vi.fn(async () => true),
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

const { default: Sidebar, handleProjectDeleteAction } = await import("./Sidebar");

// Audit traceability: c6cb176, caeb52a, eb37ddb.

const PROJECT_ID = SIDEBAR_TEST_PROJECT_ID;
const THREAD_ID = "thread-1" as ThreadId;
const NOW_ISO = SIDEBAR_TEST_NOW_ISO;

function makeSidebarThread(overrides?: {
  archivedAt?: string | null;
  isOrchestrationThread?: boolean;
  session?: ThreadSession | null;
}): SidebarThreadSummary {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Sidebar thread",
    interactionMode: "default" as const,
    session: overrides?.session ?? null,
    createdAt: NOW_ISO,
    archivedAt: overrides?.archivedAt ?? null,
    updatedAt: NOW_ISO,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: NOW_ISO,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    isOrchestrationThread: overrides?.isOrchestrationThread ?? false,
    parentThreadId: null,
  };
}

function seedStores(input?: {
  thread?: ReturnType<typeof makeSidebarThread>;
  orchestrationRunStatusByThreadId?: Record<string, "pending" | "running" | "completed">;
  projectExpanded?: boolean;
}) {
  seedSidebarTestStores({
    sidebarThreadsById: input?.thread ? { [THREAD_ID]: input.thread } : {},
    threadIdsByProjectId: input?.thread ? { [PROJECT_ID]: [THREAD_ID] } : {},
    orchestrationRunStatusByThreadId: input?.orchestrationRunStatusByThreadId ?? {},
    projectExpandedById: { [PROJECT_ID]: input?.projectExpanded ?? true },
  });
}

function installNativeApi() {
  dispatchCommandSpy.mockReset();
  confirmSpy.mockReset();
  confirmSpy.mockResolvedValue(true);
  window.nativeApi = {
    contextMenu: { show: vi.fn(async () => null) },
    dialogs: {
      pickFolder: vi.fn(async () => null),
      confirm: confirmSpy,
    },
    orchestration: {
      dispatchCommand: dispatchCommandSpy,
    },
    shell: {
      openExternal: vi.fn(async () => undefined),
    },
  } as unknown as NativeApi;
}

async function renderSidebar() {
  const queryClient = new QueryClient();
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider defaultOpen>
        <Sidebar />
      </SidebarProvider>
    </QueryClientProvider>,
  );

  return {
    unmount: () => screen.unmount(),
  };
}

describe("Sidebar project status and removal coverage", () => {
  beforeEach(() => {
    __resetNativeApiForTests();
    delete window.nativeApi;
    document.body.innerHTML = "";
    toastAddSpy.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    __resetNativeApiForTests();
    delete window.nativeApi;
  });

  it("renders the My Projects label and a Working pill for active orchestration threads", async () => {
    seedStores({
      thread: makeSidebarThread({ isOrchestrationThread: true }),
      orchestrationRunStatusByThreadId: { [THREAD_ID]: "running" },
    });
    installNativeApi();

    const mounted = await renderSidebar();
    try {
      expect(document.body.textContent ?? "").toContain("My Projects");
      expect(document.body.textContent ?? "").toContain("Working");
    } finally {
      await mounted.unmount();
    }
  });

  it("warns instead of confirming or dispatching when a project only has archived threads", async () => {
    const outcome = await handleProjectDeleteAction({
      project: {
        id: PROJECT_ID,
        name: "Alpha",
      },
      projectThreads: [{ archivedAt: "2026-04-11T12:30:00.000Z" }],
      confirmRemoval: confirmSpy,
      dispatchDelete: dispatchCommandSpy,
      toast: toastAddSpy,
    });

    expect(outcome).toBe("blocked");
    expect(toastAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "warning",
        title: "Project has archived threads",
      }),
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(dispatchCommandSpy).not.toHaveBeenCalled();
  });
});
