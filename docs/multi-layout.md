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
- **Persisted:** Written to `localStorage` alongside other UI state (sidebar expansion, project order, and board context).
- **Read on hydration:** `hydratePersistedUiState()` restores the last-used mode and saved board state.

Both `_chat.$threadId.tsx` and `_chat.index.tsx` check `viewMode` and render `ManagementView` instead of `ChatView` when in `"management"` mode.

## Thread ↔ Board Relationship

Board mode still lives inside the chat routes, so the active thread remains the source of truth for project context.

- In `/_chat/$threadId`, the board project is derived from the selected thread's `projectId`.
- In `/_chat/`, Board mode restores the persisted board project when it is still valid and otherwise falls back to the first ordered project.
- Board context is stored once as a **global management board context**.
- Same-project thread switches do **not** change board routing, scroll, or ticket detail.
- Cross-project thread switches while Board mode is open reset the board to the new thread's project root.
- Thread creation, fork, decompose, and managed-run `Ask AI` flows do not clone board context anymore.
- If a project has no saved board context, the board opens at that project's root.

This means the board and the right-hand chat panel are intentionally coupled:

- the chat thread chooses the active project
- the board restores the last relevant board state for the active project
- the board must never render a ticket from a different project than the active thread
- assistant-authored ticket links like `[T3CO-191](t3://ticket/T3CO-191)` use one shared navigation path that switches to Board mode when needed and opens that ticket's detail panel

## Board Context Model

Board mode persists a small global management context in `uiStateStore`:

- `projectId` — the project the saved board state belongs to
- `ticketStack` — ordered drill-down path for ticket detail navigation
- `boardScrollLeft` — horizontal scroll position for the root board columns view
- `updatedAt` — timestamp for the most recent board-context write

Sanitization rules:

- if the saved `projectId` does not match the active thread's project, the saved context is discarded and replaced with that project's board root
- if a ticket in `ticketStack` no longer exists, it is removed
- if the top ticket becomes invalid, the stack collapses back to the nearest valid ancestor, or to the board root if none remain
- no-thread Board mode does not restore ticket detail

## State Ownership

- **Route** owns the active thread identity.
- **Route** derives the active board project from that thread.
- **`uiStateStore`** owns the persisted global management board context.
- **`useTicketing`** owns ticket fetches, project-scoped ticket lists, and live ticket stream updates.
- **`KanbanBoard`** renders from route context, project ticket data, and the saved board context.
- **`KanbanTicketDetail`** is only valid when the top-of-stack ticket still belongs to the active project.

## ManagementView

`ManagementView` is the layout shell for Board mode. It renders:

1. A `SidebarInset` containing the `KanbanBoard` (main content area).
2. A nested `SidebarProvider` + `Sidebar` on the right for the chat panel (resizable, collapsible via `offcanvas`).
3. A `DndContext` wrapping both areas so drag-and-drop can cross from board to chat.

`ManagementView` still receives both `threadId` and `projectId`:

- `projectId` defines which ticket data is valid to render
- `threadId` is still used by the right-side chat/composer panel
- changing projects realigns the board; changing same-project threads does not

### Nested SidebarProvider

The right chat panel uses a second `SidebarProvider` nested inside the outer one (which powers the left thread sidebar). Key details:

- The inner wrapper overrides `className` with `w-auto min-h-0 flex-none` so it sizes to content rather than filling the viewport.
- Each sidebar has its own `storageKey` for persisted width (`chat_thread_sidebar_width` vs `management_chat_sidebar_width`).
- CSS custom properties (`--sidebar-width`) are scoped to each wrapper via inline styles, so they don't conflict.

### Resize Guard

The `SidebarRail` resize logic includes a guard (`sidebar.tsx`) that skips `ResizeObserver` and window-resize revalidation while a drag is active (`resizeStateRef.current !== null`). Without this, the inner wrapper's `w-auto` sizing causes the observer to fire during drag, fighting with the user's resize input.

## Kanban Board

### Components

| Component                   | File                            | Purpose                                                                                                                                                                                      |
| --------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KanbanBoard`               | `KanbanBoard.tsx`               | Groups tickets by status, sorts by `sortOrder`, renders columns. Exposes `handleDragEnd` via `forwardRef`/`useImperativeHandle`.                                                             |
| `KanbanColumn`              | `KanbanColumn.tsx`              | Single status column. Wraps cards in `SortableContext` with `verticalListSortingStrategy`. The column body is a `useDroppable` target for cross-column drops.                                |
| `KanbanCard`                | `KanbanCard.tsx`                | Ticket card using `useSortable`. Shows identifier, title, priority dot, labels. Fades when dragging (`opacity-40`).                                                                          |
| `KanbanCardOverlay`         | `KanbanCard.tsx`                | Lightweight drag preview rendered inside `DragOverlay`.                                                                                                                                      |
| `KanbanTicketDetail`        | `KanbanTicketDetail.tsx`        | Full ticket detail view (status/priority selectors, description, acceptance criteria, labels, dependencies, sub-tickets, comments, history). Replaces the board area when a card is clicked. |
| `ComposerTicketAttachments` | `ComposerTicketAttachments.tsx` | Removable chips rendered in the chat composer when tickets are dropped on the chat panel.                                                                                                    |

### Data Flow

Tickets are fetched and managed by the `useTicketing` hook:

- **Fetch:** `api.ticketing.list({ projectId })` on mount and when `projectId` changes.
- **Real-time:** Subscribes to `api.ticketing.onEvent()` stream, filters by `selectedProjectId`, applies `ticket_upserted` and `ticket_deleted` events.
- **Project sync:** A `useEffect` syncs the hook's internal `selectedProjectId` when the caller-supplied `projectId` prop changes (handles TanStack Router keeping components mounted across thread switches).
- **Optimistic reorder:** `applyLocalReorder()` updates local ticket sort orders and statuses immediately, since the server's `reorder` endpoint does not emit stream events.

Board state itself is **not** owned by `useTicketing`. `KanbanBoard` reads ticket data from `useTicketing`, then overlays the global management board context from `uiStateStore`:

- root board view uses the saved `boardScrollLeft`
- ticket detail uses the saved `ticketStack`
- same-project thread switches preserve the board context
- invalid stored context is sanitized against the current project's ticket list before detail renders

### Sub-ticket Promotion

The ticket detail view supports promoting sub-tickets to top-level board tickets without changing the current route or board context:

- the hamburger menu shows `Move to board` when the currently opened ticket is a sub-ticket
- sub-ticket rows inside a parent ticket support a right-click context menu for `Move to board`
- when multiple sub-tickets are selected, right-clicking one of the selected rows offers `Move all tickets to the board`
- promoting a sub-ticket removes its `parentId`, keeps its current status, refreshes the current detail view in place, and lets the normal ticket stream update the rest of the board

Sub-ticket rows also share one fixed hover preview surface across the flat list, recursive tree, and orchestration confirmation page. The preview opens near the first hovered row, can be resized from its bottom-right corner, can be dragged from its bottom-left handle, and reuses the same persisted size/position for all ticket previews. While the preview is open, hovering between rows swaps only the body content; the shell does not re-anchor or resize from content, so long descriptions stay clipped inside the internal scroll area.

### Sort Order Strategy

After `arrayMove`, sort orders are reassigned as `index * 1000` for each ticket in the affected column. This gives clean integer ordering with room for future insertions.

## Drag-and-Drop

Built on `@dnd-kit` (already used in the file explorer and sidebar).

### Setup

- `DndContext` lives in `ManagementView`, wrapping both the board and the chat panel.
- `PointerSensor` with `distance: 5` activation constraint distinguishes clicks from drags.
- `pointerWithin` collision detection handles nested containers and cross-boundary targets.

### Drop Targets

| Target      | ID Pattern        | Behavior                                             |
| ----------- | ----------------- | ---------------------------------------------------- |
| Column body | `column:<status>` | Drop on empty area or after last card.               |
| Ticket card | `<ticketId>`      | Reorder within column or move to this card's column. |
| Chat panel  | `chat-composer`   | Insert ticket as a composer attachment.              |

### Drag-End Logic

The `handleBoardDragEnd` handler in `KanbanBoard` (exposed via ref to `ManagementView`) handles three cases:

1. **Same-column reorder:** `arrayMove` + `applyLocalReorder` + `api.ticketing.reorder()`.
2. **Cross-column move:** Splice into target column + `applyLocalReorder` (with status) + `api.ticketing.update()` (status change) + `api.ticketing.reorder()` (sort orders).
3. **Drop on chat:** Delegates to `onDropOnChat` callback, which calls `composerDraftStore.addTicketAttachment()`.

## Ticket Composer Attachments

When a ticket is dropped on the chat panel, it becomes a structured attachment in the composer draft:

```typescript
interface ComposerTicketAttachment {
  id: string; // ticket.id
  identifier: string; // e.g. "TCO-1"
  title: string;
}
```

- **Storage:** `ticketAttachments: ComposerTicketAttachment[]` in `ComposerThreadDraftState`.
- **Rendering:** `ComposerTicketAttachments` component renders removable chips (ticket icon + identifier + title + X button), following the `ComposerCodeSnippets` pattern.
- **Resolution at send:** `formatTicketAttachmentsForModel()` converts to `Ticket ids: TCO-1, TCO-2` and includes it in the message preamble alongside skill and code-snippet blocks.
- **Cleanup:** Cleared by `clearComposerContent()` after send.

## Switching Examples

- **Thread A, project X, ticket detail `X-12` → create or reuse Thread B in project X:** the board stays on `X-12` because same-project thread changes no longer affect board routing.
- **Thread A, project X, ticket detail `X-12` → Thread C, project Y:** the board resets to project Y's board root.
- **No active thread (`/_chat/`):** Board mode uses the persisted board project if available, otherwise the first ordered project, and renders the board root only.

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
