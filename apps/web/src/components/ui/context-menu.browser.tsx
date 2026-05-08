import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { useContextMenuStore } from "~/contextMenuStore";

import { ContextMenuPortal } from "./context-menu";

async function mountContextMenuPortal() {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(<ContextMenuPortal />, { container: host });

  const cleanup = async () => {
    useContextMenuStore.setState({
      open: false,
      items: [],
      position: { x: 0, y: 0 },
      resolve: null,
      releaseBrowserOverlay: null,
    });
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("ContextMenuPortal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps a submenu open while moving onto a submenu item", async () => {
    await using _mounted = await mountContextMenuPortal();

    const selected = useContextMenuStore.getState().show(
      [
        { id: "rename", label: "Rename thread" },
        {
          id: "move-to",
          label: "Move to",
          children: [{ id: "move-to:project-b", label: "Project B" }],
        },
        { id: "copy", label: "Copy Thread ID" },
      ],
      { x: 160, y: 120 },
    );

    await page.getByRole("menuitem", { name: "Move to" }).hover();
    await expect.element(page.getByRole("menuitem", { name: "Project B" })).toBeInTheDocument();

    await page.getByRole("menuitem", { name: "Project B" }).hover();
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    await expect.element(page.getByRole("menuitem", { name: "Project B" })).toBeInTheDocument();

    await page.getByRole("menuitem", { name: "Project B" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Project B" })).not.toBeInTheDocument();
    await expect(selected).resolves.toBe("move-to:project-b");
  });
});
