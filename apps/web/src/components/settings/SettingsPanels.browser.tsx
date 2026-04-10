import "../../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  type NativeApi,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../../nativeApi";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import { GeneralSettingsPanel } from "./SettingsPanels";

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpTracesEnabled: true,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

function createProvider(input: { provider: string; displayName?: string }): ServerProvider {
  return {
    provider: input.provider as never,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-10T00:00:00.000Z",
    models: [
      {
        slug: input.provider === "codex" ? "gpt-5.4" : "claude-opus-4-6",
        name: input.provider === "codex" ? "GPT-5.4" : "Claude Opus 4.6",
        isCustom: false,
        capabilities: null,
      },
    ],
  };
}

describe("GeneralSettingsPanel observability", () => {
  beforeEach(() => {
    resetServerStateForTests();
    __resetNativeApiForTests();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    resetServerStateForTests();
    __resetNativeApiForTests();
    document.body.innerHTML = "";
  });

  it("shows diagnostics inside About with a single logs-folder action", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("About")).toBeInTheDocument();
    await expect.element(page.getByText("Diagnostics")).toBeInTheDocument();
    await expect.element(page.getByText("Open logs folder")).toBeInTheDocument();
    await expect
      .element(page.getByText("/repo/project/.t3/logs", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Local trace file. OTLP exporting traces to http://localhost:4318/v1/traces.",
        ),
      )
      .toBeInTheDocument();
    await expect.element(page.getByText("Automated review cycles")).toBeInTheDocument();
    await expect
      .element(page.getByLabelText("Maximum automated review iterations"))
      .toHaveAttribute("value", "3");
  });

  it("opens the logs folder in the preferred editor", async () => {
    const openInEditor = vi.fn<NativeApi["shell"]["openInEditor"]>().mockResolvedValue(undefined);
    window.nativeApi = {
      shell: {
        openInEditor,
      },
    } as unknown as NativeApi;

    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const openLogsButton = page.getByText("Open logs folder");
    await openLogsButton.click();

    expect(openInEditor).toHaveBeenCalledWith("/repo/project/.t3/logs", "cursor");
  });
});

describe("GeneralSettingsPanel discovered Claude profiles", () => {
  beforeEach(() => {
    resetServerStateForTests();
    __resetNativeApiForTests();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    resetServerStateForTests();
    __resetNativeApiForTests();
    document.body.innerHTML = "";
  });

  it("renders discovered Claude profiles as distinct provider cards", async () => {
    // Audit traceability: e1077b5, 7d6be28.
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [
        createProvider({ provider: "codex" }),
        createProvider({ provider: "claudeAgent", displayName: "Claude" }),
        createProvider({ provider: "claudeAgent:metric", displayName: "Claude (metric)" }),
        createProvider({ provider: "claudeAgent:zbd", displayName: "Claude (zbd)" }),
      ],
    });

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect
      .element(page.getByRole("heading", { name: "Claude", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Claude (metric)" }))
      .toBeInTheDocument();
    await expect.element(page.getByRole("heading", { name: "Claude (zbd)" })).toBeInTheDocument();
  });

  it("keeps collapse state separate for each discovered Claude profile card", async () => {
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [
        createProvider({ provider: "codex" }),
        createProvider({ provider: "claudeAgent", displayName: "Claude" }),
        createProvider({ provider: "claudeAgent:metric", displayName: "Claude (metric)" }),
        createProvider({ provider: "claudeAgent:zbd", displayName: "Claude (zbd)" }),
      ],
    });

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Toggle Claude (metric) details" }).click();

    await expect.element(page.getByText("Claude (metric) binary path")).toBeInTheDocument();
    await expect.element(page.getByText("Claude (zbd) binary path")).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Toggle Claude (zbd) details" }).click();

    await expect.element(page.getByText("Claude (metric) binary path")).toBeInTheDocument();
    await expect.element(page.getByText("Claude (zbd) binary path")).toBeInTheDocument();
  });
});
