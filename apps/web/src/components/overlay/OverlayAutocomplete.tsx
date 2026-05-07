import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";

import type { OverlayAutocompleteMessage, OverlayComboboxItem } from "@t3tools/contracts";

import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";

import type { OverlayBridgeHandle } from "./overlayTypes";

const POPUP_CHROME_CLASSES =
  "relative flex max-h-full min-w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) rounded-lg border bg-popover not-dark:bg-clip-padding shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]";
const POPUP_CLASSES =
  "flex max-h-[min(var(--available-height),23rem)] flex-1 flex-col text-foreground";
const LIST_CLASSES = "not-empty:scroll-py-1 not-empty:p-1 in-data-has-overflow-y:pe-3";
const ITEM_CLASSES =
  "flex min-h-8 cursor-default select-none items-center rounded-sm px-2 py-1 text-base outline-none hover:bg-accent data-disabled:pointer-events-none data-selected:bg-accent/50 data-selected:text-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground [&[data-highlighted][data-selected]]:bg-accent [&[data-highlighted][data-selected]]:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm";

interface OverlayAutocompleteProps {
  message: OverlayAutocompleteMessage;
  anchorRef: RefObject<HTMLDivElement | null>;
  bridge: OverlayBridgeHandle;
}

export function OverlayAutocomplete({ message, anchorRef, bridge }: OverlayAutocompleteProps) {
  const [inputValue, setInputValue] = useState(message.value);
  const items = message.items as OverlayComboboxItem[];
  const itemByLabel = useMemo(() => {
    const map = new Map<string, OverlayComboboxItem>();
    for (const item of items) {
      map.set(item.label, item);
    }
    return map;
  }, [items]);

  useEffect(() => {
    setInputValue(message.value);
  }, [message.value]);

  const selectItem = (item: OverlayComboboxItem | undefined) => {
    if (!item || item.disabled) return;
    bridge.emitEvent("select", { value: item.value });
    bridge.requestDismiss();
  };

  return (
    <AutocompletePrimitive.Root
      open={true}
      items={items}
      itemToStringValue={(item) => item.label}
      value={inputValue}
      onOpenChange={(open) => {
        if (!open) bridge.requestDismiss();
      }}
      onValueChange={(value, details) => {
        setInputValue(value);
        if (details.reason === "item-press") {
          selectItem(itemByLabel.get(value));
          return;
        }
        bridge.emitEvent("search", { query: value });
      }}
    >
      <div
        style={{
          position: "fixed",
          left: message.anchor.x,
          top: message.anchor.y,
          width: message.anchor.width,
          height: message.anchor.height,
          zIndex: 50,
        }}
      >
        <AutocompletePrimitive.Input
          autoFocus
          placeholder={message.placeholder}
          data-slot="autocomplete-input"
          render={<Input nativeInput size={message.inputSize ?? "default"} />}
        />
      </div>

      <AutocompletePrimitive.Portal>
        <AutocompletePrimitive.Positioner
          anchor={anchorRef}
          side={message.side ?? "bottom"}
          align={message.align ?? "start"}
          sideOffset={4}
          className="z-50 select-none"
        >
          <span className={POPUP_CHROME_CLASSES}>
            <AutocompletePrimitive.Popup className={POPUP_CLASSES} data-slot="autocomplete-popup">
              {items.length === 0 ? (
                <div className="not-empty:p-2 text-center text-base text-muted-foreground sm:text-sm">
                  {message.emptyText ?? "No results found."}
                </div>
              ) : (
                <ScrollArea scrollbarGutter scrollFade>
                  <AutocompletePrimitive.List
                    className={LIST_CLASSES}
                    data-slot="autocomplete-list"
                  >
                    {items.map((item) => (
                      <AutocompletePrimitive.Item
                        key={item.value}
                        value={item}
                        disabled={item.disabled}
                        className={ITEM_CLASSES}
                        onClick={() => selectItem(item)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{item.label}</span>
                          {item.description ? (
                            <span className="block truncate text-muted-foreground/72 text-xs">
                              {item.description}
                            </span>
                          ) : null}
                        </span>
                        {item.badge ? (
                          <span className="shrink-0 text-[10px] text-muted-foreground/45">
                            {item.badge}
                          </span>
                        ) : null}
                      </AutocompletePrimitive.Item>
                    ))}
                  </AutocompletePrimitive.List>
                </ScrollArea>
              )}
              {message.statusText ? (
                <div
                  className={cn(
                    "px-3 py-2 font-medium text-muted-foreground text-xs empty:m-0 empty:p-0",
                  )}
                  data-slot="autocomplete-status"
                >
                  {message.statusText}
                </div>
              ) : null}
            </AutocompletePrimitive.Popup>
          </span>
        </AutocompletePrimitive.Positioner>
      </AutocompletePrimitive.Portal>
    </AutocompletePrimitive.Root>
  );
}
