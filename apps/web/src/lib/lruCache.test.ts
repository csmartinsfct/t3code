import { describe, expect, it } from "vitest";
import { LRUCache } from "./lruCache";

describe("LRUCache", () => {
  it("returns null for missing keys", () => {
    const cache = new LRUCache<string>(2, 100);
    expect(cache.get("missing")).toBeNull();
  });

  it("evicts oldest by max entries", () => {
    const cache = new LRUCache<string>(2, 1_000);
    cache.set("a", "A", 10);
    cache.set("b", "B", 10);
    cache.set("c", "C", 10);

    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe("B");
    expect(cache.get("c")).toBe("C");
  });

  it("promotes on get and evicts least recently used", () => {
    const cache = new LRUCache<string>(2, 1_000);
    cache.set("a", "A", 10);
    cache.set("b", "B", 10);
    expect(cache.get("a")).toBe("A");

    cache.set("c", "C", 10);
    expect(cache.get("a")).toBe("A");
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).toBe("C");
  });

  it("evicts by memory budget", () => {
    const cache = new LRUCache<string>(10, 25);
    cache.set("a", "A", 10);
    cache.set("b", "B", 10);
    cache.set("c", "C", 10);

    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe("B");
    expect(cache.get("c")).toBe("C");
  });

  it("delete removes an entry and adjusts size", () => {
    const cache = new LRUCache<string>(10, 1_000);
    cache.set("a", "A", 100);
    cache.set("b", "B", 200);

    expect(cache.size).toBe(2);
    expect(cache.delete("a")).toBe(true);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe("B");
  });

  it("delete returns false for non-existent key", () => {
    const cache = new LRUCache<string>(10, 1_000);
    expect(cache.delete("missing")).toBe(false);
  });

  it("size returns current entry count", () => {
    const cache = new LRUCache<string>(10, 1_000);
    expect(cache.size).toBe(0);
    cache.set("a", "A", 10);
    expect(cache.size).toBe(1);
    cache.set("b", "B", 10);
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
