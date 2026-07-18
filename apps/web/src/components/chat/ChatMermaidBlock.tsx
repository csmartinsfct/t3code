import { useState, type ReactNode } from "react";

import { MermaidZoomPanViewer } from "~/components/mermaid/MermaidZoomPanViewer";
import { useMermaidSvg } from "~/components/mermaid/useMermaidSvg";
import { Dialog, DialogPopup } from "~/components/ui/dialog";
import { shouldRenderMermaidDiagram } from "~/lib/mermaidBlock";

export function ChatMermaidBlock({
  code,
  isStreaming,
  fallback,
}: {
  readonly code: string;
  readonly isStreaming: boolean;
  readonly fallback: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const { svg, error } = useMermaidSvg(code, { enabled: !isStreaming });

  if (!shouldRenderMermaidDiagram(isStreaming, Boolean(error)) || !svg) {
    return <>{fallback}</>;
  }

  return (
    <>
      <div className="group relative my-2 w-full">
        <div
          aria-hidden
          className="overflow-hidden rounded-md border border-border bg-background p-3 transition-colors group-focus-within:border-ring group-hover:border-ring [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <button
          type="button"
          className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Expand mermaid diagram"
          onClick={() => setExpanded(true)}
        />
      </div>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogPopup className="h-[85vh] max-w-[90vw]">
          <div className="flex min-h-0 flex-1 flex-col">
            <MermaidZoomPanViewer svg={svg} error={error} />
          </div>
        </DialogPopup>
      </Dialog>
    </>
  );
}
