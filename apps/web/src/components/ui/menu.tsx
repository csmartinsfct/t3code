"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronRightIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type * as React from "react";

import type { OverlayMenuItem, OverlayMenuMessage } from "@t3tools/contracts";
import type { OverlayAnchorRect } from "@t3tools/contracts";

import { useTrackedOverlayOpen } from "~/embeddedBrowserModalSuspension";
import {
  getElementOverlayAnchor,
  openNativeOverlay,
  trackNativeOverlayAnchor,
  useNativeOverlayActive,
  type NativeOverlaySession,
} from "~/nativeOverlayBridge";
import { cn } from "~/lib/utils";

const MenuCreateHandle = MenuPrimitive.createHandle;

// Context passed from Menu → MenuTrigger when native overlay mode is active.
// MenuTrigger reads this to intercept its click and call openNative() with
// its own getBoundingClientRect() before Base UI tries to open the DOM popup.
interface NativeMenuContextValue {
  openNative?: (anchorElement: HTMLElement) => void;
}
const NativeMenuContext = createContext<NativeMenuContextValue>({});

type MenuOpenDetails = Parameters<NonNullable<MenuPrimitive.Root.Props["onOpenChange"]>>[1];

function Menu({
  open,
  defaultOpen,
  onOpenChange,
  trackEmbeddedBrowserOverlay = true,
  overlayItems,
  overlayMenuSide,
  overlayMenuAlign,
  overlayOnSelect,
  overlayOnAction,
  ...props
}: MenuPrimitive.Root.Props & {
  trackEmbeddedBrowserOverlay?: boolean;
  /** Serializable item list. When provided and the native overlay system is
   *  active, the menu popup renders in a transparent WebContentsView above
   *  the embedded browser instead of the host DOM. */
  overlayItems?: OverlayMenuItem[];
  overlayMenuSide?: "top" | "bottom" | "left" | "right";
  overlayMenuAlign?: "start" | "center" | "end";
  overlayOnSelect?: (id: string) => void;
  overlayOnAction?: (id: string) => void;
}) {
  const nativeActive = useNativeOverlayActive();
  const [nativeAcquireFailed, setNativeAcquireFailed] = useState(false);
  const nativeSessionRef = useRef<NativeOverlaySession<string | null> | null>(null);
  const nativeAnchorElementRef = useRef<HTMLElement | null>(null);
  const nativeAnchorTrackingStopRef = useRef<(() => void) | null>(null);
  const overlayOnSelectRef = useRef(overlayOnSelect);
  const overlayOnActionRef = useRef(overlayOnAction);

  useEffect(() => {
    overlayOnSelectRef.current = overlayOnSelect;
  }, [overlayOnSelect]);

  useEffect(() => {
    overlayOnActionRef.current = overlayOnAction;
  }, [overlayOnAction]);

  const useNative =
    nativeActive &&
    overlayItems !== undefined &&
    trackEmbeddedBrowserOverlay &&
    !nativeAcquireFailed;

  const buildNativeMessage = useCallback(
    (rect: OverlayAnchorRect): OverlayMenuMessage | null => {
      if (!overlayItems) return null;
      return {
        type: "menu",
        anchor: rect,
        items: overlayItems,
        ...(overlayMenuSide !== undefined && { side: overlayMenuSide }),
        ...(overlayMenuAlign !== undefined && { align: overlayMenuAlign }),
      };
    },
    [overlayItems, overlayMenuSide, overlayMenuAlign],
  );

  const stopNativeAnchorTracking = useCallback(() => {
    nativeAnchorTrackingStopRef.current?.();
    nativeAnchorTrackingStopRef.current = null;
  }, []);

  const openNative = useCallback(
    (anchorElement: HTMLElement) => {
      const rect = getElementOverlayAnchor(anchorElement);
      const message = rect ? buildNativeMessage(rect) : null;
      if (!message) return;

      if (nativeSessionRef.current) {
        stopNativeAnchorTracking();
        nativeSessionRef.current.release();
        nativeSessionRef.current = null;
        onOpenChange?.(false, {} as MenuOpenDetails);
        return;
      }

      nativeAnchorElementRef.current = anchorElement;
      onOpenChange?.(true, {} as MenuOpenDetails);
      void openNativeOverlay<string | null>(message, {
        dismissValue: null,
        resolveEvent: (type, payload) => {
          const id = (payload as { id?: string })?.id;
          if (!id) return null;
          if (type === "action") {
            overlayOnActionRef.current?.(id);
            return null;
          }
          if (type !== "select") return null;
          return { value: id };
        },
      }).then((session) => {
        if (!session) {
          setNativeAcquireFailed(true);
          onOpenChange?.(true, {} as MenuOpenDetails);
          return;
        }
        nativeSessionRef.current = session;
        nativeAnchorTrackingStopRef.current = trackNativeOverlayAnchor(
          session,
          () => getElementOverlayAnchor(anchorElement),
          buildNativeMessage,
          anchorElement,
        );
        void session.result
          .then((id) => {
            if (id) overlayOnSelectRef.current?.(id);
          })
          .finally(() => {
            stopNativeAnchorTracking();
            if (nativeSessionRef.current === session) {
              nativeSessionRef.current = null;
            }
            onOpenChange?.(false, {} as MenuOpenDetails);
          });
      });
    },
    [buildNativeMessage, onOpenChange, stopNativeAnchorTracking],
  );

  useEffect(() => {
    const session = nativeSessionRef.current;
    const anchorElement = nativeAnchorElementRef.current;
    const rect = getElementOverlayAnchor(anchorElement);
    if (!session || !rect) return;
    const message = buildNativeMessage(rect);
    if (!message) {
      stopNativeAnchorTracking();
      session.release();
      nativeSessionRef.current = null;
      return;
    }
    void session.render(message);
  }, [buildNativeMessage, stopNativeAnchorTracking]);

  useEffect(
    () => () => {
      stopNativeAnchorTracking();
      nativeSessionRef.current?.release();
      nativeSessionRef.current = null;
    },
    [stopNativeAnchorTracking],
  );

  const handleOpenChange = useTrackedOverlayOpen({
    open: useNative ? false : open,
    defaultOpen: useNative ? false : defaultOpen,
    onOpenChange: useNative
      ? undefined
      : (nextOpen, details) => {
          if (!nextOpen) {
            setNativeAcquireFailed(false);
          }
          onOpenChange?.(nextOpen, details as Parameters<NonNullable<typeof onOpenChange>>[1]);
        },
    enabled: !useNative && trackEmbeddedBrowserOverlay,
    source: "menu",
  });

  const nativeCtx = useMemo<NativeMenuContextValue>(
    () => (useNative ? { openNative } : {}),
    [openNative, useNative],
  );

  return (
    <NativeMenuContext.Provider value={nativeCtx}>
      <MenuPrimitive.Root
        defaultOpen={useNative ? false : defaultOpen}
        onOpenChange={useNative ? undefined : handleOpenChange}
        open={useNative ? false : open}
        {...props}
      />
    </NativeMenuContext.Provider>
  );
}

const MenuPortal = MenuPrimitive.Portal;

function MenuTrigger({ className, children, onClick, ...props }: MenuPrimitive.Trigger.Props) {
  const { openNative } = useContext(NativeMenuContext);

  const handleClick = openNative
    ? (e: Parameters<NonNullable<MenuPrimitive.Trigger.Props["onClick"]>>[0]) => {
        e.preventDefault();
        e.preventBaseUIHandler();
        openNative(e.currentTarget);
      }
    : onClick;

  return (
    <MenuPrimitive.Trigger
      className={className}
      data-slot="menu-trigger"
      onClick={handleClick}
      {...props}
    >
      {children}
    </MenuPrimitive.Trigger>
  );
}

function MenuPopup({
  children,
  className,
  sideOffset = 4,
  align = "center",
  alignOffset,
  side = "bottom",
  anchor,
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
  side?: MenuPrimitive.Positioner.Props["side"];
  anchor?: MenuPrimitive.Positioner.Props["anchor"];
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50"
        data-slot="menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          className={cn(
            "relative flex not-[class*='w-']:min-w-32 origin-(--transform-origin) rounded-lg border bg-popover not-dark:bg-clip-padding shadow-lg/5 outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] focus:outline-none dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            className,
          )}
          data-slot="menu-popup"
          {...props}
        >
          <div className="max-h-(--available-height) w-full overflow-y-auto p-1">{children}</div>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function MenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="menu-group" {...props} />;
}

function MenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "[&>svg]:-mx-0.5 flex min-h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1 text-base text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-inset:ps-8 data-[variant=destructive]:text-destructive-foreground data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&>svg:not([class*='opacity-'])]:opacity-80 [&>svg:not([class*='size-'])]:size-4.5 sm:[&>svg:not([class*='size-'])]:size-4 [&>svg]:pointer-events-none [&>svg]:shrink-0",
        className,
      )}
      data-inset={inset}
      data-slot="menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

function MenuCheckboxItem({
  className,
  children,
  checked,
  variant = "default",
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  variant?: "default" | "switch";
}) {
  return (
    <MenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        "grid min-h-8 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-default items-center gap-2 rounded-sm py-1 ps-2 text-base text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        variant === "switch" ? "grid-cols-[1fr_auto] gap-4 pe-1.5" : "grid-cols-[1rem_1fr] pe-4",
        className,
      )}
      data-slot="menu-checkbox-item"
      {...props}
    >
      {variant === "switch" ? (
        <>
          <span className="col-start-1">{children}</span>
          <MenuPrimitive.CheckboxItemIndicator
            className="inset-shadow-[0_1px_--theme(--color-black/4%)] inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 items-center rounded-full p-px outline-none transition-[background-color,box-shadow] duration-200 [--thumb-size:--spacing(4)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input data-disabled:opacity-64 sm:[--thumb-size:--spacing(3)]"
            keepMounted
          >
            <span className="pointer-events-none block aspect-square h-full in-[[data-slot=menu-checkbox-item][data-checked]]:origin-[var(--thumb-size)_50%] origin-left in-[[data-slot=menu-checkbox-item][data-checked]]:translate-x-[calc(var(--thumb-size)-4px)] in-[[data-slot=menu-checkbox-item]:active]:not-data-disabled:scale-x-110 in-[[data-slot=menu-checkbox-item]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.10)] rounded-(--thumb-size) bg-background shadow-sm/5 will-change-transform [transition:translate_.15s,border-radius_.15s,scale_.1s_.1s,transform-origin_.15s]" />
          </MenuPrimitive.CheckboxItemIndicator>
        </>
      ) : (
        <>
          <MenuPrimitive.CheckboxItemIndicator className="col-start-1">
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
          </MenuPrimitive.CheckboxItemIndicator>
          <span className="col-start-2">{children}</span>
        </>
      )}
    </MenuPrimitive.CheckboxItem>
  );
}

function MenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="menu-radio-group" {...props} />;
}

function MenuRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(
        "grid min-h-8 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-sm py-1 ps-2 pe-4 text-base text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      data-slot="menu-radio-item"
      {...props}
    >
      <MenuPrimitive.RadioItemIndicator className="col-start-1">
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
      </MenuPrimitive.RadioItemIndicator>
      <span className="col-start-2">{children}</span>
    </MenuPrimitive.RadioItem>
  );
}

function MenuGroupLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.GroupLabel
      className={cn(
        "px-2 py-1.5 font-medium text-muted-foreground text-xs data-inset:ps-9 sm:data-inset:ps-8",
        className,
      )}
      data-inset={inset}
      data-slot="menu-label"
      {...props}
    />
  );
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      className={cn("mx-2 my-1 h-px bg-border", className)}
      data-slot="menu-separator"
      {...props}
    />
  );
}

function MenuShortcut({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "ms-auto font-medium font-sans text-muted-foreground/72 text-xs tracking-widest",
        className,
      )}
      data-slot="menu-shortcut"
      {...props}
    />
  );
}

function MenuSub(props: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="menu-sub" {...props} />;
}

function MenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      className={cn(
        "flex min-h-8 items-center gap-2 rounded-sm px-2 py-1 text-base text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-popup-open:bg-accent data-inset:ps-8 data-highlighted:text-accent-foreground data-popup-open:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none",
        className,
      )}
      data-inset={inset}
      data-slot="menu-sub-trigger"
      {...props}
    >
      {children}
      <ChevronRightIcon className="-me-0.5 ms-auto opacity-80" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

function MenuSubPopup({
  className,
  sideOffset = 0,
  alignOffset,
  align = "start",
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
}) {
  const defaultAlignOffset = align !== "center" ? -5 : undefined;

  return (
    <MenuPopup
      align={align}
      alignOffset={alignOffset ?? defaultAlignOffset}
      className={className}
      data-slot="menu-sub-content"
      side="inline-end"
      sideOffset={sideOffset}
      {...props}
    />
  );
}

export {
  MenuCreateHandle,
  MenuCreateHandle as DropdownMenuCreateHandle,
  Menu,
  Menu as DropdownMenu,
  MenuPortal,
  MenuPortal as DropdownMenuPortal,
  MenuTrigger,
  MenuTrigger as DropdownMenuTrigger,
  MenuPopup,
  MenuPopup as DropdownMenuContent,
  MenuGroup,
  MenuGroup as DropdownMenuGroup,
  MenuItem,
  MenuItem as DropdownMenuItem,
  MenuCheckboxItem,
  MenuCheckboxItem as DropdownMenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioGroup as DropdownMenuRadioGroup,
  MenuRadioItem,
  MenuRadioItem as DropdownMenuRadioItem,
  MenuGroupLabel,
  MenuGroupLabel as DropdownMenuLabel,
  MenuSeparator,
  MenuSeparator as DropdownMenuSeparator,
  MenuShortcut,
  MenuShortcut as DropdownMenuShortcut,
  MenuSub,
  MenuSub as DropdownMenuSub,
  MenuSubTrigger,
  MenuSubTrigger as DropdownMenuSubTrigger,
  MenuSubPopup,
  MenuSubPopup as DropdownMenuSubContent,
};
