# T3 Agent Tools

How T3 Code exposes project services (managed runs, scheduled tasks, ticketing, and prompt management) to AI provider sessions.

## Overview

T3 Code exposes four internal REST API services that AI models can use during conversations:

| Service         | Endpoint               | Tools | Purpose                                                        |
| --------------- | ---------------------- | ----- | -------------------------------------------------------------- |
| Managed Runs    | `/api/managed-runs`    | ~8    | Start/stop/monitor dev servers, build watchers, docker compose |
| Scheduled Tasks | `/api/scheduled-tasks` | ~9    | Recurring cron-based task automation                           |
| Ticketing       | `/api/ticketing`       | 26    | Project tickets, labels, comments, dependencies, artifacts     |
| Prompts         | `/api/prompts`         | 5     | Prompt definitions, validation, preview, and scoped updates    |

Managed runs, scheduled tasks, and ticketing can be injected into provider sessions as native tools. Prompt management is currently an explicit HTTP management surface for the UI and REST API workflows rather than a native provider toolset.

Each endpoint uses plain REST with a `{data, error}` response envelope. Authentication uses a per-session Bearer token issued via `managedRunService.issueMcpAccess()`.

Ticketing REST API sessions can also be scoped to a live thread. When a provider session has thread context, T3 injects `threadId` alongside `projectId` into the ticketing endpoint URL / auth context so server-side ticket creation can persist an origin-thread relationship without exposing any extra public tool arguments.

The chat composer's MCP picker also mirrors provider-side config on disk so the UI reflects what a session should be able to use:

- Codex: global `~/.codex/config.toml` plus project-scoped `.codex/config.toml`
- Claude: profile/global `.claude.json` plus project-local `.mcp.json`
- Gemini: user-level `<GEMINI_CLI_HOME>/settings.json` (default
  `~/.gemini/settings.json`) plus project-local `.gemini/settings.json`

For Codex, project-scoped config is still gated by Codex project trust. T3 Code now auto-trusts the active project path by writing the matching `[projects."<cwd>"] trust_level = "trusted"` entry into `~/.codex/config.toml` before resolving Codex MCP servers and before starting Codex sessions, so repo-local MCP config works without any manual terminal setup.

---

## Delivery Modes

The `mcpDeliveryMode` server setting (Settings > General > "MCP delivery") controls **how** these services reach the AI model. This enables A/B testing between two approaches.

### Native Tools (`"tools"` — default)

Managed runs, scheduled tasks, and ticketing are registered as native tool sets in the provider session. Each tool appears individually in the model's tool list.

**How it works:**

- **Codex**: REST API services added via `configOverrides` (e.g. `mcp_servers.t3_managed_runs.url="..."`)
- **Claude**: REST API services added via `mcpServers` option + `allowedTools` glob patterns (`mcp__t3_managed_runs__*`, etc.)
- **Gemini**: T3 Code injects a stdio MCP bridge through ACP `mcpServers` for
  internal project services.
- **System prompt**: Per-service prompts appended explaining tool usage (`MANAGED_RUNS_SYSTEM_PROMPT`, `SCHEDULED_TASKS_SYSTEM_PROMPT`, `TICKETING_SYSTEM_PROMPT`)

**Trade-offs:**

- (+) Model has direct tool access — no extra round-trip
- (+) Tool schemas visible in context — model knows exact inputs
- (-) 43+ tools injected upfront — context overhead even when unused
- (-) Each injected service adds more tools to every conversation

### HTTP Endpoints (`"prompt"`)

No native tools are registered. Instead, the system prompt provides REST endpoint URLs, the auth token, and request format examples. The model uses `curl` / code execution to discover and call tools on demand, including the explicit prompt-management endpoint.

**How it works:**

- **Codex**: No `configOverrides` for services. System prompt injected via `appendDeveloperInstructions`
- **Claude**: No `mcpServers` or `allowedTools`. System prompt injected via `systemPrompt.append`
- **Gemini**: ACP `session/new` and `session/load` do not accept a system-prompt
  field, so T3 sends service context as an ACP embedded-context resource on the
  first prompt. In native-tool sessions this context tells Gemini to prefer the
  registered T3 MCP tools while keeping REST endpoint details as fallback/API
  context. The Gemini resume cursor stores a context hash so unchanged resumed
  sessions are not repeatedly primed.
- **System prompt**: Unified prompt from `buildMcpPromptModeSystemPrompt()` with endpoint table, token, and `GET /api/<service>` / `POST {"tool":"...", "input":{...}}` curl examples

**Trade-offs:**

- (+) Zero tool bloat — model context stays clean
- (+) On-demand discovery — model only loads tools it needs via `GET /api/<service>`
- (+) Adding new services just requires a prompt update, not adapter changes
- (-) Extra round-trip for tool discovery (model must `GET` the endpoint first)
- (-) Depends on model having code execution capability

---

## Architecture

### Injection Flow

```
Thread start (with active project)
       │
       ▼
 Read mcpDeliveryMode from ServerSettings
       │
       ├── "tools" ─────────────────────────────────────┐
       │   Register native tool sets                     │
       │   Append per-service system prompts             │
       │                                                 │
       ├── "prompt" ────────────────────────────────────┐│
       │   No native tool registration                   ││
       │   Append unified prompt with endpoints + token  ││
       │                                                 ││
       ▼                                                 ▼▼
 Provider session starts (Codex, Claude, or Gemini)
```

### Token Lifecycle

1. `managedRunService.issueMcpAccess(projectId, threadId)` generates a Bearer token
2. Token is scoped to the project + thread
3. In "tools" mode: token is set in service HTTP headers
4. In "prompt" mode: token is embedded in the system prompt text
5. All REST endpoints validate the token on each request

For ticketing specifically, the validated session context may also include `threadId`. The ticketing REST route forwards that to the ticketing service so `create_ticket` can attach an `origin` ticket-thread link automatically.

Ticket replies now have a small internal-link contract for chat output: when an agent references a ticket in prose, it should use markdown like `[T3CO-191](t3://ticket/T3CO-191)`. The reminder is injected briefly through the ticketing prompts and through selected ticket tool discovery descriptions. Ticket tool call responses remain JSON-only so they stay predictable for agents and REST clients.

For prompts, managed-run bearer tokens are restricted to the issuing `projectId` and may only access project scope. Global prompt scope is only available through privileged contexts such as the dev bypass token.

### Condition Gate

Service injection (in either mode) only happens when:

- Thread has an active project context (checkpoint context exists)
- Server is listening (`serverConfig.port > 0`)

If either condition is false, no internal services are exposed to the model.

---

## File Map

```
packages/contracts/src/settings.ts                     # McpDeliveryMode type + ServerSettings field
apps/server/src/provider/mcpPromptModeSystemPrompt.ts   # "prompt" mode system prompt builder
apps/server/src/managedRuns/systemPrompt.ts             # Managed runs "tools" mode prompt
apps/server/src/scheduledTasks/systemPrompt.ts          # Scheduled tasks "tools" mode prompt
apps/server/src/ticketing/systemPrompt.ts               # Ticketing "tools" mode prompt
apps/server/src/prompts/http.ts                         # Prompt-management REST route
apps/server/src/ticketing/http.ts                       # Ticketing REST route + thread-aware request context
apps/server/src/provider/Layers/CodexAdapter.ts         # Codex injection (both modes)
apps/server/src/provider/Layers/ClaudeAdapter.ts        # Claude injection (both modes)
apps/web/src/components/settings/SettingsPanels.tsx      # UI toggle in General settings
```

---

## Adding a New Service

To add a new REST API service to both delivery modes:

1. Create the REST HTTP endpoint (e.g. `/api/new-service`)
2. Create a `systemPrompt.ts` for "tools" mode
3. **CodexAdapter**: Add `configOverrides` entries in the `"tools"` branch
4. **ClaudeAdapter**: Add entry to `mcpServersConfig` and `mcpAllowedTools` in the `"tools"` branch
5. Concatenate the new system prompt in both adapters' `"tools"` branch
6. The `"prompt"` mode prompt (`mcpPromptModeSystemPrompt.ts`) picks up the new endpoint automatically if you add it to the services table — update the table and description there
7. No UI changes needed — the setting toggle works for all services

If a service should stay HTTP-only, follow the same REST route and prompt-mode documentation path without adding native-tool registration in the provider adapters.
