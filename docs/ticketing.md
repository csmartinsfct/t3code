# T3 Ticketing

Ticketing adds project management capabilities to T3 Code — tickets with hierarchy (parent/child for epics), dependencies with cycle detection, project-scoped labels, threaded comments (human + LLM), polymorphic artifacts, acceptance criteria with verification tracking, full audit history, and ticket-to-thread relationships.

Assistant replies can also reference tickets with internal markdown links like `[T3CO-191](t3://ticket/T3CO-191)`. In chat surfaces, clicking one of those links uses the shared ticket navigation flow: if the app is still in Chat mode it switches to Board mode first, then opens that ticket in the current project's board.

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
| `ticket_thread_links` | Ticket ↔ thread relationship rows for origin, explicit thread binding, and mentions   |

### Key Columns on `projection_projects`

| Column               | Purpose                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| `next_ticket_number` | Auto-incrementing counter for ticket numbering (atomic allocation)           |
| `ticket_prefix`      | Optional custom prefix; if null, derived from first 4 chars of project title |

### Ticket Identifiers

Each ticket gets a human-readable identifier like `T3CO-42` composed of `{prefix}-{number}`. The prefix is derived from the project title (or set explicitly via `ticket_prefix`). Identifiers are unique within a project, not globally across all projects. Numbers are allocated atomically inside a SQLite transaction.

### Ticket-To-Thread Relationships

Tickets can be linked to threads in three ways:

- `origin`
  The ticket was created from inside that thread via the ticketing MCP server.
- `bound`
  The thread was explicitly associated to the ticket through `thread.ticketId`.
- `mention`
  A user or assistant message in the thread contains the canonical ticket identifier, case-insensitively.

`mention` links are stored per message so the projection pipeline can reconcile them during streaming updates and remove them when messages are deleted. Ticket detail queries currently read only the origin-thread link and show its origin-link timestamp inline.

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
  implementerModelOverride: ModelSelection | null  // per-ticket implementer model override
  reviewerModelOverride: ModelSelection | null      // per-ticket reviewer model override
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

Promoting a sub-ticket back to a top-level board ticket is modeled as a normal ticket update with `parentId: null`. That promotion preserves the ticket's existing status and sort order unless a separate update changes them.

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

### Automated Review Orchestration

When an orchestration run is created with `maxReviewIterations > 0`, the server creates a paired child-thread layout per ticket:

- a working thread for implementation turns
- a review thread for automated review turns

When `maxReviewIterations === 0`, the server creates only the working thread for each ticket and does not create a review thread at all. Each ticket entry in the orchestration run plan always stores `workingThreadId` and stores `reviewThreadId` only when automated review is enabled. After a successful work turn, the runner either completes the ticket immediately when review is disabled, or moves the ticket to `in_review`, executes the review thread with the ticket context and working-thread diff, and then:

- marks the ticket `done` when the review returns `changesNeeded: false`
- moves the ticket back to `in_progress` with structured feedback when changes are requested and review budget remains
- marks the ticket `blocked` and pauses the orchestration run when review output is invalid or the review budget is exhausted
- pauses the orchestration run with `orchestration.run.prompt.render.failed` when the effective prompt document for `implement`, `resume`, `resumeFreshAgent`, `review`, `reReview`, or `reviewFeedback` cannot be validated or rendered

The chat UI uses that explicit `reviewThreadId` identity, when present, to keep working and review child threads grouped together in the thread switcher, show review iteration state in the orchestration header, and render structured `ReviewOutput` responses as review cards instead of raw JSON. The orchestration parent thread title now tracks the currently selected ticket title rather than building a combined `"Orchestrate: ..."` label, and orchestration chat headers render a clickable ticket badge next to the thread title or `Timeline` so the current ticket can always be opened directly in Board view. The orchestration timeline itself stays chronological across parent milestones plus working/review child-thread messages, but it still presents those messages in the familiar Implementer/Reviewer section blocks. As chronology switches between implementation and review, the UI starts a new section block instead of naively dumping an entire thread at once, so implementer follow-ups can appear between review passes without changing the overall visual design. Orchestration-generated prompt messages are intentionally hidden from that timeline using explicit message metadata rather than message-text heuristics; the same prompt messages still remain visible inside the underlying child threads for full-history inspection.

When a run is paused, the orchestration header exposes two resume paths:

- `Resume` continues with the current child session as-is
- `Resume with fresh agent` keeps the same working/review child thread identity for the current ticket, but interrupts and discards the current provider session before resuming so the next turn starts on a fresh agent session

Fresh-agent resume is intentionally session-scoped rather than thread-scoped. The orchestration timeline and thread switcher continue to show the original child thread for the ticket instead of creating a replacement "rerun" thread.

Fresh-agent prompt behavior is phase-aware:

- fresh-agent resume of a working turn renders `resumeFreshAgent`
- fresh-agent resume of a review turn renders the full `review` prompt again
- normal `Resume` keeps using the lightweight `resume` prompt

On full server restart, persisted orchestration runs can still read as `running` even though no live runner survives the shutdown. Startup recovery handles that in two ways:

- when `settings.resumeAgentsOnStartup` is enabled, the server automatically re-enters the same orchestration resume path used by the Resume action
- when startup auto-resume is disabled or fails, the sidebar shows a client-only `Was working` marker until the user opens the affected thread or the client observes real live work again on that thread/run

Fresh review prompt behavior is also phase-aware:

- review iteration `1` renders `review` with the full working-thread diff
- review iteration `2+` renders `reReview`
- `reReview` receives the latest delta since the prior completed review pass and can also render the prior review summary when available

### Orchestration Prompt Templates

The orchestration runner now has a shared prompt-template domain model for its six logical prompt ids:

- `orchestration/implement`
- `orchestration/resume`
- `orchestration/resumeFreshAgent`
- `orchestration/review`
- `orchestration/reReview`
- `orchestration/reviewFeedback`

Prompt documents use this exact persisted shape:

```json
{
  "version": 1,
  "blocks": [
    {
      "when": null,
      "text": "Work on ticket ${ticketId}: ${ticketTitle}"
    },
    {
      "when": { "type": "exists", "variable": "acceptanceCriteria" },
      "text": "\nAcceptance criteria:\n${acceptanceCriteria}"
    }
  ]
}
```

Rules:

- `version` must be exactly `1`
- `blocks` render in array order
- `when: null` always renders
- v1 only supports `{ "type": "exists", "variable": "<canonicalKey>" }`
- block text supports `${variableName}` interpolation only
- aliases are normalized to canonical keys during validation/save
- validation returns structured errors with block context so the UI can identify the failing block

The canonical v1 variable registry lives in `packages/shared/src/promptTemplates.ts`. Shared ticket/project variables such as `ticketId`, `ticketTitle`, `ticketDescription`, `acceptanceCriteria`, `worktree`, `projectTitle`, and `projectPath` are available across the orchestration prompt ids. `commitDiff` and `reviewIteration` are available to both `review` and `reReview`; `reviewSummary` is available to `reReview` and `reviewFeedback`; and `reviewComments` remains scoped to `reviewFeedback`.

Global prompt storage is now server-authoritative through `settings.json`:

- `settings.prompts.orchestration.<promptId>` stores the current effective global prompt document for `implement`, `resume`, `resumeFreshAgent`, `review`, `reReview`, and `reviewFeedback`
- `settings.promptDefaults.orchestration.<promptId>` exposes the immutable shipped default document for the same ids
- persisted settings stay sparse by stripping prompt ids that match the shipped default exactly
- `server.updateSettings` accepts `null` for a prompt id in `settings.prompts.orchestration` to reset that prompt back to its shipped default

Projects can now also store sparse orchestration prompt overrides in the orchestration read model:

- `project.promptOverrides.orchestration.<promptId>` stores only the prompt ids explicitly overridden for that project
- supported project override ids are the same six orchestration prompt ids: `implement`, `resume`, `resumeFreshAgent`, `review`, `reReview`, and `reviewFeedback`
- clearing a project override removes that prompt id from project storage instead of copying any global/default value into the project row
- project payloads continue to expose `promptOverrides` separately from server settings so consumers can distinguish stored project overrides from the currently effective prompt document

Effective prompt resolution is:

1. project override
2. current global prompt from `settings.prompts`
3. immutable shipped default from `settings.promptDefaults`

The runner resolves, validates, and renders the effective prompt document at dispatch time for every new orchestration turn. That means resumed runs, later `reReview` turns, and later review-feedback turns always use the current effective document for that prompt id instead of reusing text captured when the run first started.

If validation or rendering fails at dispatch time, the runner does not fall back to hardcoded user-facing prompt text. Instead, it appends an `orchestration.run.prompt.render.failed` activity with the affected prompt id and pauses the run so the prompt document can be fixed before execution continues.

The shipped defaults now distinguish first-pass review (`review`) from later verification passes (`reReview`). `review` remains the first-pass review prompt, while `reReview` is used for review iteration `2+` and is designed for checking the latest fixes against prior review findings.

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

Both `create_ticket` and `update_ticket` accept optional `implementerModel` and `reviewerModel` parameters to set per-ticket orchestration model overrides. Each is an object with `{ provider, model, profileId? }`. Pass `null` on `update_ticket` to clear an override.

All tools are authenticated via the managed run token system (same as scheduled tasks). Dev bypass token `t3-dev-bypass` works with `?projectId=` query param.

When the ticketing MCP server is injected into a live thread session, the request context also carries `threadId`. `create_ticket` uses that server-side context to persist an `origin` link automatically; `originThreadId` is not exposed as a public MCP tool argument.

The ticketing service also seeds a small set of global labels and description templates on startup when they do not already exist. The shipped defaults now include the `idea` label plus an `Idea` template for early-stage exploration work alongside the existing `bug`, `feature`, and `research` defaults.

### MCP Delivery Modes

The `mcpDeliveryMode` server setting (Settings > General > MCP delivery) controls how these tools reach the AI model:

- **`"tools"` (Native tools)**: All three MCP servers (managed-runs, scheduled-tasks, ticketing) are registered as native tool sets. Each tool appears individually in the model's tool list. System prompts explain usage.
- **`"prompt"` (HTTP endpoints)**: No MCP tools are registered. Instead, the system prompt provides the HTTP endpoint URLs, a Bearer auth token, and MCP JSON-RPC protocol examples. The model uses `curl` / code execution to discover tools via `tools/list` and call them via `tools/call` on demand.

---

## WebSocket RPC (29 methods)

All ticket operations are exposed as WebSocket RPC methods under the `ticketing.*` namespace, plus `subscribeTicketingEvents` for real-time streaming. The stream is global (no project filter) — clients filter by `projectId` on each event.

Relationship reads use a dedicated RPC:

- `ticketing.getThreadLinks({ ticketId })`
  Returns `{ ticketId, originThread }` without inflating the core `Ticket` payload.

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
| `KanbanTicketDetail`       | `KanbanTicketDetail.tsx`       | Ticket detail panel with origin-thread section             |
| `ticketUtils`              | `ticketUtils.ts`               | Status/priority color maps, date formatters                |

### Ticket Detail Thread Sections

The ticket detail panel shows a single thread relationship section when data exists:

- `Origin Thread`
  The earliest surviving `origin` link for the ticket.

Behavior:

- archived threads stay visible and show an `Archived` badge
- orchestration/review threads also show a `Review` badge
- the row shows the origin-link time inline with a clock icon
- deleted threads are filtered out at read time
- orchestration/review threads show a `Review` badge
- clicking any thread row navigates to that thread, even when the row is currently hidden from the sidebar
- inline timestamps reflect the chosen link time for the row, not the thread's own update time

### Data Hook

`useTicketing({ projectId? })` — fetches projects from orchestration snapshot, tickets from `api.ticketing.list()`, subscribes to real-time events. The hook syncs its internal project selection when the caller-supplied `projectId` changes. Current board/project selection is route- and UI-state-driven; it is not persisted via `?project=<id>` in the current web app.

`ticketing.getById({ id, projectId? })` accepts an optional `projectId` validation hint. When provided, the server treats a ticket from a different project as not found. Board mode uses this to prevent stale cross-project ticket detail state from executing actions against the wrong project.

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
