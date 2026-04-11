import "../../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  type NativeApi,
  type ProjectId,
  type ServerConfig,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useSettings } from "../../hooks/useSettings";
import { waitForElement } from "../../test-utils/browser";
import { __resetNativeApiForTests } from "../../nativeApi";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import { useStore } from "../../store";
import { createReadyServerProvider } from "../../test/providerTestUtils";
import { useTerminalStateStore } from "../../terminalStateStore";
import type { Project, Thread } from "../../types";

const { mockNavigate, routeThreadIdState } = vi.hoisted(() => ({
  mockNavigate: vi.fn(async () => undefined),
  routeThreadIdState: { current: null as ThreadId | null },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: ({ select }: { select?: (value: { threadId?: string }) => unknown } = {}) => {
      const params =
        routeThreadIdState.current === null ? {} : { threadId: routeThreadIdState.current };
      return select ? select(params) : params;
    },
  };
});

vi.mock("../chat/ProviderModelPicker", () => ({
  ProviderModelPicker: ({
    provider,
    model,
    onProviderModelChange,
  }: {
    provider: string;
    model: string;
    onProviderModelChange?: (provider: string, model: string) => void;
  }) => (
    <button
      type="button"
      data-provider-model-picker="true"
      data-provider={provider}
      data-model={model}
      onClick={() => onProviderModelChange?.("claudeAgent", "claude-sonnet-4-6")}
    >
      {model}
    </button>
  ),
}));

vi.mock("../chat/TraitsPicker", () => ({
  TraitsPicker: () => null,
}));

vi.mock("../../hooks/useTheme", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useTheme: () => {
      const [theme, setTheme] = React.useState("system");
      return { theme, setTheme };
    },
  };
});

const { ArchivedThreadsPanel, GeneralSettingsPanel } = await import("./SettingsPanels");

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpTracesEnabled: true,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

function createProvider(input: { provider: string; displayName?: string }): ServerProvider {
  return createReadyServerProvider({
    ...input,
    checkedAt: "2026-04-10T00:00:00.000Z",
  });
}

const PROJECT_ID = "project-1" as ProjectId;
const NOW_ISO = "2026-04-11T12:00:00.000Z";

const TEST_PROJECT: Project = {
  id: PROJECT_ID,
  name: "Alpha",
  cwd: "/repo/alpha",
  defaultModelSelection: {
    provider: "codex",
    model: "gpt-5",
  },
  systemPrompt: null,
  promptOverrides: { orchestration: {} },
  scripts: [],
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
};

function createThread(input: {
  id: ThreadId;
  title: string;
  archivedAt?: string | null;
  createdAt?: string;
  worktreePath?: string | null;
}): Thread {
  return {
    id: input.id,
    codexThreadId: null,
    projectId: PROJECT_ID,
    title: input.title,
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
    createdAt: input.createdAt ?? NOW_ISO,
    archivedAt: input.archivedAt ?? null,
    updatedAt: input.archivedAt ?? input.createdAt ?? NOW_ISO,
    latestTurn: null,
    branch: null,
    worktreePath: input.worktreePath ?? null,
    turnDiffSummaries: [],
    activities: [],
    isOrchestrationThread: false,
    parentThreadId: null,
    ticketId: null,
  };
}

function seedArchivedThreadsPanel(threads: Thread[]) {
  useStore.setState({
    projects: [TEST_PROJECT],
    threads,
    threadsById: Object.fromEntries(threads.map((thread) => [thread.id, thread])) as Record<
      string,
      Thread
    >,
    sidebarThreadsById: {},
    threadIdsByProjectId: { [PROJECT_ID]: threads.map((thread) => thread.id) },
    bootstrapComplete: true,
    orchestrationRunStatusByThreadId: {},
  });
  useComposerDraftStore.setState({
    draftsByThreadId: {},
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
  useTerminalStateStore.setState({
    terminalStateByThreadId: {},
    terminalEventEntriesByKey: {},
    nextTerminalEventId: 1,
  });
}

async function renderArchivedThreadsPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AppAtomRegistryProvider>
        <ArchivedThreadsPanel />
      </AppAtomRegistryProvider>
    </QueryClientProvider>,
  );
}

function ReviewIterationsHarness() {
  const settings = useSettings();

  return <div data-review-iterations>{settings.maxReviewIterations}</div>;
}

function SettingsModelDefaultsHarness() {
  const settings = useSettings();

  return (
    <div>
      <div data-implementer-model>{settings.orchestrationImplementerModelSelection.model}</div>
      <div data-reviewer-model>{settings.orchestrationReviewerModelSelection.model}</div>
    </div>
  );
}

function createDeferredPromise() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function findDeleteAllArchivedThreadsButton() {
  return (
    [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Delete all"),
    ) ?? null
  );
}

async function clickDeleteAllArchivedThreads() {
  const deleteAllButton = await waitForElement(
    findDeleteAllArchivedThreadsButton,
    "Unable to find the archived-thread bulk delete button.",
  );
  deleteAllButton.click();
}

function createArchivedThreadsBulkDeleteScenario() {
  const firstThreadId = "thread-archived-1" as ThreadId;
  const secondThreadId = "thread-archived-2" as ThreadId;
  const activeThreadId = "thread-active" as ThreadId;
  const deleteFirst = createDeferredPromise();
  const deleteSecond = createDeferredPromise();
  const confirmSpy = vi
    .fn<NativeApi["dialogs"]["confirm"]>()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true);
  const dispatchCommandSpy = vi.fn<NativeApi["orchestration"]["dispatchCommand"]>(
    async (command) => {
      if (command.type !== "thread.delete") {
        return { sequence: 1 };
      }
      if (command.threadId === firstThreadId) {
        await deleteFirst.promise;
      }
      if (command.threadId === secondThreadId) {
        await deleteSecond.promise;
      }
      useStore.setState((state) => {
        const remainingThreads = state.threads.filter((thread) => thread.id !== command.threadId);
        const { [command.threadId]: _deletedThread, ...remainingThreadsById } = state.threadsById;
        return {
          ...state,
          threads: remainingThreads,
          threadsById: remainingThreadsById,
        };
      });
      return { sequence: 1 };
    },
  );
  const terminalCloseSpy = vi.fn<NativeApi["terminal"]["close"]>().mockResolvedValue(undefined);
  const removeWorktreeSpy = vi
    .fn<NativeApi["git"]["removeWorktree"]>()
    .mockResolvedValue(undefined);

  routeThreadIdState.current = firstThreadId;
  seedArchivedThreadsPanel([
    createThread({
      id: firstThreadId,
      title: "Archived alpha",
      archivedAt: "2026-04-11T14:00:00.000Z",
      worktreePath: "/Users/cristianomartins/.t3/worktrees/t3code/alpha-worktree",
    }),
    createThread({
      id: secondThreadId,
      title: "Archived beta",
      archivedAt: "2026-04-11T13:00:00.000Z",
      worktreePath: "/tmp/custom-worktrees/beta-worktree",
    }),
    createThread({
      id: activeThreadId,
      title: "Active thread",
    }),
  ]);
  window.nativeApi = {
    dialogs: {
      confirm: confirmSpy,
    },
    orchestration: {
      dispatchCommand: dispatchCommandSpy,
    },
    terminal: {
      close: terminalCloseSpy,
    },
    git: {
      removeWorktree: removeWorktreeSpy,
    },
  } as unknown as NativeApi;

  return {
    activeThreadId,
    confirmSpy,
    deleteFirst,
    deleteSecond,
    dispatchCommandSpy,
    firstThreadId,
    removeWorktreeSpy,
    secondThreadId,
    terminalCloseSpy,
  };
}

describe("GeneralSettingsPanel observability", () => {
  beforeEach(() => {
    resetServerStateForTests();
    __resetNativeApiForTests();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    resetServerStateForTests();
    __resetNativeApiForTests();
    document.body.innerHTML = "";
  });

  it("shows diagnostics inside About with a single logs-folder action", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("About")).toBeInTheDocument();
    await expect.element(page.getByText("Diagnostics")).toBeInTheDocument();
    await expect.element(page.getByText("Open logs folder")).toBeInTheDocument();
    await expect
      .element(page.getByText("/repo/project/.t3/logs", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Local trace file. OTLP exporting traces to http://localhost:4318/v1/traces.",
        ),
      )
      .toBeInTheDocument();
    await expect.element(page.getByText("Automated review cycles")).toBeInTheDocument();
    await expect.element(page.getByText("Resume agents on startup")).toBeInTheDocument();
    await expect
      .element(page.getByLabelText("Maximum automated review iterations"))
      .toHaveAttribute("value", "3");
  });

  it("opens the logs folder in the preferred editor", async () => {
    const openInEditor = vi.fn<NativeApi["shell"]["openInEditor"]>().mockResolvedValue(undefined);
    window.nativeApi = {
      shell: {
        openInEditor,
      },
    } as unknown as NativeApi;

    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const openLogsButton = page.getByText("Open logs folder");
    await openLogsButton.click();

    expect(openInEditor).toHaveBeenCalledWith("/repo/project/.t3/logs", "cursor");
  });

  it("shows MCP delivery and orchestration model defaults", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
        <SettingsModelDefaultsHarness />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByRole("heading", { name: "MCP delivery" })).toBeInTheDocument();
    expect(
      (document.querySelector('[aria-label="MCP delivery mode"]') as HTMLElement | null)
        ?.textContent,
    ).toContain("Native tools");

    const implementerDefault = document.querySelector("[data-implementer-model]");
    const reviewerDefault = document.querySelector("[data-reviewer-model]");
    expect(implementerDefault?.textContent).toBe("gpt-5.4-mini");
    expect(reviewerDefault?.textContent).toBe("gpt-5.4-mini");
  });

  it("shows automated review cycles with the visible default state", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
        <ReviewIterationsHarness />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Automated review cycles")).toBeInTheDocument();
    expect(document.querySelector("[data-review-iterations]")?.textContent).toBe("3");
  });
});

describe("GeneralSettingsPanel discovered Claude profiles", () => {
  beforeEach(() => {
    resetServerStateForTests();
    __resetNativeApiForTests();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    resetServerStateForTests();
    __resetNativeApiForTests();
    document.body.innerHTML = "";
  });

  it("renders discovered Claude profiles as distinct provider cards", async () => {
    // Audit traceability: e1077b5, 7d6be28.
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [
        createProvider({ provider: "codex" }),
        createProvider({ provider: "claudeAgent", displayName: "Claude" }),
        createProvider({ provider: "claudeAgent:metric", displayName: "Claude (metric)" }),
        createProvider({ provider: "claudeAgent:zbd", displayName: "Claude (zbd)" }),
      ],
    });

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect
      .element(page.getByRole("heading", { name: "Claude", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Claude (metric)" }))
      .toBeInTheDocument();
    await expect.element(page.getByRole("heading", { name: "Claude (zbd)" })).toBeInTheDocument();
  });

  it("keeps collapse state separate for each discovered Claude profile card", async () => {
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [
        createProvider({ provider: "codex" }),
        createProvider({ provider: "claudeAgent", displayName: "Claude" }),
        createProvider({ provider: "claudeAgent:metric", displayName: "Claude (metric)" }),
        createProvider({ provider: "claudeAgent:zbd", displayName: "Claude (zbd)" }),
      ],
    });

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Toggle Claude (metric) details" }).click();

    await expect.element(page.getByText("Claude (metric) binary path")).toBeInTheDocument();
    await expect.element(page.getByText("Claude (zbd) binary path")).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Toggle Claude (zbd) details" }).click();

    await expect.element(page.getByText("Claude (metric) binary path")).toBeInTheDocument();
    await expect.element(page.getByText("Claude (zbd) binary path")).toBeInTheDocument();
  });
});

describe("ArchivedThreadsPanel bulk delete", () => {
  beforeEach(() => {
    resetServerStateForTests();
    __resetNativeApiForTests();
    localStorage.clear();
    document.body.innerHTML = "";
    mockNavigate.mockReset();
    routeThreadIdState.current = null;
    seedArchivedThreadsPanel([]);
  });

  afterEach(() => {
    resetServerStateForTests();
    __resetNativeApiForTests();
    document.body.innerHTML = "";
    delete window.nativeApi;
  });

  it("shows the bulk-delete confirmation and orphaned-worktree prompt in sequence", async () => {
    const { confirmSpy } = createArchivedThreadsBulkDeleteScenario();
    const screen = await renderArchivedThreadsPanel();

    try {
      await clickDeleteAllArchivedThreads();

      await vi.waitFor(() => {
        expect(confirmSpy).toHaveBeenCalledTimes(2);
      });
      expect(confirmSpy).toHaveBeenNthCalledWith(
        1,
        [
          "Delete 2 archived threads?",
          "This permanently clears conversation history for these threads.",
        ].join("\n"),
      );
      expect(confirmSpy).toHaveBeenNthCalledWith(
        2,
        [
          "2 orphaned worktrees will be left behind:",
          "  alpha-worktree",
          "  beta-worktree",
          "",
          "Delete them too?",
        ].join("\n"),
      );
    } finally {
      await screen.unmount();
    }
  });

  it("dispatches archived-thread deletions in parallel and navigates once after the active thread resolves", async () => {
    const {
      activeThreadId,
      deleteFirst,
      deleteSecond,
      dispatchCommandSpy,
      firstThreadId,
      secondThreadId,
      terminalCloseSpy,
    } = createArchivedThreadsBulkDeleteScenario();
    const screen = await renderArchivedThreadsPanel();

    try {
      await clickDeleteAllArchivedThreads();

      await vi.waitFor(() => {
        const deletedThreadIds = dispatchCommandSpy.mock.calls
          .map(([command]) => command)
          .filter((command) => command.type === "thread.delete")
          .map((command) => command.threadId);
        expect(deletedThreadIds).toEqual(expect.arrayContaining([firstThreadId, secondThreadId]));
      });

      expect(mockNavigate).not.toHaveBeenCalled();

      deleteSecond.resolve();
      await vi.waitFor(() => {
        expect(terminalCloseSpy).toHaveBeenCalledWith({
          threadId: secondThreadId,
          deleteHistory: true,
        });
      });
      expect(mockNavigate).not.toHaveBeenCalled();

      deleteFirst.resolve();

      await vi.waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledTimes(1);
      });
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/$threadId",
        params: { threadId: activeThreadId },
        replace: true,
      });
    } finally {
      await screen.unmount();
    }
  });

  it("removes orphaned worktrees for each deleted archived thread after confirmation", async () => {
    const { deleteFirst, deleteSecond, removeWorktreeSpy } =
      createArchivedThreadsBulkDeleteScenario();
    const screen = await renderArchivedThreadsPanel();

    try {
      await clickDeleteAllArchivedThreads();
      deleteSecond.resolve();
      deleteFirst.resolve();

      await vi.waitFor(() => {
        expect(removeWorktreeSpy).toHaveBeenCalledTimes(2);
      });
      expect(removeWorktreeSpy).toHaveBeenCalledWith({
        cwd: "/repo/alpha",
        path: "/Users/cristianomartins/.t3/worktrees/t3code/alpha-worktree",
        force: true,
      });
      expect(removeWorktreeSpy).toHaveBeenCalledWith({
        cwd: "/repo/alpha",
        path: "/tmp/custom-worktrees/beta-worktree",
        force: true,
      });
    } finally {
      await screen.unmount();
    }
  });

  it("does not open the orphaned-worktree prompt when the bulk-delete confirmation is declined", async () => {
    const archivedThreadId = "thread-archived-1" as ThreadId;
    const confirmSpy = vi.fn<NativeApi["dialogs"]["confirm"]>().mockResolvedValue(false);
    const dispatchCommandSpy = vi.fn<NativeApi["orchestration"]["dispatchCommand"]>();

    seedArchivedThreadsPanel([
      createThread({
        id: archivedThreadId,
        title: "Archived alpha",
        archivedAt: "2026-04-11T14:00:00.000Z",
        worktreePath: "/Users/cristianomartins/.t3/worktrees/t3code/alpha-worktree",
      }),
    ]);
    window.nativeApi = {
      dialogs: {
        confirm: confirmSpy,
      },
      orchestration: {
        dispatchCommand: dispatchCommandSpy,
      },
      terminal: {
        close: vi.fn(async () => undefined),
      },
      git: {
        removeWorktree: vi.fn(async () => undefined),
      },
    } as unknown as NativeApi;

    const screen = await renderArchivedThreadsPanel();

    try {
      await clickDeleteAllArchivedThreads();

      await vi.waitFor(() => {
        expect(confirmSpy).toHaveBeenCalledTimes(1);
      });
      expect(dispatchCommandSpy).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });
});
