import type { ThreadId } from "@t3tools/contracts";

import ChatView from "../ChatView";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "../ui/sidebar";
import { KanbanBoard } from "./KanbanBoard";

const MANAGEMENT_CHAT_SIDEBAR_WIDTH_STORAGE_KEY = "management_chat_sidebar_width";
const MANAGEMENT_CHAT_DEFAULT_WIDTH = "clamp(25rem,40vw,38rem)";
const MANAGEMENT_CHAT_MIN_WIDTH = 400;

interface ManagementViewProps {
  threadId: ThreadId | null;
  projectId: string;
}

export function ManagementView({ threadId, projectId }: ManagementViewProps) {
  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <KanbanBoard projectId={projectId} />
      </SidebarInset>
      <SidebarProvider
        defaultOpen
        className="w-auto min-h-0 flex-none bg-transparent"
        style={{ "--sidebar-width": MANAGEMENT_CHAT_DEFAULT_WIDTH } as React.CSSProperties}
      >
        <Sidebar
          side="right"
          collapsible="offcanvas"
          className="border-l border-border bg-card text-foreground"
          resizable={{
            minWidth: MANAGEMENT_CHAT_MIN_WIDTH,
            storageKey: MANAGEMENT_CHAT_SIDEBAR_WIDTH_STORAGE_KEY,
          }}
        >
          {threadId ? (
            <ChatView threadId={threadId} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground/40">
                Select a thread or create a new one.
              </p>
            </div>
          )}
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>
    </>
  );
}
