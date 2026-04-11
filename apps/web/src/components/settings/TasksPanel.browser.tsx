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

const PROJECT_ALPHA = "project-alpha" as ProjectId;
const PROJECT_BETA = "project-beta" as ProjectId;
const NOW_ISO = "2026-04-11T12:00:00.000Z";

function createScheduledTask(input: {
  jobId: string;
  name: string;
  projectId: ProjectId;
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
      projectId: input.projectId,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      autoSend: false,
    },
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    lastRunAt: null,
    nextRunAt: "2026-04-12T09:00:00.000Z",
  };
}

describe("TasksPanel browser coverage", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    __resetNativeApiForTests();
  });

  afterEach(() => {
    __resetNativeApiForTests();
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("covers project selection, create-task dialog, and detail routing for scheduled tasks settings", async () => {
    // Audit traceability: 8b69f70.
    let jobs = [
      createScheduledTask({
        jobId: "job-existing",
        name: "Daily health check",
        projectId: PROJECT_ALPHA,
      }),
    ];

    const createSpy = vi.fn<NativeApi["scheduledTasks"]["create"]>(async (input) => {
      const created = createScheduledTask({
        jobId: "job-created",
        name: input.name,
        description: input.description ?? null,
        cronExpression: input.cronExpression,
        projectId: input.newThreadConfig?.projectId ?? PROJECT_ALPHA,
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
        toggle: vi.fn(async ({ jobId, enabled }) => {
          const updated = { ...jobs.find((job) => job.jobId === jobId)!, enabled };
          jobs = jobs.map((job) => (job.jobId === jobId ? updated : job));
          return updated;
        }),
      },
      orchestration: {
        getSnapshot: vi.fn(async () => ({
          projects: [
            {
              id: PROJECT_ALPHA,
              title: "Project Alpha",
              workspaceRoot: "/repo/project-alpha",
            },
            {
              id: PROJECT_BETA,
              title: "Project Beta",
              workspaceRoot: "/repo/project-beta",
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

      await page.getByRole("button", { name: "Add task" }).click();

      const projectSelect = await waitForElement(
        () =>
          Array.from(document.querySelectorAll('[data-slot="select-trigger"]')).find((candidate) =>
            candidate.textContent?.includes("Project Alpha"),
          ) as HTMLButtonElement | null,
        "Unable to find the project selector in the scheduled-task dialog.",
      );
      projectSelect.click();
      await page.getByText("Project Beta").click();

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
            projectId: PROJECT_BETA,
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
