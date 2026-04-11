import "../index.css";

import type { ProjectId, ServerProvider, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { resolveThreadBoardContextSourceThreadId } from "../lib/threadBoardContext";
import { buildMoveThreadConfirmationMessage, buildThreadContextMenuItems } from "./Sidebar";

function createProvider(input: {
  provider: string;
  displayName?: string;
  status?: ServerProvider["status"];
  enabled?: boolean;
  models?: ServerProvider["models"];
}): ServerProvider {
  return {
    // Runtime provider IDs can include profile suffixes like `claudeAgent:metric`,
    // even though the contracts type currently only models the base providers.
    provider: input.provider as never,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    enabled: input.enabled ?? true,
    installed: true,
    version: "1.0.0",
    status: input.status ?? "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-11T00:00:00.000Z",
    models: input.models ?? [],
  };
}

// Audit traceability: be79d4b, 90a6727.

describe("Sidebar fork board-context continuity", () => {
  it("reuses the active route thread when forking within the same project", () => {
    expect(
      resolveThreadBoardContextSourceThreadId({
        routeThreadId: "thread-active" as ThreadId,
        targetProjectId: "project-1" as ProjectId,
        activeThreadProjectId: "project-1" as ProjectId,
      }),
    ).toBe("thread-active");
  });

  it("drops cross-project board context when the active route belongs to another project", () => {
    expect(
      resolveThreadBoardContextSourceThreadId({
        routeThreadId: "thread-active" as ThreadId,
        targetProjectId: "project-2" as ProjectId,
        activeThreadProjectId: "project-1" as ProjectId,
      }),
    ).toBeNull();
  });

  it("falls back to the active draft thread project when it matches the fork target", () => {
    expect(
      resolveThreadBoardContextSourceThreadId({
        routeThreadId: "thread-draft" as ThreadId,
        targetProjectId: "project-2" as ProjectId,
        activeDraftThreadProjectId: "project-2" as ProjectId,
      }),
    ).toBe("thread-draft");
  });
});

describe("Sidebar thread context menu helpers", () => {
  it("builds fork and move children with the expected availability rules", () => {
    const items = buildThreadContextMenuItems({
      serverProviders: [
        createProvider({
          provider: "claudeAgent:metric",
          displayName: "Claude (metric)",
          models: [
            {
              slug: "claude-opus-4-6",
              name: "Claude Opus 4.6",
              isCustom: false,
              capabilities: {
                reasoningEffortLevels: [],
                supportsFastMode: false,
                supportsThinkingToggle: false,
                supportsPlan: true,
                contextWindowOptions: [],
                promptInjectedEffortLevels: [],
              },
            },
          ],
        }),
      ],
      projects: [
        { id: "project-1" as ProjectId, name: "Alpha" },
        { id: "project-2" as ProjectId, name: "Beta" },
      ],
      threadProjectId: "project-1" as ProjectId,
      hasActiveSession: false,
    });

    const forkItem = items.find((item) => item.id === "fork");
    const moveItem = items.find((item) => item.id === "move");

    expect(forkItem?.disabled).toBe(false);
    expect(forkItem?.children).toEqual([
      {
        id: "fork::claudeAgent:metric::claude-opus-4-6",
        label: "Claude (metric) — Claude Opus 4.6",
      },
    ]);
    expect(moveItem?.disabled).toBe(false);
    expect(moveItem?.children).toEqual([{ id: "move::project-2", label: "Beta" }]);
  });

  it("disables Move to when no target project exists or the thread is active", () => {
    const noTargetItems = buildThreadContextMenuItems({
      serverProviders: [],
      projects: [{ id: "project-1" as ProjectId, name: "Alpha" }],
      threadProjectId: "project-1" as ProjectId,
      hasActiveSession: false,
    });
    const activeThreadItems = buildThreadContextMenuItems({
      serverProviders: [],
      projects: [
        { id: "project-1" as ProjectId, name: "Alpha" },
        { id: "project-2" as ProjectId, name: "Beta" },
      ],
      threadProjectId: "project-1" as ProjectId,
      hasActiveSession: true,
    });

    expect(noTargetItems.find((item) => item.id === "move")?.disabled).toBe(true);
    expect(activeThreadItems.find((item) => item.id === "move")?.disabled).toBe(true);
  });

  it("mentions cleared worktree and branch associations only when needed", () => {
    expect(
      buildMoveThreadConfirmationMessage({
        threadTitle: "Main thread",
        targetProjectName: "Beta",
        clearsWorkspaceAssociation: true,
      }),
    ).toContain("The thread's worktree and branch association will be cleared.");

    expect(
      buildMoveThreadConfirmationMessage({
        threadTitle: "Main thread",
        targetProjectName: "Beta",
        clearsWorkspaceAssociation: false,
      }),
    ).toBe('Move thread "Main thread" to project "Beta"?');
  });
});
