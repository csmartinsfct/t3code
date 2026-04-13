# T3 Scheduled Tasks

Scheduled Tasks let T3 Code schedule recurring tasks that automatically create new threads on a cron schedule. Tasks can preload a prompt and/or skill into the thread, with optional auto-send.

## Overview

The system has five main moving parts:

1. **Task definitions** — persisted in SQLite with a cron expression, task type, and type-specific config.
2. **Scheduler** — a background fiber that ticks every 30s, checks for due tasks, and fires them.
3. **REST API** — an HTTP endpoint that AI providers call to list, create, propose, toggle, and run tasks.
4. **Injected system prompt** — tells the AI model about scheduled tasks so it uses the available tools.
5. **Web UI** — Settings > Scheduled Tasks tab for CRUD, detail page with run history, and interactive proposal cards in chat.

```
┌───────────────────────────────────────────────┐
│  AI Provider (Claude Code / Codex)            │
│  System prompt tells it to use REST API tools │
└──────────────┬────────────────────────────────┘
               │ POST /api/scheduled-tasks
               ▼
┌───────────────────────────────────────────────┐
│  REST API ({data, error} envelope)            │
│  Tools: list, get, create, update, delete,    │
│  toggle, run_now, list_runs, propose          │
└──────────────┬────────────────────────────────┘
               │
     ┌─────────┴─────────┐
     ▼                   ▼
  ScheduledTaskService Orchestration
  (CRUD, scheduler,   (thread.create
   run execution,      command dispatch)
   duplicate check)
     │
     │ PubSub → WebSocket push
     ▼
┌───────────────────────────────────────────────┐
│  Web Client (React)                           │
│  ScheduledTasksPanel, ProposeScheduledTaskCard, toasts    │
└───────────────────────────────────────────────┘
```

---

## Task Schema

```typescript
ScheduledTask {
  jobId: ScheduledTaskId           // UUID
  name: string               // "Daily Health Check"
  description: string | null
  cronExpression: string     // "0 9 * * *" (standard 5-field cron)
  enabled: boolean
  jobType: "new_thread"      // extensible — only type for now
  newThreadConfig: {
    projectId: ProjectId
    skillIds?: string[]      // optional skill IDs to attach (multi-select)
    prompt?: string          // optional prompt to preload
    autoSend: boolean        // if true, sends the prompt automatically
  } | null
  createdAt: string          // ISO 8601
  updatedAt: string
  lastRunAt: string | null
  nextRunAt: string | null   // computed from cronExpression, null if disabled
}
```

Defined in `packages/contracts/src/scheduledTasks.ts`.

## Run Schema

Each task execution creates a run record:

```typescript
ScheduledTaskRun {
  runId: ScheduledTaskRunId
  jobId: ScheduledTaskId
  status: "created" | "skipped" | "failed"
  threadId: ThreadId | null  // nullable — thread can be deleted
  errorMessage: string | null
  scheduledAt: string        // when the task was supposed to fire
  executedAt: string         // when it actually fired
}
```

---

## SQLite Tables

Migration: `apps/server/src/persistence/Migrations/023_CronJobs.ts`

### `crons_jobs`

| Column                 | Type          | Notes                        |
| ---------------------- | ------------- | ---------------------------- |
| job_id                 | TEXT PK       | UUID                         |
| name                   | TEXT NOT NULL |                              |
| description            | TEXT          | nullable                     |
| cron_expression        | TEXT NOT NULL | 5-field cron                 |
| enabled                | INTEGER       | 0/1                          |
| job_type               | TEXT          | "new_thread"                 |
| new_thread_config_json | TEXT          | JSON blob                    |
| created_at             | TEXT          | ISO 8601                     |
| updated_at             | TEXT          | ISO 8601                     |
| last_run_at            | TEXT          | nullable                     |
| next_run_at            | TEXT          | nullable, null when disabled |

### `crons_thread_runs`

| Column        | Type          | Notes                          |
| ------------- | ------------- | ------------------------------ |
| run_id        | TEXT PK       | UUID                           |
| job_id        | TEXT NOT NULL | references crons_jobs          |
| status        | TEXT NOT NULL | "created", "skipped", "failed" |
| thread_id     | TEXT          | nullable                       |
| error_message | TEXT          | nullable                       |
| scheduled_at  | TEXT NOT NULL | ISO 8601                       |
| executed_at   | TEXT NOT NULL | ISO 8601                       |

Indexes: `idx_crons_thread_runs_job (job_id, executed_at DESC)`, `idx_crons_jobs_enabled_due (enabled, next_run_at)`.

---

## Persistence Layer

- Service interface: `apps/server/src/persistence/Services/ScheduledTasks.ts`
- Layer implementation: `apps/server/src/persistence/Layers/ScheduledTasks.ts`
- SQLite `enabled` column is INTEGER (0/1); the layer converts to boolean via `toPersistedJob()`.
- `newThreadConfig` is stored as a JSON string; the `ScheduledTaskRow` schema uses `Schema.fromJsonString` for decoding.

---

## ScheduledTaskService

Service interface: `apps/server/src/scheduledTasks/Services/ScheduledTasks.ts`
Layer implementation: `apps/server/src/scheduledTasks/Layers/ScheduledTasks.ts`

### Dependencies

- `ScheduledTaskRepository` — persistence
- `OrchestrationEngineService` — dispatches `thread.create` commands
- `ProjectionSnapshotQuery` — resolves project defaults, checks thread existence for duplicate prevention

### Scheduler

Embedded in the service layer (not a separate reactor). On layer initialization:

1. **Catch-up**: Queries `listEnabledDueJobs(now)` and executes any missed tasks (at most one per task).
2. **Tick loop**: `Effect.forever(executeDueJobs(now), delay(30s))` forked into a `workerScope`.

### Task Execution (`executeJob`)

1. Fetch the task.
2. **Duplicate prevention**: Get latest run. If `status === "created"` and `threadId` is set, check if the thread still exists in the read model and has zero user messages. If so → create a `skipped` run and return.
3. **Execute**: For `new_thread` type:
   - Generate new `ThreadId` and `CommandId`.
   - Resolve project defaults (model selection) from snapshot.
   - Build `initialDraft` from config (prompt, skillIds, autoSend).
   - Dispatch `thread.create` orchestration command with `initialDraft`.
   - Create run record with `status: "created"`.
   - The web client auto-populates the composer (prompt + skills) when the thread is opened.
4. Update `job.lastRunAt` and recompute `job.nextRunAt` via `cron-parser`.
5. Publish `job_fired` event via PubSub.

### Cron Expression Parsing

Uses the `cron-parser` npm package (`CronExpressionParser.parse()`). The `computeNextRunAt()` helper returns the next occurrence as an ISO string, or `null` if the expression is invalid.

---

## REST API

HTTP endpoint at `POST /api/scheduled-tasks`.

### Implementation

`apps/server/src/scheduledTasks/http.ts`

Same Effect bridge pattern as managed runs (`createEffectBridge()`). All tool handlers are wrapped in try-catch with `isError: true` returns on failure.

### Authentication

Reuses managed runs token resolution — `ManagedRunService.resolveContextForToken(token)`. Dev bypass via `t3-dev-bypass` bearer token with `projectId`/`threadId` query params.

### Tools

| Tool                       | Purpose                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `list_scheduled_tasks`     | List all scheduled tasks.                                                                               |
| `get_scheduled_task`       | Get details of a specific task by ID.                                                                   |
| `create_scheduled_task`    | Create a new task directly (no user review).                                                            |
| `update_scheduled_task`    | Update an existing task.                                                                                |
| `delete_scheduled_task`    | Delete a task and all its run history.                                                                  |
| `toggle_scheduled_task`    | Enable or disable a task.                                                                               |
| `run_scheduled_task_now`   | Manually trigger a task.                                                                                |
| `list_scheduled_task_runs` | List run history for a task.                                                                            |
| `propose_scheduled_task`   | Propose a task. Returns JSON that the AI must include as a ` ```t3:propose-scheduled-task ` code block. |

### Service config injection into providers

When a provider session starts and the thread belongs to a project:

- **Claude adapter** (`apps/server/src/provider/Layers/ClaudeAdapter.ts`): Adds `t3_scheduled_tasks` to `mcpServers` config alongside `t3_managed_runs`, auto-allows `mcp__t3_scheduled_tasks__*` tools, appends system prompt.
- **Codex adapter** (`apps/server/src/provider/Layers/CodexAdapter.ts`): Sets `mcp_servers.t3_scheduled_tasks.url` and `http_headers.Authorization` via config overrides, appends system prompt.

---

## Injected System Prompt

`apps/server/src/scheduledTasks/systemPrompt.ts`

Appended to both Claude and Codex sessions alongside the managed runs prompt. Instructs the model to use `propose_scheduled_task` for user-reviewed creation and `create_scheduled_task` for direct creation.

---

## Web UI

### Settings Pages

- **List page**: `apps/web/src/components/settings/ScheduledTasksPanel.tsx` — shows all tasks with name, human-readable schedule, enabled toggle, last run time. Route: `/settings/scheduled-tasks`.
- **Detail page**: `apps/web/src/components/settings/ScheduledTaskDetailPanel.tsx` — task metadata, prompt preview, Edit/Run Now/Delete buttons, run history table with thread links. Route: `/settings/scheduled-tasks/$jobId`.
- **Add/Edit dialog**: `apps/web/src/components/settings/ScheduledTaskDialog.tsx` — form with name, description, cron expression, Type selector, Project dropdown, Skills multi-select combobox with chips, Prompt textarea, Auto send toggle.
- **Sidebar nav**: `apps/web/src/components/settings/SettingsSidebarNav.tsx` — "Scheduled Tasks" tab with ClockIcon.
- **Routes**: `apps/web/src/routes/settings.scheduled-tasks.tsx` (layout), `settings.scheduled-tasks.index.tsx` (list), `settings.scheduled-tasks.$jobId.tsx` (detail).

### Propose Card (Chat)

- **Parser**: `apps/web/src/lib/proposeScheduledTaskParser.ts` — detects `language-t3:propose-scheduled-task` code blocks, parses JSON payload.
- **Card**: `apps/web/src/components/chat/ProposeScheduledTaskCard.tsx` — interactive card with editable name/description/cron/prompt, project dropdown, Accept/Reject buttons.
- **Wiring**: `ChatMarkdown.tsx` → `MessagesTimeline.tsx` → `ChatView.tsx` (`handleProposeScheduledTask`).

See [Chat Model-to-User Prompts](chat-model-to-user-prompts.md) for the full data flow.

### RPC Client

- `apps/web/src/wsRpcClient.ts` — `scheduledTasks` namespace with 8 unary methods + `onEvent` subscription.
- `apps/web/src/wsNativeApi.ts` — delegates to RPC client.
- Contracts: `packages/contracts/src/rpc.ts` (9 RPCs), `packages/contracts/src/ipc.ts` (NativeApi).

---

## Server Wiring

In `apps/server/src/server.ts`:

- `ScheduledTaskRepositoryLive` provides persistence.
- `ScheduledTaskServiceLive` provides the service (with embedded scheduler).
- Both are wired into `RuntimeDependenciesLive` with `OrchestrationEngineLive` + `OrchestrationProjectionSnapshotQueryLive` as dependencies.
- `scheduledTasksMcpRouteLayer` is registered in `makeRoutesLayer`.
- RPC handlers in `apps/server/src/ws.ts` under `WS_METHODS.scheduledTasks*`.
- Test mock in `apps/server/src/server.test.ts` via `Layer.succeed(ScheduledTaskService, {...})`.
