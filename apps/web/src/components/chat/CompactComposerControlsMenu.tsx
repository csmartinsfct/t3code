import {
  type OverlayMenuItem,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import { memo, type ReactNode, useMemo } from "react";
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

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  supportsPlan: boolean;
  traitsMenuContent?: ReactNode;
  traitsOverlayItems?: OverlayMenuItem[];
  onTraitsOverlaySelect?: (id: string) => void;
  onInteractionModeChange: (mode: ProviderInteractionMode) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const overlayItems = useMemo<OverlayMenuItem[]>(() => {
    const items: OverlayMenuItem[] = [
      ...(props.traitsOverlayItems ?? []),
      ...(props.traitsOverlayItems && props.traitsOverlayItems.length > 0
        ? [{ id: "separator:access", label: "", separator: true } satisfies OverlayMenuItem]
        : []),
      { id: "label:access", label: "Access", labelOnly: true },
      {
        id: "runtime:approval-required",
        label: "Supervised",
        checked: props.runtimeMode === "approval-required",
      },
      {
        id: "runtime:full-access",
        label: "Full access",
        checked: props.runtimeMode === "full-access",
      },
      { id: "separator:mode", label: "", separator: true },
      { id: "label:mode", label: "Mode", labelOnly: true },
      { id: "interaction:default", label: "Chat", checked: props.interactionMode === "default" },
    ];

    if (props.supportsPlan) {
      items.push(
        { id: "interaction:plan", label: "Plan", checked: props.interactionMode === "plan" },
        {
          id: "interaction:plan-accept",
          label: "Plan + Accept",
          checked: props.interactionMode === "plan-accept",
        },
      );
    }

    return items;
  }, [props.interactionMode, props.runtimeMode, props.supportsPlan, props.traitsOverlayItems]);

  return (
    <Menu
      overlayMenuAlign="start"
      overlayOnSelect={(id) => {
        if (props.onTraitsOverlaySelect) {
          props.onTraitsOverlaySelect(id);
        }
        if (id === "runtime:approval-required" || id === "runtime:full-access") {
          const nextMode = id.slice("runtime:".length) as RuntimeMode;
          if (nextMode !== props.runtimeMode) props.onRuntimeModeChange(nextMode);
          return;
        }
        if (
          id === "interaction:default" ||
          id === "interaction:plan" ||
          id === "interaction:plan-accept"
        ) {
          const nextMode = id.slice("interaction:".length) as ProviderInteractionMode;
          if (nextMode !== props.interactionMode) props.onInteractionModeChange(nextMode);
        }
      }}
      overlayItems={overlayItems}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
            aria-label="More composer controls"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup align="start">
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
        <MenuRadioGroup
          value={props.runtimeMode}
          onValueChange={(value) => {
            if (!value || value === props.runtimeMode) return;
            props.onRuntimeModeChange(value as RuntimeMode);
          }}
        >
          <MenuRadioItem value="approval-required">Supervised</MenuRadioItem>
          <MenuRadioItem value="full-access">Full access</MenuRadioItem>
        </MenuRadioGroup>
        <MenuDivider />
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Mode</div>
        <MenuRadioGroup
          value={props.interactionMode}
          onValueChange={(value) => {
            if (!value || value === props.interactionMode) return;
            props.onInteractionModeChange(value as ProviderInteractionMode);
          }}
        >
          <MenuRadioItem value="default">Chat</MenuRadioItem>
          {props.supportsPlan ? (
            <>
              <MenuRadioItem value="plan">Plan</MenuRadioItem>
              <MenuRadioItem value="plan-accept">Plan + Accept</MenuRadioItem>
            </>
          ) : null}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
});
