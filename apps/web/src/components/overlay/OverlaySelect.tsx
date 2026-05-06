import { Select as SelectPrimitive } from "@base-ui/react/select";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type { RefObject } from "react";

import type { OverlaySelectItem, OverlaySelectMessage } from "@t3tools/contracts";

import { cn } from "~/lib/utils";

import type { OverlayBridgeHandle } from "./overlayTypes";
import { OverlayIcon } from "./OverlayIcon";

interface OverlaySelectProps {
  message: OverlaySelectMessage;
  anchorRef: RefObject<HTMLDivElement | null>;
  bridge: OverlayBridgeHandle;
}

export function OverlaySelect({ message, anchorRef, bridge }: OverlaySelectProps) {
  return (
    <SelectPrimitive.Root
      open={true}
      value={message.value}
      onOpenChange={(open) => {
        if (!open) bridge.requestDismiss();
      }}
      onValueChange={(value) => {
        if (value !== null) {
          bridge.emitEvent("select", { value });
          bridge.requestDismiss();
        }
      }}
    >
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          anchor={anchorRef}
          side={message.side ?? "bottom"}
          align={message.align ?? "start"}
          alignItemWithTrigger={message.alignItemWithTrigger ?? false}
          sideOffset={4}
          className="z-50 select-none"
        >
          <SelectPrimitive.Popup className="origin-(--transform-origin) text-foreground outline-none focus:outline-none focus-visible:outline-none">
            <SelectPrimitive.ScrollUpArrow className="top-0 z-50 flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:top-px before:h-[200%] before:rounded-t-[calc(var(--radius-lg)-1px)] before:bg-linear-to-b before:from-50% before:from-popover">
              <ChevronUpIcon className="relative size-4.5 sm:size-4" />
            </SelectPrimitive.ScrollUpArrow>
            <div className="relative h-full min-w-(--anchor-width) rounded-lg border bg-popover not-dark:bg-clip-padding shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
              <SelectPrimitive.List className="max-h-(--available-height) overflow-y-auto p-1 outline-none focus:outline-none focus-visible:outline-none">
                {renderOverlaySelectItems(message.items as OverlaySelectItem[])}
              </SelectPrimitive.List>
            </div>
            <SelectPrimitive.ScrollDownArrow className="bottom-0 z-50 flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:bottom-px before:h-[200%] before:rounded-b-[calc(var(--radius-lg)-1px)] before:bg-linear-to-t before:from-50% before:from-popover">
              <ChevronDownIcon className="relative size-4.5 sm:size-4" />
            </SelectPrimitive.ScrollDownArrow>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

function renderOverlaySelectItems(items: OverlaySelectItem[]) {
  return items.map((item) =>
    item.separator ? (
      <SelectPrimitive.Separator key={item.value} className="mx-2 my-1 h-px bg-border" />
    ) : (
      <SelectPrimitive.Item
        key={item.value}
        value={item.value}
        disabled={item.disabled}
        className={cn(
          "grid min-h-8 cursor-default items-center gap-2 rounded-sm py-1 text-base outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
          item.hideIndicator ? "grid-cols-[1fr] ps-3 pe-3" : "grid-cols-[1rem_1fr] ps-2 pe-4",
        )}
      >
        {item.hideIndicator ? null : (
          <SelectPrimitive.ItemIndicator className="col-start-1">
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
          </SelectPrimitive.ItemIndicator>
        )}
        <SelectPrimitive.ItemText
          className={cn(
            "min-w-0 inline-flex items-center gap-1.5",
            item.hideIndicator ? "col-start-1" : "col-start-2",
          )}
        >
          {item.icon && <OverlayIcon name={item.icon} className={item.iconClassName} />}
          {item.label}
        </SelectPrimitive.ItemText>
      </SelectPrimitive.Item>
    ),
  );
}

export function renderOverlaySelectItemsForTests(items: OverlaySelectItem[]) {
  return renderOverlaySelectItems(items);
}
