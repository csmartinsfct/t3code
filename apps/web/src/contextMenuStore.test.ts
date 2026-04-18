import { afterEach, describe, expect, it } from "vitest";

import { useContextMenuStore } from "./contextMenuStore";

afterEach(() => {
  const { resolve } = useContextMenuStore.getState();
  if (resolve) {
    resolve(null);
  }
  useContextMenuStore.setState({
    open: false,
    items: [],
    position: { x: 0, y: 0 },
    resolve: null,
  });
});

describe("show", () => {
  it("sets state and returns a promise", () => {
    const items = [{ id: "delete", label: "Delete" }] as const;
    const promise = useContextMenuStore.getState().show(items, { x: 10, y: 20 });

    expect(promise).toBeInstanceOf(Promise);
    const state = useContextMenuStore.getState();
    expect(state.open).toBe(true);
    expect(state.items).toEqual(items);
    expect(state.position).toEqual({ x: 10, y: 20 });
    expect(state.resolve).toBeTypeOf("function");
  });

  it("defaults position to {0, 0} when omitted", () => {
    useContextMenuStore.getState().show([{ id: "a", label: "A" }]);

    expect(useContextMenuStore.getState().position).toEqual({ x: 0, y: 0 });
  });

  it("resolves the previous promise with null when called while open", async () => {
    const first = useContextMenuStore.getState().show([{ id: "a", label: "A" }]);
    useContextMenuStore.getState().show([{ id: "b", label: "B" }]);

    await expect(first).resolves.toBeNull();
  });
});

describe("select", () => {
  it("resolves the promise with the item id", async () => {
    const promise = useContextMenuStore.getState().show([{ id: "rename", label: "Rename" }]);
    useContextMenuStore.getState().select("rename");

    await expect(promise).resolves.toBe("rename");
    expect(useContextMenuStore.getState().open).toBe(false);
  });

  it("is a no-op when no menu is open", () => {
    expect(() => useContextMenuStore.getState().select("anything")).not.toThrow();
  });
});

describe("dismiss", () => {
  it("resolves the promise with null", async () => {
    const promise = useContextMenuStore.getState().show([{ id: "a", label: "A" }]);
    useContextMenuStore.getState().dismiss();

    await expect(promise).resolves.toBeNull();
    expect(useContextMenuStore.getState().open).toBe(false);
  });

  it("is a no-op when no menu is open", () => {
    expect(() => useContextMenuStore.getState().dismiss()).not.toThrow();
  });
});
