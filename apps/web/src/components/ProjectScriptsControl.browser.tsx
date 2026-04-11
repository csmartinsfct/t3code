import "../index.css";

import type { DeclaredService, ProjectScript, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import ProjectScriptsControl from "./ProjectScriptsControl";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

function createScript(input?: Partial<ProjectScript>): ProjectScript {
  return {
    id: "dev-server",
    name: "Dev Server",
    command: "bun run dev",
    icon: "play",
    runOnWorktreeCreate: false,
    services: [
      {
        name: "frontend",
        healthCheck: {
          type: "url",
          url: "http://localhost:3773",
        },
      },
    ],
    ...input,
  };
}

describe("ProjectScriptsControl browser coverage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("covers adding an action with service metadata", async () => {
    // Audit traceability: eb1fe8e.
    const onAddScript = vi.fn(async () => undefined);
    const screen = await render(
      <ProjectScriptsControl
        scripts={[]}
        keybindings={EMPTY_KEYBINDINGS}
        onRunScript={vi.fn()}
        onAddScript={onAddScript}
        onUpdateScript={vi.fn()}
        onDeleteScript={vi.fn()}
      />,
    );

    try {
      await page.getByRole("button", { name: "Add action" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill("Preview");
      await page.getByRole("textbox", { name: "Command" }).fill("bun run preview");
      await page.getByRole("button", { name: "Add service for health monitoring" }).click();
      await page.getByPlaceholder("Name").fill("preview");
      await page.getByPlaceholder("http://localhost:3000").fill("http://localhost:4173");

      await page.getByRole("button", { name: "Save action" }).click();

      await vi.waitFor(() => {
        expect(onAddScript).toHaveBeenCalledWith({
          name: "Preview",
          command: "bun run preview",
          icon: "play",
          runOnWorktreeCreate: false,
          keybinding: null,
          services: [
            {
              name: "preview",
              healthCheck: {
                type: "url",
                url: "http://localhost:4173",
              },
            },
          ] satisfies DeclaredService[],
        });
      });
    } finally {
      await screen.unmount();
    }
  });

  it("covers editing service metadata and deleting an existing action", async () => {
    // Audit traceability: eb1fe8e.
    const onUpdateScript = vi.fn(async () => undefined);
    const onDeleteScript = vi.fn(async () => undefined);
    const screen = await render(
      <ProjectScriptsControl
        scripts={[createScript()]}
        keybindings={EMPTY_KEYBINDINGS}
        onRunScript={vi.fn()}
        onAddScript={vi.fn()}
        onUpdateScript={onUpdateScript}
        onDeleteScript={onDeleteScript}
      />,
    );

    try {
      await page.getByRole("button", { name: "Script actions" }).click();
      const menuItem = page.getByRole("menuitem", { name: /Dev Server/ });
      await menuItem.hover();
      await page.getByRole("button", { name: "Edit Dev Server" }).click();

      const typeSelect = document.querySelector<HTMLSelectElement>("select");
      expect(typeSelect).toBeTruthy();
      typeSelect!.focus();
      typeSelect!.value = "port";
      typeSelect!.dispatchEvent(new Event("change", { bubbles: true }));
      await page.getByPlaceholder("Name").fill("frontend");
      await page.getByPlaceholder("3000").fill("4173");
      await page.getByPlaceholder("host").fill("127.0.0.1");

      await page.getByRole("button", { name: "Save changes" }).click();

      await vi.waitFor(() => {
        expect(onUpdateScript).toHaveBeenCalledWith("dev-server", {
          name: "Dev Server",
          command: "bun run dev",
          icon: "play",
          runOnWorktreeCreate: false,
          keybinding: null,
          services: [
            {
              name: "frontend",
              healthCheck: {
                type: "port",
                port: 4173,
                host: "127.0.0.1",
              },
            },
          ] satisfies DeclaredService[],
        });
      });

      await page.getByRole("button", { name: "Script actions" }).click();
      await page.getByRole("menuitem", { name: /Dev Server/ }).hover();
      await page.getByRole("button", { name: "Edit Dev Server" }).click();
      await page.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("button", { name: "Delete action" }).click();

      await vi.waitFor(() => {
        expect(onDeleteScript).toHaveBeenCalledWith("dev-server");
      });
    } finally {
      await screen.unmount();
    }
  });
});
