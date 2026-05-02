import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  selectRunLogsDrawerOpen,
  selectThreadRunLogsDrawerState,
  useRunLogsDrawerStore,
} from "./runLogsDrawerStore";

const THREAD_1 = ThreadId.makeUnsafe("thread-1");
const THREAD_2 = ThreadId.makeUnsafe("thread-2");

function openTab(input: {
  threadId: ThreadId;
  runId: string;
  projectId?: string;
  scriptId?: string;
  label?: string;
}) {
  useRunLogsDrawerStore.getState().openTab({
    projectId: input.projectId ?? "project-1",
    scriptId: input.scriptId ?? "dev",
    label: input.label ?? "Dev",
    ...input,
  });
}

function threadState(threadId: ThreadId) {
  return selectThreadRunLogsDrawerState(useRunLogsDrawerStore.getState(), threadId);
}

describe("run logs drawer store", () => {
  beforeEach(() => {
    useRunLogsDrawerStore.setState({
      tabsByThreadId: {},
    });
  });

  it("opens a run logs tab only for the clicked thread", () => {
    openTab({ threadId: THREAD_1, runId: "run-1" });

    expect(selectRunLogsDrawerOpen(useRunLogsDrawerStore.getState(), THREAD_1)).toBe(true);
    expect(selectRunLogsDrawerOpen(useRunLogsDrawerStore.getState(), THREAD_2)).toBe(false);
    expect(threadState(THREAD_1).tabs).toMatchObject([{ runId: "run-1" }]);
    expect(threadState(THREAD_2).tabs).toEqual([]);
  });

  it("tracks active run independently per thread", () => {
    openTab({ threadId: THREAD_1, runId: "run-1" });
    openTab({ threadId: THREAD_1, runId: "run-2" });
    openTab({ threadId: THREAD_2, runId: "run-3" });

    useRunLogsDrawerStore.getState().setActive({ threadId: THREAD_1, runId: "run-1" });

    expect(threadState(THREAD_1).activeRunId).toBe("run-1");
    expect(threadState(THREAD_2).activeRunId).toBe("run-3");
  });

  it("closes a tab in one thread without closing the same run in another thread", () => {
    openTab({ threadId: THREAD_1, runId: "run-1" });
    openTab({ threadId: THREAD_2, runId: "run-1" });

    useRunLogsDrawerStore.getState().closeTab({ threadId: THREAD_1, runId: "run-1" });

    expect(threadState(THREAD_1).tabs).toEqual([]);
    expect(threadState(THREAD_2).tabs).toMatchObject([{ runId: "run-1" }]);
  });

  it("closes a removed run across all thread scopes", () => {
    openTab({ threadId: THREAD_1, runId: "run-1" });
    openTab({ threadId: THREAD_1, runId: "run-2" });
    openTab({ threadId: THREAD_2, runId: "run-1" });

    useRunLogsDrawerStore.getState().closeRunEverywhere("run-1");

    expect(threadState(THREAD_1).tabs).toMatchObject([{ runId: "run-2" }]);
    expect(threadState(THREAD_1).activeRunId).toBe("run-2");
    expect(threadState(THREAD_2).tabs).toEqual([]);
  });

  it("retargets open stale tabs for the same script in each existing thread scope", () => {
    openTab({ threadId: THREAD_1, runId: "run-old" });
    openTab({ threadId: THREAD_2, runId: "run-old" });
    useRunLogsDrawerStore
      .getState()
      .setActiveService({ threadId: THREAD_1, runId: "run-old", serviceId: "frontend" });

    useRunLogsDrawerStore.getState().retargetStaleScriptTab({
      runId: "run-new",
      projectId: "project-1",
      scriptId: "dev",
      label: "Dev",
      activeRunIds: ["run-new"],
    });

    expect(threadState(THREAD_1).tabs).toMatchObject([
      {
        runId: "run-new",
        projectId: "project-1",
        scriptId: "dev",
        label: "Dev",
        activeServiceId: null,
      },
    ]);
    expect(threadState(THREAD_1).activeRunId).toBe("run-new");
    expect(threadState(THREAD_2).tabs).toMatchObject([{ runId: "run-new" }]);
  });

  it("does not create a retargeted tab in unrelated threads", () => {
    openTab({ threadId: THREAD_1, runId: "run-old" });

    useRunLogsDrawerStore.getState().retargetStaleScriptTab({
      runId: "run-new",
      projectId: "project-1",
      scriptId: "dev",
      label: "Dev",
      activeRunIds: ["run-new"],
    });

    expect(threadState(THREAD_1).tabs).toMatchObject([{ runId: "run-new" }]);
    expect(threadState(THREAD_2).tabs).toEqual([]);
  });

  it("does not retarget a tab that is still attached to an active run", () => {
    openTab({ threadId: THREAD_1, runId: "run-active" });

    useRunLogsDrawerStore.getState().retargetStaleScriptTab({
      runId: "run-new",
      projectId: "project-1",
      scriptId: "dev",
      label: "Dev",
      activeRunIds: ["run-active", "run-new"],
    });

    expect(threadState(THREAD_1).tabs).toMatchObject([
      {
        runId: "run-active",
        projectId: "project-1",
        scriptId: "dev",
      },
    ]);
    expect(threadState(THREAD_1).activeRunId).toBe("run-active");
  });

  it("removes a stale duplicate when the fresh run is already open in the same thread", () => {
    openTab({ threadId: THREAD_1, runId: "run-old" });
    openTab({ threadId: THREAD_1, runId: "run-new" });
    useRunLogsDrawerStore.getState().setActive({ threadId: THREAD_1, runId: "run-old" });

    useRunLogsDrawerStore.getState().retargetStaleScriptTab({
      runId: "run-new",
      projectId: "project-1",
      scriptId: "dev",
      label: "Dev",
      activeRunIds: ["run-new"],
    });

    expect(threadState(THREAD_1).tabs).toMatchObject([{ runId: "run-new" }]);
    expect(threadState(THREAD_1).activeRunId).toBe("run-new");
  });

  it("removes only the selected thread scope", () => {
    openTab({ threadId: THREAD_1, runId: "run-1" });
    openTab({ threadId: THREAD_2, runId: "run-2" });

    useRunLogsDrawerStore.getState().removeThreadState(THREAD_1);

    expect(threadState(THREAD_1).tabs).toEqual([]);
    expect(threadState(THREAD_2).tabs).toMatchObject([{ runId: "run-2" }]);
  });
});
