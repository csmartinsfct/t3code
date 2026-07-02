import {
  DEFAULT_MODEL_BY_PROVIDER,
  ThreadId,
  type ModelSelection,
  type RuntimeMode,
} from "@t3tools/contracts";
import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { TraitsMenuContent } from "./TraitsPicker";
import { useComposerDraftStore } from "../../composerDraftStore";

async function mountMenu(props?: {
  interactionMode?: "default" | "plan" | "plan-accept";
  runtimeMode?: RuntimeMode;
  modelSelection?: ModelSelection;
  prompt?: string;
  supportsPlan?: boolean;
}) {
  const threadId = ThreadId.makeUnsafe("thread-compact-menu");
  const provider = props?.modelSelection?.provider ?? "claudeAgent";
  const draftsByThreadId = {} as ReturnType<
    typeof useComposerDraftStore.getState
  >["draftsByThreadId"];
  const model = props?.modelSelection?.model ?? DEFAULT_MODEL_BY_PROVIDER[provider];

  draftsByThreadId[threadId] = {
    prompt: props?.prompt ?? "",
    images: [],
    nonPersistedImageIds: [],
    persistedAttachments: [],
    terminalContexts: [],
    codeSnippets: [],
    ticketAttachments: [],
    skills: [],
    modelSelectionByProvider: {
      [provider]: {
        provider,
        model,
        ...(props?.modelSelection?.options ? { options: props.modelSelection.options } : {}),
      },
    },
    activeProvider: provider,
    runtimeMode: null,
    interactionMode: null,
  };
  useComposerDraftStore.setState({
    draftsByThreadId,
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
  });
  const host = document.createElement("div");
  document.body.append(host);
  const onPromptChange = vi.fn();
  const onInteractionModeChange = vi.fn();
  const onRuntimeModeChange = vi.fn();
  const providerOptions = props?.modelSelection?.options;
  const models =
    provider === "claudeAgent"
      ? [
          {
            slug: "claude-opus-4-8",
            name: "Claude Opus 4.8",
            isCustom: false,
            capabilities: {
              reasoningEffortLevels: [
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High", isDefault: true },
                { value: "xhigh", label: "Extra High" },
                { value: "max", label: "Max" },
                { value: "ultrathink", label: "Ultrathink" },
              ],
              supportsFastMode: true,
              supportsThinkingToggle: false,
              supportsPlan: true,
              contextWindowOptions: [],
              promptInjectedEffortLevels: ["ultrathink"],
            },
          },
          {
            slug: "claude-haiku-4-5",
            name: "Claude Haiku 4.5",
            isCustom: false,
            capabilities: {
              reasoningEffortLevels: [],
              supportsFastMode: false,
              supportsThinkingToggle: true,
              supportsPlan: false,
              contextWindowOptions: [],
              promptInjectedEffortLevels: [],
            },
          },
          {
            slug: "claude-sonnet-5",
            name: "Claude Sonnet 5",
            isCustom: false,
            capabilities: {
              reasoningEffortLevels: [
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High", isDefault: true },
                { value: "xhigh", label: "Extra High" },
                { value: "max", label: "Max" },
                { value: "ultrathink", label: "Ultrathink" },
              ],
              supportsFastMode: false,
              supportsThinkingToggle: false,
              supportsPlan: true,
              contextWindowOptions: [],
              promptInjectedEffortLevels: ["ultrathink"],
            },
          },
        ]
      : [
          {
            slug: "gpt-5.4",
            name: "GPT-5.4",
            isCustom: false,
            capabilities: {
              reasoningEffortLevels: [
                { value: "xhigh", label: "Extra High" },
                { value: "high", label: "High", isDefault: true },
              ],
              supportsFastMode: true,
              supportsThinkingToggle: false,
              supportsPlan: true,
              contextWindowOptions: [],
              promptInjectedEffortLevels: [],
            },
          },
        ];
  const screen = await render(
    <CompactComposerControlsMenu
      interactionMode={props?.interactionMode ?? "default"}
      runtimeMode={props?.runtimeMode ?? "full-access"}
      supportsPlan={props?.supportsPlan ?? true}
      traitsMenuContent={
        <TraitsMenuContent
          provider={provider}
          models={models}
          threadId={threadId}
          model={model}
          prompt={props?.prompt ?? ""}
          modelOptions={providerOptions}
          onPromptChange={onPromptChange}
        />
      }
      onInteractionModeChange={onInteractionModeChange}
      onRuntimeModeChange={onRuntimeModeChange}
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
    onInteractionModeChange,
    onRuntimeModeChange,
  };
}

async function waitForMenuRadioItem(label: string): Promise<HTMLElement> {
  let item: HTMLElement | null = null;
  await vi.waitFor(() => {
    item =
      Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find(
        (element) => element.textContent?.trim() === label,
      ) ?? null;
    expect(item).toBeTruthy();
  });
  if (!item) {
    throw new Error(`Unable to find menu item "${label}".`);
  }
  return item;
}

describe("CompactComposerControlsMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
    });
  });

  it("shows fast mode controls for Opus", async () => {
    await using _ = await mountMenu({
      modelSelection: { provider: "claudeAgent", model: "claude-opus-4-8" },
    });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Fast Mode");
      expect(text).toContain("off");
      expect(text).toContain("on");
    });
  });

  it("hides fast mode controls for non-Opus Claude models", async () => {
    await using _ = await mountMenu({
      modelSelection: { provider: "claudeAgent", model: "claude-sonnet-5" },
    });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").not.toContain("Fast Mode");
    });
  });

  it("shows only the provided effort options", async () => {
    await using _ = await mountMenu({
      modelSelection: { provider: "claudeAgent", model: "claude-sonnet-5" },
    });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Low");
      expect(text).toContain("Medium");
      expect(text).toContain("High");
      expect(text).toContain("Extra High");
      expect(text).toContain("Max");
      expect(text).toContain("Ultrathink");
    });
  });

  it("shows a Claude thinking on/off section for Haiku", async () => {
    await using _ = await mountMenu({
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-haiku-4-5",
        options: { thinking: true },
      },
    });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Thinking");
      expect(text).toContain("On (default)");
      expect(text).toContain("Off");
    });
  });

  it("shows prompt-controlled Ultrathink state with selectable effort controls", async () => {
    await using _ = await mountMenu({
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-8",
        options: { effort: "high" },
      },
      prompt: "Ultrathink:\nInvestigate this",
    });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Effort");
      expect(text).not.toContain("ultrathink");
    });
  });

  it("warns when ultrathink appears in prompt body text", async () => {
    await using _ = await mountMenu({
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-8",
        options: { effort: "high" },
      },
      prompt: "Ultrathink:\nplease ultrathink about this problem",
    });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain(
        'Your prompt contains "ultrathink" in the text. Remove it to change effort.',
      );
    });
  });

  it("cycles between Chat, Plan, and Plan + Accept modes from the menu", async () => {
    // Audit traceability: 623a434, 3dd6391, 03999e7.
    const defaultMounted = await mountMenu({
      interactionMode: "default",
      modelSelection: { provider: "claudeAgent", model: "claude-opus-4-8" },
    });

    try {
      await page.getByLabelText("More composer controls").click();
      (await waitForMenuRadioItem("Plan")).click();

      expect(defaultMounted.onInteractionModeChange).toHaveBeenCalledWith("plan");

      await page.getByLabelText("More composer controls").click();
      (await waitForMenuRadioItem("Plan + Accept")).click();

      expect(defaultMounted.onInteractionModeChange).toHaveBeenCalledWith("plan-accept");
    } finally {
      await defaultMounted.cleanup();
    }

    const acceptMounted = await mountMenu({
      interactionMode: "plan-accept",
      modelSelection: { provider: "claudeAgent", model: "claude-opus-4-8" },
    });

    try {
      await page.getByLabelText("More composer controls").click();
      (await waitForMenuRadioItem("Chat")).click();

      expect(acceptMounted.onInteractionModeChange).toHaveBeenCalledWith("default");
    } finally {
      await acceptMounted.cleanup();
    }
  });

  it("changes runtime access from the menu", async () => {
    const supervisedMounted = await mountMenu({
      runtimeMode: "approval-required",
      modelSelection: { provider: "claudeAgent", model: "claude-opus-4-8" },
    });

    try {
      await page.getByLabelText("More composer controls").click();
      (await waitForMenuRadioItem("Full access")).click();

      expect(supervisedMounted.onRuntimeModeChange).toHaveBeenCalledWith("full-access");
    } finally {
      await supervisedMounted.cleanup();
    }

    const fullAccessMounted = await mountMenu({
      runtimeMode: "full-access",
      modelSelection: { provider: "claudeAgent", model: "claude-opus-4-8" },
    });

    try {
      await page.getByLabelText("More composer controls").click();
      (await waitForMenuRadioItem("Supervised")).click();

      expect(fullAccessMounted.onRuntimeModeChange).toHaveBeenCalledWith("approval-required");
    } finally {
      await fullAccessMounted.cleanup();
    }
  });

  it("hides plan-only controls when the selected model does not support planning", async () => {
    const mounted = await mountMenu({
      interactionMode: "default",
      modelSelection: { provider: "claudeAgent", model: "claude-haiku-4-5" },
      supportsPlan: false,
    });

    await using _ = mounted;

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Access");
      expect(text).toContain("Full access");
      expect(text).toContain("Chat");
      expect(text).not.toContain("Plan + Accept");
    });
  });
});
