import { assert, describe, it } from "@effect/vitest";

import { normalizeGeneratedChangelogGroups } from "./generate-changelog.ts";

describe("generate-changelog", () => {
  it("accepts a batch with no user-facing changelog entries", () => {
    const groups = normalizeGeneratedChangelogGroups([
      {
        date: "2026-07-23",
        entries: [],
      },
    ]);

    assert.deepStrictEqual(groups, []);
  });

  it("drops only empty groups and preserves populated entries", () => {
    const groups = normalizeGeneratedChangelogGroups([
      {
        date: "2026-07-23",
        entries: [],
      },
      {
        date: "2026-07-22",
        entries: [
          {
            title: "Existing release note",
            summary: "Keeps valid changelog history intact.",
            category: "fix",
            commitShas: ["second-sha", "first-sha", "second-sha"],
          },
        ],
      },
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.date, "2026-07-22");
    assert.deepStrictEqual(groups[0]?.entries, [
      {
        id: "c38281d73fbad62d",
        title: "Existing release note",
        summary: "Keeps valid changelog history intact.",
        category: "fix",
        commitShas: ["first-sha", "second-sha"],
      },
    ]);
  });
});
