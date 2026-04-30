import { beforeEach, describe, expect, it } from "vitest";

import { useRunLogsDrawerStore } from "./runLogsDrawerStore";

describe("run logs drawer store", () => {
  beforeEach(() => {
    useRunLogsDrawerStore.setState({
      tabs: [],
      activeRunId: null,
    });
  });

  it("retargets an open stale tab when the same script starts a fresh run", () => {
    useRunLogsDrawerStore.getState().openTab({
      runId: "run-old",
      projectId: "project-1",
      scriptId: "dev",
      label: "Dev",
    });
    useRunLogsDrawerStore.getState().setActiveService("run-old", "frontend");

    useRunLogsDrawerStore.getState().retargetStaleScriptTab({
      runId: "run-new",
      projectId: "project-1",
      scriptId: "dev",
      label: "Dev",
      activeRunIds: ["run-new"],
    });

    expect(useRunLogsDrawerStore.getState().tabs).toMatchObject([
      {
        runId: "run-new",
        projectId: "project-1",
        scriptId: "dev",
        label: "Dev",
        activeServiceId: null,
      },
    ]);
    expect(useRunLogsDrawerStore.getState().activeRunId).toBe("run-new");
  });

  it("does not retarget a tab that is still attached to an active run", () => {
    useRunLogsDrawerStore.getState().openTab({
      runId: "run-active",
      projectId: "project-1",
      scriptId: "dev",
      label: "Dev",
    });

    useRunLogsDrawerStore.getState().retargetStaleScriptTab({
      runId: "run-new",
      projectId: "project-1",
      scriptId: "dev",
      label: "Dev",
      activeRunIds: ["run-active", "run-new"],
    });

    expect(useRunLogsDrawerStore.getState().tabs).toMatchObject([
      {
        runId: "run-active",
        projectId: "project-1",
        scriptId: "dev",
      },
    ]);
    expect(useRunLogsDrawerStore.getState().activeRunId).toBe("run-active");
  });
});
