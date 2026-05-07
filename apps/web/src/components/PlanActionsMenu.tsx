import type React from "react";

import { EllipsisIcon } from "lucide-react";

import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteMenu, OverlayRouteMenuPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";

import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";

const PLAN_ACTIONS_MENU_OVERLAY_ROUTE_KEY = "plan-actions-menu";

type PlanActionMenuResult = { action: "copy" } | { action: "download" } | { action: "save" };

function PlanActionsMenuContent({
  isCopied,
  isSaveDisabled,
  onCopy,
  onDownload,
  onSave,
}: {
  isCopied: boolean;
  isSaveDisabled: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <MenuItem onClick={onCopy}>{isCopied ? "Copied!" : "Copy to clipboard"}</MenuItem>
      <MenuItem onClick={onDownload}>Download as markdown</MenuItem>
      <MenuItem onClick={onSave} disabled={isSaveDisabled}>
        Save to workspace
      </MenuItem>
    </>
  );
}

export function PlanActionsMenu({
  buttonClassName,
  buttonVariant = "outline",
  iconClassName = "size-4",
  isCopied,
  isSaveDisabled,
  onCopy,
  onDownload,
  onSave,
}: {
  buttonClassName?: string | undefined;
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
  iconClassName?: string | undefined;
  isCopied: boolean;
  isSaveDisabled: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onSave: () => void;
}) {
  const route = useRoutedPopoverSurface<HTMLButtonElement, PlanActionMenuResult>({
    routeKey: PLAN_ACTIONS_MENU_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "end",
    params: { isCopied, isSaveDisabled },
    onResult: (result) => {
      if (result.action === "copy") {
        onCopy();
        return;
      }
      if (result.action === "download") {
        onDownload();
        return;
      }
      if (!isSaveDisabled) {
        onSave();
      }
    },
  });

  return (
    <Menu open={route.domOpen} onOpenChange={route.onOpenChange}>
      <MenuTrigger
        render={
          <Button
            aria-label="Plan actions"
            className={buttonClassName}
            onFocusCapture={route.updateAnchor}
            onMouseOverCapture={route.updateAnchor}
            ref={route.triggerRef}
            size="icon-xs"
            variant={buttonVariant}
          />
        }
      >
        <EllipsisIcon aria-hidden="true" className={iconClassName} />
      </MenuTrigger>
      <MenuPopup align="end">
        <PlanActionsMenuContent
          isCopied={isCopied}
          isSaveDisabled={isSaveDisabled}
          onCopy={onCopy}
          onDownload={onDownload}
          onSave={onSave}
        />
      </MenuPopup>
    </Menu>
  );
}

registerOverlayRoute<{
  isCopied?: unknown;
  isSaveDisabled?: unknown;
}>(
  PLAN_ACTIONS_MENU_OVERLAY_ROUTE_KEY,
  function PlanActionsMenuOverlayRoute({ message, controller }) {
    const isCopied = message.params.isCopied === true;
    const isSaveDisabled = message.params.isSaveDisabled === true;

    return (
      <OverlayRouteMenu>
        <OverlayRouteMenuPopup align="end">
          <PlanActionsMenuContent
            isCopied={isCopied}
            isSaveDisabled={isSaveDisabled}
            onCopy={() => controller.submit({ action: "copy" })}
            onDownload={() => controller.submit({ action: "download" })}
            onSave={() => {
              if (!isSaveDisabled) controller.submit({ action: "save" });
            }}
          />
        </OverlayRouteMenuPopup>
      </OverlayRouteMenu>
    );
  },
);
