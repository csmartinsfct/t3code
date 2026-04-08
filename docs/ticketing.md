# T3 Ticketing

Ticketing adds project management capabilities to T3 Code — tickets with hierarchy (parent/child for epics), dependencies with cycle detection, project-scoped labels, threaded comments (human + LLM), polymorphic artifacts, acceptance criteria with verification tracking, and full audit history.

## Overview

The system has five main moving parts:

1. **Contracts** — Effect/Schema definitions for all ticket types, inputs, errors, and stream events (`packages/contracts/src/ticketing.ts`).
2. **Persistence** — SQLite tables (7 tables + 2 ALTER columns on `projection_projects`) with repository layer.
3. **Business logic** — Service layer with epic status derivation, dependency cycle detection, comment threading enforcement, and history recording.
4. **MCP server** — an HTTP endpoint at `/mcp/ticketing` that AI providers call to manage tickets.
5. **Web UI** — Settings > Tickets page with list view, detail panel, comments, and history.

```
┌───────────────────────────────────────────────┐
│  AI Provider (Claude Code / Codex)            │
│  Uses MCP tools to create/manage tickets      │
└──────────────┬────────────────────────────────┘
               │ HTTP POST /mcp/ticketing
               ▼
┌───────────────────────────────────────────────┐
│  MCP Server (JSON-RPC)                        │
│  26 tools: tickets, labels, comments,         │
│  artifacts, dependencies, criteria, history   │
└──────────────┬────────────────────────────────┘
               │
     ┌─────────┴─────────┐
     ▼                   ▼
  TicketingService    TicketingRepository
  (business logic,    (SQLite persistence)
   epic status,
   cycle detection,
   history recording)
     │
     │ PubSub → WebSocket push
     ▼
┌───────────────────────────────────────────────┐
│  Web Client (React)                           │
│  TicketsPanel, TicketDetailPanel, comments    │
└───────────────────────────────────────────────┘
```

---

## Data Model

### Tables

| Table                 | Purpose                                                                               |
| --------------------- | ------------------------------------------------------------------------------------- |
| `tickets`             | Core ticket data — title, description, status, priority, sort order, parent reference |
| `labels`              | Project-scoped labels with name + color                                               |
| `ticket_labels`       | Many-to-many ticket ↔ label associations                                              |
| `ticket_dependencies` | Directed dependency edges between tickets (with self-reference CHECK)                 |
| `comments`            | Threaded comments — top-level and single-depth replies                                |
| `artifacts`           | Polymorphic attachments (figma_url, mermaid, image) on tickets or comments            |
| `ticket_history`      | Audit log — every mutation recorded with action, changes JSON, and performer          |

### Key Columns on `projection_projects`

| Column               | Purpose                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| `next_ticket_number` | Auto-incrementing counter for ticket numbering (atomic allocation)           |
| `ticket_prefix`      | Optional custom prefix; if null, derived from first 4 chars of project title |

### Ticket Identifiers

Each ticket gets a human-readable identifier like `T3CO-42` composed of `{prefix}-{number}`. The prefix is derived from the project title (or set explicitly via `ticket_prefix`). Numbers are allocated atomically inside a SQLite transaction.

---

## Ticket Schema

```typescript
Ticket {
  id: TicketId                              // UUID
  projectId: ProjectId
  parentId: TicketId | null                 // parent for epic/sub-ticket hierarchy
  ticketNumber: number                      // auto-incremented per project
  identifier: string                        // "T3CO-42"
  title: string
  description: string | null
  status: "backlog" | "todo" | "in_progress" | "blocked" | "in_review" | "done" | "canceled"
  priority: "none" | "low" | "medium" | "high" | "urgent"
  sortOrder: number                         // REAL for fractional indexing
  isArchived: boolean
  worktree: string | null                   // git worktree/branch name
  acceptanceCriteria: AcceptanceCriterion[] | null
  labels: Label[]
  dependencies: TicketDependency[]
  subTickets: TicketSummary[]
  comments: Comment[]
  artifacts: Artifact[]
  createdAt: string                         // ISO 8601
  updatedAt: string
}
```

---

## Business Logic

### Epic Status Derivation

When a child ticket's status changes, the parent (epic) status is automatically recalculated:

- Any child `in_progress` or `in_review` → parent becomes `in_progress`
- All children `done` → parent becomes `done`
- All children `canceled` → parent becomes `canceled`
- All children `done` or `canceled` → parent becomes `done`
- Otherwise → parent becomes `todo`

Propagation is recursive (up to 10 levels deep) — changing a grandchild can update grandparent.

### Dependency Cycle Detection

Before adding a dependency A → B, the system queries all transitive dependencies of B using a recursive CTE. If A appears in that set, the dependency would create a cycle and is rejected with a `DependencyCycleError` containing the cycle path as human-readable identifiers.

### Comment Threading

Comments support single-depth threading: top-level comments (`parentId === null`) can have replies, but replies cannot have replies. Attempting to reply to a reply fails with a `TicketingValidationError`.

### Acceptance Criteria Verification

Each criterion tracks `status` (pending/met/not_met), optional `reason`, and `verifiedBy`/`verifiedAt` metadata. The `updateCriterionStatus` API stamps the verifier and timestamp server-side — callers never provide these fields.

### History Recording

Every mutation records a `TicketHistoryEntry` with:

- `action` — one of 12 action types (created, updated, status_changed, dependency_added, label_added, comment_added, etc.)
- `changes` — JSON diff with `{ field: { old, new } }` for updates
- `performedBy` — caller identity ("user", "system", or author name for comments)

---

## MCP Tools (26)

**Tickets**: `list_tickets`, `get_ticket`, `create_ticket`, `update_ticket`, `delete_ticket`, `reorder_tickets`, `search_tickets`, `get_ticket_tree`

**Dependencies**: `set_ticket_dependencies`, `add_ticket_dependency`, `remove_ticket_dependency`

**Criteria**: `update_criterion_status`

**History**: `get_ticket_history`

**Labels**: `list_labels`, `create_label`, `update_label`, `delete_label`, `add_ticket_label`, `remove_ticket_label`

**Comments**: `list_ticket_comments`, `create_comment`, `update_comment`, `delete_comment`

**Artifacts**: `list_ticket_artifacts`, `create_artifact`, `delete_artifact`

All tools are authenticated via the managed run token system (same as scheduled tasks). Dev bypass token `t3-dev-bypass` works with `?projectId=` query param.

### MCP Delivery Modes

The `mcpDeliveryMode` server setting (Settings > General > MCP delivery) controls how these tools reach the AI model:

- **`"tools"` (Native tools)**: All three MCP servers (managed-runs, scheduled-tasks, ticketing) are registered as native tool sets. Each tool appears individually in the model's tool list. System prompts explain usage.
- **`"prompt"` (HTTP endpoints)**: No MCP tools are registered. Instead, the system prompt provides the HTTP endpoint URLs, a Bearer auth token, and MCP JSON-RPC protocol examples. The model uses `curl` / code execution to discover tools via `tools/list` and call them via `tools/call` on demand.

---

## WebSocket RPC (28 methods)

All ticket operations are exposed as WebSocket RPC methods under the `ticketing.*` namespace, plus `subscribeTicketingEvents` for real-time streaming. The stream is global (no project filter) — clients filter by `projectId` on each event.

### Stream Events

| Event              | Payload                                |
| ------------------ | -------------------------------------- |
| `ticket_upserted`  | `{ projectId, ticket: TicketSummary }` |
| `ticket_deleted`   | `{ projectId, ticketId }`              |
| `label_upserted`   | `{ label }`                            |
| `label_deleted`    | `{ labelId }`                          |
| `comment_upserted` | `{ ticketId, comment }`                |
| `comment_deleted`  | `{ ticketId, commentId }`              |

---

## Web UI

### Routes

| Route                         | Component           | Purpose                         |
| ----------------------------- | ------------------- | ------------------------------- |
| `/settings/tickets`           | `TicketsPanel`      | List view with project selector |
| `/settings/tickets/$ticketId` | `TicketDetailPanel` | Full ticket detail              |

### Key Components

| Component                  | File                           | Purpose                                                    |
| -------------------------- | ------------------------------ | ---------------------------------------------------------- |
| `TicketsPanel`             | `TicketsPanel.tsx`             | List view with project filter, real-time subscription      |
| `TicketCard`               | `TicketCard.tsx`               | Compact card with status/priority dots, labels, identifier |
| `TicketDetailPanel`        | `TicketDetailPanel.tsx`        | Full detail with inline status/priority dropdowns          |
| `CreateTicketDialog`       | `CreateTicketDialog.tsx`       | New ticket form with dynamic acceptance criteria           |
| `TicketAcceptanceCriteria` | `TicketAcceptanceCriteria.tsx` | Checkbox checklist with verification metadata              |
| `TicketComments`           | `TicketComments.tsx`           | Threaded comments with human/AI distinction                |
| `TicketHistory`            | `TicketHistory.tsx`            | Lazy-loaded collapsible audit timeline                     |
| `ticketUtils`              | `ticketUtils.ts`               | Status/priority color maps, date formatters                |

### Data Hook

`useTicketing({ projectId? })` — fetches projects from orchestration snapshot, tickets from `api.ticketing.list()`, subscribes to real-time events. The hook syncs its internal project selection when the caller-supplied `projectId` changes. Project selection persisted in URL search params (`?project=<id>`).

---

## File Map

```
packages/contracts/src/ticketing.ts              # Schemas, types, inputs, errors, events
apps/server/src/persistence/Migrations/025_Ticketing.ts  # SQLite migration
apps/server/src/persistence/Services/Ticketing.ts        # Repository interface
apps/server/src/persistence/Layers/Ticketing.ts          # Repository implementation
apps/server/src/ticketing/Services/Ticketing.ts          # Business logic interface
apps/server/src/ticketing/Layers/Ticketing.ts            # Business logic implementation
apps/server/src/ticketing/http.ts                        # MCP server + HTTP routes
apps/web/src/components/settings/Ticket*.tsx              # UI components
apps/web/src/components/settings/ticketUtils.ts          # Status/priority maps
apps/web/src/hooks/useTicketing.ts                       # Data hook
apps/web/src/routes/settings.tickets.*.tsx               # Route files
```
