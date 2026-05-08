import type { ProjectId } from "@t3tools/contracts";
import { useEffect } from "react";

import {
  beginExtensionFetch,
  completeExtensionFetch,
  failExtensionFetch,
  invalidateBrowserMetadata,
  type BrowserMetadataEntry,
  useBrowserMetadataStore,
} from "~/lib/browserMetadataStore";

const DEFAULT_ENTRY: BrowserMetadataEntry = {
  projectId: "" as ProjectId,
  extensions: [],
  status: "loading",
  error: null,
};

export function useBrowserMetadata(projectId: ProjectId): BrowserMetadataEntry {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge?.browser;
  const entry = useBrowserMetadataStore((s) => s.entries[projectId] ?? DEFAULT_ENTRY);

  useEffect(() => {
    if (!bridge) return;
    const fetch = () => {
      // beginExtensionFetch marks status="loading" synchronously; the IPC
      // resolves asynchronously. Calling it here (inside useEffect, not during
      // render) is safe — React schedules the resulting store update as a
      // normal state change rather than a synchronous commit-phase update.
      beginExtensionFetch(projectId);
      void bridge.listExtensions(projectId).then(
        (exts) => completeExtensionFetch(projectId, exts),
        (err: unknown) => failExtensionFetch(projectId, String(err)),
      );
    };
    fetch();
    return bridge.onExtensionsChanged((pid) => {
      if (pid === projectId) {
        invalidateBrowserMetadata(projectId);
        fetch();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, projectId]);

  return entry;
}
