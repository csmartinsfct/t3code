import "../../index.css";

import type {
  NativeApi,
  ProjectId,
  ScheduledTask,
  ScheduledTaskId,
  ScheduledTaskRun,
  ScheduledTaskRunId,
  ThreadId,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../../nativeApi";
import { waitForElement } from "../../test-utils/browser";
import { ScheduledTaskDetailPanel } from "./ScheduledTaskDetailPanel";

const { mockNavigate, routeTaskIdState } = vi.hoisted(() => ({
  mockNavigate: vi.fn(async () => undefined),
  routeTaskIdState: { current: "job-detail" },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ taskId: routeTaskIdState.current }),
  };
});

const PROJECT_ID = "project-1" as ProjectId;
const THREAD_ID = "thread-run-open" as ThreadId;
const NOW_ISO = "2026-04-11T12:00:00.000Z";

function createScheduledTask(input?: Partial<ScheduledTask>): ScheduledTask {
  return {
    jobId: "job-detail" as ScheduledTaskId,
    name: "Daily health check",
    description: "Run a recurring health check.",
    cronExpression: "0 9 * * *",
    enabled: true,
    jobType: "new_thread",
    newThreadConfig: {
      projectId: PROJECT_ID,
      prompt: "Check system health.",
      autoSend: false,
    },
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    lastRunAt: null,
    nextRunAt: "2026-04-12T09:00:00.000Z",
    ...input,
  };
}

function createRun(input?: Partial<ScheduledTaskRun>): ScheduledTaskRun {
  return {
    runId: "run-1" as ScheduledTaskRunId,
    jobId: "job-detail" as ScheduledTaskId,
    status: "created",
    threadId: THREAD_ID,
    errorMessage: null,
    scheduledAt: NOW_ISO,
    executedAt: NOW_ISO,
    ...input,
  };
}

describe("ScheduledTaskDetailPanel browser coverage", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    routeTaskIdState.current = "job-detail";
    __resetNativeApiForTests();
  });

  afterEach(() => {
    __resetNativeApiForTests();
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("covers detail loading, toggle, edit, run-now, open-thread, back, and delete flows", async () => {
    // Audit traceability: 2b596d9.
    let task = createScheduledTask();
    let runs: ScheduledTaskRun[] = [createRun()];

    const toggleSpy = vi.fn<NativeApi["scheduledTasks"]["toggle"]>(async ({ enabled }) => {
      task = { ...task, enabled };
      return task;
    });
    const updateSpy = vi.fn<NativeApi["scheduledTasks"]["update"]>(async (input) => {
      task = {
        ...task,
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.cronExpression ? { cronExpression: input.cronExpression } : {}),
        ...(input.newThreadConfig ? { newThreadConfig: input.newThreadConfig } : {}),
      };
      return task;
    });
    const runNowSpy = vi.fn<NativeApi["scheduledTasks"]["runNow"]>(async () => {
      const run = createRun({
        runId: "run-2" as ScheduledTaskRunId,
        executedAt: "2026-04-11T12:05:00.000Z",
      });
      runs = [run, ...runs];
      task = { ...task, lastRunAt: run.executedAt };
      return run;
    });
    const deleteSpy = vi.fn<NativeApi["scheduledTasks"]["delete"]>(async () => undefined);

    window.nativeApi = {
      scheduledTasks: {
        get: vi.fn(async () => task),
        listRuns: vi.fn(async () => runs),
        toggle: toggleSpy,
        runNow: runNowSpy,
        delete: deleteSpy,
        create: vi.fn(),
        update: updateSpy,
      },
      orchestration: {
        getSnapshot: vi.fn(async () => ({
          projects: [
            {
              id: PROJECT_ID,
              title: "Project Alpha",
              workspaceRoot: "/repo/project-alpha",
            },
          ],
        })),
      },
      server: {
        resolveSkills: vi.fn(async () => ({ skills: [] })),
      },
    } as unknown as NativeApi;

    const screen = await render(<ScheduledTaskDetailPanel />);

    try {
      await expect.element(page.getByText("Daily health check")).toBeInTheDocument();

      const detailSwitch = await waitForElement(
        () => document.querySelector('[role="switch"]') as HTMLButtonElement | null,
        "Unable to find detail toggle switch.",
      );
      detailSwitch.click();

      await vi.waitFor(() => {
        expect(toggleSpy).toHaveBeenCalledWith({
          jobId: "job-detail",
          enabled: false,
        });
      });

      await page.getByRole("button", { name: "Edit" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill("Nightly health check");
      await page.getByRole("textbox", { name: "Prompt" }).fill("Check nightly systems.");
      await page.getByRole("button", { name: "Save changes" }).click();

      await vi.waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith({
          jobId: "job-detail",
          name: "Nightly health check",
          description: "Run a recurring health check.",
          cronExpression: "0 9 * * *",
          newThreadConfig: {
            projectId: PROJECT_ID,
            prompt: "Check nightly systems.",
            autoSend: false,
          },
        });
      });
      await expect.element(page.getByText("Nightly health check")).toBeInTheDocument();

      await page.getByRole("button", { name: "Run now" }).click();
      await vi.waitFor(() => expect(runNowSpy).toHaveBeenCalledWith({ jobId: "job-detail" }));

      const openThreadButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find((button) =>
            button.textContent?.includes("Open"),
          ) as HTMLButtonElement | null,
        'Unable to find the run-history "Open" button.',
      );
      openThreadButton.click();

      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/$threadId",
        params: { threadId: THREAD_ID },
      });

      await page.getByRole("button", { name: "Back to Scheduled Tasks" }).click();
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/settings/scheduled-tasks",
        replace: true,
      });

      await page.getByRole("button", { name: "Delete" }).click();
      const confirmDeleteButton = await waitForElement(
        () =>
          (Array.from(document.querySelectorAll("button"))
            .filter((button) => button.textContent?.trim() === "Delete")
            .at(-1) as HTMLButtonElement | undefined) ?? null,
        "Unable to find the delete-confirmation button.",
      );
      confirmDeleteButton.click();

      await vi.waitFor(() => expect(deleteSpy).toHaveBeenCalledWith({ jobId: "job-detail" }));
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/settings/scheduled-tasks",
        replace: true,
      });
    } finally {
      await screen.unmount();
    }
  });
});
