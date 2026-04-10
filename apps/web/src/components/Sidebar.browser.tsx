import "../index.css";

import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { resolveThreadBoardContextSourceThreadId } from "../lib/threadBoardContext";

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
