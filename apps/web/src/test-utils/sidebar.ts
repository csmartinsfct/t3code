import { type ProjectId } from "@t3tools/contracts";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useStore } from "~/store";
import { useTerminalStateStore } from "~/terminalStateStore";
import { useThreadSelectionStore } from "~/threadSelectionStore";
import { useUiStateStore } from "~/uiStateStore";

export const SIDEBAR_TEST_PROJECT_ID = "project-1" as ProjectId;
export const SIDEBAR_TEST_NOW_ISO = "2026-04-11T12:00:00.000Z";

export function makeSidebarTestProject() {
  return {
    id: SIDEBAR_TEST_PROJECT_ID,
    name: "Alpha",
    cwd: "/repo/alpha",
    defaultModelSelection: { provider: "codex" as const, model: "gpt-5.4" },
    systemPrompt: "Honor the project conventions.",
    promptOverrides: { orchestration: {} },
    scripts: [],
    createdAt: SIDEBAR_TEST_NOW_ISO,
    updatedAt: SIDEBAR_TEST_NOW_ISO,
  };
}

export function seedSidebarTestStores(input?: {
  sidebarThreadsById?: Record<string, unknown>;
  threadIdsByProjectId?: Record<string, string[]>;
  orchestrationRunStatusByThreadId?: Record<string, "pending" | "running" | "completed">;
  projectExpandedById?: Record<string, boolean>;
}) {
  useStore.setState({
    projects: [makeSidebarTestProject()],
    threads: [],
    threadsById: {},
    sidebarThreadsById: (input?.sidebarThreadsById ?? {}) as never,
    threadIdsByProjectId: (input?.threadIdsByProjectId ?? {}) as never,
    bootstrapComplete: true,
    orchestrationRunStatusByThreadId: input?.orchestrationRunStatusByThreadId ?? {},
  });
  useUiStateStore.setState({
    projectExpandedById: input?.projectExpandedById ?? { [SIDEBAR_TEST_PROJECT_ID]: true },
    projectOrder: [SIDEBAR_TEST_PROJECT_ID],
    threadLastVisitedAtById: {},
    startupRecoveryStateByThreadId: {},
    managementBoardContextByProjectId: {},
    viewMode: "chat",
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
  useThreadSelectionStore.setState({
    selectedThreadIds: new Set(),
    anchorThreadId: null,
  });
}
