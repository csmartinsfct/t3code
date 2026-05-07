import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { RefObject } from "react";

import type { OverlayComboboxItem, OverlayComboboxMessage } from "@t3tools/contracts";

import type { OverlayBridgeHandle } from "./overlayTypes";

interface OverlayComboboxProps {
  message: OverlayComboboxMessage;
  anchorRef: RefObject<HTMLDivElement | null>;
  bridge: OverlayBridgeHandle;
}

export function OverlayCombobox({ message, anchorRef, bridge }: OverlayComboboxProps) {
  const [inputValue, setInputValue] = useState(message.inputValue);

  useEffect(() => {
    setInputValue(message.inputValue);
  }, [message.inputValue]);

  const handleInputChange = (value: string) => {
    setInputValue(value);
    bridge.emitEvent("search", { query: value });
  };

  const items = message.items as OverlayComboboxItem[];

  return (
    <ComboboxPrimitive.Root
      open={true}
      value={message.value}
      inputValue={inputValue}
      onOpenChange={(open) => {
        if (!open) bridge.requestDismiss();
      }}
      onInputValueChange={handleInputChange}
      onValueChange={(value) => {
        if (value !== null) {
          bridge.emitEvent("select", { value });
          bridge.requestDismiss();
        }
      }}
    >
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          anchor={anchorRef}
          side={message.side ?? "bottom"}
          align={message.align ?? "start"}
          sideOffset={4}
          className="z-50 select-none"
        >
          <span className="relative flex max-h-full min-w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) rounded-lg border bg-popover not-dark:bg-clip-padding shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
            <ComboboxPrimitive.Popup className="flex max-h-[min(var(--available-height),23rem)] flex-1 flex-col text-foreground">
              <div className="border-b p-1">
                <div className="relative">
                  <SearchIcon
                    aria-hidden="true"
                    className="-translate-y-1/2 pointer-events-none absolute start-2 top-1/2 size-4 text-muted-foreground/65"
                  />
                  <ComboboxPrimitive.Input
                    autoFocus
                    className="flex h-8 w-full rounded-md border border-input bg-background px-8 text-sm outline-none ring-ring/24 placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-[3px]"
                    placeholder={message.placeholder ?? "Search..."}
                  />
                </div>
              </div>
              {items.length === 0 ? (
                <div className="p-2 text-center text-muted-foreground text-sm">
                  {message.emptyText ?? "No results found."}
                </div>
              ) : (
                <ComboboxPrimitive.List className="max-h-56 overflow-y-auto p-1">
                  {items.map((item) => (
                    <ComboboxPrimitive.Item
                      key={item.value}
                      value={item.value}
                      disabled={item.disabled}
                      className="flex min-h-8 cursor-default items-center gap-2 rounded-sm px-2 py-1 text-base outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        {item.description ? (
                          <span className="block truncate text-muted-foreground text-xs">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                      {item.badge ? (
                        <span className="shrink-0 text-[10px] text-muted-foreground/45">
                          {item.badge}
                        </span>
                      ) : null}
                    </ComboboxPrimitive.Item>
                  ))}
                </ComboboxPrimitive.List>
              )}
              {message.statusText ? (
                <div className="px-3 py-2 font-medium text-muted-foreground text-xs">
                  {message.statusText}
                </div>
              ) : null}
            </ComboboxPrimitive.Popup>
          </span>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}
