import {
  baseProviderKind,
  type BaseProviderKind,
  providerProfileId,
  type ProviderKind,
  type ServerProvider,
} from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
import { memo, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import {
  type ProviderPickerKind,
  type ProviderOption,
  PROVIDER_OPTIONS,
  buildProviderOptions,
} from "../../session-logic";
import { ChevronDownIcon } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { ClaudeAI, CursorIcon, Gemini, Icon, OpenAI, OpenCodeIcon } from "../Icons";
import { cn } from "~/lib/utils";
import { getProviderModels, getProviderSnapshot } from "../../providerModels";

function isAvailableProviderOption(option: ProviderOption): option is {
  value: ProviderKind;
  label: string;
  available: true;
} {
  return option.available;
}

const PROVIDER_ICON_BY_BASE: Record<BaseProviderKind | "cursor", Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  gemini: Gemini,
  cursor: CursorIcon,
};

function getProviderIcon(kind: ProviderPickerKind): Icon {
  const base = baseProviderKind(kind as ProviderKind);
  return PROVIDER_ICON_BY_BASE[base as BaseProviderKind | "cursor"] ?? ClaudeAI;
}

export function getAvailableProviderOptions(
  serverProviders?: ReadonlyArray<ServerProvider>,
): Array<ProviderOption & { available: true; value: ProviderKind }> {
  const options = serverProviders?.length
    ? buildProviderOptions(serverProviders)
    : PROVIDER_OPTIONS;
  return options.filter(isAvailableProviderOption);
}

/** @deprecated Use getAvailableProviderOptions with server providers instead */
export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(isAvailableProviderOption);
const UNAVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter((option) => !option.available);
const COMING_SOON_PROVIDER_OPTIONS = [
  { id: "opencode", label: "OpenCode", icon: OpenCodeIcon },
] as const;

function providerIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string,
): string {
  return provider === "claudeAgent" || provider.startsWith("claudeAgent:")
    ? "text-[#d97757]"
    : fallbackClassName;
}

const COMPACT_MODEL_ITEM_CLASS =
  "min-h-0 grid-cols-[0_1fr] gap-0 px-2.5 py-1 text-[13px] [&_svg]:hidden sm:min-h-0 sm:text-[13px]";
const COMPACT_UNAVAILABLE_HEADER_CLASS = "h-auto min-h-0 flex-col items-start gap-0.5 px-2 py-1.5";

function getUnavailableProviderLabel(provider: ServerProvider): string {
  if (!provider.enabled) return "Disabled";
  if (!provider.installed) return "Not installed";

  const message = provider.message?.toLowerCase() ?? "";
  if (provider.auth.status === "unauthenticated" && message.includes("not configured")) {
    return "Not configured";
  }

  if (provider.auth.status === "unauthenticated") return "Not authenticated";
  if (provider.status === "warning") return "Needs attention";
  return "Unavailable";
}

function isProviderSelectable(provider: ServerProvider | undefined): boolean {
  return !provider || provider.status === "ready";
}

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  provider: ProviderKind;
  model: string;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: Record<BaseProviderKind, ReadonlyArray<{ slug: string; name: string }>>;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  onProviderModelChange: (provider: ProviderKind, model: string) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const activeProvider = props.lockedProvider ?? props.provider;
  const getPickerModelOptions = (provider: ProviderKind) => {
    const liveModels = props.providers ? getProviderModels(props.providers, provider) : [];
    return liveModels.length > 0
      ? liveModels
      : props.modelOptionsByProvider[baseProviderKind(provider)];
  };
  const selectedProviderOptions = getPickerModelOptions(activeProvider);
  const selectedModelLabel =
    selectedProviderOptions.find((option) => option.slug === props.model)?.name ?? props.model;
  const ProviderIcon = getProviderIcon(activeProvider);
  const handleModelChange = (provider: ProviderKind, value: string) => {
    if (props.disabled) return;
    if (!value) return;
    const liveProvider = props.providers
      ? getProviderSnapshot(props.providers, provider)
      : undefined;
    if (!isProviderSelectable(liveProvider)) return;
    const resolvedModel = resolveSelectableModel(provider, value, getPickerModelOptions(provider));
    if (!resolvedModel) return;
    props.onProviderModelChange(provider, resolvedModel);
    setIsMenuOpen(false);
  };

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant={props.triggerVariant ?? "ghost"}
            data-chat-provider-model-picker="true"
            className={cn(
              "min-w-0 justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 [&_svg]:mx-0",
              props.compact ? "max-w-42 shrink-0" : "max-w-64 shrink sm:max-w-72 sm:px-3",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          className={cn(
            "flex min-w-0 w-full box-border items-center gap-2 overflow-hidden",
            props.compact ? "max-w-36 sm:pl-1" : undefined,
          )}
        >
          <ProviderIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              providerIconClassName(activeProvider, "text-muted-foreground/70"),
              props.activeProviderIconClassName,
            )}
          />
          <span className="min-w-0 flex-1 truncate">
            {providerProfileId(activeProvider)
              ? `${selectedModelLabel} · ${providerProfileId(activeProvider)}`
              : selectedModelLabel}
          </span>
          <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
        </span>
      </MenuTrigger>
      <MenuPopup align="start">
        {props.lockedProvider !== null ? (
          <MenuGroup>
            {(() => {
              const lockedProviderSnapshot = props.providers
                ? getProviderSnapshot(props.providers, props.lockedProvider)
                : undefined;
              const lockedProviderSelectable = isProviderSelectable(lockedProviderSnapshot);
              return lockedProviderSnapshot && !lockedProviderSelectable ? (
                <>
                  <MenuItem className={COMPACT_UNAVAILABLE_HEADER_CLASS} disabled>
                    <span className="font-medium text-[13px]">
                      {getUnavailableProviderLabel(lockedProviderSnapshot)}
                    </span>
                    {lockedProviderSnapshot.message ? (
                      <span className="max-w-72 text-muted-foreground/80 text-xs leading-snug">
                        {lockedProviderSnapshot.message}
                      </span>
                    ) : null}
                  </MenuItem>
                  <MenuDivider />
                  <MenuRadioGroup value="">
                    {getPickerModelOptions(props.lockedProvider).map((modelOption) => (
                      <MenuRadioItem
                        key={`${props.lockedProvider}:${modelOption.slug}`}
                        value={modelOption.slug}
                        className={COMPACT_MODEL_ITEM_CLASS}
                        disabled
                      >
                        {modelOption.name}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </>
              ) : (
                <MenuRadioGroup
                  value={props.model}
                  onValueChange={(value) => handleModelChange(props.lockedProvider!, value)}
                >
                  {getPickerModelOptions(props.lockedProvider).map((modelOption) => (
                    <MenuRadioItem
                      key={`${props.lockedProvider}:${modelOption.slug}`}
                      value={modelOption.slug}
                      className={COMPACT_MODEL_ITEM_CLASS}
                      onClick={() => setIsMenuOpen(false)}
                    >
                      {modelOption.name}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              );
            })()}
          </MenuGroup>
        ) : (
          <>
            {getAvailableProviderOptions(props.providers).map((option) => {
              const OptionIcon = getProviderIcon(option.value);
              const liveProvider = props.providers
                ? getProviderSnapshot(props.providers, option.value)
                : undefined;
              const providerSelectable = isProviderSelectable(liveProvider);
              const providerModelOptions = getPickerModelOptions(option.value);
              return (
                <MenuSub key={option.value}>
                  <MenuSubTrigger
                    className={cn(
                      !providerSelectable &&
                        "text-muted-foreground/70 data-highlighted:text-accent-foreground data-popup-open:text-accent-foreground",
                    )}
                  >
                    <OptionIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0",
                        providerSelectable
                          ? providerIconClassName(option.value, "text-muted-foreground/85")
                          : "text-muted-foreground/55 opacity-70",
                      )}
                    />
                    {option.label}
                  </MenuSubTrigger>
                  <MenuSubPopup className="[--available-height:min(24rem,70vh)]" sideOffset={4}>
                    <MenuGroup>
                      {liveProvider && !providerSelectable ? (
                        <>
                          <MenuItem className={COMPACT_UNAVAILABLE_HEADER_CLASS} disabled>
                            <span className="font-medium text-[13px]">
                              {getUnavailableProviderLabel(liveProvider)}
                            </span>
                            {liveProvider.message ? (
                              <span className="max-w-72 text-muted-foreground/80 text-xs leading-snug">
                                {liveProvider.message}
                              </span>
                            ) : null}
                          </MenuItem>
                          <MenuDivider />
                          <MenuRadioGroup value="">
                            {providerModelOptions.map((modelOption) => (
                              <MenuRadioItem
                                key={`${option.value}:${modelOption.slug}`}
                                value={modelOption.slug}
                                className={COMPACT_MODEL_ITEM_CLASS}
                                disabled
                              >
                                {modelOption.name}
                              </MenuRadioItem>
                            ))}
                          </MenuRadioGroup>
                        </>
                      ) : (
                        <MenuRadioGroup
                          value={props.provider === option.value ? props.model : ""}
                          onValueChange={(value) => handleModelChange(option.value, value)}
                        >
                          {providerModelOptions.map((modelOption) => (
                            <MenuRadioItem
                              key={`${option.value}:${modelOption.slug}`}
                              value={modelOption.slug}
                              className={COMPACT_MODEL_ITEM_CLASS}
                              onClick={() => setIsMenuOpen(false)}
                            >
                              {modelOption.name}
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      )}
                    </MenuGroup>
                  </MenuSubPopup>
                </MenuSub>
              );
            })}
            {UNAVAILABLE_PROVIDER_OPTIONS.length > 0 && <MenuDivider />}
            {UNAVAILABLE_PROVIDER_OPTIONS.map((option) => {
              const OptionIcon = getProviderIcon(option.value);
              return (
                <MenuItem key={option.value} disabled>
                  <OptionIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground/85 opacity-80"
                  />
                  <span>{option.label}</span>
                  <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                    Coming soon
                  </span>
                </MenuItem>
              );
            })}
            {UNAVAILABLE_PROVIDER_OPTIONS.length === 0 && <MenuDivider />}
            {COMING_SOON_PROVIDER_OPTIONS.map((option) => {
              const OptionIcon = option.icon;
              return (
                <MenuItem key={option.id} disabled>
                  <OptionIcon aria-hidden="true" className="size-4 shrink-0 opacity-80" />
                  <span>{option.label}</span>
                  <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                    Coming soon
                  </span>
                </MenuItem>
              );
            })}
          </>
        )}
      </MenuPopup>
    </Menu>
  );
});
