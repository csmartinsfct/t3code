import type { ProjectId } from "@t3tools/contracts";

import { EmbeddedBrowser } from "./EmbeddedBrowser";

interface EmbeddedBrowserPopoutAppProps {
  projectId: ProjectId;
}

// Renderer entry for popout windows opened via T3CO-424. The shell is
// deliberately thin: a popout window's only purpose is to host the project's
// WebContentsView at any size on any monitor. The full app shell, router,
// and provider tree are skipped — the EmbeddedBrowser component owns its own
// IPC, modal-suspension wiring, and tab/url-bar/viewport chrome.
export function EmbeddedBrowserPopoutApp({ projectId }: EmbeddedBrowserPopoutAppProps) {
  return (
    <div className="flex h-screen min-h-0 w-screen min-w-0 flex-col bg-background text-foreground">
      <EmbeddedBrowser projectId={projectId} />
    </div>
  );
}
