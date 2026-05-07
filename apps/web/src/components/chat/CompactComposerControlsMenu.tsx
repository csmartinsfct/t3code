import { type ProviderInteractionMode, type RuntimeMode } from "@t3tools/contracts";
import { memo, type ReactNode, useCallback } from "react";
import { EllipsisIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteMenu, OverlayRouteMenuPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";
import {
  type TraitsPickerResult,
  type TraitsPickerRouteParams,
  TraitsMenuRouteContent,
} from "./TraitsPicker";

const COMPACT_COMPOSER_CONTROLS_OVERLAY_ROUTE_KEY = "compact-composer-controls-menu";

type CompactComposerControlsResult =
  | { kind: "interaction"; mode: ProviderInteractionMode }
  | { kind: "runtime"; mode: RuntimeMode }
  | { kind: "traits"; result: TraitsPickerResult };

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  supportsPlan: boolean;
  traitsMenuContent?: ReactNode;
  traitsRouteParams?: TraitsPickerRouteParams | undefined;
  onTraitsResult?: (result: TraitsPickerResult) => void;
  onInteractionModeChange: (mode: ProviderInteractionMode) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const handleResult = useCallback(
    (result: CompactComposerControlsResult) => {
      switch (result.kind) {
        case "interaction":
          if (result.mode !== props.interactionMode) props.onInteractionModeChange(result.mode);
          return;
        case "runtime":
          if (result.mode !== props.runtimeMode) props.onRuntimeModeChange(result.mode);
          return;
        case "traits":
          props.onTraitsResult?.(result.result);
      }
    },
    [props],
  );
  const route = useRoutedPopoverSurface<HTMLButtonElement, CompactComposerControlsResult>({
    routeKey: COMPACT_COMPOSER_CONTROLS_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "start",
    params: {
      hasTraitsContent: props.traitsMenuContent !== undefined && props.traitsMenuContent !== null,
      interactionMode: props.interactionMode,
      runtimeMode: props.runtimeMode,
      supportsPlan: props.supportsPlan,
      traitsRouteParams: props.traitsRouteParams,
    },
    onResult: handleResult,
  });

  return (
    <Menu open={route.domOpen} onOpenChange={route.onOpenChange}>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
            aria-label="More composer controls"
          />
        }
        onFocusCapture={route.updateAnchor}
        onMouseOverCapture={route.updateAnchor}
        ref={route.triggerRef}
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup align="start">
        <CompactComposerControlsMenuContent
          interactionMode={props.interactionMode}
          runtimeMode={props.runtimeMode}
          supportsPlan={props.supportsPlan}
          traitsMenuContent={props.traitsMenuContent}
          onInteractionModeChange={props.onInteractionModeChange}
          onRuntimeModeChange={props.onRuntimeModeChange}
        />
      </MenuPopup>
    </Menu>
  );
});

function CompactComposerControlsMenuContent({
  interactionMode,
  onInteractionModeChange,
  onRuntimeModeChange,
  runtimeMode,
  supportsPlan,
  traitsMenuContent,
}: {
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  supportsPlan: boolean;
  traitsMenuContent?: ReactNode;
  onInteractionModeChange: (mode: ProviderInteractionMode) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <>
      {traitsMenuContent ? (
        <>
          {traitsMenuContent}
          <MenuDivider />
        </>
      ) : null}
      <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
      <MenuRadioGroup
        value={runtimeMode}
        onValueChange={(value) => {
          if (!value || value === runtimeMode) return;
          onRuntimeModeChange(value as RuntimeMode);
        }}
      >
        <MenuRadioItem value="approval-required">Supervised</MenuRadioItem>
        <MenuRadioItem value="full-access">Full access</MenuRadioItem>
      </MenuRadioGroup>
      <MenuDivider />
      <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Mode</div>
      <MenuRadioGroup
        value={interactionMode}
        onValueChange={(value) => {
          if (!value || value === interactionMode) return;
          onInteractionModeChange(value as ProviderInteractionMode);
        }}
      >
        <MenuRadioItem value="default">Chat</MenuRadioItem>
        {supportsPlan ? (
          <>
            <MenuRadioItem value="plan">Plan</MenuRadioItem>
            <MenuRadioItem value="plan-accept">Plan + Accept</MenuRadioItem>
          </>
        ) : null}
      </MenuRadioGroup>
    </>
  );
}

function readRuntimeModeParam(value: unknown): RuntimeMode {
  return value === "full-access" ? "full-access" : "approval-required";
}

function readInteractionModeParam(value: unknown): ProviderInteractionMode {
  return value === "plan" || value === "plan-accept" ? value : "default";
}

function readBooleanParam(value: unknown): boolean {
  return value === true;
}

registerOverlayRoute<{
  hasTraitsContent?: unknown;
  interactionMode?: unknown;
  runtimeMode?: unknown;
  supportsPlan?: unknown;
  traitsRouteParams?: unknown;
}>(
  COMPACT_COMPOSER_CONTROLS_OVERLAY_ROUTE_KEY,
  function CompactComposerControlsMenuOverlayRoute({ controller, message }) {
    const hasTraitsContent = readBooleanParam(message.params.hasTraitsContent);
    const traitsRouteParams = message.params.traitsRouteParams as
      | TraitsPickerRouteParams
      | undefined;
    const runtimeMode = readRuntimeModeParam(message.params.runtimeMode);
    const interactionMode = readInteractionModeParam(message.params.interactionMode);
    const supportsPlan = readBooleanParam(message.params.supportsPlan);

    return (
      <OverlayRouteMenu>
        <OverlayRouteMenuPopup align="start">
          <CompactComposerControlsMenuContent
            interactionMode={interactionMode}
            runtimeMode={runtimeMode}
            supportsPlan={supportsPlan}
            traitsMenuContent={
              hasTraitsContent && traitsRouteParams ? (
                <TraitsMenuRouteContent
                  params={traitsRouteParams}
                  onResult={(result) => controller.submit({ kind: "traits", result })}
                />
              ) : null
            }
            onInteractionModeChange={(mode) => controller.submit({ kind: "interaction", mode })}
            onRuntimeModeChange={(mode) => controller.submit({ kind: "runtime", mode })}
          />
        </OverlayRouteMenuPopup>
      </OverlayRouteMenu>
    );
  },
);
