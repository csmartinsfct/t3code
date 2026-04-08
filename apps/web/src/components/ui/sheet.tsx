"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import * as React from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  clampPanelWidth,
  readPersistedPanelWidth,
  writePersistedPanelWidth,
} from "~/lib/persistedPanelWidth";

const Sheet = SheetPrimitive.Root;

const SheetPortal = SheetPrimitive.Portal;

function SheetTrigger(props: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetBackdrop({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/32 backdrop-blur-sm transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      data-slot="sheet-backdrop"
      {...props}
    />
  );
}

function SheetViewport({
  className,
  side,
  variant = "default",
  ...props
}: SheetPrimitive.Viewport.Props & {
  side?: "right" | "left" | "top" | "bottom";
  variant?: "default" | "inset";
}) {
  return (
    <SheetPrimitive.Viewport
      className={cn(
        "fixed inset-0 z-50 grid",
        side === "bottom" && "grid grid-rows-[1fr_auto] pt-12",
        side === "top" && "grid grid-rows-[auto_1fr] pb-12",
        side === "left" && "flex justify-start",
        side === "right" && "flex justify-end",
        variant === "inset" && "sm:p-4",
        className,
      )}
      data-slot="sheet-viewport"
      {...props}
    />
  );
}

export interface SheetResizableOptions {
  /** localStorage key for persisting width */
  storageKey: string;
  /** Minimum width in pixels */
  minWidth: number;
  /** Maximum width in pixels */
  maxWidth: number;
}

function SheetResizeHandle({
  side,
  popupRef,
  options,
}: {
  side: "right" | "left";
  popupRef: React.RefObject<HTMLDivElement | null>;
  options: SheetResizableOptions;
}) {
  const stateRef = React.useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    rafId: number | null;
  } | null>(null);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const popup = popupRef.current;
      if (!popup) return;

      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      stateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startWidth: popup.getBoundingClientRect().width,
        rafId: null,
      };
    },
    [popupRef],
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = stateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;
      const popup = popupRef.current;
      if (!popup) return;

      const delta = side === "right" ? state.startX - e.clientX : e.clientX - state.startX;
      const desired = state.startWidth + delta;
      const clamped = clampPanelWidth(desired, {
        minWidth: options.minWidth,
        maxWidth: options.maxWidth,
        referenceWidth: window.innerWidth,
      });
      if (clamped === null) return;

      if (state.rafId !== null) cancelAnimationFrame(state.rafId);
      state.rafId = requestAnimationFrame(() => {
        popup.style.width = `${clamped}px`;
        popup.style.maxWidth = `${clamped}px`;
      });
    },
    [popupRef, side, options],
  );

  const onPointerUp = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = stateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;

      if (state.rafId !== null) cancelAnimationFrame(state.rafId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }

      const popup = popupRef.current;
      if (popup) {
        const finalWidth = popup.getBoundingClientRect().width;
        writePersistedPanelWidth(options.storageKey, finalWidth, window.innerWidth);
      }

      stateRef.current = null;
    },
    [popupRef, options.storageKey],
  );

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={cn(
        "absolute top-0 bottom-0 z-10 w-1.5 cursor-col-resize touch-none select-none transition-colors hover:bg-primary/10 active:bg-primary/15",
        side === "right" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
      )}
      data-slot="sheet-resize-handle"
    />
  );
}

function SheetPopup({
  className,
  children,
  showCloseButton = true,
  keepMounted = false,
  side = "right",
  variant = "default",
  resizable,
  ...props
}: SheetPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  keepMounted?: boolean;
  side?: "right" | "left" | "top" | "bottom";
  variant?: "default" | "inset";
  resizable?: SheetResizableOptions;
}) {
  const popupRef = React.useRef<HTMLDivElement | null>(null);

  // Restore persisted width on mount
  const resizableStyle = React.useMemo<React.CSSProperties | undefined>(() => {
    if (!resizable) return undefined;
    const stored = readPersistedPanelWidth(resizable.storageKey);
    if (!stored) return undefined;
    const widthPx = typeof stored === "number" ? stored : stored.ratio * window.innerWidth;
    const clamped = clampPanelWidth(widthPx, {
      minWidth: resizable.minWidth,
      maxWidth: resizable.maxWidth,
      referenceWidth: window.innerWidth,
    });
    if (clamped === null) return undefined;
    return { width: `${clamped}px`, maxWidth: `${clamped}px` };
  }, [resizable]);

  const canResize = resizable && (side === "right" || side === "left");

  return (
    <SheetPortal keepMounted={keepMounted}>
      <SheetBackdrop />
      <SheetViewport side={side} variant={variant}>
        <SheetPrimitive.Popup
          ref={popupRef}
          className={cn(
            "relative flex max-h-full min-h-0 w-full min-w-0 flex-col bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 transition-[opacity,translate] duration-200 ease-in-out will-change-transform before:pointer-events-none before:absolute before:inset-0 before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:opacity-0 data-starting-style:opacity-0 max-sm:before:hidden dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            side === "bottom" &&
              "row-start-2 border-t data-ending-style:translate-y-8 data-starting-style:translate-y-8",
            side === "top" &&
              "data-ending-style:-translate-y-8 data-starting-style:-translate-y-8 border-b",
            side === "left" &&
              "data-ending-style:-translate-x-8 data-starting-style:-translate-x-8 w-[calc(100%-(--spacing(12)))] max-w-md border-e",
            side === "right" &&
              "col-start-2 w-[calc(100%-(--spacing(12)))] max-w-md border-s data-ending-style:translate-x-8 data-starting-style:translate-x-8",
            variant === "inset" &&
              "before:hidden sm:rounded-2xl sm:border sm:before:rounded-[calc(var(--radius-2xl)-1px)] sm:**:data-[slot=sheet-footer]:rounded-b-[calc(var(--radius-2xl)-1px)]",
            className,
          )}
          style={resizableStyle}
          data-slot="sheet-popup"
          {...props}
        >
          {canResize && <SheetResizeHandle side={side} popupRef={popupRef} options={resizable} />}
          {children}
          {showCloseButton && (
            <SheetPrimitive.Close
              aria-label="Close"
              className="absolute end-2 top-2"
              render={<Button size="icon" variant="ghost" />}
            >
              <XIcon />
            </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Popup>
      </SheetViewport>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-6 in-[[data-slot=sheet-popup]:has([data-slot=sheet-panel])]:pb-3 max-sm:pb-4",
        className,
      )}
      data-slot="sheet-header"
      {...props}
    />
  );
}

function SheetFooter({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "bare";
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 px-6 sm:flex-row sm:justify-end",
        variant === "default" && "border-t bg-muted/72 py-4",
        variant === "bare" &&
          "in-[[data-slot=sheet-popup]:has([data-slot=sheet-panel])]:pt-3 pt-4 pb-6",
        className,
      )}
      data-slot="sheet-footer"
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      className={cn("font-heading font-semibold text-xl leading-none", className)}
      data-slot="sheet-title"
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="sheet-description"
      {...props}
    />
  );
}

function SheetPanel({
  className,
  scrollFade = true,
  ...props
}: React.ComponentProps<"div"> & { scrollFade?: boolean }) {
  return (
    <ScrollArea scrollFade={scrollFade}>
      <div
        className={cn(
          "p-6 in-[[data-slot=sheet-popup]:has([data-slot=sheet-header])]:pt-1 in-[[data-slot=sheet-popup]:has([data-slot=sheet-footer]:not(.border-t))]:pb-1",
          className,
        )}
        data-slot="sheet-panel"
        {...props}
      />
    </ScrollArea>
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetPortal,
  SheetClose,
  SheetBackdrop,
  SheetBackdrop as SheetOverlay,
  SheetPopup,
  SheetPopup as SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetPanel,
};
