import "../../index.css";

import type { DesktopBridge, ProjectId } from "@t3tools/contracts";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { EmbeddedBrowser } from "./EmbeddedBrowser";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function installDesktopBrowserBridge() {
  const mountResolvers = new Map<string, () => void>();
  const mount = vi.fn((projectId: string) => {
    const pending = deferred();
    mountResolvers.set(projectId, pending.resolve);
    return pending.promise;
  });
  const browser = {
    mount,
    setBounds: vi.fn(async () => undefined),
    unmount: vi.fn(async () => undefined),
    suspendForModal: vi.fn(async () => undefined),
    resumeFromModal: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    getUrl: vi.fn(async (projectId: string) => `https://${projectId}.example/`),
    listTabs: vi.fn(async (projectId: string) => ({
      tabs: [
        {
          id: 0,
          url: `https://${projectId}.example/`,
          title: projectId,
          favicon: null,
          active: true,
        },
      ],
      activeTabId: 0,
    })),
    newTab: vi.fn(async () => 0),
    switchTab: vi.fn(async () => undefined),
    closeTab: vi.fn(async () => 0),
    onTabsChanged: vi.fn(() => () => undefined),
  };

  window.desktopBridge = {
    browser,
  } as unknown as DesktopBridge;

  return { browser, mountResolvers };
}

function Harness() {
  const [projectId, setProjectId] = useState("project-a" as ProjectId);
  return (
    <div style={{ display: "flex", height: 240, width: 640 }}>
      <button type="button" onClick={() => setProjectId("project-b" as ProjectId)}>
        Switch project
      </button>
      <EmbeddedBrowser projectId={projectId} />
    </div>
  );
}

describe("EmbeddedBrowser project isolation", () => {
  afterEach(() => {
    delete window.desktopBridge;
    document.body.innerHTML = "";
  });

  it("starts a fresh mount for a new project while the previous mount is still pending", async () => {
    const { browser, mountResolvers } = installDesktopBrowserBridge();

    const screen = await render(<Harness />);

    await vi.waitFor(() => {
      expect(browser.mount).toHaveBeenCalledWith("project-a", expect.any(Object));
    });

    await page.getByRole("button", { name: "Switch project" }).click();

    await vi.waitFor(() => {
      expect(browser.mount).toHaveBeenCalledWith("project-b", expect.any(Object));
    });

    mountResolvers.get("project-a")?.();
    mountResolvers.get("project-b")?.();

    await vi.waitFor(() => {
      expect(browser.getUrl).toHaveBeenCalledWith("project-b");
      expect(browser.listTabs).toHaveBeenCalledWith("project-b");
    });

    expect(browser.getUrl).not.toHaveBeenCalledWith("project-a");
    expect(browser.listTabs).not.toHaveBeenCalledWith("project-a");
    expect(browser.unmount).toHaveBeenCalledWith("project-a");

    await screen.unmount();
  });
});
