import { type ProviderKind, type ServerProvider } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProviderModelPicker } from "./ProviderModelPicker";
import { getCustomModelOptionsByProvider } from "../../modelSelection";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

function effort(value: string, isDefault = false) {
  return {
    value,
    label: value,
    ...(isDefault ? { isDefault: true } : {}),
  };
}

const TEST_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: "gpt-5-codex",
        name: "GPT-5 Codex",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
          supportsFastMode: true,
          supportsThinkingToggle: false,
          supportsPlan: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
      {
        slug: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
          supportsFastMode: true,
          supportsThinkingToggle: false,
          supportsPlan: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
  {
    provider: "codex:metric" as never,
    displayName: "Codex (metric)",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "unauthenticated" },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: "gpt-5.4",
        name: "GPT-5.4",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
          supportsFastMode: true,
          supportsThinkingToggle: false,
          supportsPlan: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
  {
    provider: "claudeAgent",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [
            effort("low"),
            effort("medium", true),
            effort("high"),
            effort("max"),
          ],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          supportsPlan: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [
            effort("low"),
            effort("medium", true),
            effort("high"),
            effort("max"),
          ],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          supportsPlan: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
      {
        slug: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          supportsPlan: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
  {
    provider: "claudeAgent:metric" as never,
    displayName: "Claude (metric)",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [
            effort("low"),
            effort("medium", true),
            effort("high"),
            effort("max"),
          ],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          supportsPlan: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
  {
    provider: "cursor",
    displayName: "Cursor",
    enabled: true,
    installed: true,
    version: "2026.05.01-eea359f",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: "composer-2",
        name: "Composer 2",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [],
          supportsFastMode: false,
          supportsThinkingToggle: false,
          supportsPlan: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
  {
    provider: "cursor:metric" as never,
    displayName: "Cursor (metric)",
    enabled: true,
    installed: true,
    version: "2026.05.01-eea359f",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: "composer-2-fast",
        name: "Composer 2 Fast",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [],
          supportsFastMode: false,
          supportsThinkingToggle: false,
          supportsPlan: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
];

function buildCodexProvider(models: ServerProvider["models"]): ServerProvider {
  return {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models,
  };
}

function getMenuRadioItemByText(label: string): HTMLElement {
  const element = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find(
    (candidate) => candidate.textContent?.includes(label),
  );

  if (!element) {
    throw new Error(`Expected menu radio item ${label} to be mounted.`);
  }

  return element;
}

function expectMenuRadioItemDisabled(label: string): HTMLElement {
  const element = getMenuRadioItemByText(label);
  expect(element.matches('[data-disabled], [aria-disabled="true"]')).toBe(true);
  return element;
}

async function mountPicker(props: {
  provider: ProviderKind;
  model: string;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  triggerVariant?: "ghost" | "outline";
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onProviderModelChange = vi.fn();
  const providers = props.providers ?? TEST_PROVIDERS;
  const modelOptionsByProvider = getCustomModelOptionsByProvider(
    DEFAULT_UNIFIED_SETTINGS,
    providers,
    props.provider,
    props.model,
  );
  const screen = await render(
    <ProviderModelPicker
      provider={props.provider}
      model={props.model}
      lockedProvider={props.lockedProvider}
      providers={providers}
      modelOptionsByProvider={modelOptionsByProvider}
      triggerVariant={props.triggerVariant}
      onProviderModelChange={onProviderModelChange}
    />,
    { container: host },
  );

  return {
    onProviderModelChange,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("ProviderModelPicker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows provider submenus when provider switching is allowed", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Codex");
        expect(text).toContain("Codex (metric)");
        expect(text).toContain("Claude");
        expect(text).toContain("Claude (metric)");
        expect(text).toContain("Cursor");
        expect(text).toContain("Cursor (metric)");
        expect(text).not.toContain("Claude Sonnet 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens provider submenus with a visible gap from the parent menu", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();
      const providerTrigger = page.getByRole("menuitem", { name: "Codex", exact: true });
      await providerTrigger.hover();

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("GPT-5 Codex");
      });

      const providerTriggerElement = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((element) => element.textContent?.includes("Codex"));
      if (!providerTriggerElement) {
        throw new Error("Expected the Codex provider trigger to be mounted.");
      }

      const providerTriggerRect = providerTriggerElement.getBoundingClientRect();
      const modelElement = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
      ).find((element) => element.textContent?.includes("GPT-5 Codex"));
      if (!modelElement) {
        throw new Error("Expected the submenu model option to be mounted.");
      }

      const submenuPopup = modelElement.closest('[data-slot="menu-sub-content"]');
      if (!(submenuPopup instanceof HTMLElement)) {
        throw new Error("Expected submenu popup to be mounted.");
      }

      const submenuRect = submenuPopup.getBoundingClientRect();

      expect(submenuRect.left).toBeGreaterThanOrEqual(providerTriggerRect.right);
      expect(submenuRect.left - providerTriggerRect.right).toBeGreaterThanOrEqual(2);
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows models directly when the provider is locked mid-thread", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: "claudeAgent",
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Sonnet 4.6");
        expect(text).toContain("Claude Haiku 4.5");
        expect(text).not.toContain("Codex");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("only shows codex spark when the server reports it for the account", async () => {
    const claudeProvider = TEST_PROVIDERS.find((provider) => provider.provider === "claudeAgent");
    if (!claudeProvider) {
      throw new Error("Expected Claude test provider to exist.");
    }
    const providersWithoutSpark: ReadonlyArray<ServerProvider> = [
      buildCodexProvider([
        {
          slug: "gpt-5.3-codex",
          name: "GPT-5.3 Codex",
          isCustom: false,
          capabilities: {
            reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
            supportsFastMode: true,
            supportsThinkingToggle: false,
            supportsPlan: true,
            contextWindowOptions: [],
            promptInjectedEffortLevels: [],
          },
        },
      ]),
      claudeProvider,
    ];
    const providersWithSpark: ReadonlyArray<ServerProvider> = [
      buildCodexProvider([
        {
          slug: "gpt-5.3-codex",
          name: "GPT-5.3 Codex",
          isCustom: false,
          capabilities: {
            reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
            supportsFastMode: true,
            supportsThinkingToggle: false,
            supportsPlan: true,
            contextWindowOptions: [],
            promptInjectedEffortLevels: [],
          },
        },
        {
          slug: "gpt-5.3-codex-spark",
          name: "GPT-5.3 Codex Spark",
          isCustom: false,
          capabilities: {
            reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
            supportsFastMode: true,
            supportsThinkingToggle: false,
            supportsPlan: true,
            contextWindowOptions: [],
            promptInjectedEffortLevels: [],
          },
        },
      ]),
      claudeProvider,
    ];

    const hidden = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: null,
      providers: providersWithoutSpark,
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Codex", exact: true }).hover();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("GPT-5.3 Codex");
        expect(text).not.toContain("GPT-5.3 Codex Spark");
      });
    } finally {
      await hidden.cleanup();
    }

    const visible = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: null,
      providers: providersWithSpark,
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Codex", exact: true }).hover();

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("GPT-5.3 Codex Spark");
      });
    } finally {
      await visible.cleanup();
    }
  });

  it("dispatches the canonical slug when a model is selected", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: "claudeAgent",
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("menuitemradio", { name: "Claude Sonnet 4.6" }).click();

      expect(mounted.onProviderModelChange).toHaveBeenCalledWith(
        "claudeAgent",
        "claude-sonnet-4-6",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps discovered Claude profiles as distinct provider selections", async () => {
    // Audit traceability: e1077b5, 7d6be28.
    const mounted = await mountPicker({
      provider: "claudeAgent:metric",
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await vi.waitFor(() => {
        expect(page.getByRole("button").element().textContent).toContain("Claude Opus 4.6");
        expect(page.getByRole("button").element().textContent).toContain("metric");
      });

      await page.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Claude (metric)" }).hover();
      await page.getByRole("menuitemradio", { name: "Claude Opus 4.6" }).click();

      expect(mounted.onProviderModelChange).toHaveBeenCalledWith(
        "claudeAgent:metric",
        "claude-opus-4-6",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps discovered Codex profiles as distinct provider selections", async () => {
    const mounted = await mountPicker({
      provider: "codex:metric",
      model: "gpt-5.4",
      lockedProvider: null,
    });

    try {
      await vi.waitFor(() => {
        expect(page.getByRole("button").element().textContent).toContain("GPT-5.4");
        expect(page.getByRole("button").element().textContent).toContain("metric");
      });

      await page.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Codex (metric)" }).hover();
      await page.getByRole("menuitemradio", { name: "GPT-5.4" }).click();

      expect(mounted.onProviderModelChange).toHaveBeenCalledWith("codex:metric", "gpt-5.4");
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps discovered Cursor profiles as distinct provider selections", async () => {
    const mounted = await mountPicker({
      provider: "cursor:metric",
      model: "composer-2-fast",
      lockedProvider: null,
    });

    try {
      await vi.waitFor(() => {
        expect(page.getByRole("button").element().textContent).toContain("Composer 2 Fast");
        expect(page.getByRole("button").element().textContent).toContain("metric");
      });

      await page.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Cursor (metric)" }).hover();
      await page.getByRole("menuitemradio", { name: "Composer 2 Fast" }).click();

      expect(mounted.onProviderModelChange).toHaveBeenCalledWith(
        "cursor:metric",
        "composer-2-fast",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not keep the static Cursor coming-soon row when server Cursor exists", async () => {
    const mounted = await mountPicker({
      provider: "cursor",
      model: "composer-2",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const cursorMenuItems = Array.from(
          document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
        ).filter((element) => element.textContent?.includes("Cursor"));
        expect(cursorMenuItems.length).toBeGreaterThan(0);
        expect(
          cursorMenuItems.some((element) => element.textContent?.includes("Coming soon")),
        ).toBe(false);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("surfaces unavailable Cursor status without allowing model selection", async () => {
    const codexProvider = TEST_PROVIDERS.find((provider) => provider.provider === "codex");
    if (!codexProvider) {
      throw new Error("Expected Codex test provider to exist.");
    }
    const unavailableCursor: ServerProvider = {
      provider: "cursor",
      displayName: "Cursor",
      enabled: true,
      installed: false,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: "Cursor CLI not found. Install Cursor CLI or set the binary path in settings.",
      checkedAt: new Date().toISOString(),
      models: [
        {
          slug: "composer-2",
          name: "Composer 2",
          isCustom: false,
          capabilities: {
            reasoningEffortLevels: [],
            supportsFastMode: false,
            supportsThinkingToggle: false,
            supportsPlan: true,
            contextWindowOptions: [],
            promptInjectedEffortLevels: [],
          },
        },
      ],
    };
    const mounted = await mountPicker({
      provider: "codex",
      model: "gpt-5-codex",
      lockedProvider: null,
      providers: [codexProvider, unavailableCursor],
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Cursor" }).hover();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Not installed");
        expect(text).toContain("Cursor CLI not found");
        expect(text).toContain("Composer 2");
      });
      const disabledModel = expectMenuRadioItemDisabled("Composer 2");
      disabledModel.click();
      expect(mounted.onProviderModelChange).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows disabled providers as non-selectable entries", async () => {
    const disabledProviders = TEST_PROVIDERS.slice();
    const claudeIndex = disabledProviders.findIndex(
      (provider) => provider.provider === "claudeAgent",
    );
    if (claudeIndex >= 0) {
      const claudeProvider = disabledProviders[claudeIndex]!;
      disabledProviders[claudeIndex] = {
        ...claudeProvider,
        enabled: false,
        status: "disabled",
      };
    }
    const mounted = await mountPicker({
      provider: "codex",
      model: "gpt-5-codex",
      lockedProvider: null,
      providers: disabledProviders,
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Claude", exact: true }).hover();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude");
        expect(text).toContain("Disabled");
        expect(text).toContain("Claude Sonnet 4.6");
      });
      const disabledModel = expectMenuRadioItemDisabled("Claude Sonnet 4.6");
      disabledModel.click();
      expect(mounted.onProviderModelChange).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("surfaces unauthenticated providers clearly in the picker", async () => {
    const unauthenticatedGemini: ServerProvider = {
      provider: "gemini",
      enabled: true,
      installed: true,
      version: "0.38.2",
      status: "error",
      auth: { status: "unauthenticated", type: "api-key", label: "Missing GEMINI_API_KEY" },
      message:
        "Gemini CLI is installed but authentication is missing. Run `gemini auth` or set GEMINI_API_KEY.",
      checkedAt: new Date().toISOString(),
      models: [
        {
          slug: "gemini-2.5-flash",
          name: "Gemini 2.5 Flash",
          isCustom: false,
          capabilities: {
            reasoningEffortLevels: [],
            supportsFastMode: false,
            supportsThinkingToggle: false,
            supportsPlan: true,
            contextWindowOptions: [],
            promptInjectedEffortLevels: [],
          },
        },
      ],
    };
    const mounted = await mountPicker({
      provider: "codex",
      model: "gpt-5-codex",
      lockedProvider: null,
      providers: [...TEST_PROVIDERS, unauthenticatedGemini],
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Gemini" }).hover();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Gemini");
        expect(text).toContain("Not authenticated");
        expect(text).toContain("Gemini 2.5 Flash");
      });
      const disabledModel = expectMenuRadioItemDisabled("Gemini 2.5 Flash");
      disabledModel.click();
      expect(mounted.onProviderModelChange).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("surfaces missing Claude profile config distinctly", async () => {
    const claudeProvider = TEST_PROVIDERS.find((provider) => provider.provider === "claudeAgent");
    const claudeProfileProvider = TEST_PROVIDERS.find(
      (provider) => String(provider.provider) === "claudeAgent:metric",
    );
    if (!claudeProvider) {
      throw new Error("Expected Claude test provider to exist.");
    }
    if (!claudeProfileProvider) {
      throw new Error("Expected Claude profile test provider to exist.");
    }
    const missingConfigClaudeProvider: ServerProvider = {
      ...claudeProvider,
      status: "error",
      installed: true,
      auth: { status: "unauthenticated" },
      message:
        "Claude profile is not configured. Run `claude auth login` for this profile and try again.",
    };
    const missingConfigProviders: ReadonlyArray<ServerProvider> = [
      TEST_PROVIDERS[0]!,
      missingConfigClaudeProvider,
      claudeProfileProvider,
    ];
    const mounted = await mountPicker({
      provider: "codex",
      model: "gpt-5-codex",
      lockedProvider: null,
      providers: missingConfigProviders,
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Claude", exact: true }).hover();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Not configured");
        expect(text).toContain("Claude Opus 4.6");
      });
      const disabledModel = expectMenuRadioItemDisabled("Claude Opus 4.6");
      disabledModel.click();
      expect(mounted.onProviderModelChange).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("accepts outline trigger styling", async () => {
    const mounted = await mountPicker({
      provider: "codex",
      model: "gpt-5-codex",
      lockedProvider: null,
      triggerVariant: "outline",
    });

    try {
      const button = document.querySelector("button");
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Expected picker trigger button to be rendered.");
      }
      expect(button.className).toContain("border-input");
      expect(button.className).toContain("bg-popover");
    } finally {
      await mounted.cleanup();
    }
  });
});
