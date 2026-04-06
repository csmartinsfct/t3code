# T3 Managed Runs

Managed Runs let T3 Code track long-running services (dev servers, docker compose, build watchers, etc.) with lifecycle management, log capture, and service health monitoring — instead of letting them disappear into raw terminal sessions.

## Overview

The system has four main moving parts:

1. **Actions** — saved project scripts (name + command + icon + declared services).
2. **MCP server** — an HTTP endpoint that AI providers call to list, launch, inspect, and propose runs.
3. **Injected system prompt** — tells the AI model about managed runs so it uses the MCP tools instead of raw `bash`.
4. **Web UI** — shows active runs, service health, completion toasts, and interactive proposal cards.

```
┌───────────────────────────────────────────────┐
│  AI Provider (Claude Code / Codex)            │
│  System prompt tells it to use MCP tools      │
└──────────────┬────────────────────────────────┘
               │ HTTP POST /mcp/managed-runs
               ▼
┌───────────────────────────────────────────────┐
│  MCP Server (JSON-RPC)                        │
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
  command: string      // "npm run dev", "docker compose up", etc.
  icon: "play" | "test" | "lint" | "configure" | "build" | "debug"
  runOnWorktreeCreate: boolean
  services?: DeclaredService[]  // services this command launches
}
```

Defined in `packages/contracts/src/orchestration.ts`.

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

## MCP Server

The managed runs MCP server is a stateless JSON-RPC endpoint at `POST /mcp/managed-runs`.

### Implementation

`apps/server/src/managedRuns/http.ts`

The server uses the `@modelcontextprotocol/sdk` and bridges async MCP tool callbacks into the Effect runtime via a work queue pattern (`createEffectBridge()`). This is necessary because MCP tool handlers run in async-land but managed run operations need the Effect fiber's SQLite connection scope.

### Authentication

Each provider session gets a short-lived bearer token via `managedRunService.issueMcpAccess(projectId, threadId)`. The token maps back to `{projectId, threadId}` when the MCP server receives a request.

### Tools

| Tool                     | Purpose                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `list_managed_runs`      | List active (and optionally historical) runs for the project. Check before launching to avoid duplicates.                       |
| `launch_project_script`  | Launch an action as a managed run. Fails if a run for the same script is already active.                                        |
| `get_managed_run`        | Get full metadata and evidence for a run (detected URLs, ports, docker info).                                                   |
| `get_managed_run_logs`   | Read timestamped log lines. Supports `stream` filter and `tailLines`.                                                           |
| `stop_managed_run`       | Stop an active run.                                                                                                             |
| `propose_project_script` | Propose a new action. Returns a JSON payload that the AI must include as a ` ```t3:propose-action ` code block in its response. |

### MCP config injection into providers

When a provider session starts and the thread belongs to a project:

- **Claude adapter** (`apps/server/src/provider/Layers/ClaudeAdapter.ts`): Passes `mcpServers` config with the `t3_managed_runs` server URL + bearer token, auto-allows `mcp__t3_managed_runs__*` tools, and appends the system prompt.
- **Codex adapter** (`apps/server/src/provider/Layers/CodexAdapter.ts`): Sets `mcp_servers.t3_managed_runs.url` and `http_headers.Authorization` via config overrides, and appends the system prompt via `appendDeveloperInstructions`.

---

## Injected System Prompt

`apps/server/src/managedRuns/systemPrompt.ts`

When MCP is configured, a system prompt section is appended to the AI's instructions:

1. Call `list_managed_runs` first to check what's already running.
2. Use `launch_project_script` for existing actions.
3. Use `propose_project_script` for new actions.
4. **Never** start long-running services via bash directly.
5. When proposing, **always** declare services with health checks.

The prompt includes examples for common patterns (npm run dev, docker compose, supabase start).

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

1. `launchProjectScript()` creates a run record in SQLite with status `"starting"`.
2. A PTY terminal (120x30) is spawned with the script command.
3. Environment variables injected: `T3CODE_PROJECT_ROOT`, `T3CODE_WORKTREE_PATH`.
4. Output is captured to an NDJSON log file (each line: `{timestamp, stream, line}`).
5. After a 1.5s startup grace period, status moves to `"running"`.
6. Evidence is collected: process PID, detected URLs/ports from output, docker containers.

### Log retention

Logs are retained for 48 hours (`LOG_RETENTION_MS`). A background fiber cleans up expired logs every hour.

---

## Service Health Checks

Managed runs now separate:

- `declaredServices`: immutable launch-time hints copied from the project action
- `runtimeServices`: LLM-inferred canonical targets for the live run

Declared services are still important because they provide validation hints and grounding context, but they are no longer treated as the source of truth for a running process. This is what makes dynamic ports and multiple worktrees safe to track independently.

### Health check types

| Type      | How it works                             | Timeout |
| --------- | ---------------------------------------- | ------- |
| `url`     | HTTP GET, any 2xx = healthy              | 5s      |
| `docker`  | `docker inspect` + check `State.Running` | 5s      |
| `port`    | TCP socket connect attempt               | 3s      |
| `command` | Shell exec, exit code 0 = healthy        | 10s     |

Implementation: `apps/server/src/managedRuns/healthCheck.ts`

### Polling

Inference runs once shortly after launch, using only that run's own logs plus declared-service context. Any inferred canonical target must be grounded in the run evidence before it is adopted.

After inference succeeds, health checks run every 12 seconds (`HEALTH_POLL_INTERVAL_MS`) against `runtimeServices[*].canonicalHealthCheck`. Status changes are stored in the database and published to connected clients via WebSocket.

The current flow is:

1. Launch snapshots declared services.
2. The run captures startup logs.
3. `ManagedRunInference` performs one structured LLM call.
4. Grounded runtime services become the live run view.
5. Ongoing polling validates those runtime services only.

---

## Web UI

### Runs Control (`ManagedRunsControl.tsx`)

A menu button in the toolbar showing:

- Run count badge
- List of active runs with status badges
- Per-runtime-service validation indicators (green/red/gray dots)
- Service summary (e.g. "2/3 services validated")
- Inference-aware secondary text when runtime targets are still pending or ungrounded
- Hover/focus stop affordance: the status pill swaps to a same-size stop button with confirmation before stopping the run

### Settings Runs Page (`/settings/runs`)

The Settings sidebar includes a new `Runs` page for inference inspection.

It shows:

- The latest inference attempts in a table
- Provider/model used for each inference
- Status (`ready`, `failed`, `ungrounded`)
- Resolved runtime-service count
- A detail panel with:
  - declared services snapshot
  - normalized payload
  - raw payload
  - grounding failures
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

- `snapshot` events on initial subscribe (seeds the run list)
- `upserted` events as runs change (status transitions, inference updates, validation updates)

---

## Key Files

| Area                      | Path                                                                | Purpose                                                                |
| ------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Contracts**             | `packages/contracts/src/orchestration.ts`                           | `ProjectScript`, `DeclaredService`, `ServiceHealthCheck` schemas       |
| **Contracts**             | `packages/contracts/src/managedRuns.ts`                             | `ManagedRunSummary`, `ManagedRunDetail`, `ManagedRunStreamEvent`, etc. |
| **MCP server**            | `apps/server/src/managedRuns/http.ts`                               | JSON-RPC endpoint with tool registrations                              |
| **System prompt**         | `apps/server/src/managedRuns/systemPrompt.ts`                       | Prompt injected into AI sessions                                       |
| **Health checks**         | `apps/server/src/managedRuns/healthCheck.ts`                        | URL/docker/port/command health check implementations                   |
| **Run inference**         | `apps/server/src/managedRuns/Layers/Inference.ts`                   | LLM-backed runtime-service inference + grounding                       |
| **Inference service**     | `apps/server/src/managedRuns/Services/Inference.ts`                 | Effect service contract for inference                                  |
| **Run service**           | `apps/server/src/managedRuns/Layers/ManagedRuns.ts`                 | Core run lifecycle: launch, track, poll, stop                          |
| **Run service interface** | `apps/server/src/managedRuns/Services/ManagedRuns.ts`               | Effect service interface                                               |
| **SQL layer**             | `apps/server/src/persistence/Layers/ManagedRuns.ts`                 | SQLite persistence for runs, evidence, and inference audit records     |
| **Provider injection**    | `apps/server/src/provider/Layers/ClaudeAdapter.ts`                  | MCP config + prompt injection for Claude                               |
| **Provider injection**    | `apps/server/src/provider/Layers/CodexAdapter.ts`                   | MCP config + prompt injection for Codex                                |
| **Runs UI**               | `apps/web/src/components/ManagedRunsControl.tsx`                    | Runs dropdown with service health                                      |
| **Runs settings UI**      | `apps/web/src/components/settings/RunsSettingsPanel.tsx`            | Read-only inference audit surface                                      |
| **Propose card**          | `apps/web/src/components/chat/ProposeActionCard.tsx`                | Interactive action proposal card                                       |
| **Propose parser**        | `apps/web/src/lib/proposeActionParser.ts`                           | Validates `t3:propose-action` code blocks                              |
| **Toasts**                | `apps/web/src/hooks/useManagedRunCompletionToasts.ts`               | Toast notifications + "Ask AI" on failure                              |
| **Event subscription**    | `apps/web/src/components/ChatView.tsx`                              | WebSocket subscribe + action accept handler                            |
| **Migrations**            | `apps/server/src/persistence/Migrations/020_ManagedRuns.ts`         | Initial managed_runs table                                             |
| **Migrations**            | `apps/server/src/persistence/Migrations/021_ManagedRunServices.ts`  | services_json column                                                   |
| **Migrations**            | `apps/server/src/persistence/Migrations/024_ManagedRunInference.ts` | declared/runtime service split + managed_run_inferences table          |
