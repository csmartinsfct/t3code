# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Rules

### NEVER destroy provider session resume cursors

The resume cursor (`ProviderRuntimeBinding.resumeCursor`) is the ONLY mechanism for restoring conversation context after a session is stopped. It contains the Anthropic session ID that lets a new CLI process resume a prior conversation. Without it, sessions start completely fresh and the user loses all conversation history.

- **NEVER call `directory.remove(threadId)`** in production code. This deletes the binding and its resume cursor permanently.
- When stopping a session (idle reaper, explicit stop, shutdown), use `directory.upsert({ status: "stopped" })` to mark it stopped while preserving the cursor.
- The only acceptable place for `directory.remove` is in test cleanup code.
- Any code path that transitions a session to stopped/closed MUST preserve the binding's resume cursor.

This rule exists because the idle reaper previously called `directory.remove()` after stopping idle sessions, which permanently destroyed resume cursors and caused users to lose conversation context after periods of inactivity. The graceful shutdown path (`runStopAll`) correctly uses `directory.upsert({ status: "stopped" })` — all other stop paths must follow the same pattern.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.

## Codex App Server (Important)

T3 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `apps/server/src/codexAppServerManager.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/wsServer.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Internal Docs

- [Managed Runs](docs/managed-runs.md) — Actions, REST API, service health checks, injected prompts, UI components, and run lifecycle.
- [Startup Recovery](docs/startup-recovery.md) — Restart-time stale work detection, startup auto-resume, and the client-only `Was working` marker.
- [Prompts](docs/prompts.md) — Prompt definitions, scope-aware overrides, validation, deterministic preview rendering, and prompt-management REST APIs.
- [Changelog](docs/changelog.md) — Build-time AI changelog generation, cache/runtime asset formats, Codex structured-output flow, incremental commit processing, and Settings UI integration. `docs/chage-log.md` is a convenience entrypoint that redirects back to this canonical doc.
- [Scheduled Tasks](docs/scheduled-tasks.md) — Recurring task scheduler, REST API, cron expressions, UI settings, and propose card flow.
- [Ticketing](docs/ticketing.md) — Tickets with hierarchy, dependencies, labels, comments, artifacts, acceptance criteria, audit history, REST API tools, and Settings UI.
- [Agent Tools](docs/t3-agent-tools.md) — How internal services are exposed to AI sessions, delivery modes (native tools vs HTTP endpoints), injection flow, and adding new services.
- [Multi-Layout](docs/multi-layout.md) — Board view with Kanban ticket management, drag-and-drop reordering/status changes, nested sidebar layout, and ticket composer attachments.
- [Design Language](docs/design-language.md) — Prescriptive design system reference: color tokens, typography, spacing, component patterns, animations, layout recipes, and anti-patterns. Used as context for LLM-generated UIs.
- [Features](docs/features.md) — Exhaustive product feature catalog: what each feature is, how users interact with it, and how agents interact via REST API.
- [Visibility](docs/visibility.md) — Practical debugging guide: lifecycle logs, timeline logs, provider event logs, log file locations, context-loss investigation workflow, and logging best practices.
- [Observability](docs/observability.md) — Tracing infrastructure, OTLP export, metrics, span/trace debugging, Grafana setup, and instrumentation patterns.
- [Resource Management](docs/resource-management.md) — Lazy loading, shallow startup snapshot, thread content cache (LRU eviction, configurable size), idle session timeout, and memory optimization.
- [Gemini Provider](docs/gemini-provider.md) — Gemini ACP integration, T3 MCP tool delivery, approvals/user input, usage telemetry, fork/resume limitations, attachments, structured output, and auth detection.

These docs must be kept up to date as related code changes.

## Bug Investigation Protocol

**When a bug is reported, always inspect logs first before making code changes.**

1. **Get the threadId** from the user or the UI.
2. **Read `~/.t3/{env}/logs/provider/{threadId}.lifecycle.log`** — this shows every session decision, state transition, and recovery attempt. It's small and focused.
3. **Read `~/.t3/{env}/logs/provider/{threadId}.log`** — raw provider events if you need token counts, streaming details, or SDK-level data.
4. **Check timeline logs** — `grep '[timeline]' desktop-main.log server-child.log` for cross-boundary event flow.
5. **If the bug is in the past**: reconstruct the timeline from existing log files. The lifecycle log is usually sufficient.
6. **If reproducing**: tail logs live (`tail -f *.lifecycle.log`) while triggering the bug. Use the chrome-devtools MCP to interact with the running app, inspect state, and observe behavior in real time.

See [Visibility](docs/visibility.md) for the full debugging reference including common issue patterns (context loss, rate limit recovery, stuck turns, orphaned sessions).

## Dev Server

The dev server listens on `http://localhost:3773` by default (configurable via `T3CODE_PORT` env var or `--port` CLI flag). REST API endpoints are available at:

- `http://localhost:3773/api/ticketing`
- `http://localhost:3773/api/prompts`
- `http://localhost:3773/api/managed-runs`
- `http://localhost:3773/api/scheduled-tasks`

Auth: `Authorization: Bearer t3-dev-bypass` (dev-only bypass token). Ticketing and managed-runs endpoints require a `?projectId=<uuid>` query param.

If the tools in this session are connected to the wrong instance (e.g. production), use these endpoints directly or write to the dev database at `~/.t3/dev/state.sqlite`.

## Data Directories

The T3 server persists state in `~/.t3/` (overridable via `T3CODE_HOME`).

- **Production** (`apps/desktop` packaged build): `~/.t3/userdata/`
- **Dev** (`bun run dev` / `bun run dev:desktop`): `~/.t3/dev/`

Each directory contains:

- `state.sqlite` — main SQLite database (orchestration events, projections, ticketing, managed runs, scheduled tasks)
- `keybindings.json`, `settings.json` — user config
- `attachments/` — uploaded files
- `logs/` — server and provider logs

Electron also stores Chromium profile data (localStorage, cookies) under `~/Library/Application Support/t3code/` (production) or `~/Library/Application Support/t3code-dev/` (dev).

**Important:** The production database contains real user data. Never run destructive operations (DROP TABLE, DELETE without WHERE, schema-breaking ALTERs) against it. Migrations must be additive and idempotent where possible. If a migration was already run and needs schema changes, create a new migration — never edit a migration that has already executed on production databases.

## Skills (`.claude/skills/`)

- `debug` — Investigate bugs using lifecycle logs, provider event logs, and timeline logs. Use `/debug THREAD_ID` when a bug is reported.
- `start-electron-dev` — Start the Electron dev stack (`bun run dev:desktop`).
- `production-build` — Build a production macOS DMG via `scripts/build-desktop-artifact.ts`.
- `test-managed-runs-mcp` — Test the managed runs REST endpoint end-to-end using the dev bypass token.
- `test-orchestration` — End-to-end orchestration test: reset test repo, create tickets, run orchestration with real models, verify via chrome-devtools MCP.

Skills must be kept up to date as related code changes. When modifying behavior covered by a skill or doc, review and update the corresponding file.
