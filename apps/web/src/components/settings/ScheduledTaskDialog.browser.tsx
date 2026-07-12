import "../../index.css";

import type { NativeApi, ProjectId, ScheduledTask, ScheduledTaskId } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../../nativeApi";
import { ScheduledTaskDialog } from "./ScheduledTaskDialog";

const PROJECT_ID = "project-scheduled-capabilities" as ProjectId;
const NOW_ISO = "2026-07-12T00:00:00.000Z";
const spotifyCapability = {
  provider: "codex" as const,
  kind: "plugin" as const,
  id: "spotify@openai-curated-remote",
  name: "spotify",
  displayName: "Spotify",
  capabilityRootPath: "/Users/example/.codex/plugins/cache/spotify/4.0.0",
  appIds: ["asdk_app_spotify"],
  iconUrl: "https://files.openai.com/spotify.png",
};

describe("ScheduledTaskDialog provider capabilities", () => {
  beforeEach(() => {
    __resetNativeApiForTests();
  });

  afterEach(() => {
    __resetNativeApiForTests();
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("selects and persists a provider plugin", async () => {
    const createSpy = vi.fn(
      async (input) =>
        ({
          jobId: "job-spotify" as ScheduledTaskId,
          name: input.name,
          description: input.description ?? null,
          cronExpression: input.cronExpression,
          enabled: input.enabled,
          jobType: input.jobType,
          newThreadConfig: input.newThreadConfig ?? null,
          createdAt: NOW_ISO,
          updatedAt: NOW_ISO,
          lastRunAt: null,
          nextRunAt: null,
        }) satisfies ScheduledTask,
    );

    window.nativeApi = {
      server: {
        resolveSkills: vi.fn(async () => ({ skills: [] })),
        resolveProviderCapabilities: vi.fn(async () => ({
          capabilities: [
            {
              ...spotifyCapability,
              source: "openai-curated-remote",
              enabled: true,
              installed: true,
            },
          ],
        })),
      },
    } as unknown as NativeApi;

    const screen = await render(
      <ScheduledTaskDialog
        open
        onOpenChange={() => {}}
        editingJob={null}
        projects={[
          {
            id: PROJECT_ID,
            title: "Scheduled Project",
            workspaceRoot: "/repo/scheduled-project",
          },
        ]}
        onSave={() => {}}
        onCreateJob={createSpy}
        onUpdateJob={vi.fn()}
      />,
    );

    try {
      await expect
        .element(page.getByText("Skills and plugins", { exact: true }))
        .toBeInTheDocument();
      await page.getByRole("button", { name: "Select skills and plugins..." }).click();
      await page.getByText("Spotify", { exact: true }).last().click();
      await expect
        .element(page.getByRole("button", { name: "Remove Spotify" }))
        .toBeInTheDocument();

      await page.getByRole("textbox", { name: "Prompt" }).fill("Check Spotify playback.");
      await page.getByRole("button", { name: "Create task" }).click();

      await vi.waitFor(() => {
        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            newThreadConfig: expect.objectContaining({
              projectId: PROJECT_ID,
              prompt: "Check Spotify playback.",
              providerCapabilities: [spotifyCapability],
            }),
          }),
        );
      });
    } finally {
      await screen.unmount();
    }
  });
});
