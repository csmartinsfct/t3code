# T3 Agent Tools

How T3 Code exposes project services (managed runs, scheduled tasks, ticketing, browser automation, Dynamic Chat UI, prompt management, and session restart) to AI provider sessions.

## Overview

T3 Code exposes several internal REST API services that AI models can use during conversations:

| Service         | Endpoint               | Tools | Purpose                                                                                                                                                                                                                                                                             |
| --------------- | ---------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed Runs    | `/api/managed-runs`    | ~8    | Start/stop/monitor dev servers, build watchers, docker compose                                                                                                                                                                                                                      |
| Scheduled Tasks | `/api/scheduled-tasks` | ~9    | Recurring cron-based task automation                                                                                                                                                                                                                                                |
| Ticketing       | `/api/ticketing`       | 26    | Project tickets, labels, comments, dependencies, artifacts                                                                                                                                                                                                                          |
| Browser         | `/api/browser`         | 59    | Per-project browser automation with plaintext output and stable @ref element IDs. Defaults to Playwright headless Chromium; desktop projects that mount the embedded browser route to Electron `WebContentsView` through the CDP broker — see [browser-tools.md](browser-tools.md). |
| Prompts         | `/api/prompts`         | 5     | Prompt definitions, validation, preview, and scoped updates                                                                                                                                                                                                                         |
| Dynamic Chat UI | `/api/dynamic-chat-ui` | 1     | Generate experimental self-contained chat UI artifacts and insert them directly into the timeline through sandboxed iframes. See [dynamic-chat-ui.md](dynamic-chat-ui.md).                                                                                                          |
| Session Restart | `/api/session-restart` | 1     | Model-initiated stop+resume of its own agent session                                                                                                                                                                                                                                |

Each endpoint uses plain REST with a `{data, error}` response envelope. Authentication uses a per-session Bearer token issued via `managedRunService.issueMcpAccess()`.

Ticketing REST API sessions can also be scoped to a live thread. When a provider session has thread context, T3 injects `threadId` alongside `projectId` into the ticketing endpoint URL / auth context so server-side ticket creation can persist an origin-thread relationship without exposing any extra public tool arguments.

The chat composer's MCP picker reflects provider-side MCP availability:

- Codex: global `~/.codex/config.toml` plus project-scoped `.codex/config.toml`
- Claude: project-scoped live SDK status from `mcpServerStatus()`, loaded in the
  background for every enabled Claude profile in the project. The hidden status
  probe initializes Claude Code MCP state without yielding a user prompt or
  triggering model inference.
- Gemini: user-level `<GEMINI_CLI_HOME>/settings.json` (default
  `~/.gemini/settings.json`) plus project-local `.gemini/settings.json`
- Cursor: Cursor CLI `agent mcp list` from the project cwd, backed by
  user-level `<CURSOR_CONFIG_DIR>/mcp.json` (default `~/.cursor/mcp.json`) plus
  project-local `.cursor/mcp.json`. ACP mode does not use Cursor
  dashboard-configured MCP servers. When Cursor reports a server as needing
  approval or login, the composer exposes inline actions that call
  `agent mcp enable <identifier>` or `agent mcp login <identifier>` with the
  same resolved Cursor launch settings, then refreshes the visible status.

Codex profiles use profile-scoped homes. The base provider reads `~/.codex/config.toml`
unless `providers.codex.homePath` or `CODEX_HOME` overrides it; discovered profiles
such as `codex:metric` read `~/.codex-metric/config.toml` unless explicitly
configured in `providers.codexProfiles`. For Codex, project-scoped config is still
gated by Codex project trust. T3 Code now auto-trusts the active project path by
writing the matching `[projects."<cwd>"] trust_level = "trusted"` entry into the
active Codex home before resolving Codex MCP servers and before starting Codex
sessions, so repo-local MCP config works without any manual terminal setup.

---

## Delivery Path: REST via Shell

Every supported provider (Codex, Claude, Gemini, Cursor) reaches T3 services through the same prompt-injected REST path. The shared builder `buildT3ServiceInjectionPrompt` (in `apps/server/src/provider/sessionContextPrompt.ts`) assembles the environment header, the REST endpoint table, the per-session Bearer token, and the admin prompt documents. Each adapter hands this identical string to its CLI:

- **Codex**: appended through `appendDeveloperInstructions` at session start.
- **Claude**: appended through `systemPrompt.append` at session start.
- **Gemini**: sent as an ACP embedded-context resource on the first user turn (ACP `session/new` and `session/load` do not accept a system-prompt field). The session-context hash is stored on the resume cursor so the prompt is only re-injected when it actually changes between process runs.
- **Cursor**: prepended to the first ACP `session/prompt` text for the session.
  The session-context hash is stored on the Cursor resume cursor so unchanged
  service instructions are not re-injected after process restarts.

The model uses its native shell/bash tool to call `curl <ENDPOINT_URL>` with the token. No provider-specific MCP server registration is performed by T3 today. User-configured MCP servers remain visible and usable — they're read from the provider CLI's own config files or status commands and surfaced in the composer MCP menu.

Browser automation has two host implementations behind that same REST endpoint. Agents do not choose between them per call. `BrowserHostResolver` picks Electron when the desktop process has wired its CDP broker into the resolver, and Playwright otherwise. In practice that means Electron in the desktop runtime (always) and Playwright only in theoretical server-only deployments. Per [T3CO-421](t3://ticket/T3CO-421) the desktop's per-project `WebContentsView` is always-on — created lazily on first agent or user touch and persisting across visibility toggles — so agents act in the exact tab the user can see, regardless of whether the embedded UI happens to be open.

**Trade-offs:**

- (+) One code path to maintain across all providers.
- (+) Adding a new service is a prompt-table update.
- (+) Zero up-front tool-slot cost; the model loads schemas on demand via `GET /api/<service>`.
- (-) One extra round-trip for tool discovery (`GET` before `POST`).
- (-) Depends on the model having a shell/code-execution tool available.

---

## Future: Native-MCP Mode

A native-MCP delivery mode (one registered MCP server per service, tool schemas injected up-front) is a plausible future option. It would be added as a single shared seam: `buildT3ServiceInjectionPrompt` would either return the current REST guidance or a "these tools are registered; prefer them" variant, and each adapter would register the corresponding MCP servers before session start. Gate it behind a feature flag and a per-provider capability check when shipping.

---

## Architecture

### Injection Flow

```
Thread start (with active project)
       │
       ▼
 Issue per-session Bearer token via managedRunService.issueMcpAccess()
       │
       ▼
 buildT3ServiceInjectionPrompt() assembles env header + REST table + admin prompts
       │
       ▼
 Provider adapter injects the string into its session-start call:
   - Codex: appendDeveloperInstructions
   - Claude: systemPrompt.append
   - Gemini: ACP embedded-context resource on the first prompt
   - Cursor: first ACP prompt text, guarded by a resume-cursor context hash
```

### Token Lifecycle

1. `managedRunService.issueMcpAccess(projectId, threadId)` generates a Bearer token
2. Token is scoped to the project + thread
3. Token is embedded in the injected prompt text
4. All REST endpoints validate the token on each request

For ticketing specifically, the validated session context may also include `threadId`. The ticketing REST route forwards that to the ticketing service so `create_ticket` can attach an `origin` ticket-thread link automatically.

Tool call `input` objects are strict across the agent-facing REST services. Endpoints reject unknown input fields before dispatching the tool handler, return the standard error envelope, and include a close field-name suggestion when one is available from the discovered `inputSchema`. For example, passing `parent` to `create_ticket` fails before creating a ticket and suggests `parentId`.

Ticket replies have a small internal-link contract for chat output: when an agent references a ticket in prose, it should use markdown like `[T3CO-191](t3://ticket/T3CO-191)`. The reminder is injected briefly through the ticketing prompts and through selected ticket tool discovery descriptions. Ticket tool call responses remain JSON-only so they stay predictable for agents and REST clients.

For prompts, managed-run bearer tokens are restricted to the issuing `projectId` and may only access project scope. Global prompt scope is only available through privileged contexts such as the dev bypass token.

### Condition Gate

Service injection only happens when:

- Thread has an active project context (checkpoint context exists)
- Server is listening (`serverConfig.port > 0`)

If either condition is false, no internal services are exposed to the model.

---

## File Map

```
packages/contracts/src/settings.ts                     # Server settings schema
apps/server/src/provider/sessionContextPrompt.ts        # buildT3ServiceInjectionPrompt (shared helper)
apps/server/src/provider/restEndpointSystemPrompt.ts    # REST endpoint table + env header
apps/server/src/prompts/http.ts                         # Prompt-management REST route
apps/server/src/dynamicChatUi/http.ts                   # Dynamic chat UI artifact REST route
apps/web/src/components/settings/DynamicChatUiPromptSection.tsx # Dynamic UI design-guide settings
apps/server/src/ticketing/http.ts                       # Ticketing REST route + thread-aware request context
apps/server/src/provider/Layers/CodexAdapter.ts         # Codex injection (REST via curl)
apps/server/src/provider/Layers/ClaudeAdapter.ts        # Claude injection (REST via curl)
apps/server/src/provider/Layers/GeminiAdapter.ts        # Gemini injection (ACP embedded-context)
apps/server/src/provider/Layers/CursorAdapter.ts        # Cursor injection (first ACP prompt)
```

---

## Adding a New Service

To add a new REST API service:

1. Create the REST HTTP endpoint (e.g. `/api/new-service`)
2. Add the service to the table in `buildRestEndpointSystemPrompt` (in `apps/server/src/provider/restEndpointSystemPrompt.ts`)
3. If the service has its own admin prompt document, add it to `AdminPromptSettings` and include it in `buildT3ServiceInjectionPrompt`
4. No adapter changes required — the shared helper handles every supported provider

If a service should stay HTTP-only and not be advertised to models, simply do not add it to the table.

---

## Ticket Body Tools

Ticket bodies are patchable documents. Use `get_ticket` for metadata and preview; pass `includeBody: true` only when the full body is truly needed. Prefer these tools for large tickets:

- `get_ticket_body`: line-window read with `startLine`, `limit`, and optional `sectionPath`. Returns revision, content hash, size, total line count, and section hash when scoped.
- `search_ticket_body`: direct text search within one ticket body with small line snippets.
- `get_ticket_body_sections`: markdown outline only, including section paths, ranges, and hashes.
- `edit_ticket_body`: the single write tool. Always pass `expectedRevision`; for `replace_section` and section-scoped `append_section`, also pass `expectedSectionHash`. Use `str_replace` for known unique strings, `insert` for line additions, `replace_section` for known headings, `append_section` for new sections, and `replace_body` as a last resort. Bodies over 1 MiB reject with `body_too_large` without mutating.

Acceptance criteria use stable IDs:

- `list_ticket_criteria` returns criteria plus `criteriaRevision`.
- `edit_ticket_criteria` supports `add`, `update`, `remove`, and `reorder`, all requiring `expectedCriteriaRevision`. Reorders must include every current criterion ID once; positions are renormalized server-side.

Legacy `update_ticket.description` and `update_ticket.acceptanceCriteria` remain for compatibility but should be avoided by agents because they replace whole fields and are more conflict-prone.
