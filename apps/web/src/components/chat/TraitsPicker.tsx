import {
  baseProviderKind,
  type BaseProviderKind,
  type ClaudeModelOptions,
  type CodexModelOptions,
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
import { memo, useCallback } from "react";
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
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteMenu, OverlayRouteMenuPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";

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

const ULTRATHINK_PROMPT_PREFIX = "Ultrathink:\n";
const TRAITS_PICKER_OVERLAY_ROUTE_KEY = "traits-picker-menu";

export type TraitsPickerResult =
  | { kind: "context-window"; value: string }
  | { kind: "effort"; value: string }
  | { kind: "fast-mode"; value: string }
  | { kind: "thinking"; value: string };

type TraitsActionHandlers = ReturnType<typeof useTraitsActions>;

export interface TraitsPickerRouteParams extends Record<string, unknown> {
  allowPromptInjectedEffort: boolean;
  model: string | null | undefined;
  modelOptions?: ProviderOptions | null | undefined;
  models: ReadonlyArray<ServerProviderModel>;
  prompt: string;
  provider: ProviderKind;
}

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
  const actions = useTraitsActions({
    provider,
    prompt,
    onPromptChange,
    modelOptions,
    selected,
    persistence,
  });

  return <TraitsMenuBody actions={actions} selected={selected} />;
});

export function buildTraitsPickerRouteParams({
  allowPromptInjectedEffort = true,
  model,
  modelOptions,
  models,
  prompt,
  provider,
}: TraitsMenuContentProps): TraitsPickerRouteParams {
  return {
    allowPromptInjectedEffort,
    model,
    modelOptions,
    models,
    prompt,
    provider,
  };
}

export function useTraitsPickerRouteResultHandler({
  provider,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence): (value: unknown) => void {
  const selected = getSelectedTraits(
    provider,
    models,
    model,
    prompt,
    modelOptions,
    allowPromptInjectedEffort,
  );
  const actions = useTraitsActions({
    provider,
    prompt,
    onPromptChange,
    modelOptions,
    selected,
    persistence,
  });
  return useCallback(
    (value: unknown) => {
      if (!isTraitsPickerResult(value, selected)) return;
      applyTraitsPickerResult(value, actions);
    },
    [actions, selected],
  );
}

export function TraitsMenuRouteContent({
  onResult,
  params,
}: {
  onResult: (result: TraitsPickerResult) => void;
  params: TraitsPickerRouteParams;
}) {
  const selected = getSelectedTraits(
    params.provider,
    params.models,
    params.model,
    params.prompt,
    params.modelOptions,
    params.allowPromptInjectedEffort,
  );
  const actions: TraitsActionHandlers = {
    handleContextWindowChange: (value) => onResult({ kind: "context-window", value }),
    handleEffortChange: (value) => onResult({ kind: "effort", value }),
    handleFastModeChange: (value) => onResult({ kind: "fast-mode", value }),
    handleThinkingChange: (value) => onResult({ kind: "thinking", value }),
  };
  return <TraitsMenuBody actions={actions} selected={selected} />;
}

function TraitsMenuBody({
  actions,
  selected,
}: {
  actions: TraitsActionHandlers;
  selected: ReturnType<typeof getSelectedTraits>;
}) {
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
              onValueChange={actions.handleEffortChange}
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
            onValueChange={actions.handleThinkingChange}
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
              onValueChange={actions.handleFastModeChange}
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
              onValueChange={actions.handleContextWindowChange}
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
}

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
  const actions = useTraitsActions({
    provider,
    prompt,
    onPromptChange,
    modelOptions,
    selected,
    persistence,
  });
  const handleRouteResult = useTraitsPickerRouteResultHandler({
    provider,
    models,
    model,
    prompt,
    onPromptChange,
    modelOptions,
    allowPromptInjectedEffort,
    ...persistence,
  });
  const route = useRoutedPopoverSurface<HTMLButtonElement, TraitsPickerResult>({
    routeKey: TRAITS_PICKER_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "start",
    params: buildTraitsPickerRouteParams({
      provider,
      models,
      model,
      prompt,
      onPromptChange,
      modelOptions,
      allowPromptInjectedEffort,
    }),
    onResult: handleRouteResult,
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
    <Menu open={route.domOpen} onOpenChange={route.onOpenChange}>
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
        onFocusCapture={route.updateAnchor}
        onMouseOverCapture={route.updateAnchor}
        ref={route.triggerRef}
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
        <TraitsMenuBody actions={actions} selected={selected} />
      </MenuPopup>
    </Menu>
  );
});

function applyTraitsPickerResult(result: TraitsPickerResult, actions: TraitsActionHandlers): void {
  switch (result.kind) {
    case "context-window":
      actions.handleContextWindowChange(result.value);
      return;
    case "effort":
      actions.handleEffortChange(result.value);
      return;
    case "fast-mode":
      actions.handleFastModeChange(result.value);
      return;
    case "thinking":
      actions.handleThinkingChange(result.value);
  }
}

function isTraitsPickerResult(
  value: unknown,
  selected: ReturnType<typeof getSelectedTraits>,
): value is TraitsPickerResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TraitsPickerResult>;
  if (typeof candidate.value !== "string") return false;
  switch (candidate.kind) {
    case "context-window":
      return selected.contextWindowOptions.some((option) => option.value === candidate.value);
    case "effort":
      return (
        !selected.ultrathinkInBodyText &&
        selected.effortLevels.some((option) => option.value === candidate.value)
      );
    case "fast-mode":
      return (
        selected.caps.supportsFastMode && (candidate.value === "on" || candidate.value === "off")
      );
    case "thinking":
      return (
        selected.thinkingEnabled !== null && (candidate.value === "on" || candidate.value === "off")
      );
    default:
      return false;
  }
}

function readProviderKindParam(value: unknown): ProviderKind {
  return typeof value === "string" ? (value as ProviderKind) : ("codex" as ProviderKind);
}

function readStringParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readBooleanParam(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readModelOptionsParam(value: unknown): ProviderOptions | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ProviderOptions)
    : undefined;
}

function readServerProviderModelsParam(value: unknown): ServerProviderModel[] {
  if (!Array.isArray(value)) return [];
  const models: ServerProviderModel[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<ServerProviderModel>;
    if (typeof candidate.slug !== "string" || typeof candidate.name !== "string") continue;
    models.push({
      slug: candidate.slug,
      name: candidate.name,
      isCustom: candidate.isCustom === true,
      capabilities:
        candidate.capabilities === null || typeof candidate.capabilities === "object"
          ? candidate.capabilities
          : null,
    });
  }
  return models;
}

registerOverlayRoute<{
  allowPromptInjectedEffort?: unknown;
  model?: unknown;
  modelOptions?: unknown;
  models?: unknown;
  prompt?: unknown;
  provider?: unknown;
}>(TRAITS_PICKER_OVERLAY_ROUTE_KEY, function TraitsPickerOverlayRoute({ controller, message }) {
  const provider = readProviderKindParam(message.params.provider);
  const models = readServerProviderModelsParam(message.params.models);
  const model = readStringParam(message.params.model);
  const prompt = readStringParam(message.params.prompt);
  const modelOptions = readModelOptionsParam(message.params.modelOptions);
  const allowPromptInjectedEffort = readBooleanParam(
    message.params.allowPromptInjectedEffort,
    true,
  );

  return (
    <OverlayRouteMenu>
      <OverlayRouteMenuPopup align="start">
        <TraitsMenuRouteContent
          params={{
            allowPromptInjectedEffort,
            model,
            modelOptions,
            models,
            prompt,
            provider,
          }}
          onResult={(result) => controller.submit(result)}
        />
      </OverlayRouteMenuPopup>
    </OverlayRouteMenu>
  );
});
