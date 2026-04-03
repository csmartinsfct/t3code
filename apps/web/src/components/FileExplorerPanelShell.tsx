import type { ReactNode } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

export type FileExplorerPanelMode = "inline" | "sheet" | "sidebar";

export function FileExplorerPanelShell(props: {
  mode: FileExplorerPanelMode;
  children: ReactNode;
}) {
  const shouldUseDragRegion = isElectron && props.mode !== "sheet";

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col bg-background",
        props.mode === "inline"
          ? "w-[60vw] min-w-[640px] max-w-[1200px] shrink-0 border-l border-border"
          : "w-full",
      )}
    >
      {shouldUseDragRegion ? <div className="drag-region h-1 shrink-0" /> : null}
      {props.children}
    </div>
  );
}
