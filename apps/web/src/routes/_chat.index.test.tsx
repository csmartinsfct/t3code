import { describe, expect, it } from "vitest";

import { resolveInitialManagementProjectId } from "./chatIndex";

describe("_chat.index", () => {
  it("restores latestManagementBoardProjectId when it still exists in the ordered project list", () => {
    expect(
      resolveInitialManagementProjectId({
        orderedProjectIds: ["project-2", "project-1", "project-3"],
        latestManagementBoardProjectId: "project-1",
      }),
    ).toBe("project-1");
  });

  it("falls back to the first ordered project when the saved board project is stale", () => {
    expect(
      resolveInitialManagementProjectId({
        orderedProjectIds: ["project-2", "project-1"],
        latestManagementBoardProjectId: "project-9",
      }),
    ).toBe("project-2");
  });

  it("returns null when there is no project to restore", () => {
    expect(
      resolveInitialManagementProjectId({
        orderedProjectIds: [],
        latestManagementBoardProjectId: "project-1",
      }),
    ).toBeNull();
  });
});
