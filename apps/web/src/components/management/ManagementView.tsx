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
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useRef, useState } from "react";

import ChatView from "../ChatView";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "../ui/sidebar";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useTicketSelectionStore } from "../../ticketSelectionStore";
import { KanbanBoard, type KanbanBoardHandle } from "./KanbanBoard";
import { KanbanCardOverlay, KanbanMultiCardOverlay } from "./KanbanCard";

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
  const [activeDragTickets, setActiveDragTickets] = useState<TicketSummary[]>([]);
  const boardRef = useRef<KanbanBoardHandle>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Clear ticket selection when clicking on non-selectable areas
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (e.shiftKey || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-ticket-selectable]")) return;
      const store = useTicketSelectionStore.getState();
      if (store.selectedTicketIds.size > 0) store.clearSelection();
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, []);

  const handleDropOnChat = useCallback(
    (tickets: TicketSummary[]) => {
      if (!threadId) return;
      const store = useComposerDraftStore.getState();
      for (const ticket of tickets) {
        store.addTicketAttachment(threadId, {
          id: ticket.id,
          identifier: ticket.identifier,
          title: ticket.title,
        });
      }
      useTicketSelectionStore.getState().clearSelection();
    },
    [threadId],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const ticket = (event.active.data.current as { ticket?: TicketSummary })?.ticket;
    if (!ticket) return;

    const selStore = useTicketSelectionStore.getState();
    if (selStore.selectedTicketIds.has(ticket.id)) {
      setActiveDragTickets([...selStore.selectedTickets.values()]);
    } else {
      setActiveDragTickets([ticket]);
    }
    boardRef.current?.handleDragStart(event);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    boardRef.current?.handleDragOver(event);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragTickets([]);
    boardRef.current?.handleDragEnd(event);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragTickets([]);
    boardRef.current?.handleDragCancel();
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
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
        {activeDragTickets.length === 1 ? (
          <KanbanCardOverlay ticket={activeDragTickets[0]!} />
        ) : activeDragTickets.length > 1 ? (
          <KanbanMultiCardOverlay tickets={activeDragTickets} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
