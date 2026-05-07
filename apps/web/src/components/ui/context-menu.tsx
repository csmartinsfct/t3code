import type { ContextMenuItem } from "@t3tools/contracts";
import { useMemo } from "react";

import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { useContextMenuStore } from "~/contextMenuStore";
import { OverlayRouteMenu, OverlayRouteMenuPopup } from "~/routedOverlayAdapters";

import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "./menu";

const CONTEXT_MENU_ROUTE_KEY = "context-menu";

type ContextMenuRouteParams = {
  items?: unknown;
};

function readContextMenuItems(value: unknown): readonly ContextMenuItem<string>[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate): ContextMenuItem<string>[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.label !== "string") return [];
    const children = readContextMenuItems(item.children);
    return [
      {
        id: item.id,
        label: item.label,
        ...(typeof item.destructive === "boolean" ? { destructive: item.destructive } : {}),
        ...(typeof item.disabled === "boolean" ? { disabled: item.disabled } : {}),
        ...(children.length > 0 ? { children } : {}),
      },
    ];
  });
}

function ContextMenuItems({
  items,
  onSelect,
}: {
  items: readonly ContextMenuItem<string>[];
  onSelect: (id: string) => void;
}) {
  return items.map((item) => {
    if (item.id === "---") {
      return <MenuSeparator key={item.id} />;
    }

    if (item.children && item.children.length > 0) {
      return (
        <MenuSub key={item.id}>
          <MenuSubTrigger disabled={item.disabled}>{item.label}</MenuSubTrigger>
          <MenuSubPopup>
            <ContextMenuItems items={item.children} onSelect={onSelect} />
          </MenuSubPopup>
        </MenuSub>
      );
    }

    return (
      <MenuItem
        key={item.id}
        disabled={item.disabled}
        variant={item.destructive ? "destructive" : "default"}
        onClick={() => onSelect(item.id)}
      >
        {item.label}
      </MenuItem>
    );
  });
}

function ContextMenuRouteContent({
  items,
  onSelect,
}: {
  items: readonly ContextMenuItem<string>[];
  onSelect: (id: string) => void;
}) {
  return (
    <OverlayRouteMenu>
      <OverlayRouteMenuPopup align="start" side="bottom" sideOffset={0}>
        <ContextMenuItems items={items} onSelect={onSelect} />
      </OverlayRouteMenuPopup>
    </OverlayRouteMenu>
  );
}

export function ContextMenuPortal() {
  const open = useContextMenuStore((s) => s.open);
  const items = useContextMenuStore((s) => s.items);
  const position = useContextMenuStore((s) => s.position);
  const select = useContextMenuStore((s) => s.select);
  const dismiss = useContextMenuStore((s) => s.dismiss);

  const triggerStyle = useMemo(
    () => ({ left: position.x, top: position.y }),
    [position.x, position.y],
  );

  return (
    <Menu
      open={open}
      trackEmbeddedBrowserOverlay={false}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          dismiss();
        }
      }}
    >
      <MenuTrigger
        aria-hidden
        className="pointer-events-none fixed size-0 opacity-0"
        style={triggerStyle}
        tabIndex={-1}
      />
      <MenuPopup align="start" side="bottom" sideOffset={0}>
        <ContextMenuItems items={items} onSelect={select} />
      </MenuPopup>
    </Menu>
  );
}

registerOverlayRoute<ContextMenuRouteParams>(CONTEXT_MENU_ROUTE_KEY, ({ message, controller }) => (
  <ContextMenuRouteContent
    items={readContextMenuItems(message.params.items)}
    onSelect={(id) => controller.submit(id)}
  />
));
