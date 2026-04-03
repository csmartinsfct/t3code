import { useDroppable } from "@dnd-kit/core";
import { cn } from "~/lib/utils";

/**
 * SplitDropZones — shown during drag to allow creating a split pane.
 *
 * Renders two transparent zones covering ~20% of each edge of the editor
 * area. Highlight appears when the pointer hovers over them.
 */
export function SplitDropZones() {
  const { setNodeRef: setLeftRef, isOver: isOverLeft } = useDroppable({
    id: "split-zone-left",
  });

  const { setNodeRef: setRightRef, isOver: isOverRight } = useDroppable({
    id: "split-zone-right",
  });

  return (
    <>
      {/* Left edge drop zone */}
      <div
        ref={setLeftRef}
        className={cn(
          "pointer-events-auto absolute inset-y-0 left-0 z-20 w-1/5 transition-all duration-120",
          isOverLeft ? "bg-primary/15 border-r-2 border-primary/50" : "bg-transparent",
        )}
        aria-hidden
      />

      {/* Right edge drop zone */}
      <div
        ref={setRightRef}
        className={cn(
          "pointer-events-auto absolute inset-y-0 right-0 z-20 w-1/5 transition-all duration-120",
          isOverRight ? "bg-primary/15 border-l-2 border-primary/50" : "bg-transparent",
        )}
        aria-hidden
      />
    </>
  );
}
