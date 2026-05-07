import { createElement } from "react";
import type {
  ManagedRunStreamEvent,
  ManagedRunSummary,
  ProjectId,
  ProjectScript,
  ThreadId,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useUiStateStore } from "~/uiStateStore";
import { toastManager } from "~/components/ui/toast";

const { getLogsSpy, navigateSpy, toastAddSpy, toastCloseSpy } = vi.hoisted(() => ({
  getLogsSpy: vi.fn(),
  navigateSpy: vi.fn(async () => {}),
  toastAddSpy: vi.fn(() => "toast-1"),
  toastCloseSpy: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

vi.mock("~/nativeApi", () => ({
  readNativeApi: () => ({
    managedRuns: {
      getLogs: getLogsSpy,
    },
  }),
}));

vi.mock("~/components/ui/toast", () => ({
  toastManager: {
    add: toastAddSpy,
    close: toastCloseSpy,
  },
}));

import {
  startManagedRunAskAiThread,
  useManagedRunCompletionToasts,
} from "./useManagedRunCompletionToasts";

const NOW_ISO = "2026-04-10T20:15:00.000Z";
const PROJECT_ID = "project-55" as ProjectId;
const SOURCE_THREAD_ID = "thread-source" as ThreadId;

let probeHandleRunEvent: ((event: ManagedRunStreamEvent) => void) | null = null;

function makeRun(overrides: Partial<ManagedRunSummary> = {}): ManagedRunSummary {
  return {
    runId: "run-1" as ManagedRunSummary["runId"],
    projectId: PROJECT_ID,
    scriptId: "preview" as ManagedRunSummary["scriptId"],
    createdByThreadId: SOURCE_THREAD_ID,
    lastTouchedByThreadId: SOURCE_THREAD_ID,
    cwd: "/repo/project",
    launchMode: "attached",
    status: "running",
    detectedUrl: null,
    detectedPort: null,
    terminalThreadId: SOURCE_THREAD_ID,
    terminalId: "default",
    terminalPid: 123,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    startedAt: NOW_ISO,
    completedAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    declaredServices: [],
    runtimeServices: [],
    inferenceStatus: "pending",
    inferenceUpdatedAt: null,
    inferenceError: null,
    ...overrides,
  };
}

function Probe(props: {
  projectId: ProjectId | undefined;
  scripts: ReadonlyArray<ProjectScript> | undefined;
}) {
  probeHandleRunEvent = useManagedRunCompletionToasts(props).handleRunEvent;
  return null;
}

async function mountProbe(props: {
  projectId: ProjectId | undefined;
  scripts: ReadonlyArray<ProjectScript> | undefined;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(createElement(Probe, props), { container: host });
  expect(probeHandleRunEvent).toBeTypeOf("function");
  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
      probeHandleRunEvent = null;
    },
  };
}

describe("useManagedRunCompletionToasts", () => {
  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
    useUiStateStore.setState({
      projectExpandedById: {},
      projectOrder: [],
      threadLastVisitedAtById: {},
      startupRecoveryStateByThreadId: {},
      managementBoardContextByProjectId: {},
      viewMode: "chat",
    });
    toastAddSpy.mockReset();
    toastAddSpy.mockReturnValue("toast-1");
    toastCloseSpy.mockReset();
    navigateSpy.mockReset();
    navigateSpy.mockResolvedValue(undefined);
    getLogsSpy.mockReset();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    probeHandleRunEvent = null;
  });

  it("creates a draft thread when Ask AI is triggered from a managed-run failure", async () => {
    const setProjectDraftThreadId = vi.fn();
    const applyStickyState = vi.fn();
    const setPrompt = vi.fn();
    const navigateToThread = vi.fn(async () => {});

    const threadId = await startManagedRunAskAiThread({
      projectId: PROJECT_ID,
      prompt: "Explain why the managed run failed.",
      composerDraftStore: {
        setProjectDraftThreadId,
        applyStickyState,
        setPrompt,
      },
      createThreadId: () => "thread-draft" as ThreadId,
      now: () => NOW_ISO,
      navigateToThread,
    });

    expect(threadId).toBe("thread-draft");
    expect(setProjectDraftThreadId).toHaveBeenCalledWith(PROJECT_ID, "thread-draft", {
      createdAt: NOW_ISO,
      runtimeMode: "full-access",
    });
    expect(applyStickyState).toHaveBeenCalledWith("thread-draft");
    expect(setPrompt).toHaveBeenCalledWith("thread-draft", "Explain why the managed run failed.");
    expect(navigateToThread).toHaveBeenCalledWith("thread-draft");
  });

  it("publishes terminal-state managed-run toasts and dedupes snapshot/live notifications", async () => {
    // Audit traceability: ea4d857, 0ae911d.
    const mounted = await mountProbe({
      projectId: PROJECT_ID,
      scripts: [
        {
          id: "preview",
          name: "Preview",
          command: "bun run dev",
          icon: "play",
          runOnWorktreeCreate: false,
        },
      ],
    });

    try {
      probeHandleRunEvent!({
        type: "snapshot",
        projectId: PROJECT_ID,
        runs: [
          makeRun({
            runId: "run-completed" as ManagedRunSummary["runId"],
            status: "completed",
            lastExitCode: 0,
            completedAt: NOW_ISO,
          }),
        ],
      });

      probeHandleRunEvent!({
        type: "upserted",
        projectId: PROJECT_ID,
        run: makeRun({
          runId: "run-completed" as ManagedRunSummary["runId"],
          status: "completed",
          lastExitCode: 0,
          completedAt: NOW_ISO,
        }),
      });

      expect(toastAddSpy).not.toHaveBeenCalled();

      probeHandleRunEvent!({
        type: "upserted",
        projectId: PROJECT_ID,
        run: makeRun({
          runId: "run-failed" as ManagedRunSummary["runId"],
          status: "failed",
          lastExitCode: 1,
          completedAt: NOW_ISO,
        }),
      });

      probeHandleRunEvent!({
        type: "upserted",
        projectId: PROJECT_ID,
        run: makeRun({
          runId: "run-failed" as ManagedRunSummary["runId"],
          status: "failed",
          lastExitCode: 1,
          completedAt: NOW_ISO,
        }),
      });

      probeHandleRunEvent!({
        type: "upserted",
        projectId: PROJECT_ID,
        run: makeRun({
          runId: "run-stopped" as ManagedRunSummary["runId"],
          status: "stopped",
          completedAt: NOW_ISO,
        }),
      });

      probeHandleRunEvent!({
        type: "upserted",
        projectId: PROJECT_ID,
        run: makeRun({
          runId: "run-lost" as ManagedRunSummary["runId"],
          status: "lost",
          completedAt: NOW_ISO,
        }),
      });

      probeHandleRunEvent!({
        type: "upserted",
        projectId: PROJECT_ID,
        run: makeRun({
          runId: "run-success" as ManagedRunSummary["runId"],
          status: "completed",
          lastExitCode: 0,
          completedAt: NOW_ISO,
        }),
      });

      expect(toastAddSpy).toHaveBeenCalledTimes(4);
      expect(toastAddSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          type: "error",
          title: '"Preview" failed (exit code 1)',
          timeout: 0,
        }),
      );
      expect(toastAddSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: "info",
          title: '"Preview" stopped',
        }),
      );
      expect(toastAddSpy).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          type: "warning",
          title: '"Preview" connection lost',
        }),
      );
      expect(toastAddSpy).toHaveBeenNthCalledWith(
        4,
        expect.objectContaining({
          type: "success",
          title: '"Preview" completed',
        }),
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back when Ask AI cannot fetch logs, seeds a draft, and navigates to it", async () => {
    toastAddSpy.mockReturnValue("toast-failure");
    getLogsSpy.mockRejectedValue(new Error("log file expired"));

    const mounted = await mountProbe({
      projectId: PROJECT_ID,
      scripts: [
        {
          id: "preview",
          name: "Preview",
          command: "bun run dev",
          icon: "play",
          runOnWorktreeCreate: false,
        },
      ],
    });

    try {
      probeHandleRunEvent!({
        type: "upserted",
        projectId: PROJECT_ID,
        run: makeRun({
          runId: "run-failed-ask-ai" as ManagedRunSummary["runId"],
          status: "failed",
          lastExitCode: 137,
          completedAt: NOW_ISO,
        }),
      });

      const failureToast = (
        toastAddSpy.mock.calls as unknown as Array<[Parameters<typeof toastManager.add>[0]]>
      ).at(0)?.[0];
      expect(failureToast).toMatchObject({
        type: "error",
        title: '"Preview" failed (exit code 137)',
      });
      expect(failureToast?.actionProps?.children).toBe("Ask AI");

      failureToast?.actionProps?.onClick?.(undefined as never);

      let draftThreadId =
        useComposerDraftStore.getState().projectDraftThreadIdByProjectId[PROJECT_ID];

      await vi.waitFor(() => {
        draftThreadId =
          useComposerDraftStore.getState().projectDraftThreadIdByProjectId[PROJECT_ID];
        expect(draftThreadId).toBeTruthy();
        expect(getLogsSpy).toHaveBeenCalledWith({
          runId: "run-failed-ask-ai",
          tailLines: 50,
        });
        expect(toastCloseSpy).toHaveBeenCalledWith("toast-failure");
        expect(navigateSpy).toHaveBeenCalledWith({
          to: "/$threadId",
          params: { threadId: draftThreadId },
        });
      });

      const draft = useComposerDraftStore.getState().draftsByThreadId[draftThreadId!];
      expect(draft?.prompt).toContain('I just triggered the action "Preview"');
      expect(draft?.prompt).toContain("Command: `bun run dev`");
      expect(draft?.prompt).toContain("Exit code: 137");
      expect(draft?.prompt).not.toContain("Output (last");
    } finally {
      await mounted.cleanup();
    }
  });
});
