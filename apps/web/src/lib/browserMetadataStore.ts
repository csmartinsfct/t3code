import type { BrowserExtensionInfo, ProjectId } from "@t3tools/contracts";
import { create } from "zustand";

export interface BrowserMetadataEntry {
  readonly projectId: ProjectId;
  readonly extensions: readonly BrowserExtensionInfo[];
  readonly status: "loading" | "ready" | "error";
  readonly error: string | null;
}

interface BrowserMetadataStore {
  entries: Record<string, BrowserMetadataEntry>;
}

export const useBrowserMetadataStore = create<BrowserMetadataStore>(() => ({ entries: {} }));

export function beginExtensionFetch(projectId: ProjectId): void {
  useBrowserMetadataStore.setState((s) => ({
    entries: {
      ...s.entries,
      [projectId]: {
        projectId,
        extensions: s.entries[projectId]?.extensions ?? [],
        status: "loading",
        error: null,
      },
    },
  }));
}

export function completeExtensionFetch(
  projectId: ProjectId,
  extensions: BrowserExtensionInfo[],
): void {
  useBrowserMetadataStore.setState((s) => ({
    entries: {
      ...s.entries,
      [projectId]: { projectId, extensions, status: "ready", error: null },
    },
  }));
}

export function failExtensionFetch(projectId: ProjectId, error: string): void {
  useBrowserMetadataStore.setState((s) => ({
    entries: {
      ...s.entries,
      [projectId]: {
        projectId,
        extensions: s.entries[projectId]?.extensions ?? [],
        status: "error",
        error,
      },
    },
  }));
}

export function optimisticTogglePin(projectId: ProjectId, extensionId: string): void {
  useBrowserMetadataStore.setState((s) => {
    const current = s.entries[projectId];
    if (!current) return s;
    return {
      entries: {
        ...s.entries,
        [projectId]: {
          ...current,
          extensions: current.extensions.map((e) =>
            e.id === extensionId ? { ...e, pinned: !e.pinned } : e,
          ),
        },
      },
    };
  });
}

export function invalidateBrowserMetadata(projectId: ProjectId): void {
  useBrowserMetadataStore.setState((s) => {
    const current = s.entries[projectId];
    if (!current) return s;
    return {
      entries: { ...s.entries, [projectId]: { ...current, status: "loading" } },
    };
  });
}
