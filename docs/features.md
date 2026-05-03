# Features

T3 Code is a web GUI for AI coding agents. It wraps providers like Codex, Claude, and Gemini behind a unified orchestration layer and exposes every feature to both human users (via a React UI) and AI agents (via REST API tools and WebSocket RPC).

## Architecture

| Package              | Role                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server`        | Node.js WebSocket server. Wraps provider processes (Codex app-server, Claude Agent SDK, Gemini ACP), serves the React app, manages sessions, and hosts REST API endpoints. |
| `apps/web`           | React/Vite UI. Session UX, conversation rendering, ticketing board, file explorer, terminal, settings. Connects to the server via WebSocket.                               |
| `apps/desktop`       | Electron shell. Embeds the server + web app into a native macOS/Linux/Windows desktop application with auto-update, native dialogs, and protocol handling.                 |
| `packages/contracts` | Shared Effect/Schema schemas and TypeScript contracts. Schema-only — no runtime logic.                                                                                     |
| `packages/shared`    | Shared runtime utilities. Explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.                                                                         |

---

## 1. Orchestration & Sessions

The core of T3 Code is an event-sourced orchestration engine that manages all agent interactions.

**Concepts:**

- **Project** — A workspace context with a root path, scripts, system prompts, and prompt overrides.
- **Thread** — A conversation/work session with an agent. Threads belong to a project.
- **Turn** — A single back-and-forth exchange: user input → agent output. Turns belong to a thread.
- **Message** — A text or system output with metadata (origin, phase, role, attachments). Messages belong to a turn.
- **Command** — An action request (dispatch to agent, archive thread, send message). Commands are validated by invariants before producing events.
- **Event** — An immutable fact (thread created, message added, turn completed). Events are persisted and projected into the read model.

**Session state machine:** `idle` → `running` → `quiescing` → `idle`.

**Turn flow:**

1. User sends input → `thread.turn.start` command dispatched.
2. Provider session starts or resumes.
3. Provider streams runtime events back (tool calls, messages, approvals).
4. Events are normalized into orchestration domain events and persisted.
5. Projections update the in-memory read model.
6. WebSocket pushes domain events to the browser in real time.
7. Async work (checkpointing, command reactions) settles.
8. `turn.processing.quiesced` receipt emitted.

**User interaction:**

- Create threads from the sidebar or board view.
- Send messages via the composer.
- Approve or decline agent decisions from the pending-approval panel.
- Archive or delete threads from context menus.
- View the full messages timeline with work log entries, tool usage, and file change summaries.

**Agent interaction (WebSocket RPC):**

- `orchestration.getStartupSnapshot` — Shallow startup/read-side metadata: projects plus thread shells for sidebar, header, settings, and lightweight cards.
- `orchestration.getThreadContent` — On-demand thread messages, activities, proposed plans, and checkpoints for route-level hydration.
- `orchestration.getSnapshot` — Full read model of projects, threads, messages, and turns. Kept for compatibility and server-side recovery paths that still need the complete model in one response.
- `orchestration.dispatchCommand` — Send any orchestration command.
- `orchestration.getTurnDiff` / `orchestration.getFullThreadDiff` — Retrieve diffs.
- `orchestration.replayEvents` — Replay events from a given sequence number.
- `subscribeOrchestrationDomainEvents` — Stream all domain events in real time.
- `subscribeOrchestrationRunEvents` — Stream events for a specific orchestration run.

### Dynamic Chat UI Artifacts

Assistant messages can include experimental `t3:dynamic-chat-ui` fenced blocks. The web timeline parses these durable message blocks and renders them as inline sandboxed iframe artifacts with compact T3 Code chrome, theme delivery, and a `window.t3ChatUi` postMessage bridge for height and future host-visible events.

The server projection extracts lightweight artifact metadata (`id`, `title`, `description`, `initialHeight`, `maxHeight`) into message metadata so thread hydration and virtualized row measurement can understand the artifact without duplicating large HTML blobs. The HTML source remains in the assistant message text, so reloads/reconnects preserve the artifact as normal timeline content.

Agents can use `/api/dynamic-chat-ui` to:

- Generate and insert an artifact from a prompt using the current thread's selected model and the Dynamic UI design guide.
- Revise an existing artifact by passing `sourceArtifactId` and describing the requested change.
- See a pending timeline message while generation runs; the service replaces that same message with the durable artifact on success or an inline failure note on error.
- Receive a compact success payload after insertion, without carrying artifact HTML through the parent agent response.

The chat agent-facing API intentionally exposes only prompt-driven generation. The server keeps HTML validation and fenced-block serialization as internal implementation details so the chat agent does not hand-author UI HTML or anchor generation on canned examples.

Dynamic UI generation uses hidden provider sessions keyed to the source thread and artifact id. Those sessions reuse the normal provider runtime binding/resume cursor path, but they are not represented as visible chat threads. If provider resume is unavailable, the server still resolves prior artifact context from the current thread and sends it in the revision prompt as a fallback.

See [Dynamic Chat UI](dynamic-chat-ui.md) for the full agent flow, builder session lifecycle, iframe rendering model, Settings integration, and testing notes.

---

## 2. Provider System

T3 Code supports multiple AI providers behind a unified adapter interface.

### Codex (OpenAI)

- Runs `codex app-server` as a child process communicating via JSON-RPC over stdio.
- Authentication via `codex login` CLI.
- Configuration: global `~/.codex/config.toml` + project-scoped `.codex/config.toml`.
- **Profiles:** Multiple named profiles supported. T3 auto-discovers `~/.codex-*`
  homes such as `~/.codex-metric`; profiles appear as separate provider entries
  and run Codex with profile-scoped `CODEX_HOME`.
- Project trust: the server auto-trusts the active project path.

### Claude Agent (Anthropic)

- Uses `@anthropic-ai/claude-agent-sdk` for direct SDK integration.
- Authentication via `claude auth login`.
- Configuration: global profile config + project `.mcp.json`.
- **Profiles:** Multiple named profiles supported. Each profile can have its own binary path, config directory, and custom models. Profiles appear as separate provider entries.
- Model selection: full Claude model family with per-session model and reasoning effort options.
- Claude Opus 4.7 exposes `xhigh` effort between High and Max. Older Claude
  models do not advertise it, and stale `xhigh` selections fall back to High.
- Context usage: when the Claude SDK exposes `getContextUsage()`, T3 records the
  categorized context breakdown on turn completion and shows the top categories
  in the chat composer context-window hover card.
- Terminal reasons: when Claude returns a structured `terminal_reason`, T3 keeps
  it on the latest turn and surfaces non-success reasons in the response
  divider, for example `Response • Worked for 2m • Limit reached`. Limit and
  recoverable stop reasons leave the session ready so the user can retry or
  continue.
- Hook lifecycle visibility: Claude hook start/progress/completion events are
  included in the SDK stream and projected into the chat work log with hook
  name, hook event, outcome, exit code, and truncated output when available.
  Failed or cancelled hooks use error tone so `hook_stopped` /
  `stop_hook_prevented` terminal reasons have visible context.

### Gemini (Google)

- Uses Gemini CLI ACP mode through a provider adapter.
- Authentication is delegated to Gemini CLI and inherited Google/API-key
  environment configuration.
- Configuration: enabled/disabled, binary path, `GEMINI_CLI_HOME`, and custom
  model slugs.
- Runtime access: T3 maps `full-access` to Gemini YOLO mode with sandboxing
  disabled, and `approval-required` to Gemini's default approval mode.
- Model selection: Gemini model family with no fake reasoning-effort or thinking
  controls. Unsupported advanced provider behaviors return explicit errors.
- Context usage: T3 reports Gemini token usage from ACP quota metadata. It only
  shows a max context/window denominator when Gemini emits an effective
  `usage_update.size`, because the CLI's effective context window can vary by
  account plan and is not safely derivable from model name alone.
- Rate limits: for Google-login Code Assist accounts, T3 polls the Gemini Code
  Assist quota endpoint through cached Gemini CLI OAuth credentials and displays
  per-model quota usage as percentage used plus reset time when available.
- MCP discovery: the chat MCP menu mirrors Gemini CLI user settings
  (`<GEMINI_CLI_HOME>/settings.json`) and project settings
  (`.gemini/settings.json`), including `mcp.allowed` / `mcp.excluded` filters.
- Claude MCP status: for Claude, the composer uses project-scoped SDK
  `mcpServerStatus()` snapshots shared across threads. T3 probes every enabled
  Claude profile in the background without yielding a user prompt or triggering
  model inference, then renders live statuses such as connected, needs-auth, and
  failed with manual retry.
- Project title, T3 REST service guidance, and project system prompts are
  delivered through ACP embedded context on the first Gemini turn because Gemini
  ACP session creation does not accept a system-prompt parameter.
- See [Gemini Provider Implementation Specification](gemini-provider-implementation.md)
  for rollout risks and deferred capabilities.

### Cursor

- Provider status discovery is registered for the default Cursor Agent CLI and
  explicitly configured Cursor profiles. The server reports
  install/version/auth/model snapshots before the runtime adapter is enabled.
- Authentication and model availability are delegated to Cursor CLI probes:
  `agent about --format json`, fallback `agent status`, and `agent models`.
  Account identifiers are treated as sensitive and are not displayed in provider
  status labels.
- **Profiles:** Multiple named profiles remain supported through explicit
  `providers.cursorProfiles` settings, but T3 does not auto-discover
  `~/.cursor-profiles/*`. Cursor profile homes can prompt macOS keychain access
  during background status probes, so profile setup must be deliberate. T3 does
  not create profile homes, unlock keychains, or synthesize HOME/config/data
  paths for Cursor profiles. There is no user-facing Settings UI for adding
  Cursor profiles until auto-discovery and auth probing are quiet enough for
  routine use. The default provider appears as `cursor`; configured profiles
  remain exact provider entries such as `cursor:metric` internally and keep
  independent launch commands, optional environment overrides, accounts, status
  probes, resume cursors, rate-limit keys, and draft state. In the current
  rollout, user-facing model pickers and Fork with model menus hide `cursor:*`
  providers; only the base Cursor provider is selectable.
- Configuration: enabled/disabled, binary path, optional launch command, profile
  HOME, `CURSOR_CONFIG_DIR`, `CURSOR_DATA_DIR`, custom environment, and custom
  model slugs.
- Runtime shape: Cursor runs through `agent acp` using newline-delimited
  JSON-RPC over stdio. T3 stores the Cursor ACP `sessionId` as the provider
  resume cursor and resumes with `session/load`.
- Runtime access: T3 maps plan mode through `session/set_config_option`, sends
  turns with `session/prompt`, responds to `session/request_permission`, and
  handles `cursor/create_plan` as native T3 proposed plans with explicit
  accept/reject/cancel approval responses back to Cursor ACP. Rejected Cursor
  plans are retained with `rejected` status, cancelled Cursor plans are retained
  with `cancelled` status, and neither terminal status is treated as a
  `Plan Ready` follow-up.
- Attachments: T3 sends image attachments to Cursor ACP as
  `ContentBlock.image` payloads when the CLI advertises
  `promptCapabilities.image: true`. Embedded arbitrary file/resource attachment
  contents remain unsupported for Cursor because the installed CLI currently
  reports `embeddedContext: false`; users can reference workspace files by path
  in prompt text.
- MCP discovery: uses Cursor CLI `agent mcp list` from the project cwd so the
  composer can show configured servers and approval/status text. If the CLI
  probe fails, T3 falls back to parsing user-level `.cursor/mcp.json` and
  project-local `.cursor/mcp.json`. Cursor ACP does not use MCP servers
  configured through the Cursor dashboard.
- See [Cursor Provider Implementation Specification](cursor-provider-implementation.md)
  for rollout risks, profile requirements, ACP event mapping, and deferred
  capabilities.

### Provider configuration

Server settings expose per-provider configuration:

- `providers.codex` — enabled/disabled, binaryPath, homePath, customModels.
- `providers.codexProfiles` — Array of profile configs (profileId, displayName, enabled, binaryPath, homePath, customModels). T3 also auto-discovers `~/.codex-*` directories as Codex profiles.
- `providers.claudeAgent` — enabled/disabled, binaryPath, configDir, customModels.
- `providers.claudeProfiles` — Array of profile configs (profileId, displayName, enabled, binaryPath, configDir, customModels).
- `providers.gemini` — enabled/disabled, binaryPath, homePath, customModels.
- `providers.cursor` — enabled/disabled, binaryPath, optional launchCommand, homePath, configDir, dataDir, env, customModels.
- `providers.cursorProfiles` — Advanced/internal explicit array of profile
  configs (profileId, displayName, enabled, binaryPath or launchCommand,
  homePath, configDir, dataDir, env, customModels). T3 does not auto-discover
  Cursor profile directories, expose manual profile creation in Settings, or
  expose `cursor:*` profiles in user-facing model/fork selectors in the current
  rollout.

Model selection settings (each can target a specific provider + model):

- `textGenerationModelSelection` — Default for LLM text generation (branch names, commit messages, PR descriptions).
- `managedRunInferenceModelSelection` — For managed run service inference.
- `orchestrationImplementerModelSelection` — For ticket implementation turns.
- `orchestrationReviewerModelSelection` — For ticket review turns.

### Rate limits

Provider rate limits are tracked in real time with OAuth usage tiers (5-hour and 7-day windows, per-model breakdowns). Rate limit snapshots are keyed by the exact provider kind, including profile suffixes such as `codex:metric`, so profile accounts never inherit the base provider's usage data. Rate limit state is streamed to the UI via `subscribeServerConfig`.

**User interaction:**

- Select provider and model for each thread.
- Configure providers and models in Settings → General.
- View provider health status with color-coded indicators.
- Enable/disable providers and profiles with toggles.

**Agent interaction (WebSocket RPC):**

- `provider.startSession` / `provider.sendTurn` / `provider.interruptTurn` — Session lifecycle.
- `server.refreshProviders` — Re-scan provider statuses.
- `server.resolveMcpServers` — Get project-scoped MCP status for Claude or
  name-only MCP discovery for Codex/Gemini.

---

## 3. Conversation UI

The main chat view is the primary interface for interacting with agents.

### Messages timeline

- User and assistant messages rendered with full markdown.
- Configurable timestamp format (12-hour, 24-hour, locale default).
- Copy button per message.
- Multi-select with shift-click for bulk operations.
- Virtualized rendering for large conversations.

### Work log / timeline entries

- Tool usage display (terminal commands, file operations, reviews).
- Status indicators per entry (completed, in-progress, failed).
- Collapsible work groups.
- Terminal command snippets inline.
- File change summaries with clickable diffs.
- Review output cards with comment severity badges.
- Ticket references rendered as links.
- Elapsed time estimates.

### Composer

- Rich text input with markdown support.
- **Slash command menu** — Type `/` to browse available commands and skills.
- **Skill chips** — Selected skills displayed as removable chips above the input.
- **Code snippet attachments** — Attach code blocks to messages.
- **File drag-to-composer** — Drag files from the file explorer to reference them.
- **Ticket drag-to-composer** — Drag tickets from the board to reference them.
- **Draft persistence** — Drafts auto-save per thread and survive navigation.

### Pending approval panel

When an agent requests approval (e.g. before executing a command or asking the
user to accept a Cursor plan), the composer area displays decision buttons
(approve/decline) with context about the requested action.

### Pending user input panel

When an agent requests structured input, a form panel appears in the composer area for the user to fill in.

### Plan sidebar

- Resizable side panel showing the agent's current plan.
- Step-by-step breakdown with status indicators (completed, in-progress, pending).
- Collapsible sections.
- Copy, download, and export actions.

### Interaction modes

- **Default** — Normal back-and-forth conversation.
- **Plan** — Plan-focused mode where the agent designs before executing.

---

## 4. Ticketing

A full-featured issue tracker built into T3 Code. See [ticketing.md](ticketing.md) for implementation details.

### Data model

- **Ticket** — Title, description, status, priority, sort order, worktree assignment, model overrides, acceptance criteria.
- **Status values:** `backlog`, `todo`, `in_progress`, `blocked`, `in_review`, `done`, `canceled`.
- **Priority values:** `none`, `low`, `medium`, `high`, `urgent`.
- **Hierarchy** — Tickets can have a parent (epic) and sub-tickets, forming a tree. Epic status is derived from children (recursive to 10 levels).
- **Dependencies** — Directed acyclic graph between tickets. Cycle detection prevents invalid dependency chains.
- **Labels** — Color-coded labels, both global and project-scoped. Assigned to tickets via a join table.
- **Comments** — Threaded comments (single-depth replies). Author can be human or LLM.
- **Artifacts** — Polymorphic attachments: Figma URLs, Mermaid diagrams, images.
- **Acceptance criteria** — Checklist items with status (`pending`, `met`, `not_met`). Server-side verification stamping.
- **Templates** — Reusable ticket templates with variable substitution for quick creation.
- **History** — Audit trail: every mutation recorded with action type, JSON diff, and performer.

### Ticket-to-thread relationships

- `origin` — Ticket created from inside a thread.
- `bound` — Thread explicitly associated with a ticket via `thread.ticketId`.
- `mention` — Ticket referenced in a message by identifier (case-insensitive pattern matching).

**User interaction:**

- Create, edit, and delete tickets from the board view or settings.
- Assign labels, set priorities, manage acceptance criteria.
- Add comments and artifacts.
- View ticket history (audit trail).
- Drag tickets between status columns on the board.
- Drop tickets onto the chat composer to reference them.
- Multi-select tickets for bulk actions (archive, orchestrate).
- Configure labels and templates in Settings → Tickets.

**Agent interaction (REST API — `/api/ticketing`):**

26+ tools including:

- `list_tickets`, `get_ticket`, `search_tickets` — Query tickets.
- `create_ticket`, `update_ticket`, `delete_ticket`, `reorder_ticket` — Mutate tickets.
- `get_ticket_tree` — Retrieve hierarchy.
- `set_dependencies`, `add_dependency`, `remove_dependency` — Manage dependency graph.
- `list_labels`, `create_label`, `update_label`, `delete_label` — Label CRUD.
- `list_comments`, `create_comment`, `update_comment`, `delete_comment` — Comment CRUD.
- `list_artifacts`, `create_artifact`, `update_artifact`, `delete_artifact` — Artifact CRUD.
- `list_templates`, `create_template`, `update_template`, `delete_template` — Template CRUD.
- `update_criterion_status` — Mark acceptance criteria met/not met.
- `get_ticket_history` — Audit trail.

---

## 5. Board View (Multi-Layout)

A Kanban-style board for visual ticket management. See [multi-layout.md](multi-layout.md) for implementation details.

**User interaction:**

- **Kanban columns** — Tickets grouped by status, displayed as cards with title, identifier, priority indicator, labels, sub-ticket count, and dependency indicators.
- **Drag-and-drop** — Reorder tickets within a column or drag between columns to change status.
- **Ticket detail panel** — Click a card to open a drill-down panel with full ticket information, acceptance criteria checkboxes, comments, history, related threads, and label management.
- **Multi-select** — Select multiple tickets with modifier keys. A selection bar appears with bulk action buttons (archive, orchestrate).
- **Drop-to-chat** — Drag a ticket card onto the chat area to reference it in a message.
- **Orchestration controls** — Confirmation page for running orchestration on selected tickets, with model selection for implementer and reviewer plus the shared ticket hover preview for a final content check before starting.

---

## 6. Managed Runs

Launch, monitor, and manage long-running project scripts (dev servers, build watchers, docker-compose stacks). See [managed-runs.md](managed-runs.md) for implementation details.

### Project scripts (actions)

Each project can define scripts:

```
ProjectScript {
  id         — kebab-case identifier
  name       — display name (e.g. "Dev Server")
  command    — shell command (e.g. "npm run dev")
  icon       — visual icon type (play, test, build, etc.)
  runOnWorktreeCreate — auto-launch when a worktree is created
  services   — declared services with health check definitions
}
```

### Run lifecycle

`starting` → `running` → `completed` | `failed` | `stopped` | `lost`

- Scripts run in a PTY terminal (120×30 default).
- Environment variables injected: `T3CODE_PROJECT_ROOT`, `T3CODE_WORKTREE_PATH`.
- Log retention: 48 hours.

### Service health checks

- **URL** — HTTP GET with expected status code.
- **Docker** — Container state check.
- **Port** — TCP connect test.
- **Command** — Custom shell command.
- Polling interval: 12 seconds.

### Service inference

An LLM analyzes script output logs to infer what services are running, their roles (frontend, backend, proxy, worker, database, devtool), URLs, and health status. Inference records include the model used, raw/normalized payloads, provenance metadata, and confidence levels. Inferred health checks are adopted when they satisfy the schema, then regular service validation determines whether each target is reachable. A zero-service inference result is treated as a successful empty result; only inference request or runner errors are marked failed, after a short retry window.

**User interaction:**

- View running scripts in the sidebar with detected services and health indicators (healthy/unhealthy/unknown).
- Click to see service details: role, URL (with copy/open buttons), validation status.
- Launch scripts from the project action menu.
- Stop scripts manually.
- Keep thread-scoped run-log tabs attached across stop/start cycles for the same script; stale tabs retarget to the fresh run only in threads where the logs tab was already open.
- View inference records in Settings → Managed Runs with detailed JSON payloads.

**Agent interaction (REST API — `/api/managed-runs`):**

- `list_managed_runs` — List all runs with status and services.
- `launch_project_script` — Start a script by ID.
- `get_managed_run` — Get run details.
- `get_managed_run_logs` — Retrieve terminal output.
- `stop_managed_run` — Terminate a running script.
- `propose_project_script` — Suggest a new script definition.

**System prompt injection:**

- In "tools" mode: `MANAGED_RUNS_SYSTEM_PROMPT` injected with tool descriptions.
- In "prompt" mode: HTTP endpoint URL + bearer token injected into the system prompt for on-demand discovery.

---

## 7. Scheduled Tasks

Cron-based automation that creates new threads on a schedule. See [scheduled-tasks.md](scheduled-tasks.md) for implementation details.

### Task model

```
ScheduledTask {
  jobId            — UUID
  name             — display name
  description      — optional description
  cronExpression   — 5-field standard cron (e.g. "0 9 * * 1" for Mondays at 9am)
  enabled          — on/off toggle
  jobType          — currently only "new_thread"
  newThreadConfig  — { projectId, skillIds?, prompt?, autoSend }
  lastRunAt        — timestamp of most recent execution
  nextRunAt        — calculated next execution time
}
```

### Scheduler behavior

- Ticks every 30 seconds, executes due jobs.
- Catch-up on startup: missed tasks are executed immediately.
- At most 1 execution per task per tick (deduplication).
- Execution records track runId, status (`created`, `skipped`, `failed`), resulting threadId, and any error.

**User interaction:**

- Create, edit, enable/disable, and delete scheduled tasks in Settings → Scheduled Tasks.
- View task detail with cron expression, project selector, prompt configuration.
- Browse execution history with success/failure status.
- Settings list/detail pages and chat proposal cards hydrate their project dropdowns from the client project store, with `orchestration.listProjects` available for narrow project-only refreshes. Opening scheduled-task UI does not wait for startup snapshot hydration.

**Agent interaction (REST API — `/api/scheduled-tasks`):**

- `list` / `get` — Query tasks.
- `create` / `update` / `delete` — Manage tasks.
- `toggle` — Enable or disable a task.
- `run_now` — Force immediate execution.
- `list_runs` — View execution history.
- `propose` — Suggest a new scheduled task.

**Stream event:** `job_fired` — Emitted when a job executes, includes runId and created threadId.

---

## 8. Prompt Management

Customize the system prompts sent to AI providers for each orchestration phase. See [prompts.md](prompts.md) for implementation details.

### Orchestration prompt types

| Prompt ID          | When used                                      |
| ------------------ | ---------------------------------------------- |
| `implement`        | Initial implementation turn                    |
| `resume`           | Resume after interruption (with history)       |
| `resumeFreshAgent` | Resume with a fresh agent session (no history) |
| `review`           | Initial code review pass                       |
| `reReview`         | Review iteration 2+                            |
| `reviewFeedback`   | Feedback to implementer after review           |

### Prompt document format

Prompts are block-based documents (version 1). Each block has:

- `text` — Template string supporting `${variable}` interpolation.
- `when` (optional) — Conditional rendering: `{ type: "exists", variable: "ticketId" }` includes the block only when the variable is present.

### Scope resolution (3-tier)

1. **Shipped defaults** — Built-in, read-only prompts.
2. **Global overrides** — User customizations applied to all projects.
3. **Project overrides** — Per-project customizations (highest priority).

### Canonical variables

- **Shared:** `ticketId`, `ticketTitle`, `ticketDescription`, `acceptanceCriteria`, `worktree`, `projectTitle`, `projectPath`.
- **Review-specific:** `commitDiff`, `reviewIteration`, `reviewSummary`, `reviewComments`.

**User interaction:**

- Edit prompts in Settings → Prompts with a scope selector (global / project).
- View state badges per prompt: Default, Customized, Inherited, Overridden.
- Preview rendered prompts with sample variable data before saving.
- Reset to shipped defaults.

**Agent interaction (REST API — `/api/prompts`):**

- `list_definitions` — Get available prompts and groups.
- `get_document` — Get the effective (merged) prompt document.
- `validate_document` — Syntax check a prompt document.
- `preview_document` — Render a prompt with sample variables.
- `update_document` — Save a global or project override.

---

## 9. Browser Automation

Per-project headless Chromium automation for QA testing, web scraping, and UI verification. See [browser-tools.md](browser-tools.md) for the full reference.

**What it is:** 58 plaintext-returning tools exposed at `/api/browser` — navigate, click/fill/hover/type, accessibility snapshots with stable `@ref` element IDs, screenshots (full page / viewport / clipped / element / base64), PDF export, JavaScript evaluation, multi-tab management, and a batch endpoint that sequences up to 50 commands in one request.

**Per-project isolation.** Each T3 project gets its own Chromium persistent context at `<dataDir>/browser/<projectId>/chromium-profile/`. Cookies, localStorage, and auth sessions persist across server restarts but never bleed across projects. Chromium runs headless by default.

**Vendored, not invented.** The core command implementations are byte-identical to upstream [GStack Browser](https://github.com/gstack/gstack) (MIT, © Garry Tan). T3-specific behavior (per-project profiles, REST shape, Effect-based lifecycle) lives in T3-authored files outside the vendored `core/` directory.

**User interaction:**

- Runs invisibly by default — no browser popup. Screenshots are the window into what the agent is doing.
- Settings → Prompts → Browser lets you edit the system-prompt instructions the agent sees.
- (Planned) A "watch mode" UI toggle to flip the active project's Chromium to headed for demos and debugging — tracked at [T3CO-330](t3://ticket/T3CO-330).

**Agent interaction (REST API — `/api/browser`):**

- Discovery: `GET /api/browser` returns the full tool registry with input schemas.
- Typical flow: `goto` → `snapshot` (get `@e1`, `@e2` refs) → `click @e1` / `fill @e2 value=...` → `snapshot` (fresh refs) → `screenshot`.
- `batch` runs up to 50 `{tool, input}` entries sequentially.

---

## 10. Git Integration

Built-in git operations for version control without leaving the app.

### Core operations

- **Status** — Staged/unstaged changes, branch, remote tracking info.
- **Branches** — List, create, checkout, delete, set upstream. Local vs. remote deduplication.
- **Pull** — Fetch + merge with conflict detection.
- **Worktrees** — Create (with branch), remove, list. See [Worktree & Environment Modes](#10-worktree--environment-modes).
- **Remotes** — Multi-remote support with upstream branch tracking (15-second refresh cache).

### Stacked diff / PR workflow

Multi-step workflow for preparing and shipping code:

- **Actions:** `commit`, `push`, `create_pr`, `commit_push`, `commit_push_pr`.
- Progress events emitted for each phase (branch, commit, push, PR creation).
- PR metadata fetching (title, body, state, author).

### LLM-assisted text generation

The configured text generation model can auto-generate:

- Branch names (from ticket context).
- Commit messages (from staged changes).
- PR titles and descriptions (from diff context).

**User interaction:**

- **Branch toolbar** — Switch branches, view current branch, see environment mode.
- **Git actions control** — Commit, push, and open PRs from a toolbar menu. Progress tracking via toast notifications.
- **Pull request checkout** — Check out a PR directly from the branch toolbar.
- **Default branch confirmation** — Warning dialog when committing to the default branch.

**Agent interaction (WebSocket RPC):**

- `git.status`, `git.pull`, `git.listBranches`, `git.discoverRepos`.
- `git.createBranch`, `git.checkout`, `git.init`.
- `git.createWorktree`, `git.removeWorktree`.
- `git.runStackedAction` — Execute a multi-step commit/push/PR workflow.
- `git.resolvePullRequest` — Fetch PR metadata.
- `git.preparePullRequestThread` — Prepare context for a review thread.

---

## 11. Worktree & Environment Modes

Per-thread workspace isolation using git worktrees.

### Environment modes

- **Local** — All threads share the main working tree. Simpler, but changes from one thread are visible to others.
- **Worktree** — Each thread gets an isolated git worktree with its own branch. Changes are fully isolated between threads.

Configurable globally via `defaultThreadEnvMode` in server settings, or per-thread at creation time.

### Worktree storage

- Worktrees are created under `~/.t3/worktrees/` (or the configured data directory).
- Each worktree gets a dedicated branch.
- Worktrees are cleaned up when their thread is deleted.
- Project scripts with `runOnWorktreeCreate: true` auto-launch in new worktrees.

**User interaction:**

- Toggle between Local and Worktree mode in the branch toolbar.
- Choose environment mode when creating a new thread (Cmd+K for local, Cmd+Shift+K for worktree).
- Set the default mode in Settings → General.

**Agent interaction:**

- Orchestration commands include worktree context when dispatching to providers.
- Provider sessions receive the correct working directory based on the thread's environment mode.

---

## 12. Terminal

PTY-based terminal sessions embedded in the UI, attached to threads.

### Capabilities

- Full PTY emulation (via Bun or node-pty backend).
- Multiple terminals per thread (up to 4 per group).
- Real-time stdout/stderr/pty streaming.
- Resize (columns and rows).
- Write input, clear, restart.
- Session history persistence.
- Environment variable injection (up to 128 vars, 8KB per value).
- Terminal link detection (file:line:col patterns are clickable).
- Theme synchronization with the app theme.

**User interaction:**

- **Terminal drawer** — Togglable panel at the bottom of the chat view.
- Tab management: add, close, switch between terminals.
- Draggable height divider.
- Real-time output rendering via xterm.js.
- Click detected links to open files in the editor.

**Agent interaction (WebSocket RPC):**

- `terminal.open` — Create a session at a specific cwd with environment variables.
- `terminal.write` — Send input.
- `terminal.resize` — Adjust dimensions.
- `terminal.clear` / `terminal.restart` / `terminal.close` — Session control.

**Stream events:**

- `terminal.started` — Session initialized.
- `terminal.output` — Data from pty/stdout/stderr.
- `terminal.exited` — Process terminated (with exit code/signal).
- `terminal.error` — Error occurred.

---

## 13. File Explorer

A built-in file browser and editor for navigating project files.

**User interaction:**

- **Tree view** — Hierarchical file/directory listing with expand/collapse.
- **Split panes** — Left/right editor split for side-by-side file viewing.
- **Tabs** — Draggable tab bar for open files. Close, reorder, switch tabs.
- **Git status indicators** — Modified, added, and deleted files are visually marked.
- **Markdown preview** — Toggle between raw markdown and rendered preview.
- **File search** — Cmd+P / Ctrl+P to quickly find and open files.
- **Drag to composer** — Drag files from the explorer into the chat composer to reference them.
- **Settings panel** — Explorer-specific configuration.

**Agent interaction (WebSocket RPC):**

- `projects.readFile` — Read file contents (with size/depth limits).
- `projects.writeFile` — Write file contents (with conflict detection).
- `projects.listDirectory` — Browse directory with metadata.
- `projects.searchEntries` — Full-text search across project files.

---

## 14. Diff Viewer

Visualize code changes from agent turns or git operations.

**User interaction:**

- **Side-by-side or stacked view** — Toggle between diff display modes.
- **Syntax highlighting** — Language-aware code coloring.
- **File navigation** — Previous/next file buttons to step through changed files.
- **Word wrap toggle** — Configurable in settings and per-session.
- **Adaptive layout** — Renders as an inline sidebar on wide viewports, or as a sheet overlay on narrow viewports (breakpoint: 1180px).
- **Resizable width** — Draggable divider (width persisted to localStorage).

**Agent interaction:**

- Turn diffs are automatically generated from checkpoint comparisons (see [Checkpointing](#14-checkpointing)).
- `orchestration.getTurnDiff` / `orchestration.getFullThreadDiff` — Retrieve diffs via RPC.

---

## 15. Checkpointing

Git-ref based snapshots that track file state before and after each agent turn.

### Lifecycle

1. **Baseline captured** — At turn start, a git ref is stored as a hidden branch (`checkpoints/{threadId}/{turnId}`).
2. **Turn executes** — Agent makes changes.
3. **Finalized** — At turn completion, a second ref is stored. The diff between baseline and finalized refs produces the turn diff.

### Diff generation

- Incremental processing with progress publication.
- Per-file change tracking (add/delete/modify) with insertion/deletion statistics.
- Linked to turn ID for navigation in the timeline.

**User interaction:**

- Turn diffs appear as collapsible file change summaries in the work log timeline.
- Click a file change to open the full diff viewer.

**Agent interaction:**

- Checkpoints are managed automatically by the `CheckpointReactor` — no manual agent interaction required.
- Diff data is available via `orchestration.getTurnDiff`.

---

## 16. Settings & Configuration

### Server settings

| Setting                    | Description                                | Default          |
| -------------------------- | ------------------------------------------ | ---------------- |
| `enableAssistantStreaming` | Incremental assistant text delivery        | `false`          |
| `resumeAgentsOnStartup`    | Auto-resume stale work on server restart   | `false`          |
| `maxReviewIterations`      | Max review passes for tickets              | `3` (max 10)     |
| `defaultThreadEnvMode`     | Thread workspace isolation                 | `"local"`        |
| Provider settings          | Codex, Claude Agent, Gemini, profiles      | Per-provider     |
| Model selections           | Text gen, inference, implementer, reviewer | Per-use-case     |
| Observability              | OTLP traces/metrics URLs                   | Disabled         |
| Orchestration prompts      | Global prompt overrides                    | Shipped defaults |

### Client settings

| Setting                   | Description               | Default        |
| ------------------------- | ------------------------- | -------------- |
| `timestampFormat`         | Message timestamp format  | `"locale"`     |
| `sidebarProjectSortOrder` | Project sort in sidebar   | `"updated_at"` |
| `sidebarThreadSortOrder`  | Thread sort in sidebar    | `"updated_at"` |
| `diffWordWrap`            | Word wrap in diff viewer  | `true`         |
| `confirmThreadArchive`    | Show archive confirmation | `false`        |
| `confirmThreadDelete`     | Show delete confirmation  | `true`         |

### Keybindings

Custom keyboard shortcuts stored in `keybindings.json`:

```
KeybindingRule {
  key      — e.g. "mod+j", "ctrl+shift+k"
  command  — action to execute
  when     — optional condition (e.g. "terminalFocus")
}
```

Commands: `terminal.toggle`, `terminal.split`, `terminal.new`, `terminal.close`, `chat.new`, `chat.newLocal`, `thread.previous`, `thread.next`, `thread.jump.1-9`, `file.quickOpen`, `editor.openFavorite`, `script.{id}.run`.

Conditions support `!`, `&&`, `||`, and parentheses. Available conditions: `terminalFocus`, `terminalOpen`.

Limits: 256 rules max, 64-char key values, 256-char when expressions.

**User interaction:**

- Settings UI organized into tabs: General, Prompts, Tickets, Archived, Changelog, Managed Runs, Scheduled Tasks.
- Theme toggle (System/Light/Dark).
- All provider and model configuration in one place.

**Agent interaction (WebSocket RPC):**

- `server.getSettings` / `server.updateSettings` — Read and patch settings.
- `server.upsertKeybinding` — Add or update keybinding rules.
- `subscribeServerConfig` — Stream config changes, provider statuses, and rate limits.

---

## 17. T3 Project Service Injection

Internal T3 project services are exposed to every provider the same way: REST endpoint URLs and a short-lived Bearer token are injected into the session-start prompt via the shared `buildT3ServiceInjectionPrompt` helper. The model calls them with its native shell/bash tool. See [t3-agent-tools.md](t3-agent-tools.md) for implementation details.

- Codex: appended through `appendDeveloperInstructions`.
- Claude: appended through `systemPrompt.append`.
- Gemini: sent as an ACP embedded-context resource on the first user turn; the resume cursor tracks a hash so unchanged prompts are not re-injected.
- Cursor: prepended to the first ACP `session/prompt` text for the session; the
  resume cursor tracks a hash so unchanged prompts are not re-injected.

### Services exposed via REST API

| Service         | Endpoint               | Tool count |
| --------------- | ---------------------- | ---------- |
| Ticketing       | `/api/ticketing`       | 26+        |
| Managed Runs    | `/api/managed-runs`    | 6          |
| Scheduled Tasks | `/api/scheduled-tasks` | 9          |
| Prompts         | `/api/prompts`         | 5          |

Trade-off: one extra round-trip for tool discovery (`GET` before `POST`) in exchange for no up-front tool-slot cost. A future native-MCP delivery mode would slot into the same shared helper.

---

## 18. Desktop App (Electron)

The Electron shell wraps the server and web app into a native desktop application.

### Features

- **Native window** — Platform-appropriate title bar and window management.
- **Embedded browser** — Board toolbar browser mode mounts a per-project Electron `WebContentsView` with a URL bar and native Chromium rendering. Agent `/api/browser` calls drive the same visible view through the Electron CDP broker once `host.json` marks the project Electron-authoritative.
- **Protocol handler** — `t3://` scheme for internal navigation (e.g. `t3://ticket/T3CO-42`).
- **Auto-update** — Checks every 4 hours via electron-updater. Supports prerelease channels. GitHub token support for higher rate limits.
- **Shell environment sync** — Preserves the user's PATH and shell environment in the embedded server.
- **Native dialogs** — File picker, confirm dialogs, context menus via IPC.
- **Theme detection** — Follows system dark/light mode preference.

### IPC channels

- `desktop:pick-folder` — Native folder picker dialog.
- `desktop:confirm` — Native confirmation dialog.
- `desktop:set-theme` — Dark/light theme switching.
- `desktop:context-menu` — Right-click context menus.
- `desktop:open-external` — Open URLs and files externally.
- `desktop:update-*` — Update lifecycle (check, download, install, progress).
- `desktop:get-ws-url` — Get the backend WebSocket URL.
- `browser:*` — Embedded browser mount, bounds, navigation, URL, and unmount IPC.

### Embedded browser

The embedded browser is a native desktop-only project surface. The web renderer owns the chrome (URL bar and placeholder rect), while Electron main owns the `WebContentsView`, its per-project `persist:<projectId>` session, hidden-view throttling, and CDP debugger lifecycle. The server resolves `/api/browser` through the two-host model documented in [Browser Tools](browser-tools.md): Playwright remains the default headless host; Electron becomes authoritative for a project after first native mount and persists that choice in `browser/<projectId>/host.json`.

The v0.1 placement is intentionally the management-board browser toggle. The browser is project infrastructure, so future layout work can move it into a project-pane system without changing the host resolver, CDP broker, or REST tool surface.

### Build targets

- macOS DMG: `bun run dist:desktop:dmg`
- Linux AppImage: `bun run dist:desktop:linux`
- Windows NSIS: `bun run dist:desktop:win`

---

## 19. Startup Recovery

Handles server restarts gracefully when threads were mid-execution. See [startup-recovery.md](startup-recovery.md) for implementation details.

### Stale work detection

On startup, the server scans the orchestration state for sessions with `status === "running"` and active turns.

### Recovery modes

1. **Auto-resume enabled** (`resumeAgentsOnStartup: true`) — Server automatically re-enters the resume path for stale threads.
2. **Auto-resume disabled or failed** — UI shows a client-only "Was working" marker on affected threads.
   - Not persisted to orchestration state.
   - Auto-clears when the thread is opened or live activity resumes.

**User interaction:**

- See "Was working" indicators on threads that were active at shutdown.
- Manually resume threads by opening them and sending a new message.

---

## 20. Observability

Logging, tracing, and metrics for debugging and monitoring.

### Log destinations

| Destination   | Format                                      | Purpose                     |
| ------------- | ------------------------------------------- | --------------------------- |
| stdout        | Human-readable                              | Development console output  |
| Trace file    | NDJSON (`~/.t3/*/logs/server.trace.ndjson`) | Persisted spans with timing |
| Desktop logs  | `desktop-main.log`, `server-child.log`      | Packaged app diagnostics    |
| Timeline logs | `[timeline]` prefix, JSON                   | Structured event timeline   |

### Trace file schema

Each NDJSON record contains: `name`, `traceId`, `spanId`, `parentSpanId`, `durationMs`, `attributes`, `events`, and `exit` status (`Success`, `Failure`, `Interrupted`).

### OTLP export (optional)

- Traces: `T3CODE_OTLP_TRACES_URL` (default: disabled).
- Metrics: `T3CODE_OTLP_METRICS_URL` (default: disabled).
- Export interval: 10 seconds (configurable via `T3CODE_OTLP_EXPORT_INTERVAL_MS`).
- Service name: `t3-server` (configurable via `T3CODE_OTLP_SERVICE_NAME`).

### RPC instrumentation

All WebSocket RPC calls are instrumented with request/response tracing, error tracking, and duration measurement.

---

## 21. Keyboard Shortcuts

### Global shortcuts

| Shortcut                       | Action                  |
| ------------------------------ | ----------------------- |
| `Cmd+K` / `Ctrl+K`             | New thread (local)      |
| `Cmd+Shift+K` / `Ctrl+Shift+K` | New thread (worktree)   |
| `1-9`                          | Jump to thread by index |
| `←` / `→`                      | Previous / next thread  |
| `Escape`                       | Clear thread selection  |

### Chat shortcuts

| Shortcut           | Action                            |
| ------------------ | --------------------------------- |
| `Cmd+P` / `Ctrl+P` | File search                       |
| `Cmd+S` / `Ctrl+S` | Save file                         |
| `Cmd+W` / `Ctrl+W` | Close tab                         |
| `Escape`           | Close diff / file explorer panels |

### Terminal-aware behavior

Keyboard shortcuts are context-aware. When the terminal is focused, certain shortcuts (like arrow keys) pass through to the terminal instead of triggering navigation.

### Custom keybindings

Users can define custom shortcuts in `keybindings.json` with conditional expressions. See [Settings & Configuration](#15-settings--configuration) for the keybinding rule format.

---

## 22. Changelog

AI-generated release notes from git commit history. See [changelog.md](changelog.md) for implementation details.

### Generation

- Built at build time from the commit range since the last processed commit.
- An LLM (Codex with structured output) analyzes commits and produces categorized entries.
- Results cached in `.generated/changelog/cache.json`.
- Published as a static asset: `apps/web/public/generated/changelog.json`.
- Validated against the contracts schema.
- Provenance tracked: `lastProcessedCommit`, prompt version, rebuild caps.

### Categories

`feature`, `improvement`, `fix`, `performance`, `breaking`, `security`, `internal`.

**User interaction:**

- View changelog in Settings → Changelog.
- Entries grouped by date with color-coded category badges.
- Last processed commit reference displayed.

---

## 23. Attachment Storage

Immutable file storage for chat attachments (images, documents, etc.).

### Behavior

- Unique ID generation per attachment.
- Path traversal prevention.
- MIME type detection.
- Immutable cache-forever headers (max-age: 31536000).

### HTTP endpoints

- `GET /attachments/{id}` — Lookup by ID.
- `GET /attachments/{relative/path}` — Lookup by relative path.

**User interaction:**

- Attach files to messages via the composer.
- Inline image preview with expansion.

**Agent interaction:**

- Attachments are included in message metadata when sent to providers.
- Provider responses can reference attachments by ID.
