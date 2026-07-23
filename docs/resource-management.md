# Resource Management

How T3 Code manages memory, connections, and system resources across the server and client lifecycle.

## Startup Memory (Lazy Loading)

### Problem

The original `getSnapshot()` loaded the entire projection state into memory at startup: all threads, all messages, all activities. At scale (258K+ activities, 334K events), this consumed ~3 GB of V8 heap before a single WebSocket client connected, exceeding the default heap limit.

### Solution: Shallow Startup Snapshot

Startup now uses `getStartupSnapshot()` which returns **metadata only**: all projects and thread shell data (title, status, timestamps, session state, summary fields) without per-thread content arrays (messages, activities, checkpoints, proposed plans).

Pre-computed summary fields in the metadata include:

- `latestUserActivity` — most recent user message reference
- `pendingApprovalCount` / `pendingUserInputCount` — sidebar indicator counts
- `actionablePlanState` — whether a plan needs attention
- `lastActivitySummary` — text summary for the hydration loading state

This reduces startup memory from ~3 GB to ~20 MB.

### RPC Protocol

| RPC                                | Returns                                               | When                       |
| ---------------------------------- | ----------------------------------------------------- | -------------------------- |
| `orchestration.getStartupSnapshot` | Projects + thread metadata (no content)               | App boot, reconnection     |
| `orchestration.getThreadContent`   | Messages, activities, plans, checkpoints + `sequence` | User navigates to a thread |
| `orchestration.getSnapshot`        | Full read model (retained for compatibility)          | Not used in normal flow    |

## Lazy Thread Hydration

When a user clicks a thread that hasn't been loaded yet:

1. **Thread header renders immediately** from startup metadata (title, model, session status).
2. **Chat area shows a loading skeleton** — spinning loader, "Loading thread content..." text, the `lastActivitySummary` if available, and three animated placeholder blocks.
3. **Composer is disabled** during hydration.
4. **`getThreadContent` RPC fires** — returns full content plus a `sequence` number.
5. **Content appears**, composer enables.

Typical hydration latency is <100ms (local SQLite read).

### Sequence-Aware Reconciliation

Domain events continue arriving via WebSocket while a thread is being hydrated. The `sequence` field in the content response prevents duplicates:

1. Events for unloaded threads are queued in `pendingEvents` on the cache entry.
2. When content arrives with `sequence = N`, only pending events with `sequence > N` are replayed.
3. Events for loaded threads apply directly to the in-memory state.

This ensures no lost or duplicate messages across hydration, reconnection, or server restart.

### Domain Events for Unloaded Threads

Events targeting threads whose content is not loaded update **metadata only**:

- Sidebar badges (working, pending approval, pending input) update in real-time.
- Activity summary and timestamps update.
- No `getThreadContent` RPC fires until the user actually navigates to the thread.

### Orchestration Threads

Opening an orchestration parent thread does **not** bulk-load all child thread content. Instead:

1. **Child thread IDs** are fetched via a lightweight `getChildThreadIds` RPC (no snapshot, no content).
2. **All children** are hydrated in parallel via per-thread `getThreadContent` calls — each as an independent lightweight SQLite query, not a full snapshot load.
3. The **switcher menu** works immediately from startup snapshot metadata — it only needs thread titles, status badges, and ticket identifiers, not message content.
4. The **orchestration timeline** shows a loading state until the parent and all required child threads are hydrated.

The key difference from the startup path: child threads are bounded by the orchestration's ticket count (typically 2-20 threads), so hydrating all of them in parallel is fast. The old approach loaded a full system-wide snapshot to extract a few children.

## Bounded Content Cache

Loaded thread content is held in a client-side LRU cache with a configurable size limit.

### Configuration

The cache size is controlled by the **Thread content cache** setting in Settings > General:

| Setting         | Behavior                                                |
| --------------- | ------------------------------------------------------- |
| `0` (Unlimited) | No eviction — all loaded threads stay in memory         |
| `1` (default)   | 1 GB budget, LRU eviction of oldest unprotected threads |
| `2`, `4`, `8`   | Corresponding GB budgets                                |

Server setting key: `threadContentCacheMaxGB` (persisted in `settings.json`).

### Eviction Policy

When total cached content exceeds the budget:

1. Threads are sorted by `lastAccessedAt` (least recent first).
2. **Protected threads are never evicted:**
   - The currently focused (viewed) thread
   - Threads visible in the current route
   - Threads with active provider sessions (running, connecting, idle, ready)
3. Unprotected threads are evicted oldest-first until the cache is within budget.
4. Eviction sets `messages` back to `"not-loaded"` and clears content arrays.
5. Re-navigating to an evicted thread triggers a fresh `getThreadContent` RPC.

### Size Estimation

Each thread's memory footprint is estimated from:

- Base overhead: 512 bytes per thread
- Per message: 256 + text byte length
- Per proposed plan: 256 + markdown byte length
- Per checkpoint: 256 + 128 per file
- Per activity: 512 + metadata size

## Board Ticket Summary Cache

Board mode keeps ticket summaries in a client-side, RAM-only cache keyed by project ID.

This cache is intentionally separate from the thread content cache:

- It stores only `TicketSummary` data used by the board columns and list view.
- It does **not** store ticket bodies, comments, artifacts, history, or criteria.
- It is cleared on app reload and is not persisted to localStorage or SQLite.
- It has no eviction policy in v1; ticket summaries are small enough that UX smoothness is preferred until profiling shows a real memory problem.

### Board Loading Behavior

When a project board is opened:

1. If that project has no cached ticket summaries, the board shows its normal loading state and calls `ticketing.list`.
2. If that project is cached, the board renders immediately from RAM.
3. Cached projects refresh in the background after a short freshness window, but refreshing never blanks the board.
4. Ticket stream events patch cached projects in place. Events for uncached projects are ignored because those projects will load fresh when opened.

This means switching between already-loaded projects in Board mode does not repeatedly clear and reload the visible board.

## Idle Session Timeout

Provider sessions (Codex app-server processes, Claude SDK connections, Gemini ACP processes) consume system resources: child processes, MCP server connections, memory.

### Claude Runtime Compatibility

T3 Code pins `@anthropic-ai/claude-agent-sdk` exactly at `0.3.207`, which bundles
Claude Code `2.1.207`. This pair is the tested compatibility boundary, not a
floating minimum. Future SDK upgrades must review the Anthropic changelog, the
exported runtime types, bundled executable layout, terminal reasons, control
methods, and native-package metadata before changing the pin.

By default the SDK launches the Claude Code executable from its platform-native
optional package. A configured Claude binary path is passed through
`pathToClaudeCodeExecutable` and overrides that default. Desktop artifact staging
installs production dependencies with the requested target OS and CPU, so macOS
arm64 and x64 builds receive `@anthropic-ai/claude-agent-sdk-darwin-arm64` and
`@anthropic-ai/claude-agent-sdk-darwin-x64`, respectively.

Claude process recovery does not call `Query.reinitialize()` speculatively.
That API is reserved for a detected control-channel gap while the same process
is still valid. A process exit or restart creates a new query with the preserved
resume cursor. Every stop path must mark the binding stopped with
`directory.upsert({ status: "stopped" })`; it must never delete the binding or
its resume cursor.

The **Idle session timeout** setting automatically stops sessions that have been inactive:

| Setting        | Behavior                                         |
| -------------- | ------------------------------------------------ |
| `0` (Never)    | Sessions run indefinitely until manually stopped |
| `30`           | Stopped after 30 minutes idle                    |
| `60` (default) | Stopped after 1 hour idle                        |
| `120`, `240`   | 2 or 4 hours                                     |

When a session is stopped by the idle reaper:

- The resume cursor is **preserved** (via `directory.upsert({ status: "stopped" })`, never `directory.remove()`).
- MCP servers attached to the session are torn down.
- The thread appears idle in the sidebar.
- Sending a new message cold-starts a fresh session but resumes the conversation via the preserved cursor.

Claude's live `background_tasks_changed` message is a process-scoped level
snapshot. Each message replaces the prior live set; session start, stop, stream
exit, and resume-cursor restart reset it to empty. Detailed `task_started`,
`task_progress`, and task completion/notification messages remain independent
edge events in the action history and are never correlated to the level
snapshot's task IDs.

Server setting key: `idleSessionTimeoutMinutes` (persisted in `settings.json`).
