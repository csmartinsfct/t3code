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
      <button
        type="button"
        className="my-2 block w-full overflow-hidden rounded-md border border-border bg-background p-3 text-left outline-none transition-colors hover:border-ring focus-visible:ring-2 focus-visible:ring-ring [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        aria-label="Expand mermaid diagram"
        onClick={() => setExpanded(true)}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
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
