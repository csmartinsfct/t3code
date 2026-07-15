import "../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  ORCHESTRATION_WS_METHODS,
  type MessageId,
  type OrchestrationReadModel,
  type ProjectId,
  type ServerConfig,
  type ServerLifecycleWelcomePayload,
  type ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { http, HttpResponse, ws } from "msw";
import { setupWorker } from "msw/browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { APP_DISPLAY_NAME } from "../branding";
import { useComposerDraftStore } from "../composerDraftStore";
import { __resetNativeApiForTests } from "../nativeApi";
import { getRouter } from "../router";
import { useStore } from "../store";
import { NativeApiUnavailableFallback } from "./__root";
import { BrowserWsRpcHarness } from "../../test/wsRpcHarness";

const REMOVED_CONNECTION_SURFACE_COPY = [
  "Cannot reach the T3 server",
  "WebSocket connection unavailable",
  "Show connection details",
  "Some requests are slow",
  "Disconnected from T3 Server",
  "Reconnected to T3 Server",
];

const THREAD_ID = "thread-root-route-test" as ThreadId;
const PROJECT_ID = "project-root-route-test" as ProjectId;
const NOW_ISO = "2026-04-11T12:00:00.000Z";

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: ServerLifecycleWelcomePayload;
}

let fixture: TestFixture;
const rpcHarness = new BrowserWsRpcHarness();
const wsLink = ws.link(/ws(s)?:\/\/.*/);

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [
      {
        provider: "codex",
        enabled: true,
        installed: true,
        version: "0.116.0",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: NOW_ISO,
        models: [],
      },
    ],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      enableAssistantStreaming: false,
      defaultThreadEnvMode: "local" as const,
      textGenerationModelSelection: { provider: "codex" as const, model: "gpt-5.4-mini" },
      providers: {
        codex: { enabled: true, binaryPath: "", homePath: "", customModels: [] },
        claudeAgent: { enabled: true, binaryPath: "", configDir: "", customModels: [] },
        gemini: { enabled: true, binaryPath: "", homePath: "", customModels: [] },
        cursor: {
          enabled: true,
          binaryPath: "",
          launchCommand: [],
          homePath: "",
          configDir: "",
          dataDir: "",
          env: {},
          customModels: [],
        },
        codexProfiles: [],
        claudeProfiles: [],
        cursorProfiles: [],
      },
    },
  };
}

function createMinimalSnapshot(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project",
        nameHidden: false,
        workspaceRoot: "/repo/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        scripts: [],
        systemPrompt: null,
        promptOverrides: { orchestration: {} },
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: THREAD_ID,
        projectId: PROJECT_ID,
        title: "Root route test thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        parentThreadId: null,
        isOrchestrationThread: false,
        ticketId: null,
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        archivedAt: null,
        deletedAt: null,
        messages: [
          {
            id: "msg-1" as MessageId,
            role: "user",
            text: "hello",
            turnId: null,
            streaming: false,
            createdAt: NOW_ISO,
            updatedAt: NOW_ISO,
          },
        ],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId: THREAD_ID,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
    updatedAt: NOW_ISO,
  };
}

function buildFixture(): TestFixture {
  return {
    snapshot: createMinimalSnapshot(),
    serverConfig: createBaseServerConfig(),
    welcome: {
      cwd: "/repo/project",
      projectName: "Project",
    },
  };
}

function resolveWsRpc(tag: string): unknown {
  if (
    tag === ORCHESTRATION_WS_METHODS.getSnapshot ||
    tag === ORCHESTRATION_WS_METHODS.getStartupSnapshot
  ) {
    return fixture.snapshot;
  }
  if (tag === WS_METHODS.serverGetConfig) {
    return fixture.serverConfig;
  }
  if (tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      nextCursor: null,
      totalCount: 1,
      branches: [{ name: "main", current: true, isDefault: true, worktreePath: null }],
    };
  }
  if (tag === WS_METHODS.gitStatus) {
    return {
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
    };
  }
  if (tag === WS_METHODS.projectsSearchEntries) {
    return { entries: [], truncated: false };
  }
  if (tag === WS_METHODS.serverResolveMcpServers) {
    return { status: "ready", serverNames: [] };
  }
  if (tag === WS_METHODS.serverResolveSkills) {
    return { skills: [] };
  }
  return {};
}

const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    void rpcHarness.connect(client);
    client.addEventListener("message", (event) => {
      const rawData = event.data;
      if (typeof rawData !== "string") return;
      void rpcHarness.onMessage(rawData);
    });
  }),
  http.get("*/attachments/:attachmentId", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

function queryToastTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="toast-title"]')).map(
    (element) => element.textContent ?? "",
  );
}

async function waitForComposerEditor(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(document.querySelector('[data-testid="composer-editor"]')).toBeTruthy();
    },
    { timeout: 8_000, interval: 16 },
  );
}

async function mountApp(initialEntries: string[]): Promise<{ cleanup: () => Promise<void> }> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const router = getRouter(createMemoryHistory({ initialEntries }));
  const screen = await render(<RouterProvider router={router} />, { container: host });

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

function expectNoLegacyConnectionSurface() {
  const text = document.body.textContent ?? "";
  for (const removedCopy of REMOVED_CONNECTION_SURFACE_COPY) {
    expect(text).not.toContain(removedCopy);
  }

  expect(queryToastTitles()).toHaveLength(0);
  expect(
    Array.from(document.querySelectorAll("button")).some((button) => {
      const label = button.textContent?.trim();
      return label === "Retry" || label === "Retry now";
    }),
  ).toBe(false);
}

describe("root route connection surfaces", () => {
  beforeAll(async () => {
    fixture = buildFixture();
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: { url: "/mockServiceWorker.js" },
    });
  });

  afterAll(async () => {
    await rpcHarness.disconnect();
    await worker.stop();
  });

  beforeEach(async () => {
    fixture = buildFixture();
    await rpcHarness.reset({
      resolveUnary: (request) => resolveWsRpc(request._tag),
      getInitialStreamValues: (request) => {
        if (request._tag === WS_METHODS.subscribeServerLifecycle) {
          return [
            {
              version: 1,
              sequence: 1,
              type: "welcome",
              payload: fixture.welcome,
            },
          ];
        }
        if (request._tag === WS_METHODS.subscribeServerConfig) {
          return [
            {
              version: 1,
              type: "snapshot",
              config: fixture.serverConfig,
            },
          ];
        }
        return [];
      },
    });
    __resetNativeApiForTests();
    localStorage.clear();
    document.body.innerHTML = "";
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
    useStore.setState({
      projects: [],
      threads: [],
      threadsById: {},
      sidebarThreadsById: {},
      threadIdsByProjectId: {},
      bootstrapComplete: false,
      orchestrationRunStatusByThreadId: {},
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the real bootstrap fallback shell markup", async () => {
    // Audit traceability: 69a1cec, b8a41f3.
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<NativeApiUnavailableFallback />, { container: host });
    try {
      await expect
        .element(page.getByText(`Connecting to ${APP_DISPLAY_NAME} server...`))
        .toBeInTheDocument();
      expectNoLegacyConnectionSurface();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("keeps the mounted app shell free of the reverted websocket copy and retry affordances", async () => {
    // Audit traceability: 69a1cec, b8a41f3.
    const mounted = await mountApp([`/${THREAD_ID}`]);

    try {
      await waitForComposerEditor();
      await expect.element(page.getByTestId("composer-editor")).toBeInTheDocument();

      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));

      expectNoLegacyConnectionSurface();
    } finally {
      await mounted.cleanup();
    }
  });
});
