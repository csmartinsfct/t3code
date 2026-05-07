import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useState } from "react";

import type { OverlayImagePreviewMessage } from "@t3tools/contracts";

import type { OverlayBridgeHandle } from "./overlayTypes";

interface OverlayImagePreviewProps {
  message: OverlayImagePreviewMessage;
  bridge: OverlayBridgeHandle;
}

export function OverlayImagePreview({ message, bridge }: OverlayImagePreviewProps) {
  const [index, setIndex] = useState(message.initialIndex);
  const images = message.images;
  const item = images[index];

  if (!item) return null;

  const navigate = (delta: number) => {
    const next = Math.max(0, Math.min(images.length - 1, index + delta));
    setIndex(next);
    bridge.emitEvent("navigate", { delta });
  };

  const close = () => {
    bridge.emitEvent("close", {});
    bridge.requestDismiss();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-zoom-out"
        aria-label="Close image preview"
        onClick={close}
      />
      {images.length > 1 && (
        <button
          type="button"
          className="absolute left-2 top-1/2 z-20 -translate-y-1/2 flex size-9 items-center justify-center rounded-lg text-white/90 hover:bg-white/10 hover:text-white transition-colors sm:left-6"
          aria-label="Previous image"
          onClick={() => navigate(-1)}
        >
          <ChevronLeftIcon className="size-5" />
        </button>
      )}
      <div className="relative isolate z-10 max-h-[92vh] max-w-[92vw]">
        <button
          type="button"
          className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-md bg-black/40 text-white/80 hover:bg-black/60 hover:text-white transition-colors"
          onClick={close}
          aria-label="Close image preview"
        >
          <XIcon className="size-4" />
        </button>
        <img
          src={item.src}
          alt={item.name}
          className="max-h-[86vh] max-w-[92vw] select-none rounded-lg border border-border/70 bg-background object-contain shadow-2xl"
          draggable={false}
        />
        <p className="mt-2 max-w-[92vw] truncate text-center text-xs text-muted-foreground/80">
          {item.name}
          {images.length > 1 ? ` (${index + 1}/${images.length})` : ""}
        </p>
      </div>
      {images.length > 1 && (
        <button
          type="button"
          className="absolute right-2 top-1/2 z-20 -translate-y-1/2 flex size-9 items-center justify-center rounded-lg text-white/90 hover:bg-white/10 hover:text-white transition-colors sm:right-6"
          aria-label="Next image"
          onClick={() => navigate(1)}
        >
          <ChevronRightIcon className="size-5" />
        </button>
      )}
    </div>
  );
}
