import {
  baseProviderKind,
  type BaseProviderKind,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type OverlayMenuItem,
  type ProviderKind,
  type ProviderModelOptions,
  type ServerProviderModel,
  type ThreadId,
} from "@t3tools/contracts";
import {
  applyClaudePromptEffortPrefix,
  isClaudeUltrathinkPrompt,
  trimOrNull,
  getDefaultEffort,
  getDefaultContextWindow,
  hasContextWindowOption,
  resolveEffort,
} from "@t3tools/shared/model";
import { memo, useCallback, useMemo, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { useComposerDraftStore } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import { cn } from "~/lib/utils";

type ProviderOptions = ProviderModelOptions[BaseProviderKind];
type TraitsPersistence =
  | {
      threadId: ThreadId;
      onModelOptionsChange?: never;
    }
  | {
      threadId?: undefined;
      onModelOptionsChange: (nextOptions: ProviderOptions | undefined) => void;
    };

export interface TraitsOverlayMenu {
  overlayItems: OverlayMenuItem[] | undefined;
  overlaySelectionById: Map<string, () => void>;
}

const ULTRATHINK_PROMPT_PREFIX = "Ultrathink:\n";

function getRawEffort(
  provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined,
): string | null {
  if (baseProviderKind(provider) === "codex") {
    return trimOrNull((modelOptions as CodexModelOptions | undefined)?.reasoningEffort);
  }
  return trimOrNull((modelOptions as ClaudeModelOptions | undefined)?.effort);
}

function getRawContextWindow(
  provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined,
): string | null {
  if (baseProviderKind(provider) === "claudeAgent") {
    return trimOrNull((modelOptions as ClaudeModelOptions | undefined)?.contextWindow);
  }
  return null;
}

function buildNextOptions(
  provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined,
  patch: Record<string, unknown>,
): ProviderOptions {
  if (baseProviderKind(provider) === "codex") {
    return { ...(modelOptions as CodexModelOptions | undefined), ...patch } as CodexModelOptions;
  }
  return { ...(modelOptions as ClaudeModelOptions | undefined), ...patch } as ClaudeModelOptions;
}

function getSelectedTraits(
  provider: ProviderKind,
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  prompt: string,
  modelOptions: ProviderOptions | null | undefined,
  allowPromptInjectedEffort: boolean,
) {
  const caps = getProviderModelCapabilities(models, model, provider);
  const effortLevels = allowPromptInjectedEffort
    ? caps.reasoningEffortLevels
    : caps.reasoningEffortLevels.filter(
        (option) => !caps.promptInjectedEffortLevels.includes(option.value),
      );

  // Resolve effort from options (provider-specific key)
  const rawEffort = getRawEffort(provider, modelOptions);
  const effort = resolveEffort(caps, rawEffort) ?? null;

  // Thinking toggle (only for models that support it)
  const thinkingEnabled = caps.supportsThinkingToggle
    ? ((modelOptions as ClaudeModelOptions | undefined)?.thinking ?? true)
    : null;

  // Fast mode
  const fastModeEnabled =
    caps.supportsFastMode &&
    (modelOptions as { fastMode?: boolean } | undefined)?.fastMode === true;

  // Context window
  const contextWindowOptions = caps.contextWindowOptions;
  const rawContextWindow = getRawContextWindow(provider, modelOptions);
  const defaultContextWindow = getDefaultContextWindow(caps);
  const contextWindow =
    rawContextWindow && hasContextWindowOption(caps, rawContextWindow)
      ? rawContextWindow
      : defaultContextWindow;

  // Prompt-controlled effort (e.g. ultrathink in prompt text)
  const ultrathinkPromptControlled =
    allowPromptInjectedEffort &&
    caps.promptInjectedEffortLevels.length > 0 &&
    isClaudeUltrathinkPrompt(prompt);

  // Check if "ultrathink" appears in the body text (not just our prefix)
  const ultrathinkInBodyText =
    ultrathinkPromptControlled && isClaudeUltrathinkPrompt(prompt.replace(/^Ultrathink:\s*/i, ""));

  return {
    caps,
    effort,
    effortLevels,
    thinkingEnabled,
    fastModeEnabled,
    contextWindowOptions,
    contextWindow,
    defaultContextWindow,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
  };
}

export interface TraitsMenuContentProps {
  provider: ProviderKind;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  modelOptions?: ProviderOptions | null | undefined;
  allowPromptInjectedEffort?: boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
}

function useTraitsActions({
  provider,
  prompt,
  onPromptChange,
  modelOptions,
  selected,
  persistence,
}: Pick<TraitsMenuContentProps, "provider" | "prompt" | "onPromptChange" | "modelOptions"> & {
  selected: ReturnType<typeof getSelectedTraits>;
  persistence: TraitsPersistence;
}) {
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const updateModelOptions = useCallback(
    (nextOptions: ProviderOptions | undefined) => {
      if ("onModelOptionsChange" in persistence) {
        persistence.onModelOptionsChange(nextOptions);
        return;
      }
      setProviderModelOptions(persistence.threadId, provider, nextOptions, { persistSticky: true });
    },
    [persistence, provider, setProviderModelOptions],
  );

  const handleEffortChange = useCallback(
    (value: string) => {
      if (!value) return;
      const nextOption = selected.effortLevels.find((option) => option.value === value);
      if (!nextOption) return;
      if (selected.caps.promptInjectedEffortLevels.includes(nextOption.value)) {
        const nextPrompt =
          prompt.trim().length === 0
            ? ULTRATHINK_PROMPT_PREFIX
            : applyClaudePromptEffortPrefix(prompt, "ultrathink");
        onPromptChange(nextPrompt);
        return;
      }
      if (selected.ultrathinkInBodyText) return;
      if (selected.ultrathinkPromptControlled) {
        const stripped = prompt.replace(/^Ultrathink:\s*/i, "");
        onPromptChange(stripped);
      }
      const effortKey = baseProviderKind(provider) === "codex" ? "reasoningEffort" : "effort";
      updateModelOptions(
        buildNextOptions(provider, modelOptions, { [effortKey]: nextOption.value }),
      );
    },
    [modelOptions, onPromptChange, prompt, provider, selected, updateModelOptions],
  );

  const handleThinkingChange = useCallback(
    (value: string) => {
      updateModelOptions(buildNextOptions(provider, modelOptions, { thinking: value === "on" }));
    },
    [modelOptions, provider, updateModelOptions],
  );

  const handleFastModeChange = useCallback(
    (value: string) => {
      updateModelOptions(buildNextOptions(provider, modelOptions, { fastMode: value === "on" }));
    },
    [modelOptions, provider, updateModelOptions],
  );

  const handleContextWindowChange = useCallback(
    (value: string) => {
      updateModelOptions(
        buildNextOptions(provider, modelOptions, {
          contextWindow: value,
        }),
      );
    },
    [modelOptions, provider, updateModelOptions],
  );

  return {
    handleEffortChange,
    handleThinkingChange,
    handleFastModeChange,
    handleContextWindowChange,
  };
}

export function useTraitsOverlayMenu({
  provider,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence): TraitsOverlayMenu {
  const selected = getSelectedTraits(
    provider,
    models,
    model,
    prompt,
    modelOptions,
    allowPromptInjectedEffort,
  );
  const {
    caps,
    effort,
    effortLevels,
    thinkingEnabled,
    fastModeEnabled,
    contextWindowOptions,
    contextWindow,
    defaultContextWindow,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
  } = selected;
  const {
    handleEffortChange,
    handleThinkingChange,
    handleFastModeChange,
    handleContextWindowChange,
  } = useTraitsActions({
    provider,
    prompt,
    onPromptChange,
    modelOptions,
    selected,
    persistence,
  });

  return useMemo(() => {
    const items: OverlayMenuItem[] = [];
    const selectionById = new Map<string, () => void>();
    let separatorIndex = 0;

    const addLabel = (id: string, label: string) => {
      items.push({ id, label, labelOnly: true });
    };
    const addSeparator = () => {
      items.push({ id: `separator:${separatorIndex++}`, label: "", separator: true });
    };
    const addAction = (item: OverlayMenuItem, action: () => void) => {
      items.push(item);
      if (!item.selectDisabled && !item.disabled) {
        selectionById.set(item.id, action);
      }
    };

    if (effort) {
      addLabel("label:effort", "Effort");
      if (ultrathinkInBodyText) {
        items.push({
          id: "effort:prompt-controlled-help",
          label: 'Your prompt contains "ultrathink" in the text. Remove it to change effort.',
          description: undefined,
          selectDisabled: true,
        });
      }
      const checkedEffort = ultrathinkPromptControlled ? "ultrathink" : effort;
      for (const option of effortLevels) {
        addAction(
          {
            id: `effort:${option.value}`,
            label: `${option.label}${option.value === getDefaultEffort(caps) ? " (default)" : ""}`,
            checked: option.value === checkedEffort,
            selectDisabled: ultrathinkInBodyText,
          },
          () => handleEffortChange(option.value),
        );
      }
    } else if (thinkingEnabled !== null) {
      addLabel("label:thinking", "Thinking");
      addAction({ id: "thinking:on", label: "On (default)", checked: thinkingEnabled }, () =>
        handleThinkingChange("on"),
      );
      addAction({ id: "thinking:off", label: "Off", checked: !thinkingEnabled }, () =>
        handleThinkingChange("off"),
      );
    }

    if (caps.supportsFastMode) {
      if (items.length > 0) addSeparator();
      addLabel("label:fast-mode", "Fast Mode");
      addAction({ id: "fast-mode:off", label: "off", checked: !fastModeEnabled }, () =>
        handleFastModeChange("off"),
      );
      addAction({ id: "fast-mode:on", label: "on", checked: fastModeEnabled }, () =>
        handleFastModeChange("on"),
      );
    }

    if (contextWindowOptions.length > 1) {
      if (items.length > 0) addSeparator();
      addLabel("label:context-window", "Context Window");
      const checkedContextWindow = contextWindow ?? defaultContextWindow ?? "";
      for (const option of contextWindowOptions) {
        addAction(
          {
            id: `context-window:${option.value}`,
            label: `${option.label}${option.value === defaultContextWindow ? " (default)" : ""}`,
            checked: option.value === checkedContextWindow,
          },
          () => handleContextWindowChange(option.value),
        );
      }
    }

    return {
      overlayItems: items.length > 0 ? items : undefined,
      overlaySelectionById: selectionById,
    };
  }, [
    caps,
    contextWindow,
    contextWindowOptions,
    defaultContextWindow,
    effort,
    effortLevels,
    fastModeEnabled,
    handleContextWindowChange,
    handleEffortChange,
    handleFastModeChange,
    handleThinkingChange,
    thinkingEnabled,
    ultrathinkInBodyText,
    ultrathinkPromptControlled,
  ]);
}

export const TraitsMenuContent = memo(function TraitsMenuContentImpl({
  provider,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence) {
  const selected = getSelectedTraits(
    provider,
    models,
    model,
    prompt,
    modelOptions,
    allowPromptInjectedEffort,
  );
  const {
    caps,
    effort,
    effortLevels,
    thinkingEnabled,
    fastModeEnabled,
    contextWindowOptions,
    contextWindow,
    defaultContextWindow,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
  } = selected;
  const defaultEffort = getDefaultEffort(caps);
  const {
    handleEffortChange,
    handleThinkingChange,
    handleFastModeChange,
    handleContextWindowChange,
  } = useTraitsActions({
    provider,
    prompt,
    onPromptChange,
    modelOptions,
    selected,
    persistence,
  });

  if (effort === null && thinkingEnabled === null && contextWindowOptions.length <= 1) {
    return null;
  }

  return (
    <>
      {effort ? (
        <>
          <MenuGroup>
            <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">Effort</div>
            {ultrathinkInBodyText ? (
              <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
                Your prompt contains &quot;ultrathink&quot; in the text. Remove it to change effort.
              </div>
            ) : null}
            <MenuRadioGroup
              value={ultrathinkPromptControlled ? "ultrathink" : effort}
              onValueChange={handleEffortChange}
            >
              {effortLevels.map((option) => (
                <MenuRadioItem
                  key={option.value}
                  value={option.value}
                  disabled={ultrathinkInBodyText}
                >
                  {option.label}
                  {option.value === defaultEffort ? " (default)" : ""}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        </>
      ) : thinkingEnabled !== null ? (
        <MenuGroup>
          <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Thinking</div>
          <MenuRadioGroup
            value={thinkingEnabled ? "on" : "off"}
            onValueChange={handleThinkingChange}
          >
            <MenuRadioItem value="on">On (default)</MenuRadioItem>
            <MenuRadioItem value="off">Off</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
      ) : null}
      {caps.supportsFastMode ? (
        <>
          <MenuDivider />
          <MenuGroup>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Fast Mode</div>
            <MenuRadioGroup
              value={fastModeEnabled ? "on" : "off"}
              onValueChange={handleFastModeChange}
            >
              <MenuRadioItem value="off">off</MenuRadioItem>
              <MenuRadioItem value="on">on</MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>
        </>
      ) : null}
      {contextWindowOptions.length > 1 ? (
        <>
          <MenuDivider />
          <MenuGroup>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
              Context Window
            </div>
            <MenuRadioGroup
              value={contextWindow ?? defaultContextWindow ?? ""}
              onValueChange={handleContextWindowChange}
            >
              {contextWindowOptions.map((option) => (
                <MenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                  {option.value === defaultContextWindow ? " (default)" : ""}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        </>
      ) : null}
    </>
  );
});

export const TraitsPicker = memo(function TraitsPicker({
  provider,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  triggerVariant,
  triggerClassName,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const selected = getSelectedTraits(
    provider,
    models,
    model,
    prompt,
    modelOptions,
    allowPromptInjectedEffort,
  );
  const {
    caps,
    effort,
    effortLevels,
    thinkingEnabled,
    fastModeEnabled,
    contextWindowOptions,
    contextWindow,
    defaultContextWindow,
    ultrathinkPromptControlled,
  } = selected;
  const { overlayItems, overlaySelectionById } = useTraitsOverlayMenu({
    provider,
    models,
    model,
    prompt,
    onPromptChange,
    modelOptions,
    allowPromptInjectedEffort,
    ...persistence,
  });

  const effortLabel = effort
    ? (effortLevels.find((l) => l.value === effort)?.label ?? effort)
    : null;
  const contextWindowLabel =
    contextWindowOptions.length > 1 && contextWindow !== defaultContextWindow
      ? (contextWindowOptions.find((o) => o.value === contextWindow)?.label ?? null)
      : null;
  const triggerLabel = [
    ultrathinkPromptControlled
      ? "Ultrathink"
      : effortLabel
        ? effortLabel
        : thinkingEnabled === null
          ? null
          : `Thinking ${thinkingEnabled ? "On" : "Off"}`,
    ...(caps.supportsFastMode && fastModeEnabled ? ["Fast"] : []),
    ...(contextWindowLabel ? [contextWindowLabel] : []),
  ]
    .filter(Boolean)
    .join(" · ");

  if (!triggerLabel) {
    return null;
  }

  const isCodexStyle = baseProviderKind(provider) === "codex";

  return (
    <Menu
      overlayMenuAlign="start"
      overlayOnSelect={(id) => {
        overlaySelectionById.get(id)?.();
      }}
      open={isMenuOpen}
      onOpenChange={(open) => {
        setIsMenuOpen(open);
      }}
      {...(overlayItems !== undefined ? { overlayItems } : {})}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant={triggerVariant ?? "ghost"}
            className={cn(
              isCodexStyle
                ? "min-w-0 max-w-40 shrink justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:max-w-48 sm:px-3 [&_svg]:mx-0"
                : "shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3",
              triggerClassName,
            )}
          />
        }
      >
        {isCodexStyle ? (
          <span className="flex min-w-0 w-full items-center gap-2 overflow-hidden">
            {triggerLabel}
            <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
          </span>
        ) : (
          <>
            <span>{triggerLabel}</span>
            <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
          </>
        )}
      </MenuTrigger>
      <MenuPopup align="start">
        <TraitsMenuContent
          provider={provider}
          models={models}
          model={model}
          prompt={prompt}
          onPromptChange={onPromptChange}
          modelOptions={modelOptions}
          allowPromptInjectedEffort={allowPromptInjectedEffort}
          {...persistence}
        />
      </MenuPopup>
    </Menu>
  );
});
