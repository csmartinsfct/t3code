import "../index.css";

import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "../composerDraftStore";
import { SidebarProvider } from "../components/ui/sidebar";
import { writePersistedPanelWidth } from "../lib/persistedPanelWidth";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import { waitForElement } from "../test-utils/browser";
import type { Project, SidebarThreadSummary, Thread } from "../types";
import {
  ChatThreadRouteView,
  type ChatThreadRouteNavigate,
  type ChatThreadRouteSearch,
} from "./_chat.$threadId";

const THREAD_ID = "thread-route-browser-test";
const ORCHESTRATION_PARENT_THREAD_ID = "thread-route-orchestration-parent";
const ORCHESTRATION_CHILD_THREAD_ID = "thread-route-orchestration-child";
const ORCHESTRATION_REVIEW_THREAD_ID = "thread-route-orchestration-review";
const PROJECT_ID = "project-route-browser-test";
const PROJECT_CWD = "/repo/project";
const NOW_ISO = "2026-04-11T10:00:00.000Z";

const routeTestState = vi.hoisted(() => ({
  sheetPopups: [] as Array<{
    maxWidth: number | null;
    minWidth: number | null;
    storageKey: string | null;
  }>,
}));

vi.mock("../components/ChatView", () => ({
  default: ({ threadId }: { threadId: string }) => (
    <div data-testid="chat-view">Chat view {threadId}</div>
  ),
}));

vi.mock("../components/management/ManagementView", () => ({
  ManagementView: ({ threadId, projectId }: { threadId: string; projectId: string }) => (
    <div data-testid="management-view">
      Management view {threadId}:{projectId}
    </div>
  ),
}));

function mockDiffWorkerPoolProvider() {
  return {
    DiffWorkerPoolProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
}

vi.mock("../components/DiffWorkerPoolProvider", mockDiffWorkerPoolProvider);
vi.mock("../components/DiffWorkerPoolProvider.tsx", mockDiffWorkerPoolProvider);

function mockDiffPanel() {
  return {
    default: () => <div data-testid="diff-panel">Diff panel body</div>,
  };
}

vi.mock("../components/DiffPanel", mockDiffPanel);
vi.mock("../components/DiffPanel.tsx", mockDiffPanel);

function mockFileExplorer() {
  return {
    default: ({ cwd, onClose }: { cwd: string; onClose: () => void }) => (
      <div data-testid="file-explorer">
        File explorer body {cwd}
        <button type="button" onClick={onClose}>
          Close file explorer
        </button>
      </div>
    ),
  };
}

vi.mock("../components/file-explorer/FileExplorer", mockFileExplorer);
vi.mock("../components/file-explorer/FileExplorer.tsx", mockFileExplorer);

vi.mock("../components/ui/sheet", async () => vi.importActual("../components/ui/sheet"));

vi.mock("../hooks/useMediaQuery", () => ({
  useMediaQuery: vi.fn(() => true),
}));

vi.mock("../uiStateStore", async () => vi.importActual("../uiStateStore"));

vi.mock("../store", async () => vi.importActual("../store"));

vi.mock("../composerDraftStore", async () => vi.importActual("../composerDraftStore"));

vi.mock("../projectScripts", () => ({
  projectScriptCwd: ({
    project,
    worktreePath,
  }: {
    project: { cwd: string };
    worktreePath: string | null;
  }) => worktreePath ?? project.cwd,
}));

const ROUTE_PROJECT: Project = {
  id: PROJECT_ID as never,
  name: "Project",
  cwd: PROJECT_CWD,
  defaultModelSelection: {
    provider: "codex",
    model: "gpt-5",
  },
  systemPrompt: null,
  promptOverrides: { orchestration: {} },
  scripts: [],
};

const ROUTE_THREAD: Thread = {
  id: THREAD_ID as never,
  codexThreadId: null,
  projectId: ROUTE_PROJECT.id,
  title: "Route browser test thread",
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
  turnDiffSummaries: [],
  activities: [],
  isOrchestrationThread: false,
  parentThreadId: null,
  ticketId: null,
};

const ROUTE_SIDEBAR_THREAD: SidebarThreadSummary = {
  id: ROUTE_THREAD.id,
  projectId: ROUTE_THREAD.projectId,
  title: ROUTE_THREAD.title,
  interactionMode: ROUTE_THREAD.interactionMode,
  session: ROUTE_THREAD.session,
  createdAt: ROUTE_THREAD.createdAt,
  archivedAt: ROUTE_THREAD.archivedAt,
  updatedAt: ROUTE_THREAD.updatedAt,
  latestTurn: ROUTE_THREAD.latestTurn,
  branch: ROUTE_THREAD.branch,
  worktreePath: ROUTE_THREAD.worktreePath,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  isOrchestrationThread: ROUTE_THREAD.isOrchestrationThread,
  parentThreadId: ROUTE_THREAD.parentThreadId,
};

const ORCHESTRATION_PARENT_THREAD: Thread = {
  ...ROUTE_THREAD,
  id: ORCHESTRATION_PARENT_THREAD_ID as never,
  title: "Route orchestration timeline",
  isOrchestrationThread: true,
};

const ORCHESTRATION_CHILD_THREAD: Thread = {
  ...ROUTE_THREAD,
  id: ORCHESTRATION_CHILD_THREAD_ID as never,
  title: "Route waiting child",
  parentThreadId: ORCHESTRATION_PARENT_THREAD.id,
  ticketId: "ticket-route-orchestration-child" as never,
};

const ORCHESTRATION_REVIEW_THREAD: Thread = {
  ...ROUTE_THREAD,
  id: ORCHESTRATION_REVIEW_THREAD_ID as never,
  title: "Route review child",
  parentThreadId: ORCHESTRATION_PARENT_THREAD.id,
  ticketId: "ticket-route-orchestration-child" as never,
};

const ORCHESTRATION_PARENT_SIDEBAR_THREAD: SidebarThreadSummary = {
  ...ROUTE_SIDEBAR_THREAD,
  id: ORCHESTRATION_PARENT_THREAD.id,
  title: ORCHESTRATION_PARENT_THREAD.title,
  isOrchestrationThread: true,
};

const ORCHESTRATION_CHILD_SIDEBAR_THREAD: SidebarThreadSummary = {
  ...ROUTE_SIDEBAR_THREAD,
  id: ORCHESTRATION_CHILD_THREAD.id,
  title: ORCHESTRATION_CHILD_THREAD.title,
  parentThreadId: ORCHESTRATION_PARENT_THREAD.id,
};

const ORCHESTRATION_REVIEW_SIDEBAR_THREAD: SidebarThreadSummary = {
  ...ROUTE_SIDEBAR_THREAD,
  id: ORCHESTRATION_REVIEW_THREAD.id,
  title: ORCHESTRATION_REVIEW_THREAD.title,
  parentThreadId: ORCHESTRATION_PARENT_THREAD.id,
};

async function mountRoute(input: {
  initialSearch: ChatThreadRouteSearch;
  // Defaults to the base route thread unless a test needs a specific orchestration thread.
  initialThreadId?: string;
}) {
  routeTestState.sheetPopups.length = 0;
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  document.body.append(host);

  const navigationState = {
    currentSearch: input.initialSearch,
  };

  function Harness() {
    const [search, setSearch] = useState<ChatThreadRouteSearch>(input.initialSearch);
    const threadId = input.initialThreadId ?? THREAD_ID;

    const setSearchState = (
      searchUpdate:
        | ChatThreadRouteSearch
        | ((previous: ChatThreadRouteSearch) => ChatThreadRouteSearch | undefined),
    ) => {
      setSearch((previous) => {
        const next =
          typeof searchUpdate === "function" ? (searchUpdate(previous) ?? previous) : searchUpdate;
        navigationState.currentSearch = next;
        return next;
      });
    };

    const navigate: ChatThreadRouteNavigate = (input) => {
      if (input.to !== "/$threadId") return Promise.resolve();

      const searchUpdate = input.search;
      if (!searchUpdate) return Promise.resolve();

      setSearchState(searchUpdate);
      return Promise.resolve();
    };

    return (
      <SidebarProvider>
        <ChatThreadRouteView
          threadId={threadId as never}
          search={search}
          diffPanelRenderer={(mode) => (
            <div data-testid={`diff-panel-${mode}`}>Diff panel body</div>
          )}
          fileExplorerRenderer={({ cwd, onClose }) => (
            <div data-testid="file-explorer">
              File explorer body {cwd}
              <button type="button" onClick={onClose}>
                Close file explorer
              </button>
            </div>
          )}
          navigate={navigate}
        />
      </SidebarProvider>
    );
  }

  const screen = await render(<Harness />, { container: host });

  return {
    host,
    navigationState,
    unmount: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("chat route management overlays", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    routeTestState.sheetPopups.length = 0;
    localStorage.clear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1_000,
    });
    useStore.setState({
      bootstrapComplete: true,
      projects: [ROUTE_PROJECT],
      threads: [ROUTE_THREAD],
      threadsById: {
        [THREAD_ID]: ROUTE_THREAD,
      },
      sidebarThreadsById: {
        [THREAD_ID]: ROUTE_SIDEBAR_THREAD,
      },
      threadIdsByProjectId: {
        [PROJECT_ID]: [THREAD_ID as never],
      },
      orchestrationRunStatusByThreadId: {},
    });
    useUiStateStore.setState((state) => ({ ...state, viewMode: "management" }));
    useComposerDraftStore.setState((state) => ({ ...state, draftThreadsByThreadId: {} }));
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the diff overlay mounted in management mode and wires sheet resizing", async () => {
    // Audit traceability: b984bf3.
    writePersistedPanelWidth("chat_diff_sheet_width", 300, 1_000);
    const mounted = await mountRoute({ initialSearch: { diff: "1" } });

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Diff panel body");
      });

      const popup = await waitForElement(
        () => document.querySelector<HTMLElement>("[data-slot='sheet-popup']"),
        "Unable to find the diff sheet popup.",
      );
      expect(popup.style.width).toBe("400px");

      const backdrop = await waitForElement(
        () => document.querySelector<HTMLElement>("[data-slot='sheet-backdrop']"),
        "Unable to find the diff sheet backdrop.",
      );
      backdrop.click();

      await vi.waitFor(() => {
        expect(mounted.navigationState.currentSearch.diff).toBeUndefined();
      });
    } finally {
      await mounted.unmount();
    }
  });

  it("keeps the file explorer overlay mounted in management mode and closes via its route callback", async () => {
    writePersistedPanelWidth("chat_file_explorer_sheet_width", 500, 1_000);
    const mounted = await mountRoute({ initialSearch: { fileExplorer: "1" } });

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain(`File explorer body ${PROJECT_CWD}`);
      });

      const popup = await waitForElement(
        () => document.querySelector<HTMLElement>("[data-slot='sheet-popup']"),
        "Unable to find the file explorer sheet popup.",
      );
      expect(popup).toBeTruthy();

      const closeExplorerButton = Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Close file explorer"),
      );
      if (!(closeExplorerButton instanceof HTMLButtonElement)) {
        throw new Error("Unable to find the file explorer close button.");
      }
      closeExplorerButton.click();

      await vi.waitFor(() => {
        expect(mounted.navigationState.currentSearch.fileExplorer).toBeUndefined();
      });
    } finally {
      await mounted.unmount();
    }
  });

  it("keeps orchestration parent and child routes compatible with management overlays", async () => {
    // Audit traceability: 3b13b26, 5b6a8b2.
    useStore.setState((state) => ({
      ...state,
      threads: [
        ORCHESTRATION_PARENT_THREAD,
        ORCHESTRATION_CHILD_THREAD,
        ORCHESTRATION_REVIEW_THREAD,
      ],
      threadsById: {
        [ORCHESTRATION_PARENT_THREAD_ID]: ORCHESTRATION_PARENT_THREAD,
        [ORCHESTRATION_CHILD_THREAD_ID]: ORCHESTRATION_CHILD_THREAD,
        [ORCHESTRATION_REVIEW_THREAD_ID]: ORCHESTRATION_REVIEW_THREAD,
      },
      sidebarThreadsById: {
        [ORCHESTRATION_PARENT_THREAD_ID]: ORCHESTRATION_PARENT_SIDEBAR_THREAD,
        [ORCHESTRATION_CHILD_THREAD_ID]: ORCHESTRATION_CHILD_SIDEBAR_THREAD,
        [ORCHESTRATION_REVIEW_THREAD_ID]: ORCHESTRATION_REVIEW_SIDEBAR_THREAD,
      },
      threadIdsByProjectId: {
        [PROJECT_ID]: [
          ORCHESTRATION_PARENT_THREAD_ID as never,
          ORCHESTRATION_CHILD_THREAD_ID as never,
          ORCHESTRATION_REVIEW_THREAD_ID as never,
        ],
      },
    }));

    const parentRoute = await mountRoute({
      initialSearch: { diff: "1" },
      initialThreadId: ORCHESTRATION_PARENT_THREAD_ID,
    });

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Diff panel body");
      });
    } finally {
      await parentRoute.unmount();
    }

    const childRoute = await mountRoute({
      initialSearch: { fileExplorer: "1" },
      initialThreadId: ORCHESTRATION_CHILD_THREAD_ID,
    });

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain(`File explorer body ${PROJECT_CWD}`);
      });
    } finally {
      await childRoute.unmount();
    }

    const reviewChildRoute = await mountRoute({
      initialSearch: { diff: "1" },
      initialThreadId: ORCHESTRATION_REVIEW_THREAD_ID,
    });

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Diff panel body");
      });
    } finally {
      await reviewChildRoute.unmount();
    }
  });
});
