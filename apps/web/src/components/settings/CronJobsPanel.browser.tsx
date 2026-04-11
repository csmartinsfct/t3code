import "../../index.css";

import type { NativeApi, ProjectId, ScheduledTask, ScheduledTaskId } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../../nativeApi";
import { waitForElement } from "../../test-utils/browser";
import { ScheduledTasksPanel } from "./ScheduledTasksPanel";

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(async () => undefined),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const PROJECT_ID = "project-1" as ProjectId;
const NOW_ISO = "2026-04-11T12:00:00.000Z";

function createScheduledTask(input: {
  jobId: string;
  name: string;
  enabled?: boolean;
  description?: string | null;
  cronExpression?: string;
  prompt?: string;
}): ScheduledTask {
  return {
    jobId: input.jobId as ScheduledTaskId,
    name: input.name,
    description: input.description ?? null,
    cronExpression: input.cronExpression ?? "0 9 * * *",
    enabled: input.enabled ?? true,
    jobType: "new_thread",
    newThreadConfig: {
      projectId: PROJECT_ID,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      autoSend: false,
    },
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    lastRunAt: null,
    nextRunAt: "2026-04-12T09:00:00.000Z",
  };
}

describe("ScheduledTasksPanel browser coverage", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    __resetNativeApiForTests();
  });

  afterEach(() => {
    __resetNativeApiForTests();
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("covers list, toggle, create, and detail navigation flows", async () => {
    // Audit traceability: 2b596d9.
    let jobs = [createScheduledTask({ jobId: "job-existing", name: "Daily health check" })];
    const toggleSpy = vi.fn<NativeApi["scheduledTasks"]["toggle"]>(async ({ jobId, enabled }) => {
      const updated = { ...jobs.find((job) => job.jobId === jobId)!, enabled };
      jobs = jobs.map((job) => (job.jobId === jobId ? updated : job));
      return updated;
    });
    const createSpy = vi.fn<NativeApi["scheduledTasks"]["create"]>(async (input) => {
      const created = createScheduledTask({
        jobId: "job-created",
        name: input.name,
        description: input.description ?? null,
        cronExpression: input.cronExpression,
        ...(input.newThreadConfig?.prompt ? { prompt: input.newThreadConfig.prompt } : {}),
      });
      jobs = [created, ...jobs];
      return created;
    });

    window.nativeApi = {
      scheduledTasks: {
        list: vi.fn(async () => jobs),
        create: createSpy,
        update: vi.fn(),
        toggle: toggleSpy,
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

    const screen = await render(<ScheduledTasksPanel />);

    try {
      await expect.element(page.getByText("Daily health check")).toBeInTheDocument();

      const firstSwitch = await waitForElement(
        () => document.querySelector('[role="switch"]') as HTMLButtonElement | null,
        "Unable to find scheduled-task toggle.",
      );
      firstSwitch.click();

      await vi.waitFor(() => {
        expect(toggleSpy).toHaveBeenCalledWith({
          jobId: "job-existing",
          enabled: false,
        });
      });
      await expect.element(page.getByText("Disabled")).toBeInTheDocument();

      await page.getByRole("button", { name: "Add task" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill("Weekly report");
      await page.getByRole("textbox", { name: "Description" }).fill("Collect release notes");
      await page.getByRole("textbox", { name: "Schedule" }).fill("15 8 * * 1");
      await page.getByRole("textbox", { name: "Prompt" }).fill("Summarize the latest changes.");
      await page.getByRole("button", { name: "Create task" }).click();

      await vi.waitFor(() => {
        expect(createSpy).toHaveBeenCalledWith({
          name: "Weekly report",
          description: "Collect release notes",
          cronExpression: "15 8 * * 1",
          enabled: true,
          jobType: "new_thread",
          newThreadConfig: {
            projectId: PROJECT_ID,
            prompt: "Summarize the latest changes.",
            autoSend: false,
          },
        });
      });
      await expect.element(page.getByText("Weekly report")).toBeInTheDocument();

      const createdRow = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find((button) =>
            button.textContent?.includes("Weekly report"),
          ) as HTMLButtonElement | null,
        'Unable to find the "Weekly report" scheduled-task row.',
      );
      createdRow.click();

      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/settings/scheduled-tasks/$taskId",
        params: { taskId: "job-created" },
      });
    } finally {
      await screen.unmount();
    }
  });
});
