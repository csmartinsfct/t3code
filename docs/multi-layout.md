# Multi-Layout (Board View)

T3 Code supports two main view modes: **Chat** (default) and **Board**. The Board view replaces the main content area with a Kanban ticket board while keeping a resizable chat panel on the right, enabling project management alongside AI conversations.

## Overview

The feature has four main parts:

1. **View mode state** — A `viewMode` (`"chat" | "management"`) persisted in `uiStateStore`, toggled via a sidebar pill.
2. **Management layout** — `ManagementView` renders a Kanban board as main content with a right-side resizable chat panel, wrapped in a `DndContext` for drag-and-drop.
3. **Kanban board** — Columns grouped by ticket status, sortable cards, ticket detail drill-down, and a create-ticket dialog.
4. **Drag-and-drop** — @dnd-kit-powered drag for reordering within columns, moving across columns (status change), and dropping tickets into the chat composer as structured attachments.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  AppSidebarLayout                                           │
│  ┌──────────┐  ┌─────────────────────────────────────────┐  │
│  │  Sidebar  │  │  Route content (_chat.$threadId)        │  │
│  │  (left)   │  │                                         │  │
│  │           │  │  viewMode === "chat"                     │  │
│  │  Thread   │  │    → ChatView (full width)              │  │
│  │  list     │  │                                         │  │
│  │           │  │  viewMode === "management"               │  │
│  │  Chat/    │  │    → ManagementView                     │  │
│  │  Board    │  │       ┌────────────┬──────────────┐     │  │
│  │  toggle   │  │       │ KanbanBoard│  Chat panel  │     │  │
│  │           │  │       │ (main)     │  (right      │     │  │
│  │  Settings │  │       │            │   sidebar)   │     │  │
│  │           │  │       └────────────┴──────────────┘     │  │
│  └──────────┘  └─────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## View Mode Toggle

The toggle lives in the sidebar footer (`Sidebar.tsx`) as a segmented control with "Chat" and "Board" buttons. State is managed by `uiStateStore`:

- **Type:** `ViewMode = "chat" | "management"`
- **Persisted:** Written to `localStorage` alongside other UI state (sidebar expansion, project order).
- **Read on hydration:** `hydratePersistedProjectState()` restores the last-used mode.

Both `_chat.$threadId.tsx` and `_chat.index.tsx` check `viewMode` and render `ManagementView` instead of `ChatView` when in `"management"` mode.

## ManagementView

`ManagementView` is the layout shell for Board mode. It renders:

1. A `SidebarInset` containing the `KanbanBoard` (main content area).
2. A nested `SidebarProvider` + `Sidebar` on the right for the chat panel (resizable, collapsible via `offcanvas`).
3. A `DndContext` wrapping both areas so drag-and-drop can cross from board to chat.

### Nested SidebarProvider

The right chat panel uses a second `SidebarProvider` nested inside the outer one (which powers the left thread sidebar). Key details:

- The inner wrapper overrides `className` with `w-auto min-h-0 flex-none` so it sizes to content rather than filling the viewport.
- Each sidebar has its own `storageKey` for persisted width (`chat_thread_sidebar_width` vs `management_chat_sidebar_width`).
- CSS custom properties (`--sidebar-width`) are scoped to each wrapper via inline styles, so they don't conflict.

### Resize Guard

The `SidebarRail` resize logic includes a guard (`sidebar.tsx`) that skips `ResizeObserver` and window-resize revalidation while a drag is active (`resizeStateRef.current !== null`). Without this, the inner wrapper's `w-auto` sizing causes the observer to fire during drag, fighting with the user's resize input.

## Kanban Board

### Components

| Component | File | Purpose |
| --------- | ---- | ------- |
| `KanbanBoard` | `KanbanBoard.tsx` | Groups tickets by status, sorts by `sortOrder`, renders columns. Exposes `handleDragEnd` via `forwardRef`/`useImperativeHandle`. |
| `KanbanColumn` | `KanbanColumn.tsx` | Single status column. Wraps cards in `SortableContext` with `verticalListSortingStrategy`. The column body is a `useDroppable` target for cross-column drops. |
| `KanbanCard` | `KanbanCard.tsx` | Ticket card using `useSortable`. Shows identifier, title, priority dot, labels. Fades when dragging (`opacity-40`). |
| `KanbanCardOverlay` | `KanbanCard.tsx` | Lightweight drag preview rendered inside `DragOverlay`. |
| `KanbanTicketDetail` | `KanbanTicketDetail.tsx` | Full ticket detail view (status/priority selectors, description, acceptance criteria, labels, dependencies, sub-tickets, comments, history). Replaces the board area when a card is clicked. |
| `ComposerTicketAttachments` | `ComposerTicketAttachments.tsx` | Removable chips rendered in the chat composer when tickets are dropped on the chat panel. |

### Data Flow

Tickets are fetched and managed by the `useTicketing` hook:

- **Fetch:** `api.ticketing.list({ projectId })` on mount and when `projectId` changes.
- **Real-time:** Subscribes to `api.ticketing.onEvent()` stream, filters by `selectedProjectId`, applies `ticket_upserted` and `ticket_deleted` events.
- **Project sync:** A `useEffect` syncs the hook's internal `selectedProjectId` when the caller-supplied `projectId` prop changes (handles TanStack Router keeping components mounted across thread switches).
- **Optimistic reorder:** `applyLocalReorder()` updates local ticket sort orders and statuses immediately, since the server's `reorder` endpoint does not emit stream events.

### Sort Order Strategy

After `arrayMove`, sort orders are reassigned as `index * 1000` for each ticket in the affected column. This gives clean integer ordering with room for future insertions.

## Drag-and-Drop

Built on `@dnd-kit` (already used in the file explorer and sidebar).

### Setup

- `DndContext` lives in `ManagementView`, wrapping both the board and the chat panel.
- `PointerSensor` with `distance: 5` activation constraint distinguishes clicks from drags.
- `pointerWithin` collision detection handles nested containers and cross-boundary targets.

### Drop Targets

| Target | ID Pattern | Behavior |
| ------ | ---------- | -------- |
| Column body | `column:<status>` | Drop on empty area or after last card. |
| Ticket card | `<ticketId>` | Reorder within column or move to this card's column. |
| Chat panel | `chat-composer` | Insert ticket as a composer attachment. |

### Drag-End Logic

The `handleBoardDragEnd` handler in `KanbanBoard` (exposed via ref to `ManagementView`) handles three cases:

1. **Same-column reorder:** `arrayMove` + `applyLocalReorder` + `api.ticketing.reorder()`.
2. **Cross-column move:** Splice into target column + `applyLocalReorder` (with status) + `api.ticketing.update()` (status change) + `api.ticketing.reorder()` (sort orders).
3. **Drop on chat:** Delegates to `onDropOnChat` callback, which calls `composerDraftStore.addTicketAttachment()`.

## Ticket Composer Attachments

When a ticket is dropped on the chat panel, it becomes a structured attachment in the composer draft:

```typescript
interface ComposerTicketAttachment {
  id: string;           // ticket.id
  identifier: string;   // e.g. "TCO-1"
  title: string;
}
```

- **Storage:** `ticketAttachments: ComposerTicketAttachment[]` in `ComposerThreadDraftState`.
- **Rendering:** `ComposerTicketAttachments` component renders removable chips (ticket icon + identifier + title + X button), following the `ComposerCodeSnippets` pattern.
- **Resolution at send:** `formatTicketAttachmentsForModel()` converts to `Ticket ids: TCO-1, TCO-2` and includes it in the message preamble alongside skill and code-snippet blocks.
- **Cleanup:** Cleared by `clearComposerContent()` after send.

## File Map

```
apps/web/src/
  components/
    management/
      ManagementView.tsx              # Layout shell: DndContext + board + chat panel
      KanbanBoard.tsx                 # Board with columns, drag-end handler, ticket detail
      KanbanColumn.tsx                # Single status column with SortableContext + droppable
      KanbanCard.tsx                  # Sortable ticket card + DragOverlay preview
      KanbanTicketDetail.tsx          # Full ticket detail view
      ComposerTicketAttachments.tsx   # Ticket attachment chips in composer
    AppSidebarLayout.tsx              # Outer sidebar layout + restore button
    Sidebar.tsx                       # Chat/Board toggle, collapse button
    ChatView.tsx                      # Ticket attachment rendering + send resolution
    ui/sidebar.tsx                    # ResizeObserver drag guard
  hooks/
    useTicketing.ts                   # Ticket fetch, stream, optimistic reorder
  composerDraftStore.ts               # ComposerTicketAttachment type + store methods
  uiStateStore.ts                     # ViewMode state + persistence
  routes/
    _chat.$threadId.tsx               # viewMode check → ManagementView
    _chat.index.tsx                   # viewMode check → ManagementView (no thread)
```
