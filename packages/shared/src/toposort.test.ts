import { describe, expect, it } from "vitest";

import { toposort } from "./toposort.js";

const getId = (n: string) => n;

describe("toposort", () => {
  it("returns empty for empty input", () => {
    const result = toposort<string>([], [], getId);
    expect(result.sorted).toEqual([]);
    expect(result.cycles).toEqual([]);
  });

  it("returns single node", () => {
    const result = toposort(["a"], [], getId);
    expect(result.sorted).toEqual(["a"]);
    expect(result.cycles).toEqual([]);
  });

  it("sorts a linear chain", () => {
    // c depends on b, b depends on a → output: a, b, c
    const result = toposort(
      ["c", "b", "a"],
      [
        { from: "c", to: "b" },
        { from: "b", to: "a" },
      ],
      getId,
    );
    expect(result.sorted).toEqual(["a", "b", "c"]);
    expect(result.cycles).toEqual([]);
  });

  it("sorts a diamond dependency", () => {
    // d depends on b and c, b and c both depend on a
    const result = toposort(
      ["d", "c", "b", "a"],
      [
        { from: "d", to: "b" },
        { from: "d", to: "c" },
        { from: "b", to: "a" },
        { from: "c", to: "a" },
      ],
      getId,
    );
    expect(result.sorted[0]).toBe("a");
    expect(result.sorted[result.sorted.length - 1]).toBe("d");
    // b and c can be in either order but both come after a and before d
    expect(result.sorted.indexOf("b")).toBeGreaterThan(0);
    expect(result.sorted.indexOf("c")).toBeGreaterThan(0);
    expect(result.cycles).toEqual([]);
  });

  it("preserves input order for disjoint nodes (no edges)", () => {
    const result = toposort(["x", "y", "z"], [], getId);
    expect(result.sorted).toEqual(["x", "y", "z"]);
    expect(result.cycles).toEqual([]);
  });

  it("preserves input order for disjoint subgraphs", () => {
    // Two independent chains: (b→a) and (d→c)
    // Input order: d, c, b, a
    const result = toposort(
      ["d", "c", "b", "a"],
      [
        { from: "b", to: "a" },
        { from: "d", to: "c" },
      ],
      getId,
    );
    // c and a are roots — c appears before a in input, so c comes first
    expect(result.sorted.indexOf("c")).toBeLessThan(result.sorted.indexOf("d"));
    expect(result.sorted.indexOf("a")).toBeLessThan(result.sorted.indexOf("b"));
    expect(result.cycles).toEqual([]);
  });

  it("detects a simple cycle", () => {
    const result = toposort(
      ["a", "b"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
      getId,
    );
    expect(result.sorted).toEqual([]);
    expect(result.cycles.length).toBe(1);
    expect(result.cycles[0]).toHaveLength(2);
  });

  it("detects a cycle while still sorting non-cyclic nodes", () => {
    // a is independent; b and c form a cycle
    const result = toposort(
      ["a", "b", "c"],
      [
        { from: "b", to: "c" },
        { from: "c", to: "b" },
      ],
      getId,
    );
    expect(result.sorted).toEqual(["a"]);
    expect(result.cycles.length).toBe(1);
    expect(new Set(result.cycles[0]!.map(getId))).toEqual(new Set(["b", "c"]));
  });

  it("ignores edges referencing nodes not in the input set", () => {
    const result = toposort(
      ["a", "b"],
      [
        { from: "b", to: "a" },
        { from: "b", to: "unknown" }, // unknown not in nodes
      ],
      getId,
    );
    expect(result.sorted).toEqual(["a", "b"]);
    expect(result.cycles).toEqual([]);
  });

  it("works with object nodes and custom getId", () => {
    interface Task {
      id: string;
      name: string;
    }
    const tasks: Task[] = [
      { id: "3", name: "deploy" },
      { id: "2", name: "test" },
      { id: "1", name: "build" },
    ];
    const result = toposort(
      tasks,
      [
        { from: tasks[0]!, to: tasks[1]! }, // deploy depends on test
        { from: tasks[1]!, to: tasks[2]! }, // test depends on build
      ],
      (t) => t.id,
    );
    expect(result.sorted.map((t) => t.name)).toEqual(["build", "test", "deploy"]);
    expect(result.cycles).toEqual([]);
  });
});
