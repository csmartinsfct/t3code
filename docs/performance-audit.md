# T3 Code Runtime Performance Audit

**Date:** 2026-04-06
**Scope:** Stable runtime performance after initial launch. Focus on WebSocket communication, event pipeline, state management, and specific laggy operations (stop model, send message, delete archived threads).

---

## Executive Summary

The app has a multi-layer event pipeline: **Codex app-server (stdio/JSON-RPC) -> Node.js server (Effect RPC) -> WebSocket -> React frontend (Zustand)**. Each layer adds serialization, validation, and transformation overhead. The biggest performance issues cluster around:

1. **Sequential operations where parallelism is possible** (bulk delete, message send pipeline)
2. **Unbounded queues with serial processing** (orchestration command queue)
3. **Excessive state rebuilds** on every event (Zustand store spreads entire state)
4. **Schema validation on every WebSocket message** (Effect RPC + Schema decode)
5. **O(n) thread lookups** in selectors used by many components

---

## Layer 1: Codex App-Server Integration (stdio/JSON-RPC)

### Finding 1.1: `spawnSync` blocks the event loop on session startup

**Location:** `apps/server/src/codexAppServerManager.ts:474`
**Severity:** Medium
**Detail:** `assertSupportedCodexCliVersion()` uses `spawnSync` to check the CLI version, blocking the entire Node.js event loop during session creation. While this only happens at session start, it can freeze in-flight WebSocket messages and event processing for all other sessions.

### Finding 1.2: No backpressure on stdin writes

**Location:** `apps/server/src/codexAppServerManager.ts:1264`
**Severity:** Medium
**Detail:** `context.child.stdin.write()` return value is never checked. Node.js streams return `false` when the internal buffer exceeds `highWaterMark` (~16KB). Under high-throughput scenarios (large attachments, rapid turn starts), writes could silently buffer without flow control, increasing memory pressure and latency.

### Finding 1.3: Synchronous JSON.parse on every Codex message

**Location:** `apps/server/src/codexAppServerManager.ts:1015`
**Severity:** Low-Medium
**Detail:** Every line from Codex stdout is `JSON.parse()`'d synchronously in the readline `line` handler. For large event payloads (e.g., full file diffs in turn completions), this blocks the event loop proportionally to payload size.

### Finding 1.4: Event listeners not deregistered on session stop

**Location:** `apps/server/src/codexAppServerManager.ts:910-937` vs `970-1009`
**Severity:** Low
**Detail:** `attachProcessListeners()` adds 4 listeners (readline line, stderr data, child error, child exit) but `stopSession()` only calls `context.output.close()` and kills the child process — no explicit `.off()` calls. While the process termination should trigger cleanup, there's a window where listener closures keep the session context alive in memory, preventing GC until the process fully exits.

### Finding 1.5: Sequential session startup requests

**Location:** `apps/server/src/codexAppServerManager.ts:515-611`
**Severity:** Low
**Detail:** `initialize`, `model/list`, `account/read`, and `thread/start` are all awaited sequentially. `model/list` and `account/read` are independent and could be parallelized, saving one round-trip (~20-100ms).

---

## Layer 2: Server-Side Event Pipeline (OrchestrationEngine)

### Finding 2.1: Unbounded command queue with strictly serial processing

**Location:** `apps/server/src/orchestration/Layers/OrchestrationEngine.ts:82-83, 275`
**Severity:** High
**Detail:**

```typescript
const commandQueue = yield * Queue.unbounded<CommandEnvelope>();
// ...
Effect.forever(Queue.take(commandQueue).pipe(Effect.flatMap(processEnvelope)));
```

Every command (send message, stop, delete thread, archive, etc.) enters a single unbounded FIFO queue processed by one sequential fiber. Each `processEnvelope` involves:

- Command receipt deduplication (DB read)
- Event store transaction (DB write)
- Projection pipeline update (in-memory)
- PubSub publish to all subscribers

If commands arrive faster than they're processed (e.g., deleting 50 archived threads), they queue up linearly. At ~50-100ms per command, 50 threads = 2.5-5s of queued latency where later commands feel "stuck."

### Finding 2.2: Unbounded PubSub broadcasts to all subscribers without filtering

**Location:** `apps/server/src/orchestration/Layers/OrchestrationEngine.ts:83, 107-109, 189`
**Severity:** Medium
**Detail:** `PubSub.unbounded<OrchestrationEvent>()` delivers every event to every subscriber (WebSocket clients, ProviderRuntimeIngestion, CheckpointReactor). No event-type filtering at the subscription level. Large turn-diff payloads are broadcast to all consumers even if most don't need them.

### Finding 2.3: Per-subscriber sequence deduplication map can grow unbounded

**Location:** `apps/server/src/ws.ts:269-308`
**Severity:** Low-Medium
**Detail:** Each WebSocket client subscription to `subscribeOrchestrationDomainEvents` maintains an in-memory `Map<number, OrchestrationEvent>` for reordering out-of-sequence events. If a sequence gap occurs (e.g., event N is delayed while N+1..N+100 arrive), this map holds 100 full event objects with no upper bound or timeout.

---

## Layer 3: WebSocket Transport & Serialization

### Finding 3.1: Effect Schema validation on every WebSocket message

**Location:** `apps/server/src/ws.ts:738` (server), `apps/web/src/rpc/protocol.ts` (client)
**Severity:** High
**Detail:** Both server and client use `RpcSerialization.layerJson` which runs full Effect Schema decode/encode on every message. The orchestration event schema alone has 15+ discriminated union variants with nested structures. Each decode involves:

1. JSON parse
2. Discriminator matching across union variants
3. Type coercions (TrimmedString, branded types, defaults)
4. Error handling infrastructure

For high-frequency streams (terminal output: ~100 msg/sec, orchestration: ~10 msg/sec), this is significant per-message overhead. The validation is valuable for external inputs but redundant for server-to-client pushes where the server already constructed valid events.

### Finding 3.2: No WebSocket message compression

**Location:** `apps/server/src/ws.ts`
**Severity:** Medium
**Detail:** No `permessage-deflate` or application-level compression. Every event is sent as raw JSON. Orchestration events carry repeated metadata fields (`threadId`, `aggregateId`, `occurredAt`, `commandId`, `correlationId`) on every message — ~200+ bytes of overhead per event that compresses well.

### Finding 3.3: No message batching for rapid event sequences

**Location:** `apps/server/src/orchestration/Layers/OrchestrationEngine.ts:107-109, 189`
**Severity:** Medium
**Detail:** Events are published to PubSub individually. When a single command produces multiple events (e.g., thread creation emits `thread.created` + `thread.meta-updated`), each is serialized, sent, and decoded independently. Batching into a single WebSocket frame would halve the per-message overhead.

### Finding 3.4: RPC instrumentation adds timing overhead to every request

**Location:** `apps/server/src/observability/RpcInstrumentation.ts:64, 101`
**Severity:** Low
**Detail:** Every RPC method call is wrapped with span annotation and `Date.now()` calls for duration metrics. While individually cheap (~0.01ms), this compounds across high-frequency streams.

---

## Layer 4: Frontend State Management (Zustand)

### Finding 4.1: O(n) thread lookups on every selector call

**Location:** `apps/web/src/store.ts:1156-1159`
**Severity:** High
**Detail:**

```typescript
export const selectThreadById =
  (threadId: ThreadId | null | undefined) =>
  (state: AppState): Thread | undefined =>
    threadId ? state.threads.find((thread) => thread.id === threadId) : undefined;
```

This `.find()` runs on every Zustand state change that triggers a component re-render. With 200+ threads, every component using `useThreadById()` pays O(n) per state update. Should use a `Map<ThreadId, Thread>` or `Record<ThreadId, Thread>` for O(1) lookups.

### Finding 4.2: Full state spread on every thread update

**Location:** `apps/web/src/store.ts:535-572`
**Severity:** Medium-High
**Detail:** `updateThreadState()` always creates a new root state object (`{ ...state, threads, ... }`). While the `sidebarThreadSummariesEqual` check prevents unnecessary sidebar rebuilds, the `threads` array is always a new reference if any thread changed, which triggers re-renders in every component that selects from `threads`.

### Finding 4.3: `buildSidebarThreadSummary` does expensive derivations on every thread update

**Location:** `apps/web/src/store.ts:213-232`
**Severity:** Medium
**Detail:** Every call to `updateThreadState` triggers `buildSidebarThreadSummary()` which:

- `derivePendingApprovals(thread.activities)` — iterates all activities
- `derivePendingUserInputs(thread.activities)` — iterates all activities again
- `hasActionableProposedPlan(findLatestProposedPlan(...))` — iterates proposed plans
- `getLatestUserMessageAt(thread.messages)` — iterates all messages

For threads with 100+ messages and activities, this is measurable work done even when the update was just a session status change.

### Finding 4.4: `thread.deleted` event handler does filter + find + spread

**Location:** `apps/web/src/store.ts:695-713`
**Severity:** Medium
**Detail:**

```typescript
const threads = state.threads.filter((thread) => thread.id !== event.payload.threadId);
const deletedThread = state.threads.find((thread) => thread.id === event.payload.threadId);
const sidebarThreadsById = { ...state.sidebarThreadsById };
delete sidebarThreadsById[event.payload.threadId];
```

Each deletion iterates the threads array twice (filter + find) and shallow-copies the entire `sidebarThreadsById` record. When deleting N archived threads, this is O(N \* T) where T = total thread count, plus N full copies of `sidebarThreadsById`.

### Finding 4.5: Event batching uses microtask but no coalescing window

**Location:** `apps/web/src/routes/__root.tsx:313-423`
**Severity:** Medium
**Detail:** Incoming domain events accumulate in `pendingDomainEvents[]` and flush via `queueMicrotask`. This batches events that arrive in the same microtask tick, but WebSocket messages arriving across multiple ticks (common with individual PubSub publishes from the server) each trigger a separate flush → separate state update → separate re-render cycle. A small time-based coalescing window (e.g., 16ms / one animation frame) would batch more effectively.

### Finding 4.6: Sidebar thread list is not virtualized

**Location:** `apps/web/src/components/Sidebar.tsx`
**Severity:** Medium
**Detail:** While the message timeline uses `@tanstack/react-virtual`, the sidebar renders all thread items as DOM nodes. With 200+ threads across multiple projects, this creates a large DOM tree that must be reconciled on every state change. The `THREAD_PREVIEW_LIMIT = 6` only limits the preview section, not archived or full lists.

---

## Layer 5: Specific Laggy Operations Traced End-to-End

### Operation A: "Delete All Archived Threads"

**Critical Path:**

```
User clicks "Delete All" →
  confirm dialog (blocks) →
  for each archived thread (SEQUENTIAL):
    if session running → dispatchCommand("thread.session.stop") → await
    terminal.close() → await
    dispatchCommand("thread.delete") → await
    optionally: navigate + remove worktree
```

**Location:** `apps/web/src/components/settings/SettingsPanels.tsx:1631-1660`, `apps/web/src/hooks/useThreadActions.ts:67-166`

**Root Causes:**

1. **Sequential loop:** `for (const id of allArchivedThreadIds) { await deleteThread(id, ...) }` — each thread deletion awaits completion before starting the next.
2. **Multiple RPCs per thread:** Each `deleteThread` can make up to 3 sequential RPC calls (session stop, terminal close, thread delete) plus navigation and worktree cleanup.
3. **Server-side serial command queue:** Even if parallelized on the client, the server processes each command one at a time (Finding 2.1).
4. **Per-delete state rebuild:** Each `thread.deleted` event triggers a full `threads.filter()` + `sidebarThreadsById` copy (Finding 4.4).

**Estimated latency for 50 archived threads:** 50 \* (50ms session stop + 30ms terminal close + 50ms delete + state rebuild) = **~6.5-10 seconds minimum**.

**Recommendations:**

- Add a bulk `thread.bulk-delete` command that accepts an array of thread IDs, processed as one transaction server-side.
- On the client, issue all delete commands in parallel with `Promise.all` (or at least `Promise.allSettled`), since each thread's deletion is independent.
- Batch the resulting state updates into a single store update.

---

### Operation B: "Stop a Model / Interrupt Turn"

**Critical Path:**

```
User clicks Stop →
  UI dispatches "thread.turn.interrupt" command →
  Server: command enters OrchestrationEngine queue →
  Server: processEnvelope → emits "thread.turn-interrupt-requested" event →
  Server: ProviderCommandReactor reacts → calls providerService.interruptTurn() →
  Server: providerService routes to CodexAdapter.interruptTurn() →
  Server: CodexAdapter sends "turn/interrupt" JSON-RPC to codex app-server →
  Codex processes interrupt → emits turn completion events →
  Events flow back through pipeline → UI updates
```

**Location:** `apps/server/src/orchestration/decider.ts:516-536`, `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:716-736`, `apps/server/src/provider/Layers/ProviderService.ts:472-507`, `apps/server/src/codexAppServerManager.ts:773-790`

**Root Causes:**

1. **Command queue serialization:** The interrupt command enters the same serial queue as all other commands. If other commands are ahead in the queue (e.g., pending message events), the interrupt waits.
2. **Reactor indirection:** The actual `interruptTurn()` call happens in a reactor that subscribes to events, not in the command dispatch path. This adds at least one event-loop tick of latency.
3. **No priority queue:** Interrupt commands should bypass the regular queue or have higher priority, but the queue is a simple FIFO.
4. **20s default timeout:** The JSON-RPC `turn/interrupt` request has a 20s timeout (codexAppServerManager.ts:1231), meaning the UI won't get error feedback for slow interrupts until timeout.

**Recommendations:**

- Implement priority channels for interrupt/stop commands that bypass the regular command queue.
- Consider optimistic UI: immediately show "stopping" state before server confirms, and reconcile if the command fails.
- Reduce the interrupt request timeout to 5s — an interrupt that takes 20s has already failed.

---

### Operation C: "Send a Message"

**Critical Path (worst case — new thread + worktree):**

```
User submits message →
  Image processing (sync file reads) →
  Optimistic message added to state →
  forceStickToBottom() (DOM measurement) →
  await createWorktreeMutation (if worktree mode) →
  await dispatchCommand("terminal.state-sync") (sequential) →
  await dispatchCommand("thread.create") (if new thread) →
  await setup script execution (if configured) →
  await dispatchCommand("thread.meta.update") (auto-title) →
  await persist thread settings →
  await dispatchCommand("thread.turn.start") →
  ... all events flow back through pipeline
```

**Location:** `apps/web/src/components/ChatView.tsx:3404-3703`

**Root Causes:**

1. **7+ sequential await steps:** Each step blocks the next. Independent steps (auto-title, settings persist, terminal sync) could be parallelized.
2. **Synchronous image processing:** `readFileAsDataUrl` blocks the main thread for large images.
3. **Multiple state updates in sequence:** Several `setState` calls before the actual send, each potentially triggering re-renders.
4. **Server-side serial processing:** Even after the turn start command reaches the server, it enters the serial command queue.

**Recommendations:**

- Parallelize independent operations (auto-title, settings persist, terminal state sync can happen concurrently with or after `thread.turn.start`).
- Move image processing to a Web Worker or at least make it async with chunked reading.
- Consider sending the turn start command first (the thing the user is waiting for) and doing bookkeeping operations after.

---

## Summary: Ranked Bottlenecks

| #   | Issue                                       | Severity        | Layer             | Impact on User                           |
| --- | ------------------------------------------- | --------------- | ----------------- | ---------------------------------------- |
| 1   | Sequential bulk delete (N+1 problem)        | **Critical**    | Frontend + Server | 6-10s+ for 50 threads                    |
| 2   | Serial orchestration command queue          | **High**        | Server            | All commands queue behind each other     |
| 3   | Schema validation on every WS message       | **High**        | Transport         | Per-message decode overhead on hot paths |
| 4   | O(n) thread lookups in selectors            | **High**        | Frontend          | Scales with thread count, many callers   |
| 5   | Sequential message send pipeline            | **High**        | Frontend          | 500-2000ms+ added latency per send       |
| 6   | No interrupt command priority               | **Medium-High** | Server            | Stop command queued behind other work    |
| 7   | Per-event state rebuild with full spreads   | **Medium**      | Frontend          | Re-render storm during event bursts      |
| 8   | No WS message batching                      | **Medium**      | Transport         | Per-message serialization overhead       |
| 9   | Event flush on microtask (no time window)   | **Medium**      | Frontend          | Missed batching opportunities            |
| 10  | No WebSocket compression                    | **Medium**      | Transport         | ~200 bytes overhead per event            |
| 11  | Sidebar not virtualized                     | **Medium**      | Frontend          | Large DOM with 200+ threads              |
| 12  | `buildSidebarThreadSummary` on every update | **Medium**      | Frontend          | Redundant derivations                    |
| 13  | `spawnSync` during session startup          | **Medium**      | Server            | Blocks event loop                        |
| 14  | No stdin backpressure handling              | **Medium**      | Server            | Potential data loss under load           |
| 15  | Unbounded PubSub (no filtering)             | **Medium**      | Server            | All consumers get all events             |

---

## Quick Wins (High Impact, Low Effort)

1. **Thread lookup index:** Replace `state.threads.find()` with a `Map<ThreadId, Thread>` — touches 1 file, fixes Finding 4.1.
2. **Parallel bulk delete:** Change `for...await` to `Promise.allSettled()` in `handleDeleteAllArchived` — touches 1 file, fixes Operation A.
3. **Reorder message send:** Move `thread.turn.start` dispatch earlier, do bookkeeping after — touches 1 file, fixes Operation C.
4. **Time-based event coalescing:** Replace `queueMicrotask` flush with `requestAnimationFrame` or 16ms `setTimeout` — touches 1 file, improves Finding 4.5.
5. **Interrupt priority channel:** Add a second queue or `Queue.offer` that bypasses the main command queue for interrupt commands — fixes Operation B.
