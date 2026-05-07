import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { OverlayComposerCommandItem, OverlayComposerCommandMessage } from "@t3tools/contracts";
import type { RefObject } from "react";

import { ComposerCommandMenu } from "~/components/chat/ComposerCommandMenu";

import type { OverlayBridgeHandle } from "./overlayTypes";

interface OverlayComposerCommandProps {
  message: OverlayComposerCommandMessage;
  anchorRef: RefObject<HTMLDivElement | null>;
  bridge: OverlayBridgeHandle;
}

export function OverlayComposerCommand({
  message,
  anchorRef,
  bridge,
}: OverlayComposerCommandProps) {
  const { anchor } = message;

  return (
    <MenuPrimitive.Root
      open={true}
      onOpenChange={(open) => {
        if (!open) bridge.requestDismiss();
      }}
    >
      <MenuPrimitive.Trigger
        aria-hidden
        tabIndex={-1}
        style={{
          position: "fixed",
          left: anchor.x,
          top: anchor.y,
          width: anchor.width || 1,
          height: anchor.height || 1,
          pointerEvents: "none",
          opacity: 0,
        }}
      />
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          anchor={anchorRef}
          align="start"
          className="z-50"
          side="top"
          sideOffset={8}
        >
          <div className="px-1" style={{ width: anchor.width }}>
            <ComposerCommandMenu
              items={message.items as OverlayComposerCommandItem[]}
              resolvedTheme={message.resolvedTheme}
              isLoading={message.isLoading}
              triggerKind={message.triggerKind}
              activeItemId={message.activeItemId}
              onHighlightedItemChange={(itemId) => {
                bridge.emitEvent("highlight", { id: itemId });
              }}
              onSelect={(item) => {
                bridge.emitEvent("select", { id: item.id });
                bridge.requestDismiss();
              }}
            />
          </div>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}
