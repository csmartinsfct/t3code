import {
  baseProviderKind,
  type BaseProviderKind,
  providerProfileId,
  type ProviderKind,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  getKnownProviderModelOptions,
  resolveKnownProviderModelName,
  resolveSelectableModel,
} from "@t3tools/shared/model";
import { memo, useCallback, useMemo } from "react";
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
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteMenu, OverlayRouteMenuPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";
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
  providerFilter: (provider: ProviderKind) => boolean = () => true,
): Array<ProviderOption & { available: true; value: ProviderKind }> {
  const options = serverProviders?.length
    ? buildProviderOptions(serverProviders)
    : PROVIDER_OPTIONS;
  return options.filter(isAvailableProviderOption).filter((option) => providerFilter(option.value));
}

/** @deprecated Use getAvailableProviderOptions with server providers instead */
export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(isAvailableProviderOption);
const COMING_SOON_PROVIDER_OPTIONS = [
  { id: "opencode", label: "OpenCode", icon: OpenCodeIcon },
] as const;

function getUnavailableProviderOptions(
  serverProviders?: ReadonlyArray<ServerProvider>,
  providerFilter: (provider: ProviderKind) => boolean = () => true,
): Array<ProviderOption> {
  const options = serverProviders?.length
    ? buildProviderOptions(serverProviders)
    : PROVIDER_OPTIONS;
  return options
    .filter((option) => !option.available)
    .filter((option) => providerFilter(option.value as ProviderKind));
}

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
const PROVIDER_MODEL_PICKER_OVERLAY_ROUTE_KEY = "provider-model-picker-menu";

type ProviderModelPickerResult = {
  model: string;
  provider: ProviderKind;
};

type ProviderModelMenuModel = {
  name: string;
  slug: string;
};

type ProviderModelMenuProvider = {
  label: string;
  message?: string | null | undefined;
  models: ProviderModelMenuModel[];
  provider: ProviderKind;
  selectable: boolean;
  unavailableLabel?: string | undefined;
};

type ProviderModelMenuUnavailableProvider = {
  label: string;
  provider: ProviderPickerKind;
};

type ProviderModelMenuData =
  | {
      kind: "locked";
      provider: ProviderModelMenuProvider;
    }
  | {
      availableProviders: ProviderModelMenuProvider[];
      kind: "unlocked";
      unavailableProviders: ProviderModelMenuUnavailableProvider[];
    };

function allowAllProviders(_provider: ProviderKind): boolean {
  return true;
}

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
  providerFilter?: (provider: ProviderKind) => boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  onProviderModelChange: (provider: ProviderKind, model: string) => void;
}) {
  const activeProvider = props.lockedProvider ?? props.provider;
  const providerFilter = props.providerFilter ?? allowAllProviders;
  const unavailableProviderOptions = useMemo(
    () => getUnavailableProviderOptions(props.providers, providerFilter),
    [props.providers, providerFilter],
  );
  const getPickerModelOptions = useCallback(
    (provider: ProviderKind) => {
      const liveModels = props.providers ? getProviderModels(props.providers, provider) : [];
      if (liveModels.length > 0) {
        return liveModels;
      }

      const configuredModels = props.modelOptionsByProvider[baseProviderKind(provider)];
      return configuredModels.length > 0
        ? configuredModels
        : getKnownProviderModelOptions(provider);
    },
    [props.modelOptionsByProvider, props.providers],
  );
  const selectedProviderOptions = getPickerModelOptions(activeProvider);
  const selectedModelLabel =
    selectedProviderOptions.find((option) => option.slug === props.model)?.name ??
    resolveKnownProviderModelName(activeProvider, props.model) ??
    props.model;
  const ProviderIcon = getProviderIcon(activeProvider);
  const menuData = useMemo<ProviderModelMenuData>(() => {
    if (props.lockedProvider !== null) {
      const lockedProviderSnapshot = props.providers
        ? getProviderSnapshot(props.providers, props.lockedProvider)
        : undefined;
      const lockedProviderSelectable = isProviderSelectable(lockedProviderSnapshot);
      return {
        kind: "locked",
        provider: {
          label: props.lockedProvider,
          provider: props.lockedProvider,
          selectable: lockedProviderSelectable,
          unavailableLabel:
            lockedProviderSnapshot && !lockedProviderSelectable
              ? getUnavailableProviderLabel(lockedProviderSnapshot)
              : undefined,
          message: lockedProviderSnapshot?.message,
          models: getPickerModelOptions(props.lockedProvider).map(toProviderModelMenuModel),
        },
      };
    }

    return {
      kind: "unlocked",
      availableProviders: getAvailableProviderOptions(props.providers, providerFilter).map(
        (option) => {
          const liveProvider = props.providers
            ? getProviderSnapshot(props.providers, option.value)
            : undefined;
          const providerSelectable = isProviderSelectable(liveProvider);
          return {
            label: option.label,
            provider: option.value,
            selectable: providerSelectable,
            unavailableLabel:
              liveProvider && !providerSelectable
                ? getUnavailableProviderLabel(liveProvider)
                : undefined,
            message: liveProvider?.message,
            models: getPickerModelOptions(option.value).map(toProviderModelMenuModel),
          };
        },
      ),
      unavailableProviders: unavailableProviderOptions.map((option) => ({
        label: option.label,
        provider: option.value as ProviderPickerKind,
      })),
    };
  }, [
    getPickerModelOptions,
    props.lockedProvider,
    props.providers,
    providerFilter,
    unavailableProviderOptions,
  ]);
  const selectModel = useCallback(
    (provider: ProviderKind, value: string) => {
      if (props.disabled) return;
      if (!value) return;
      const liveProvider = props.providers
        ? getProviderSnapshot(props.providers, provider)
        : undefined;
      if (!isProviderSelectable(liveProvider)) return;
      const resolvedModel = resolveSelectableModel(
        provider,
        value,
        getPickerModelOptions(provider),
      );
      if (!resolvedModel) return;
      props.onProviderModelChange(provider, resolvedModel);
    },
    [getPickerModelOptions, props],
  );
  const handleRouteResult = useCallback(
    (value: ProviderModelPickerResult) => {
      if (!isProviderModelPickerResult(value, menuData)) return;
      selectModel(value.provider, value.model);
    },
    [menuData, selectModel],
  );
  const route = useRoutedPopoverSurface<HTMLButtonElement, ProviderModelPickerResult>({
    routeKey: PROVIDER_MODEL_PICKER_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "start",
    params: {
      menuData,
      model: props.model,
      provider: props.provider,
    },
    onResult: handleRouteResult,
  });
  const handleModelChange = useCallback(
    (provider: ProviderKind, value: string) => {
      selectModel(provider, value);
      route.onOpenChange(false);
    },
    [route, selectModel],
  );
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (props.disabled) {
        route.onOpenChange(false);
        return;
      }
      route.onOpenChange(open);
    },
    [props.disabled, route],
  );

  return (
    <Menu open={route.domOpen} onOpenChange={handleOpenChange}>
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
        onFocusCapture={route.updateAnchor}
        onMouseOverCapture={route.updateAnchor}
        ref={route.triggerRef}
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
        <ProviderModelMenuContent
          menuData={menuData}
          model={props.model}
          provider={props.provider}
          onModelChange={handleModelChange}
        />
      </MenuPopup>
    </Menu>
  );
});

function ProviderModelMenuContent({
  menuData,
  model,
  onModelChange,
  provider,
}: {
  menuData: ProviderModelMenuData;
  model: string;
  onModelChange: (provider: ProviderKind, model: string) => void;
  provider: ProviderKind;
}) {
  if (menuData.kind === "locked") {
    const lockedProvider = menuData.provider;
    return (
      <MenuGroup>
        {!lockedProvider.selectable ? (
          <>
            <MenuItem className={COMPACT_UNAVAILABLE_HEADER_CLASS} disabled>
              <span className="font-medium text-[13px]">{lockedProvider.unavailableLabel}</span>
              {lockedProvider.message ? (
                <span className="max-w-72 text-muted-foreground/80 text-xs leading-snug">
                  {lockedProvider.message}
                </span>
              ) : null}
            </MenuItem>
            <MenuDivider />
            <MenuRadioGroup value="">
              {lockedProvider.models.map((modelOption) => (
                <MenuRadioItem
                  key={`${lockedProvider.provider}:${modelOption.slug}`}
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
            value={model}
            onValueChange={(value) => onModelChange(lockedProvider.provider, value)}
          >
            {lockedProvider.models.map((modelOption) => (
              <MenuRadioItem
                key={`${lockedProvider.provider}:${modelOption.slug}`}
                value={modelOption.slug}
                className={COMPACT_MODEL_ITEM_CLASS}
              >
                {modelOption.name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        )}
      </MenuGroup>
    );
  }

  return (
    <>
      {menuData.availableProviders.map((option) => {
        const OptionIcon = getProviderIcon(option.provider);
        return (
          <MenuSub key={option.provider}>
            <MenuSubTrigger
              className={cn(
                !option.selectable &&
                  "text-muted-foreground/70 data-highlighted:text-accent-foreground data-popup-open:text-accent-foreground",
              )}
            >
              <OptionIcon
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0",
                  option.selectable
                    ? providerIconClassName(option.provider, "text-muted-foreground/85")
                    : "text-muted-foreground/55 opacity-70",
                )}
              />
              {option.label}
            </MenuSubTrigger>
            <MenuSubPopup className="[--available-height:min(24rem,70vh)]" sideOffset={4}>
              <MenuGroup>
                {!option.selectable ? (
                  <>
                    <MenuItem className={COMPACT_UNAVAILABLE_HEADER_CLASS} disabled>
                      <span className="font-medium text-[13px]">{option.unavailableLabel}</span>
                      {option.message ? (
                        <span className="max-w-72 text-muted-foreground/80 text-xs leading-snug">
                          {option.message}
                        </span>
                      ) : null}
                    </MenuItem>
                    <MenuDivider />
                    <MenuRadioGroup value="">
                      {option.models.map((modelOption) => (
                        <MenuRadioItem
                          key={`${option.provider}:${modelOption.slug}`}
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
                    value={provider === option.provider ? model : ""}
                    onValueChange={(value) => onModelChange(option.provider, value)}
                  >
                    {option.models.map((modelOption) => (
                      <MenuRadioItem
                        key={`${option.provider}:${modelOption.slug}`}
                        value={modelOption.slug}
                        className={COMPACT_MODEL_ITEM_CLASS}
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
      {menuData.unavailableProviders.length > 0 && <MenuDivider />}
      {menuData.unavailableProviders.map((option) => {
        const OptionIcon = getProviderIcon(option.provider);
        return (
          <MenuItem key={option.provider} disabled>
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
      {menuData.unavailableProviders.length === 0 && <MenuDivider />}
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
  );
}

function toProviderModelMenuModel(model: { name: string; slug: string }): ProviderModelMenuModel {
  return {
    name: model.name,
    slug: model.slug,
  };
}

function isProviderModelPickerResult(
  value: unknown,
  menuData: ProviderModelMenuData,
): value is ProviderModelPickerResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProviderModelPickerResult>;
  if (typeof candidate.provider !== "string" || typeof candidate.model !== "string") return false;
  if (menuData.kind === "locked") {
    const option = menuData.provider;
    return (
      option.selectable &&
      option.provider === candidate.provider &&
      option.models.some((model) => model.slug === candidate.model)
    );
  }
  const option = menuData.availableProviders.find(
    (providerOption) => providerOption.provider === candidate.provider,
  );
  return Boolean(
    option?.selectable && option.models.some((model) => model.slug === candidate.model),
  );
}

function readStringParam(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readProviderKindParam(value: unknown): ProviderKind | null {
  return typeof value === "string" ? (value as ProviderKind) : null;
}

function readProviderPickerKindParam(value: unknown): ProviderPickerKind | null {
  return typeof value === "string" ? (value as ProviderPickerKind) : null;
}

function readProviderModelMenuModelsParam(value: unknown): ProviderModelMenuModel[] {
  if (!Array.isArray(value)) return [];
  const models: ProviderModelMenuModel[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<ProviderModelMenuModel>;
    if (typeof candidate.name !== "string" || typeof candidate.slug !== "string") continue;
    models.push({ name: candidate.name, slug: candidate.slug });
  }
  return models;
}

function readProviderModelMenuProviderParam(value: unknown): ProviderModelMenuProvider | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ProviderModelMenuProvider>;
  const provider = readProviderKindParam(candidate.provider);
  if (!provider || typeof candidate.label !== "string") return null;
  return {
    label: candidate.label,
    provider,
    selectable: candidate.selectable === true,
    ...(typeof candidate.unavailableLabel === "string"
      ? { unavailableLabel: candidate.unavailableLabel }
      : {}),
    ...(typeof candidate.message === "string" ? { message: candidate.message } : {}),
    models: readProviderModelMenuModelsParam(candidate.models),
  };
}

function readUnavailableProviderParam(value: unknown): ProviderModelMenuUnavailableProvider | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ProviderModelMenuUnavailableProvider>;
  const provider = readProviderPickerKindParam(candidate.provider);
  if (!provider || typeof candidate.label !== "string") return null;
  return {
    label: candidate.label,
    provider,
  };
}

function readProviderModelMenuDataParam(value: unknown): ProviderModelMenuData {
  if (!value || typeof value !== "object") {
    return { kind: "unlocked", availableProviders: [], unavailableProviders: [] };
  }
  const candidate = value as Partial<ProviderModelMenuData>;
  if (candidate.kind === "locked") {
    const provider = readProviderModelMenuProviderParam(
      (candidate as { provider?: unknown }).provider,
    );
    if (provider) return { kind: "locked", provider };
  }
  const unlocked = candidate as {
    availableProviders?: unknown;
    unavailableProviders?: unknown;
  };
  return {
    kind: "unlocked",
    availableProviders: Array.isArray(unlocked.availableProviders)
      ? unlocked.availableProviders
          .map(readProviderModelMenuProviderParam)
          .filter((provider): provider is ProviderModelMenuProvider => provider !== null)
      : [],
    unavailableProviders: Array.isArray(unlocked.unavailableProviders)
      ? unlocked.unavailableProviders
          .map(readUnavailableProviderParam)
          .filter((provider): provider is ProviderModelMenuUnavailableProvider => provider !== null)
      : [],
  };
}

function firstProviderFromMenuData(menuData: ProviderModelMenuData): ProviderKind | null {
  return menuData.kind === "locked"
    ? menuData.provider.provider
    : (menuData.availableProviders[0]?.provider ?? null);
}

registerOverlayRoute<{
  menuData?: unknown;
  model?: unknown;
  provider?: unknown;
}>(
  PROVIDER_MODEL_PICKER_OVERLAY_ROUTE_KEY,
  function ProviderModelPickerOverlayRoute({ controller, message }) {
    const menuData = readProviderModelMenuDataParam(message.params.menuData);
    const provider =
      readProviderKindParam(message.params.provider) ??
      firstProviderFromMenuData(menuData) ??
      ("codex" as ProviderKind);
    const model = readStringParam(message.params.model) ?? "";

    return (
      <OverlayRouteMenu>
        <OverlayRouteMenuPopup align="start">
          <ProviderModelMenuContent
            menuData={menuData}
            model={model}
            provider={provider}
            onModelChange={(nextProvider, nextModel) =>
              controller.submit({ provider: nextProvider, model: nextModel })
            }
          />
        </OverlayRouteMenuPopup>
      </OverlayRouteMenu>
    );
  },
);
