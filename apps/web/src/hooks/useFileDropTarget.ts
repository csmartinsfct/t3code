import { useCallback, useRef, useState, type DragEvent, type HTMLAttributes } from "react";

export interface UseFileDropTargetOptions {
  readonly onFiles: (files: File[]) => void;
  readonly disabled?: boolean;
}

export interface UseFileDropTargetReturn {
  readonly isActive: boolean;
  readonly bindProps: Pick<
    HTMLAttributes<HTMLElement>,
    "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop"
  >;
}

/**
 * Reusable file drop-target hook. Listens for HTML5 drag-and-drop events,
 * tracks nested children via a counter so `isActive` stays true while hovering
 * child elements, and extracts dropped `File[]`.
 *
 * The drop target is MIME-open on the client — validation belongs to whatever
 * consumes the files (so the same hook can serve image uploads, file uploads,
 * etc.).
 */
export function useFileDropTarget(options: UseFileDropTargetOptions): UseFileDropTargetReturn {
  const { onFiles, disabled } = options;
  const counterRef = useRef(0);
  const [isActive, setIsActive] = useState(false);

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled) return;
      if (!event.dataTransfer?.types?.includes("Files")) return;
      counterRef.current += 1;
      setIsActive(true);
      event.preventDefault();
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled) return;
      if (!event.dataTransfer?.types?.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [disabled],
  );

  const onDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled) return;
      counterRef.current = Math.max(0, counterRef.current - 1);
      if (counterRef.current === 0) setIsActive(false);
      event.preventDefault();
    },
    [disabled],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled) return;
      event.preventDefault();
      counterRef.current = 0;
      setIsActive(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [disabled, onFiles],
  );

  return {
    isActive,
    bindProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
