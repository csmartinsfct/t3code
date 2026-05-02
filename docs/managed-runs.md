# T3 Managed Runs

Managed Runs let T3 Code track long-running services (dev servers, docker compose, build watchers, etc.) with lifecycle management, log capture, and service health monitoring — instead of letting them disappear into raw terminal sessions.

## Overview

The system has four main moving parts:

1. **Actions** — saved project scripts (name + command + icon + declared services).
2. **REST API** — an HTTP endpoint that AI providers call to list, launch, inspect, and propose runs.
3. **Injected system prompt** — tells the AI model about managed runs so it uses the available tools instead of raw `bash`.
4. **Web UI** — shows active runs, service health, completion toasts, and interactive proposal cards.

```
┌───────────────────────────────────────────────┐
│  AI Provider (Codex / Claude / Gemini)        │
│  Injected guidance tells it to use T3 tools   │
└──────────────┬────────────────────────────────┘
               │ POST /api/managed-runs
               ▼
┌───────────────────────────────────────────────┐
│  REST API ({data, error} envelope)            │
│  Tools: list, launch, get, logs, stop, propose│
└──────────────┬────────────────────────────────┘
               │
     ┌─────────┴─────────┐
     ▼                   ▼
  ManagedRunService   Orchestration
  (launch, track,     (persist actions
   health poll,        via event sourcing)
   log capture)
     │                   │
     └─────────┬─────────┘
               │ WebSocket push
               ▼
┌───────────────────────────────────────────────┐
│  Web Client (React)                           │
│  ManagedRunsControl, ProposeActionCard, toasts│
└───────────────────────────────────────────────┘
```

---

## Actions (Project Scripts)

An **action** is a saved script associated with a project. Actions are what the AI launches via `launch_project_script`.

### Schema

```typescript
ProjectScript {
  id: string           // kebab-case, auto-generated from name
  name: string         // "Dev Server", "Run Tests", etc.
  // Required for legacy actions; OMITTED for composite (where every service
  // carries its own command). Mixed shapes are rejected at write time.
  command?: string
  icon: "play" | "test" | "lint" | "configure" | "build" | "debug"
  runOnWorktreeCreate: boolean
  services?: DeclaredService[]
}

DeclaredService {
  name: string                     // human-readable, must be unique per script
  command?: string                 // composite-only: launches this service in its own PTY
  cwd?: string                     // optional per-service cwd override
  env?: Record<string, string>     // optional per-service env, layered on the run's env
  // Note: NO healthCheck field. T3 infers health checks from logs at runtime.
}
```

Defined in `packages/contracts/src/orchestration.ts`. Helpers `isCompositeProjectScript()` and `validateProjectScriptShape()` enforce the legacy-vs-composite split and reject duplicate service names within a composite script.

### Storage

Actions are persisted through the orchestration event-sourcing pipeline:

1. Client dispatches a `project.meta.update` command (with a `scripts` array).
2. The decider (`apps/server/src/orchestration/decider.ts`) produces a `project.meta-updated` event.
3. The projection pipeline persists scripts into the SQLite projection table.
4. The web client reduces `project.meta-updated` events into its in-memory store.

### How actions get created

There are two paths:

- **Manual:** The user configures actions directly through the project settings UI.
- **AI-proposed:** The AI calls `propose_project_script`, which renders an interactive card in chat where the user can review, edit, and accept/reject the proposal. On accept, the client dispatches `project.meta.update` and sends a confirmation message back to the AI: `"Action added: {name} (id: {id}, command: {command})"`.

---

## REST API

The managed runs REST API is a stateless endpoint at `POST /api/managed-runs`.

### Implementation

`apps/server/src/managedRuns/http.ts`

The server bridges async tool callbacks into the Effect runtime via a work queue pattern (`createEffectBridge()`). This is necessary because tool handlers run in async-land but managed run operations need the Effect fiber's SQLite connection scope.

### Authentication

Each provider session gets a short-lived bearer token via `managedRunService.issueMcpAccess(projectId, threadId)`. The token maps back to `{projectId, threadId}` when the REST endpoint receives a request.

### Tools

| Tool                     | Purpose                                                                                                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_managed_runs`      | List active (and optionally historical) runs for the project. Check before launching to avoid duplicates.                                                                                                                                                                          |
| `launch_project_script`  | Launch an action as a managed run. Fails if a run for the same script is already active.                                                                                                                                                                                           |
| `get_managed_run`        | Get full metadata and evidence for a run (detected URLs, ports, docker info).                                                                                                                                                                                                      |
| `get_managed_run_logs`   | Read timestamped log lines. Supports `stream` filter, `tailLines`, and an optional `serviceId` for composite runs (omit it to receive merged-by-timestamp lines across all services).                                                                                              |
| `stop_managed_run`       | Stop an active run.                                                                                                                                                                                                                                                                |
| `propose_project_script` | Propose a new action. Returns a JSON payload the AI must include as a ` ```t3:propose-action ` code block in its response. The endpoint rejects any service-level `healthCheck` outright (the system prompt instructs the AI not to author them; this endpoint enforces the rule). |

### Service config injection into providers

When a provider session starts and the thread belongs to a project:

- **Claude adapter** (`apps/server/src/provider/Layers/ClaudeAdapter.ts`): Passes `mcpServers` config with the `t3_managed_runs` server URL + bearer token, auto-allows `mcp__t3_managed_runs__*` tools, and appends the system prompt.
- **Codex adapter** (`apps/server/src/provider/Layers/CodexAdapter.ts`): Sets `mcp_servers.t3_managed_runs.url` and `http_headers.Authorization` via config overrides, and appends the system prompt via `appendDeveloperInstructions`.
- **Gemini adapter** (`apps/server/src/provider/Layers/GeminiAdapter.ts`): Injects the shared `t3-code` stdio MCP bridge through ACP `mcpServers` and primes service guidance through embedded context on the first turn.

---

## Injected System Prompt

The shipped default text lives in `packages/contracts/src/promptTemplates.ts` (constant `MANAGED_RUNS_DEFAULT_TEXT`); `apps/server/src/managedRuns/systemPrompt.ts` is a thin re-export that resolves to the configured prompt block.

The prompt instructs the AI to:

1. Call `list_managed_runs` first to discover both running runs and the project's `availableActions`.
2. Use `launch_project_script` for an existing action when the command/purpose matches; pass `cwd` if the user is working in a worktree.
3. Use `propose_project_script` for new actions.
4. Never start long-running services via bash directly.
5. Declare services by name only — **never** include a `healthCheck` field. T3 infers health checks from runtime logs.

It also documents the two valid action shapes and tells the AI to pick composite when per-service log separation matters:

- **Legacy single-process action** — top-level `command`, optional `services[]` as named metadata.
- **Composite multi-service action** — top-level `command` omitted, every entry in `services[]` carries its own `command`, `cwd?`, `env?`.

---

## Run Lifecycle

### States

```
starting → running → completed (exit 0)
                   → failed    (non-zero exit)
                   → stopped   (user/AI stopped it)
                   → lost      (process disappeared)
```

### Launch flow

1. `launchProjectScript()` validates the script shape, marks the runId as launching (`launchingRunsRef`), and creates the run record in SQLite with status `"starting"`.
2. One PTY terminal (120x30) is spawned per service — one for legacy runs, N for composite runs. All siblings share the run's `terminalThreadId`. If any open fails, every successfully-opened sibling is closed and the DB row is deleted before propagating the error (no leaked PTYs / orphan rows).
3. Environment variables injected: `T3CODE_PROJECT_ROOT`, `T3CODE_WORKTREE_PATH`. Per-service `cwd` and `env` overrides apply when set.
4. Each PTY's output is captured to an NDJSON log file: legacy → `<runId>.ndjson`, composite → `<runId>/<serviceId>.ndjson` (one file per service).
5. After a 1.5s startup grace period, status moves to `"running"`.
6. Evidence is collected: process PID per service, detected URLs/ports from output, docker containers.
7. Once `liveRunsRef` is registered the launching marker clears; subsequent orphan-cleanup events can act on the run safely.

### Restart trigger actions

Some actions are intentionally short-lived triggers rather than the service they affect. The
Electron dev restart action uses `scripts/restart-electron-dev.ts` to spawn a detached restart
supervisor and exit, so the same action can be launched again later. The supervisor then kills
existing repo-local Electron dev processes and starts `bun run dev:desktop` detached. This is useful
when agents working inside the Electron dev build need to restart the host process that is currently
running them; auto-resume can reconnect the session after the new build comes up.

### Log retention

Logs are retained for 48 hours (`LOG_RETENTION_MS`). A background fiber sweeps every hour and:

- Removes NDJSON files (legacy `<runId>.ndjson` and composite `<runId>/` directories alike) for runs whose `logsExpireAt` has passed.
- Sweeps expired MCP access tokens from the `(projectId, threadId)` map (24h TTL).

---

## Service Health Checks

Health checks are **inferred** by T3 from runtime logs — never authored by the user or the AI. Authoring surfaces (`ProjectScriptsControl`, `ProposeActionCard`, `propose_project_script`) do not surface a healthCheck field, and the propose REST endpoint rejects payloads that include one.

The model carries two service collections:

- `declaredServices`: immutable launch-time names copied from the project action.
- `runtimeServices`: canonical per-service entries for the live run, validated periodically.

Composite runs pre-populate `runtimeServices` from declared services at launch (`validationStatus: "unknown"`, `inferenceSource: "declared"`), so per-service log tabs render before inference returns. Inference then **enriches** those entries with LLM-canonicalised names, roles, and health checks when the model returns a schema-valid service. Legacy runs build `runtimeServices` purely from inference output.

### Health check types

| Type      | How it works                             | Timeout |
| --------- | ---------------------------------------- | ------- |
| `url`     | HTTP GET, any 2xx = healthy              | 5s      |
| `docker`  | `docker inspect` + check `State.Running` | 5s      |
| `port`    | TCP socket connect attempt               | 3s      |
| `command` | Shell exec, exit code 0 = healthy        | 10s     |

Implementation: `apps/server/src/managedRuns/healthCheck.ts`

### Inference + polling

`ManagedRunInference` performs **one** structured LLM call per run — same code path for legacy and composite. Actual structured-output request failures are retried twice with a short delay before the run records inference as failed. The call is fed the merged log across all services (legacy reads `<runId>.ndjson`; composite's `<runId>/` directory is auto-merged by `readNdjsonLines`) and the run's full `declaredServices` list. ANSI-styled terminal output is normalized before URL/port extraction so tools like Vite can be inferred reliably. The LLM proposes runtime services with canonical health checks; schema-valid health checks are adopted, then normal health validation determines whether those targets are reachable.

An empty useful inference result is not a failure. If the model returns no canonical runtime services, inference is recorded as `ready` with zero runtime services and no inference error; the UI simply has no inferred target to show. `failed` is reserved for failures in the inference request/runner itself.

For composite runs there's a small post-pass: each LLM-emitted runtime service carries a `declaredServiceName`, which we match against the run's declared services to look up the deterministic composite serviceId; that overrides the LLM's auto-slug so per-service tabs/streams line up. Any matched schema-valid service replaces its stub in `runtimeServices`; services the model omits or cannot express with a valid health check keep their stub so the per-service tab still renders. Hallucinated services with no matching declared name are dropped.

For legacy runs the LLM's runtime services are adopted as-is (no slug remap, no stubs to merge into).

A single audit record is written to `managed_run_inferences` per run, in both shapes.

After inference, health checks run every 12 seconds (`HEALTH_POLL_INTERVAL_MS`) against `runtimeServices[*].canonicalHealthCheck`. A run that goes "all unhealthy" transitions to `stopped` automatically. Status changes are persisted and pushed to clients via WebSocket.

---

## Web UI

### Runs Control (`ManagedRunsControl.tsx`)

A menu button in the toolbar showing:

- Run count badge
- List of active runs with status badges
- Per-runtime-service validation indicators (green/red/gray dots)
- Service summary (e.g. "2/3 services validated")
- Inference-aware secondary text when runtime targets are still pending or inference could not produce canonical services
- Hover/focus stop affordance: the status pill swaps to a same-size stop button with confirmation before stopping the run

### Settings Runs Page (`/settings/runs`)

The Settings sidebar includes a new `Runs` page for inference inspection.

It shows:

- The latest inference attempts in a table
- Provider/model used for each inference
- Status (`ready`, `failed`, `ungrounded`; `ungrounded` is retained for historical records)
- Resolved runtime-service count
- A detail panel with:
  - declared services snapshot
  - normalized payload
  - raw payload
  - inference failures
  - evidence excerpt

This page is intentionally read-only in v1. It is an audit surface, not a control surface.

### Propose Action Card (`ProposeActionCard.tsx`)

When the AI includes a ` ```t3:propose-action ` code block in its response, the markdown renderer detects it (via `isProposeActionBlock()` in `apps/web/src/lib/proposeActionParser.ts`) and renders an interactive card:

- Editable name and command fields
- Icon picker (play, test, lint, configure, build, debug)
- Declared services list with health check type icons
- Accept / Reject buttons

On accept:

1. The client dispatches `project.meta.update` with the new script added.
2. A confirmation message is injected: `"Action added: {name} (id: {id}, command: {command})"`.
3. The AI can then call `launch_project_script` to start it.

### Composite (multi-service) actions

A `ProjectScript` can declare multiple services that each run in their own subprocess. Each service has its own command and optional `cwd`/`env`. Each gets its own PTY and its own per-service NDJSON log file so the Run Logs Drawer can surface them as separate sub-tabs.

A script is **composite** when its top-level `command` is empty/omitted AND every entry in `services[]` carries its own `command`. Mixed shapes (top-level command AND any per-service command) are rejected by `validateProjectScriptShape` (`packages/contracts/src/orchestration.ts`). Duplicate service names within a composite script are also rejected — slugs are used as file names and tab keys, so collisions would alias each other. The launcher branches on `isCompositeProjectScript(script)`.

Composite runs:

- Spawn one PTY per service, all sharing the run's `terminalThreadId` (the `TerminalManager` keys terminals by `(threadId, terminalId)`).
- Persist logs to `~/.t3/{env}/logs/managed-runs/<projectId>/<runId>/<serviceId>.ndjson` (one file per service, rather than the legacy single `<runId>.ndjson`).
- Each `serviceId` is a stable slug derived from the service name (`slugifyServiceName` in `apps/server/src/managedRuns/utils.ts`), with collision-suffixing and the synthetic `"main"` reserved for legacy runs.
- Pre-populate `runtimeServices` with stubs at launch so per-service tabs render immediately; inference enriches each entry by serviceId once it returns.
- Aggregate run-level status from per-service exits: an explicit Stop transitions to `stopped` (any service that crashed during the stop is recorded on `lastError`); any non-zero exit without an intentional stop fails the run; all-zero exits complete it.

Legacy single-command runs are unchanged: one PTY, single `<runId>.ndjson`, inference fills `runtimeServices` from scratch.

#### Authoring composite actions

- **Settings UI** (`apps/web/src/components/ProjectScriptsControl.tsx`): each service row has an optional `Cmd` input. Filling it on any service flips the editor into composite mode (parent command field hidden). No health-check authoring surface — the field was removed entirely.
- **AI tool** (`propose_project_script`): accepts optional per-service `command`, `cwd`, `env`. Health-check fields are rejected with a clear error.
- **Propose card** (`apps/web/src/components/chat/ProposeActionCard.tsx`): renders `$ <command>` under each service row when composite.

### Run Logs Drawer (`RunLogsDrawer.tsx`)

A bottom-anchored drawer that shows live and historical NDJSON logs for managed runs opened from the active thread. Managed runs remain project-level, but drawer tabs are thread-scoped UI state, matching the terminal drawer: a tab opened in one thread does not appear in sibling threads or other projects. It mirrors the visual treatment of `ThreadTerminalDrawer` (border-t, top resize handle, xterm viewport) and stacks above it when both are open.

- Opened by clicking the hover-revealed `ScrollText` icon on each `RunCard` row in the Active Runs popover (see `ManagedRunsControl.tsx` → `RunLogsButton`). The clicked thread owns the opened logs tab; other threads stay closed until the user opens logs there too.
- Top tab strip: each opened run gets its own tab. Tabs show a state dot (green for `running`/`starting`, muted otherwise) and a hover-revealed `×` close. Tab labels are cached at open time so a tab keeps a meaningful name after the run is stopped or its action is deleted.
- For composite runs (≥2 declared services), a sub-strip below the tab strip exposes an `All` tab plus one tab per service. The `All` view interleaves per-service streams by timestamp and prefixes each line with `[<service-name>]` in a stable per-service ANSI colour (6-colour palette, indexed by `serviceId`). Per-service tabs render their own stream verbatim, no prefix.
- For single-service / legacy runs the sub-strip is hidden and the viewport binds directly to that one service's stream — no merged-view prefix.
- Inactive viewports stay mounted so switching tabs preserves accumulated buffers.
- Read-only xterm viewport (`disableStdin: true`); theme + fonts shared via `apps/web/src/components/terminal/xtermShared.ts`.
- Drawer height is independently resizable and persists in `localStorage` under `t3code:run-logs-drawer:height:v1`.
- State lives in `apps/web/src/runLogsDrawerStore.ts` (Zustand). Tabs are session-only and scoped per thread — they clear on page reload. The store also tracks each thread's active run tab and each run tab's active sub-tab (`activeServiceId`).
- Tabs remember the script they were opened for. If the user stops a run while its logs tab is open and starts the same script again, stale tabs in thread scopes that already had that tab are retargeted to the fresh `runId` so live logs resume instead of staying attached to the stopped process. Retargeting never creates tabs in unrelated threads.
- The drawer reacts to `removed` stream events (see [Orphan cleanup](#orphan-cleanup)): when a run's action is deleted, the corresponding tab closes immediately.

### Log streaming (`useManagedRunLogs`)

Each viewport uses the `useManagedRunLogs` hook (`apps/web/src/hooks/useManagedRunLogs.ts`) which:

1. Subscribes to live lines first via `managedRuns.subscribeLogs({ runId, serviceId? })`, then fetches the last 1000 historical lines via `managedRuns.getLogs` and writes them into the xterm instance.
2. Lines that arrive between the subscribe and historical fetch resolving are buffered (capped at 50,000 with FIFO eviction so a hung fetch can't grow the buffer unbounded), deduplicated by timestamp against the historical tail, and flushed in order so nothing is dropped or doubled.
3. `stderr` lines are tinted red. In merged-view mode (`serviceId === null` for a composite run) each line is prefixed with the service name in a stable ANSI colour.

Server-side, log appends publish to a per-`(runId, serviceId)` PubSub (eager-created at launch so subscribers that arrive before the first published line still see live events). The WebSocket method is `subscribeManagedRunLogs` (registered in `apps/server/src/ws.ts`) and emits `ManagedRunLogStreamEvent` records of `{ runId, serviceId, line }`. When `serviceId` is omitted on subscribe, the server merges per-service PubSubs for the run via `Stream.mergeAll`. For runs that are no longer live, the merge falls back to the persisted `runtimeServices[*].serviceId` from the DB row instead of the legacy synthetic id, so subscribers tailing a finished composite run see the right per-service streams.

### Completion Toasts (`useManagedRunCompletionToasts.ts`)

Subscribes to `ManagedRunStreamEvent` via WebSocket. When a run reaches a terminal state:

| Status    | Toast type | Behavior                         |
| --------- | ---------- | -------------------------------- |
| Failed    | Error      | Persistent, with "Ask AI" button |
| Completed | Success    | Auto-dismiss after 8s            |
| Stopped   | Info       | Auto-dismiss after 5s            |
| Lost      | Warning    | Auto-dismiss after 8s            |

The **"Ask AI" button** on failure toasts:

1. Fetches the last 50 log lines via `managedRuns.getLogs`.
2. Builds a prompt with the command, exit code, and output.
3. Creates a new thread with the prompt pre-filled.
4. Navigates to the new thread.

### WebSocket streaming

The client subscribes via `subscribeManagedRunEvents(projectId)` and receives:

- `snapshot` events on initial subscribe (seeds the run list).
- `upserted` events as runs change (status transitions, inference updates, validation updates).
- `removed` events when a run is fully torn down (orphan cleanup, manual removal). Subscribers must drop UI state for the run, including any open log-drawer tab.

For per-run log tailing, the client additionally subscribes via `subscribeManagedRunLogs({ runId, serviceId? })` and receives one `ManagedRunLogStreamEvent` per appended log line.

### Orphan cleanup

When the user (or AI) deletes an action from a project, every managed run that referenced that action becomes an orphan. T3 reacts to this **deterministically** via `OrphanRunsReactor` (`apps/server/src/managedRuns/Layers/OrphanRunsReactor.ts`):

1. The reactor subscribes to the orchestration engine's domain-event stream.
2. On every `project.meta-updated` event whose payload includes a `scripts` field, it calls `managedRuns.cleanupOrphansForProject(projectId)`.
3. That method walks all known runs for the project, skips any that are still mid-launch (tracked via `launchingRunsRef`), and tears down the rest via `removeRunAndPublish`.
4. `removeRunAndPublish` marks the run as `removing` (so terminal output buffered by node-pty can't recreate the log dir after delete), closes every PTY, deletes the DB row, removes the NDJSON file/directory, and publishes a `removed` stream event so the UI drops its tab immediately.

There is no polling. Cleanup latency is one event-loop tick from action deletion to tab disappearing.

---

## Key Files

| Area                      | Path                                                                | Purpose                                                                |
| ------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Contracts**             | `packages/contracts/src/orchestration.ts`                           | `ProjectScript`, `DeclaredService`, `ServiceHealthCheck` schemas       |
| **Contracts**             | `packages/contracts/src/managedRuns.ts`                             | `ManagedRunSummary`, `ManagedRunDetail`, `ManagedRunStreamEvent`, etc. |
| **REST API**              | `apps/server/src/managedRuns/http.ts`                               | REST endpoint with tool registrations                                  |
| **System prompt**         | `apps/server/src/managedRuns/systemPrompt.ts`                       | Prompt injected into AI sessions                                       |
| **Health checks**         | `apps/server/src/managedRuns/healthCheck.ts`                        | URL/docker/port/command health check implementations                   |
| **Run inference**         | `apps/server/src/managedRuns/Layers/Inference.ts`                   | LLM-backed runtime-service inference and evidence normalization        |
| **Inference service**     | `apps/server/src/managedRuns/Services/Inference.ts`                 | Effect service contract for inference                                  |
| **Run service**           | `apps/server/src/managedRuns/Layers/ManagedRuns.ts`                 | Core run lifecycle: launch, track, poll, stop, orphan cleanup          |
| **Run service interface** | `apps/server/src/managedRuns/Services/ManagedRuns.ts`               | Effect service interface                                               |
| **Orphan reactor**        | `apps/server/src/managedRuns/Layers/OrphanRunsReactor.ts`           | Subscribes to orchestration events; tears down runs on action delete   |
| **Slug helper**           | `apps/server/src/managedRuns/utils.ts`                              | `slugifyServiceName` shared between launcher and inference             |
| **SQL layer**             | `apps/server/src/persistence/Layers/ManagedRuns.ts`                 | SQLite persistence for runs, evidence, and inference audit records     |
| **Provider injection**    | `apps/server/src/provider/Layers/ClaudeAdapter.ts`                  | Service config + prompt injection for Claude                           |
| **Provider injection**    | `apps/server/src/provider/Layers/CodexAdapter.ts`                   | Service config + prompt injection for Codex                            |
| **Provider injection**    | `apps/server/src/provider/Layers/GeminiAdapter.ts`                  | ACP MCP bridge + embedded context injection for Gemini                 |
| **Runs UI**               | `apps/web/src/components/ManagedRunsControl.tsx`                    | Runs dropdown with service health                                      |
| **Runs settings UI**      | `apps/web/src/components/settings/RunsSettingsPanel.tsx`            | Read-only inference audit surface                                      |
| **Propose card**          | `apps/web/src/components/chat/ProposeActionCard.tsx`                | Interactive action proposal card                                       |
| **Propose parser**        | `apps/web/src/lib/proposeActionParser.ts`                           | Validates `t3:propose-action` code blocks                              |
| **Run logs drawer**       | `apps/web/src/components/RunLogsDrawer.tsx`                         | Bottom-anchored drawer with per-run tabs + per-service sub-tabs        |
| **Run logs store**        | `apps/web/src/runLogsDrawerStore.ts`                                | Zustand store: tabs, active run, active service, drawer height         |
| **Log streaming hook**    | `apps/web/src/hooks/useManagedRunLogs.ts`                           | Historical fetch + live subscribe with per-service ANSI prefixes       |
| **Toasts**                | `apps/web/src/hooks/useManagedRunCompletionToasts.ts`               | Toast notifications + "Ask AI" on failure                              |
| **Event subscription**    | `apps/web/src/components/ChatView.tsx`                              | WebSocket subscribe + action accept handler                            |
| **Migrations**            | `apps/server/src/persistence/Migrations/020_ManagedRuns.ts`         | Initial managed_runs table                                             |
| **Migrations**            | `apps/server/src/persistence/Migrations/021_ManagedRunServices.ts`  | services_json column                                                   |
| **Migrations**            | `apps/server/src/persistence/Migrations/024_ManagedRunInference.ts` | declared/runtime service split + managed_run_inferences table          |
