import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { isElectron } from "../env";
import { orderItemsByPreferredIds } from "../components/Sidebar.logic";
import { ManagementView } from "../components/management/ManagementView";
import { CollapsedSidebarTrigger } from "../components/ui/sidebar";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import { resolveInitialManagementProjectId } from "./chatIndex";

export function ChatIndexRouteView() {
  const viewMode = useUiStateStore((store) => store.viewMode);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const managementBoardProjectId = useUiStateStore(
    (store) => store.managementBoardContext?.projectId ?? null,
  );
  const projects = useStore((store) => store.projects);
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: (project) => project.id,
      }),
    [projectOrder, projects],
  );
  const initialProjectId = resolveInitialManagementProjectId({
    orderedProjectIds: orderedProjects.map((project) => project.id),
    managementBoardProjectId,
  });

  if (viewMode === "management" && initialProjectId) {
    return <ManagementView threadId={null} projectId={initialProjectId} />;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground/40">
      {!isElectron && (
        <header className="border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <CollapsedSidebarTrigger className="size-7 shrink-0" />
            <span className="text-sm font-medium text-foreground">Threads</span>
          </div>
        </header>
      )}

      {isElectron && (
        <div className="drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-5">
          <CollapsedSidebarTrigger className="size-7 shrink-0" />
          <span className="text-xs text-muted-foreground/50">No active thread</span>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm">Select a thread or create a new one to get started.</p>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
