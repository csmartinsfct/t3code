import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useEmbeddedBrowserOverlayLifecycle } from "../../embeddedBrowserModalSuspension";
import {
  openNativeOverlay,
  type NativeOverlaySession,
  useNativeOverlayActive,
} from "../../nativeOverlayBridge";
import type { ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import { Button } from "../ui/button";

function nextImageIndex(preview: ExpandedImagePreview, direction: -1 | 1): number {
  return (preview.index + direction + preview.images.length) % preview.images.length;
}

function ImagePreviewDialog({
  preview,
  onClose,
  onNavigate,
}: {
  readonly preview: ExpandedImagePreview;
  readonly onClose: () => void;
  readonly onNavigate: (direction: -1 | 1) => void;
}) {
  const item = preview.images[preview.index];
  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 [-webkit-app-region:no-drag]"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded image preview"
    >
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-zoom-out"
        aria-label="Close image preview"
        onClick={onClose}
      />
      {preview.images.length > 1 && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute left-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:left-6"
          aria-label="Previous image"
          onClick={() => onNavigate(-1)}
        >
          <ChevronLeftIcon className="size-5" />
        </Button>
      )}
      <div className="relative isolate z-10 max-h-[92vh] max-w-[92vw]">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="absolute right-2 top-2"
          onClick={onClose}
          aria-label="Close image preview"
        >
          <XIcon />
        </Button>
        <img
          src={item.src}
          alt={item.name}
          className="max-h-[86vh] max-w-[92vw] select-none rounded-lg border border-border/70 bg-background object-contain shadow-2xl"
          draggable={false}
        />
        <p className="mt-2 max-w-[92vw] truncate text-center text-xs text-muted-foreground/80">
          {item.name}
          {preview.images.length > 1 ? ` (${preview.index + 1}/${preview.images.length})` : ""}
        </p>
      </div>
      {preview.images.length > 1 && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute right-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:right-6"
          aria-label="Next image"
          onClick={() => onNavigate(1)}
        >
          <ChevronRightIcon className="size-5" />
        </Button>
      )}
    </div>
  );
}

export function useImagePreviewOverlay() {
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const nativeOverlayActive = useNativeOverlayActive();
  const nativeImageOverlayHandleRef = useRef<NativeOverlaySession<void> | null>(null);

  useEmbeddedBrowserOverlayLifecycle(
    !nativeOverlayActive && expandedImage !== null,
    "expanded-image",
  );

  const closeImagePreview = useCallback(() => {
    nativeImageOverlayHandleRef.current?.release();
    nativeImageOverlayHandleRef.current = null;
    setExpandedImage(null);
  }, []);

  const navigateImagePreview = useCallback((direction: -1 | 1) => {
    setExpandedImage((existing) => {
      if (!existing || existing.images.length <= 1) return existing;
      const nextIndex = nextImageIndex(existing, direction);
      return nextIndex === existing.index ? existing : { ...existing, index: nextIndex };
    });
  }, []);

  useEffect(() => {
    if (!expandedImage) return;

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeImagePreview();
        return;
      }
      if (expandedImage.images.length <= 1) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        navigateImagePreview(-1);
        return;
      }
      if (event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      navigateImagePreview(1);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeImagePreview, expandedImage, navigateImagePreview]);

  const openImagePreview = useCallback(
    (preview: ExpandedImagePreview) => {
      closeImagePreview();
      if (nativeOverlayActive) {
        void openNativeOverlay<void>(
          {
            type: "image-preview",
            images: preview.images.map((image) => ({ src: image.src, name: image.name })),
            initialIndex: preview.index,
          },
          {
            resolveEvent: (type) => (type === "close" ? { value: undefined } : null),
          },
        ).then((session) => {
          if (!session) {
            setExpandedImage(preview);
            return;
          }
          nativeImageOverlayHandleRef.current = session;
          void session.result.finally(() => {
            if (nativeImageOverlayHandleRef.current === session) {
              nativeImageOverlayHandleRef.current = null;
            }
          });
        });
      } else {
        setExpandedImage(preview);
      }
    },
    [closeImagePreview, nativeOverlayActive],
  );

  return {
    openImagePreview,
    closeImagePreview,
    imagePreviewOverlay: expandedImage ? (
      <ImagePreviewDialog
        preview={expandedImage}
        onClose={closeImagePreview}
        onNavigate={navigateImagePreview}
      />
    ) : null,
  };
}
