import "../../index.css";

import type { ManageMcpServerAction, ResolvedMcpServer } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { McpServersPicker } from "./McpServersPicker";

const TEST_SERVERS: readonly ResolvedMcpServer[] = [
  {
    name: "playwright",
    status: "needs-approval",
    scope: "project",
  },
  {
    name: "linear",
    status: "needs approval",
    scope: "project",
  },
  {
    name: "github-personal",
    status: "ready",
    scope: "user",
    toolCount: 41,
  },
  {
    name: "figma",
    status: "error",
    scope: "user",
    error: "command failed",
  },
];

async function mountPicker(props?: {
  onServerAction?: (serverName: string, action: ManageMcpServerAction) => Promise<void>;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onRetry = vi.fn();
  const onServerAction =
    props?.onServerAction ??
    vi.fn(async (_serverName: string, _action: ManageMcpServerAction) => {});
  const screen = await render(
    <McpServersPicker
      status="ready"
      serverNames={TEST_SERVERS.map((server) => server.name)}
      servers={TEST_SERVERS}
      canManageServers
      onRetry={onRetry}
      onServerAction={onServerAction}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    onRetry,
    onServerAction,
  };
}

describe("McpServersPicker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows Cursor approval actions and approves every pending server", async () => {
    await using mounted = await mountPicker();

    await page.getByLabelText("MCP servers").click();

    await expect.element(page.getByText("MCP Servers")).toBeInTheDocument();
    await expect.element(page.getByText("Approve all")).toBeInTheDocument();
    await expect.element(page.getByText("playwright")).toBeInTheDocument();
    await expect.element(page.getByText("linear")).toBeInTheDocument();
    await expect.element(page.getByText("github-personal")).toBeInTheDocument();
    await expect.element(page.getByText("needs-approval")).not.toBeInTheDocument();
    await expect.element(page.getByText("needs approval")).not.toBeInTheDocument();
    await expect.element(page.getByText("ready")).not.toBeInTheDocument();
    await expect.element(page.getByText("READY")).not.toBeInTheDocument();
    await expect.element(page.getByText("error")).toBeInTheDocument();

    await page.getByRole("button", { name: "Approve all pending Cursor MCP servers" }).click();

    await vi.waitFor(() => {
      expect(mounted.onServerAction).toHaveBeenCalledTimes(2);
      expect(mounted.onServerAction).toHaveBeenNthCalledWith(1, "playwright", "approve");
      expect(mounted.onServerAction).toHaveBeenNthCalledWith(2, "linear", "approve");
    });
  });

  it("shows a loading state instead of an empty state while resolving servers", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <McpServersPicker status="loading" serverNames={[]} servers={[]} onRetry={vi.fn()} />,
      { container: host },
    );

    try {
      await page.getByLabelText("MCP servers").click();

      await expect.element(page.getByText("Loading")).toBeInTheDocument();
      await expect.element(page.getByText("No MCP servers")).not.toBeInTheDocument();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
