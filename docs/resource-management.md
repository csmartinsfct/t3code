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
2. The **4 most recent children** are eagerly hydrated in parallel via per-thread `getThreadContent` calls.
3. **Remaining children** hydrate on demand when the user navigates to them via the thread switcher.
4. The **switcher menu** works immediately from startup snapshot metadata — it only needs thread titles, status badges, and ticket identifiers, not message content.
5. The **orchestration timeline** shows a loading state until the parent and all required child threads are hydrated.

For small orchestrations (4 or fewer children), all threads are eagerly hydrated. For larger runs, only the most recent work is loaded upfront.

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

## Idle Session Timeout

Provider sessions (Codex app-server processes, Claude SDK connections) consume system resources: child processes, MCP server connections, memory.

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

Server setting key: `idleSessionTimeoutMinutes` (persisted in `settings.json`).
