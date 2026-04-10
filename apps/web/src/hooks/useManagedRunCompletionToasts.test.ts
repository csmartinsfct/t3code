import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import { startManagedRunAskAiThread } from "./useManagedRunCompletionToasts";

describe("useManagedRunCompletionToasts", () => {
  it("preserves board context when Ask AI creates a draft thread from a managed-run failure", async () => {
    const initializeThreadBoardContextFromSource = vi.fn();
    const setProjectDraftThreadId = vi.fn();
    const applyStickyState = vi.fn();
    const setPrompt = vi.fn();
    const navigateToThread = vi.fn(async () => {});

    const threadId = await startManagedRunAskAiThread({
      projectId: "project-55" as ProjectId,
      sourceThreadId: "thread-source" as ThreadId,
      prompt: "Explain why the managed run failed.",
      composerDraftStore: {
        setProjectDraftThreadId,
        applyStickyState,
        setPrompt,
      },
      uiStateStore: {
        initializeThreadBoardContextFromSource,
      },
      createThreadId: () => "thread-draft" as ThreadId,
      now: () => "2026-04-10T20:15:00.000Z",
      navigateToThread,
    });

    expect(threadId).toBe("thread-draft");
    expect(initializeThreadBoardContextFromSource).toHaveBeenCalledWith({
      sourceThreadId: "thread-source",
      targetThreadId: "thread-draft",
      projectId: "project-55",
    });
    expect(setProjectDraftThreadId).toHaveBeenCalledWith("project-55", "thread-draft", {
      createdAt: "2026-04-10T20:15:00.000Z",
      runtimeMode: "full-access",
    });
    expect(applyStickyState).toHaveBeenCalledWith("thread-draft");
    expect(setPrompt).toHaveBeenCalledWith("thread-draft", "Explain why the managed run failed.");
    expect(navigateToThread).toHaveBeenCalledWith("thread-draft");
  });
});
