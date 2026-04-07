import type { ThreadId, TicketSummary } from "@t3tools/contracts";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useRef, useState } from "react";

import ChatView from "../ChatView";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "../ui/sidebar";
import { useComposerDraftStore } from "../../composerDraftStore";
import { KanbanBoard, type KanbanBoardHandle } from "./KanbanBoard";
import { KanbanCardOverlay } from "./KanbanCard";

const MANAGEMENT_CHAT_SIDEBAR_WIDTH_STORAGE_KEY = "management_chat_sidebar_width";
const MANAGEMENT_CHAT_DEFAULT_WIDTH = "clamp(25rem,40vw,38rem)";
const MANAGEMENT_CHAT_MIN_WIDTH = 400;

interface ManagementViewProps {
  threadId: ThreadId | null;
  projectId: string;
}

function ChatDropTarget({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "chat-composer" });

  return (
    <div ref={setNodeRef} className="relative flex h-full w-full flex-col">
      {children}
      {isOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-primary/5 ring-2 ring-inset ring-primary/30">
          <span className="rounded-md bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
            Drop to reference in chat
          </span>
        </div>
      )}
    </div>
  );
}

export function ManagementView({ threadId, projectId }: ManagementViewProps) {
  const [activeDragTicket, setActiveDragTicket] = useState<TicketSummary | null>(null);
  const boardRef = useRef<KanbanBoardHandle>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDropOnChat = useCallback(
    (ticket: TicketSummary) => {
      if (!threadId) return;
      useComposerDraftStore.getState().addTicketAttachment(threadId, {
        id: ticket.id,
        identifier: ticket.identifier,
        title: ticket.title,
      });
    },
    [threadId],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const ticket = (event.active.data.current as { ticket?: TicketSummary })?.ticket;
    if (ticket) {
      setActiveDragTicket(ticket);
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragTicket(null);
    boardRef.current?.handleDragEnd(event);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragTicket(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <KanbanBoard ref={boardRef} projectId={projectId} onDropOnChat={handleDropOnChat} />
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
          <ChatDropTarget>
            {threadId ? (
              <ChatView threadId={threadId} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground/40">
                  Select a thread or create a new one.
                </p>
              </div>
            )}
          </ChatDropTarget>
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>
      <DragOverlay dropAnimation={null}>
        {activeDragTicket ? <KanbanCardOverlay ticket={activeDragTicket} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
