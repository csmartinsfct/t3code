import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronRightIcon } from "lucide-react";
import type { RefObject } from "react";
import React from "react";

import type {
  OverlayContextMenuMessage,
  OverlayMenuAction,
  OverlayMenuMessage,
  OverlayMenuItem,
} from "@t3tools/contracts";

import { cn } from "~/lib/utils";

import type { OverlayBridgeHandle } from "./overlayTypes";
import { OverlayIcon } from "./OverlayIcon";

// Mirror the exact class strings from ~/components/ui/menu.tsx so the overlay
// popup looks pixel-identical to the host-side menu.
const POPUP_CLASSES =
  "relative flex not-[class*='w-']:min-w-32 origin-(--transform-origin) rounded-lg border bg-popover not-dark:bg-clip-padding shadow-lg/5 outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] focus:outline-none dark:before:shadow-[0_-1px_--theme(--color-white/6%)]";

// Use the sm: values directly — the overlay is always full-window so the
// 640px breakpoint always applies, but hardcoding avoids any Chromium
// viewport quirks in the isolated WebContentsView context.
const ITEM_CLASSES =
  "[&>svg]:-mx-0.5 flex min-h-7 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1 text-sm text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-[variant=destructive]:text-destructive-foreground data-highlighted:text-accent-foreground data-disabled:opacity-64 [&>svg:not([class*='opacity-'])]:opacity-80 [&>svg:not([class*='size-'])]:size-4 [&>svg]:pointer-events-none [&>svg]:shrink-0";

const CHECKED_ITEM_CLASSES =
  "grid min-h-7 cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-sm py-1 ps-2 pe-4 text-sm text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0";

const SUBTRIGGER_CLASSES =
  "flex min-h-7 items-center gap-2 rounded-sm px-2 py-1 text-sm text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-popup-open:bg-accent data-highlighted:text-accent-foreground data-popup-open:text-accent-foreground data-disabled:opacity-64 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none";

const SEPARATOR_CLASSES = "mx-2 my-1 h-px bg-border";
const SHORTCUT_CLASSES = "ms-auto text-muted-foreground/72 text-xs tracking-widest";
const BADGE_CLASSES =
  "max-w-32 shrink-0 truncate rounded-sm bg-muted/45 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/75";
const ACTION_CLASSES =
  "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-md border border-border/70 bg-background/45 px-1.5 text-muted-foreground/85 text-xs outline-none hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50";
const ICON_ACTION_CLASSES =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/65 outline-none hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

interface OverlayMenuProps {
  message: OverlayContextMenuMessage | OverlayMenuMessage;
  anchorRef: RefObject<HTMLDivElement | null>;
  bridge: OverlayBridgeHandle;
}

export function OverlayMenu({ message, anchorRef, bridge }: OverlayMenuProps) {
  const side = "side" in message ? (message.side ?? "bottom") : "bottom";
  const align = "align" in message ? (message.align ?? "start") : "start";
  const { anchor } = message;

  return (
    <MenuPrimitive.Root
      open={true}
      onOpenChange={(open) => {
        if (!open) bridge.requestDismiss();
      }}
    >
      {/* Ghost trigger — zero-size, invisible, positioned at the anchor
          so Base UI can manage keyboard focus without closing the menu
          when the pointer moves or a submenu opens. This mirrors the
          pattern used by ContextMenuPortal in the host renderer. */}
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
          side={side}
          align={align}
          sideOffset={4}
          className="z-50"
        >
          <MenuPrimitive.Popup className={POPUP_CLASSES}>
            <div className="max-h-(--available-height) w-full overflow-y-auto p-1">
              {renderMenuItems(message.items as OverlayMenuItem[], bridge)}
            </div>
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

function renderMenuItems(items: OverlayMenuItem[], bridge: OverlayBridgeHandle): React.ReactNode {
  return items.map((item) => {
    if (item.separator) {
      return <MenuPrimitive.Separator key={item.id} className={SEPARATOR_CLASSES} />;
    }
    if (item.labelOnly) {
      return (
        <div
          key={item.id}
          className="flex items-center justify-between gap-3 px-2 py-1.5"
          role="presentation"
        >
          <div className="font-medium text-muted-foreground text-xs">{item.label}</div>
          {item.actions && item.actions.length > 0 ? (
            <div className="flex items-center gap-1">
              {item.actions.map((action) => renderActionButton(action, bridge))}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <React.Fragment key={item.id}>
        {item.children && item.children.length > 0 ? (
          <MenuPrimitive.SubmenuRoot>
            <MenuPrimitive.SubmenuTrigger className={SUBTRIGGER_CLASSES} disabled={item.disabled}>
              {item.icon && <OverlayIcon name={item.icon} className={item.iconClassName} />}
              <span className="flex-1 truncate">{item.label}</span>
              <ChevronRightIcon className="-me-0.5 ms-auto opacity-80" />
            </MenuPrimitive.SubmenuTrigger>
            <MenuPrimitive.Portal>
              <MenuPrimitive.Positioner
                side="inline-end"
                align="start"
                alignOffset={-5}
                sideOffset={0}
                className="z-50"
              >
                <MenuPrimitive.Popup className={POPUP_CLASSES}>
                  <div className="max-h-(--available-height) w-full overflow-y-auto p-1">
                    {renderMenuItems(item.children, bridge)}
                  </div>
                </MenuPrimitive.Popup>
              </MenuPrimitive.Positioner>
            </MenuPrimitive.Portal>
          </MenuPrimitive.SubmenuRoot>
        ) : (
          <MenuPrimitive.Item
            className={cn(
              item.checked === undefined ? ITEM_CLASSES : CHECKED_ITEM_CLASSES,
              item.selectDisabled && "opacity-64",
              item.secondaryAction && "min-w-[15rem] max-w-[22rem]",
            )}
            data-variant={item.destructive ? "destructive" : undefined}
            disabled={item.disabled}
            aria-disabled={item.selectDisabled || item.disabled || undefined}
            onClick={(event) => {
              if (item.selectDisabled) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              bridge.emitEvent("select", { id: item.id });
            }}
          >
            {item.checked === undefined ? (
              <>
                {item.statusTone && (
                  <span
                    aria-hidden="true"
                    className={cn("size-1.5 shrink-0 rounded-full", statusToneClass(item))}
                  />
                )}
                {item.icon && <OverlayIcon name={item.icon} className={item.iconClassName} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {item.description ? (
                    <span className="block truncate text-muted-foreground/72 text-xs">
                      {item.description}
                    </span>
                  ) : null}
                </span>
              </>
            ) : (
              <>
                <span className="col-start-1">
                  {item.checked ? (
                    <svg
                      fill="none"
                      height="24"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      width="24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
                    </svg>
                  ) : null}
                </span>
                <span className="col-start-2">{item.label}</span>
              </>
            )}
            {item.badge && <span className={BADGE_CLASSES}>{item.badge}</span>}
            {item.shortcut && <span className={SHORTCUT_CLASSES}>{item.shortcut}</span>}
            {item.secondaryAction && renderActionButton(item.secondaryAction, bridge)}
          </MenuPrimitive.Item>
        )}
      </React.Fragment>
    );
  });
}

export function renderOverlayMenuItemsForTests(
  items: OverlayMenuItem[],
  bridge: OverlayBridgeHandle,
): React.ReactNode {
  return renderMenuItems(items, bridge);
}

function statusToneClass(item: OverlayMenuItem): string {
  switch (item.statusTone) {
    case "success":
      return "bg-emerald-400/80";
    case "warning":
      return "bg-amber-400/85";
    case "danger":
      return "bg-rose-400/75";
    case "muted":
    default:
      return "bg-muted-foreground/45";
  }
}

function renderActionButton(action: OverlayMenuAction, bridge: OverlayBridgeHandle) {
  const iconName = action.loading ? "LoaderCircle" : action.icon;
  const label = action.label?.trim();

  return (
    <button
      key={action.id}
      type="button"
      className={label ? ACTION_CLASSES : ICON_ACTION_CLASSES}
      aria-label={action.ariaLabel ?? label}
      title={action.ariaLabel ?? label}
      disabled={action.disabled}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!action.disabled) {
          bridge.emitEvent(action.dismissOnAction ? "select" : "action", { id: action.id });
        }
      }}
    >
      {iconName ? (
        <OverlayIcon
          name={iconName}
          className={cn(action.iconClassName, action.loading && "animate-spin")}
        />
      ) : null}
      {label ? <span>{label}</span> : null}
    </button>
  );
}
