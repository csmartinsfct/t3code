# T3 Agent Tools

How T3 Code exposes project services (managed runs, scheduled tasks, ticketing) to AI provider sessions.

## Overview

T3 Code runs three internal MCP servers that AI models can use during conversations:

| Service         | Endpoint               | Tools | Purpose                                                        |
| --------------- | ---------------------- | ----- | -------------------------------------------------------------- |
| Managed Runs    | `/mcp/managed-runs`    | ~8    | Start/stop/monitor dev servers, build watchers, docker compose |
| Scheduled Tasks | `/mcp/scheduled-tasks` | ~9    | Recurring cron-based task automation                           |
| Ticketing       | `/mcp/ticketing`       | 26    | Project tickets, labels, comments, dependencies, artifacts     |

Each endpoint speaks the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) over HTTP using JSON-RPC 2.0. Authentication uses a per-session Bearer token issued via `managedRunService.issueMcpAccess()`.

The chat composer's MCP picker also mirrors provider-side config on disk so the UI reflects what a session should be able to use:

- Codex: global `~/.codex/config.toml` plus project-scoped `.codex/config.toml`
- Claude: profile/global `.claude.json` plus project-local `.mcp.json`

For Codex, project-scoped config is still gated by Codex project trust. T3 Code now auto-trusts the active project path by writing the matching `[projects."<cwd>"] trust_level = "trusted"` entry into `~/.codex/config.toml` before resolving Codex MCP servers and before starting Codex sessions, so repo-local MCP config works without any manual terminal setup.

---

## Delivery Modes

The `mcpDeliveryMode` server setting (Settings > General > "MCP delivery") controls **how** these services reach the AI model. This enables A/B testing between two approaches.

### Native Tools (`"tools"` — default)

All three MCP servers are registered as native tool sets in the provider session. Each tool appears individually in the model's tool list.

**How it works:**

- **Codex**: MCP servers added via `configOverrides` (e.g. `mcp_servers.t3_managed_runs.url="..."`)
- **Claude**: MCP servers added via `mcpServers` option + `allowedTools` glob patterns (`mcp__t3_managed_runs__*`, etc.)
- **System prompt**: Per-service prompts appended explaining tool usage (`MANAGED_RUNS_SYSTEM_PROMPT`, `SCHEDULED_TASKS_SYSTEM_PROMPT`, `TICKETING_SYSTEM_PROMPT`)

**Trade-offs:**

- (+) Model has direct tool access — no extra round-trip
- (+) Tool schemas visible in context — model knows exact inputs
- (-) 43+ tools injected upfront — context overhead even when unused
- (-) Each new service adds more tools to every conversation

### HTTP Endpoints (`"prompt"`)

No MCP tools are registered. Instead, the system prompt provides endpoint URLs, the auth token, and MCP JSON-RPC protocol examples. The model uses `curl` / code execution to discover and call tools on demand.

**How it works:**

- **Codex**: No `configOverrides` for MCP servers. System prompt injected via `appendDeveloperInstructions`
- **Claude**: No `mcpServers` or `allowedTools`. System prompt injected via `systemPrompt.append`
- **System prompt**: Unified prompt from `buildMcpPromptModeSystemPrompt()` with endpoint table, token, and `tools/list` / `tools/call` curl examples

**Trade-offs:**

- (+) Zero tool bloat — model context stays clean
- (+) On-demand discovery — model only loads tools it needs via `tools/list`
- (+) Adding new services just requires a prompt update, not adapter changes
- (-) Extra round-trip for tool discovery (model must `curl tools/list` first)
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
       │   Register 3 MCP servers as native tools       │
       │   Append per-service system prompts             │
       │                                                 │
       ├── "prompt" ────────────────────────────────────┐│
       │   No MCP server registration                   ││
       │   Append unified prompt with endpoints + token  ││
       │                                                 ││
       ▼                                                 ▼▼
 Provider session starts (Codex or Claude)
```

### Token Lifecycle

1. `managedRunService.issueMcpAccess(projectId, threadId)` generates a Bearer token
2. Token is scoped to the project + thread
3. In "tools" mode: token is set in MCP server HTTP headers
4. In "prompt" mode: token is embedded in the system prompt text
5. All three MCP endpoints validate the token on each request

### Condition Gate

MCP injection (in either mode) only happens when:

- Thread has an active project context (checkpoint context exists)
- Server is listening (`serverConfig.port > 0`)

If either condition is false, no MCP services are exposed to the model.

---

## File Map

```
packages/contracts/src/settings.ts                     # McpDeliveryMode type + ServerSettings field
apps/server/src/provider/mcpPromptModeSystemPrompt.ts   # "prompt" mode system prompt builder
apps/server/src/managedRuns/systemPrompt.ts             # Managed runs "tools" mode prompt
apps/server/src/scheduledTasks/systemPrompt.ts          # Scheduled tasks "tools" mode prompt
apps/server/src/ticketing/systemPrompt.ts               # Ticketing "tools" mode prompt
apps/server/src/provider/Layers/CodexAdapter.ts         # Codex injection (both modes)
apps/server/src/provider/Layers/ClaudeAdapter.ts        # Claude injection (both modes)
apps/web/src/components/settings/SettingsPanels.tsx      # UI toggle in General settings
```

---

## Adding a New Service

To add a new MCP service to both delivery modes:

1. Create the MCP HTTP endpoint (e.g. `/mcp/new-service`)
2. Create a `systemPrompt.ts` for "tools" mode
3. **CodexAdapter**: Add `configOverrides` entries in the `"tools"` branch
4. **ClaudeAdapter**: Add entry to `mcpServersConfig` and `mcpAllowedTools` in the `"tools"` branch
5. Concatenate the new system prompt in both adapters' `"tools"` branch
6. The `"prompt"` mode prompt (`mcpPromptModeSystemPrompt.ts`) picks up the new endpoint automatically if you add it to the services table — update the table and description there
7. No UI changes needed — the setting toggle works for all services
