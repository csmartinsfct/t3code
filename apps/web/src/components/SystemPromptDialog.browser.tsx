import "../index.css";

import type { NativeApi, ProjectId } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "~/nativeApi";
import { toastManager } from "./ui/toast";

const { enhanceSystemPromptSpy, dispatchCommandSpy, onOpenChangeSpy } = vi.hoisted(() => ({
  enhanceSystemPromptSpy: vi.fn(),
  dispatchCommandSpy: vi.fn(async () => undefined),
  onOpenChangeSpy: vi.fn(),
}));

import { SystemPromptDialog } from "./SystemPromptDialog";

// Audit traceability: c6cb176, caeb52a, eb37ddb.

const PROJECT_ID = "project-system-prompt" as ProjectId;

function installNativeApi() {
  enhanceSystemPromptSpy.mockReset();
  dispatchCommandSpy.mockReset();
  window.nativeApi = {
    projects: {
      enhanceSystemPrompt: enhanceSystemPromptSpy,
    },
    orchestration: {
      dispatchCommand: dispatchCommandSpy,
    },
  } as unknown as NativeApi;
}

function makeProject(systemPrompt: string | null) {
  return {
    id: PROJECT_ID,
    name: "Alpha",
    cwd: "/repo/alpha",
    defaultModelSelection: {
      provider: "codex" as const,
      model: "gpt-5.4",
    },
    systemPrompt,
    promptOverrides: { orchestration: {} },
    scripts: [],
  };
}

describe("SystemPromptDialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    __resetNativeApiForTests();
    delete window.nativeApi;
    installNativeApi();
    onOpenChangeSpy.mockReset();
    vi.spyOn(toastManager, "add").mockImplementation(() => "toast-1" as never);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    __resetNativeApiForTests();
    delete window.nativeApi;
    vi.restoreAllMocks();
  });

  it("hydrates from project state, enhances successfully, and saves the trimmed prompt", async () => {
    enhanceSystemPromptSpy.mockResolvedValue({
      enhancedPrompt: "Always explain tradeoffs.",
    });

    const screen = await render(
      <SystemPromptDialog
        open
        onOpenChange={onOpenChangeSpy}
        project={makeProject("Initial project instructions.")}
      />,
    );

    try {
      const textarea = page.getByPlaceholder(
        "e.g. Always use TypeScript strict mode. Prefer functional patterns...",
      );
      await expect.element(textarea).toHaveValue("Initial project instructions.");

      await page.getByRole("button", { name: "Enhance prompt" }).click();

      await vi.waitFor(() => {
        expect(enhanceSystemPromptSpy).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          currentPrompt: "Initial project instructions.",
        });
      });
      await expect.element(textarea).toHaveValue("Always explain tradeoffs.");

      const saveButton = page.getByRole("button", { name: "Save" });
      await expect.element(saveButton).toBeEnabled();
      await saveButton.click();

      await vi.waitFor(() => {
        expect(dispatchCommandSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "project.meta.update",
            projectId: PROJECT_ID,
            systemPrompt: "Always explain tradeoffs.",
          }),
        );
      });
      expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
    } finally {
      await screen.unmount();
    }
  });

  it("shows enhancement failures and lets cancel exit without saving", async () => {
    enhanceSystemPromptSpy.mockRejectedValue(new Error("Provider unavailable"));

    const screen = await render(
      <SystemPromptDialog
        open
        onOpenChange={onOpenChangeSpy}
        project={makeProject("Needs refinement")}
      />,
    );

    try {
      await page.getByRole("button", { name: "Enhance prompt" }).click();

      await vi.waitFor(() => {
        expect(enhanceSystemPromptSpy).toHaveBeenCalledTimes(1);
        expect(toastManager.add).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "error",
            title: "Enhancement failed",
            description: "Provider unavailable",
          }),
        );
      });

      await page.getByRole("button", { name: "Cancel" }).click();

      expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
      expect(dispatchCommandSpy).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });
});
