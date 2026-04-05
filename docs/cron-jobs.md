# T3 Cron Jobs

Cron Jobs let T3 Code schedule recurring tasks that automatically create new threads on a cron schedule. Jobs can preload a prompt and/or skill into the thread, with optional auto-send.

## Overview

The system has five main moving parts:

1. **Job definitions** — persisted in SQLite with a cron expression, job type, and type-specific config.
2. **Scheduler** — a background fiber that ticks every 30s, checks for due jobs, and fires them.
3. **MCP server** — an HTTP endpoint that AI providers call to list, create, propose, toggle, and run jobs.
4. **Injected system prompt** — tells the AI model about cron jobs so it uses the MCP tools.
5. **Web UI** — Settings > Cron Jobs tab for CRUD, detail page with run history, and interactive proposal cards in chat.

```
┌───────────────────────────────────────────────┐
│  AI Provider (Claude Code / Codex)            │
│  System prompt tells it to use MCP tools      │
└──────────────┬────────────────────────────────┘
               │ HTTP POST /mcp/cron-jobs
               ▼
┌───────────────────────────────────────────────┐
│  MCP Server (JSON-RPC)                        │
│  Tools: list, get, create, update, delete,    │
│  toggle, run_now, list_runs, propose          │
└──────────────┬────────────────────────────────┘
               │
     ┌─────────┴─────────┐
     ▼                   ▼
  CronJobService      Orchestration
  (CRUD, scheduler,   (thread.create
   run execution,      command dispatch)
   duplicate check)
     │
     │ PubSub → WebSocket push
     ▼
┌───────────────────────────────────────────────┐
│  Web Client (React)                           │
│  CronJobsPanel, ProposeCronJobCard, toasts    │
└───────────────────────────────────────────────┘
```

---

## Job Schema

```typescript
CronJob {
  jobId: CronJobId           // UUID
  name: string               // "Daily Health Check"
  description: string | null
  cronExpression: string     // "0 9 * * *" (standard 5-field cron)
  enabled: boolean
  jobType: "new_thread"      // extensible — only type for now
  newThreadConfig: {
    projectId: ProjectId
    skillId?: string         // optional skill to attach
    prompt?: string          // optional prompt to preload
    autoSend: boolean        // if true, sends the prompt automatically
  } | null
  createdAt: string          // ISO 8601
  updatedAt: string
  lastRunAt: string | null
  nextRunAt: string | null   // computed from cronExpression, null if disabled
}
```

Defined in `packages/contracts/src/cronJobs.ts`.

## Run Schema

Each job execution creates a run record:

```typescript
CronThreadRun {
  runId: CronThreadRunId
  jobId: CronJobId
  status: "created" | "skipped" | "failed"
  threadId: ThreadId | null  // nullable — thread can be deleted
  errorMessage: string | null
  scheduledAt: string        // when the job was supposed to fire
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

- Service interface: `apps/server/src/persistence/Services/CronJobs.ts`
- Layer implementation: `apps/server/src/persistence/Layers/CronJobs.ts`
- SQLite `enabled` column is INTEGER (0/1); the layer converts to boolean via `toPersistedJob()`.
- `newThreadConfig` is stored as a JSON string; the `CronJobRow` schema uses `Schema.fromJsonString` for decoding.

---

## CronJobService

Service interface: `apps/server/src/cronJobs/Services/CronJobs.ts`
Layer implementation: `apps/server/src/cronJobs/Layers/CronJobs.ts`

### Dependencies

- `CronJobRepository` — persistence
- `OrchestrationEngineService` — dispatches `thread.create` commands
- `ProjectionSnapshotQuery` — resolves project defaults, checks thread existence for duplicate prevention

### Scheduler

Embedded in the service layer (not a separate reactor). On layer initialization:

1. **Catch-up**: Queries `listEnabledDueJobs(now)` and executes any missed jobs (at most one per job).
2. **Tick loop**: `Effect.forever(executeDueJobs(now), delay(30s))` forked into a `workerScope`.

### Job Execution (`executeJob`)

1. Fetch the job.
2. **Duplicate prevention**: Get latest run. If `status === "created"` and `threadId` is set, check if the thread still exists in the read model and has zero user messages. If so → create a `skipped` run and return.
3. **Execute**: For `new_thread` type:
   - Generate new `ThreadId` and `CommandId`.
   - Resolve project defaults (model selection) from snapshot.
   - Dispatch `thread.create` orchestration command.
   - Create run record with `status: "created"`.
4. Update `job.lastRunAt` and recompute `job.nextRunAt` via `cron-parser`.
5. Publish `job_fired` event via PubSub.

### Cron Expression Parsing

Uses the `cron-parser` npm package (`CronExpressionParser.parse()`). The `computeNextRunAt()` helper returns the next occurrence as an ISO string, or `null` if the expression is invalid.

---

## MCP Server

HTTP endpoint at `POST /mcp/cron-jobs`.

### Implementation

`apps/server/src/cronJobs/http.ts`

Same Effect bridge pattern as managed runs (`createEffectBridge()`). All tool handlers are wrapped in try-catch with `isError: true` returns on failure.

### Authentication

Reuses managed runs token resolution — `ManagedRunService.resolveContextForToken(token)`. Dev bypass via `t3-dev-bypass` bearer token with `projectId`/`threadId` query params.

### Tools

| Tool                 | Purpose                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `list_cron_jobs`     | List all scheduled cron jobs.                                                                |
| `get_cron_job`       | Get details of a specific job by ID.                                                         |
| `create_cron_job`    | Create a new job directly (no user review).                                                  |
| `update_cron_job`    | Update an existing job.                                                                      |
| `delete_cron_job`    | Delete a job and all its run history.                                                        |
| `toggle_cron_job`    | Enable or disable a job.                                                                     |
| `run_cron_job_now`   | Manually trigger a job.                                                                      |
| `list_cron_job_runs` | List run history for a job.                                                                  |
| `propose_cron_job`   | Propose a job. Returns JSON that the AI must include as a ` ```t3:propose-cron ` code block. |

### MCP config injection into providers

When a provider session starts and the thread belongs to a project:

- **Claude adapter** (`apps/server/src/provider/Layers/ClaudeAdapter.ts`): Adds `t3_cron_jobs` to `mcpServers` config alongside `t3_managed_runs`, auto-allows `mcp__t3_cron_jobs__*` tools, appends system prompt.
- **Codex adapter** (`apps/server/src/provider/Layers/CodexAdapter.ts`): Sets `mcp_servers.t3_cron_jobs.url` and `http_headers.Authorization` via config overrides, appends system prompt.

---

## Injected System Prompt

`apps/server/src/cronJobs/systemPrompt.ts`

Appended to both Claude and Codex sessions alongside the managed runs prompt. Instructs the model to use `propose_cron_job` for user-reviewed creation and `create_cron_job` for direct creation.

---

## Web UI

### Settings Pages

- **List page**: `apps/web/src/components/settings/CronJobsPanel.tsx` — shows all jobs with name, human-readable schedule, enabled toggle, last run time. Route: `/settings/cron`.
- **Detail page**: `apps/web/src/components/settings/CronJobDetailPanel.tsx` — job metadata, prompt preview, Edit/Run Now/Delete buttons, run history table with thread links. Route: `/settings/cron/$jobId`.
- **Add/Edit dialog**: `apps/web/src/components/settings/CronJobDialog.tsx` — form with name, description, cron expression, Type selector, Project dropdown, Skill dropdown, Prompt textarea, Auto send toggle.
- **Sidebar nav**: `apps/web/src/components/settings/SettingsSidebarNav.tsx` — "Cron Jobs" tab with ClockIcon.
- **Routes**: `apps/web/src/routes/settings.cron.tsx` (layout), `settings.cron.index.tsx` (list), `settings.cron.$jobId.tsx` (detail).

### Propose Card (Chat)

- **Parser**: `apps/web/src/lib/proposeCronJobParser.ts` — detects `language-t3:propose-cron` code blocks, parses JSON payload.
- **Card**: `apps/web/src/components/chat/ProposeCronJobCard.tsx` — interactive card with editable name/description/cron/prompt, project dropdown, Accept/Reject buttons.
- **Wiring**: `ChatMarkdown.tsx` → `MessagesTimeline.tsx` → `ChatView.tsx` (`handleProposeCronJob`).

See [Chat Model-to-User Prompts](chat-model-to-user-prompts.md) for the full data flow.

### RPC Client

- `apps/web/src/wsRpcClient.ts` — `cronJobs` namespace with 8 unary methods + `onEvent` subscription.
- `apps/web/src/wsNativeApi.ts` — delegates to RPC client.
- Contracts: `packages/contracts/src/rpc.ts` (9 RPCs), `packages/contracts/src/ipc.ts` (NativeApi).

---

## Server Wiring

In `apps/server/src/server.ts`:

- `CronJobRepositoryLive` provides persistence.
- `CronJobServiceLive` provides the service (with embedded scheduler).
- Both are wired into `RuntimeDependenciesLive` with `OrchestrationEngineLive` + `OrchestrationProjectionSnapshotQueryLive` as dependencies.
- `cronJobsMcpRouteLayer` is registered in `makeRoutesLayer`.
- RPC handlers in `apps/server/src/ws.ts` under `WS_METHODS.cronJobs*`.
- Test mock in `apps/server/src/server.test.ts` via `Layer.succeed(CronJobService, {...})`.
