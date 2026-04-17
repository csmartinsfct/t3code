# Visibility: Debugging with Logs

This document is the practical guide for investigating bugs using T3 Code's logging infrastructure. For the full tracing/metrics/OTLP reference, see [Observability](observability.md).

**When a bug is reported, always inspect logs first.** Either look at past logs if the bug already happened, or reproduce it while tailing logs. If the user is present, use chrome-devtools MCP to interact with the running app and observe behavior in real time.

## Bug Investigation Workflow

1. **Get the threadId** from the user or the UI
2. **Read the lifecycle log** — `{threadId}.lifecycle.log` (small, focused, shows session decisions)
3. **Read the event log** — `{threadId}.log` (raw provider events, streaming data)
4. **Check the server trace** — `server.trace.ndjson` (spans, timing, Effect logs)
5. **Check client logs** — `desktop-main.log` or browser console (timeline breadcrumbs)
6. **If reproducing**: tail logs live while triggering the bug via chrome-devtools MCP

## Log File Locations

All logs live under `~/.t3/{env}/logs/` where `{env}` is `userdata` (production) or `dev` (dev mode).

| File                                      | Content                                    | Format                           | Rotation            |
| ----------------------------------------- | ------------------------------------------ | -------------------------------- | ------------------- |
| `provider/{threadId}.lifecycle.log`       | Session lifecycle decisions                | NDJSON, `LFCYL:` prefix          | 5 MB, 5 files       |
| `provider/{threadId}.log`                 | Raw provider events (native + canonical)   | NDJSON, `NTIVE:`/`CANON:` prefix | 10 MB, 10 files     |
| `server.trace.ndjson`                     | Effect spans with timing and embedded logs | NDJSON (`TraceRecord`)           | 10 MB, 10 files     |
| `desktop-main.log`                        | Electron main process + renderer timeline  | Plain text                       | Desktop builds only |
| `server-child.log`                        | Embedded server stdout/stderr              | Plain text                       | Desktop builds only |
| `managed-runs/{projectId}/{runId}.ndjson` | Managed run output                         | NDJSON                           | 2-day retention     |
| `terminals/`                              | Terminal session output                    | Plain text                       | Per-session files   |

## Lifecycle Logs (LFCYL)

These are the most important logs for debugging context loss, session failures, and recovery issues. Each thread gets a `.lifecycle.log` file that records every session decision point.

**Format**: `[ISO_TIMESTAMP] LFCYL: {scope, event, threadId, sessionId, turnId, ...details}`

### Scopes and Events

#### `claude-adapter` — Session lifecycle within the Claude SDK adapter

| Event                            | When                                     | Key Details                                                                                  |
| -------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `session.start.begin`            | Entry to startSession                    | `resumeCursor`, `modelSelection`, `runtimeMode`, `cwd`                                       |
| `session.start.resume-state`     | After parsing resume cursor              | `resume` (session ID), `resumeSessionAt`, `turnCount`, `isFork`                              |
| `session.start.existing-cleanup` | Stopping old session before new one      | `existingSessionStopped`, `existingSessionStatus`                                            |
| `session.start.success`          | Session created successfully             | `sessionId`, `resumeSessionId`, `isFork`, `model`                                            |
| `session.stop.begin`             | Entry to stop                            | `alreadyStopped`, `sessionStatus`, `pendingApprovalsCount`, `hasTurnState`, `hasStreamFiber` |
| `session.stop.already-stopped`   | Idempotency guard hit                    | (session was already stopped)                                                                |
| `session.stop.complete`          | Session fully torn down                  | `removedFromMap`, `emitExitEvent`                                                            |
| `stream.exit`                    | Stream fiber exits                       | `exitType` (`rate-limit`/`interrupted`/`error`/`success`)                                    |
| `stream.exit.rate-limit`         | Rate limit — session preserved           | `sessionPreserved: true`, `message` (truncated)                                              |
| `stream.exit.destroyed`          | Non-rate-limit error — session destroyed | `reason`                                                                                     |
| `resume-cursor.updated`          | Cursor state changes                     | `resumeSessionId`, `lastAssistantUuid`, `turnCount`                                          |
| `turn.send.begin`                | Sending a turn                           | `hasStreamFiber`, `triggeringRecovery`, `inputPreview` (100 chars), `model`                  |
| `turn.send.stream-recovery`      | Rebuilding stream after rate limit       | `resumeSessionId`                                                                            |
| `stream.recreate.begin`          | Stream recreation starting               | `resumeSessionId`                                                                            |
| `stream.recreate.success`        | Stream recreation completed              |                                                                                              |
| `turn.complete`                  | Turn finished                            | `status`, `turnCount`, `errorMessage` (truncated)                                            |
| `thread-id.resolved`             | Provider thread ID received from SDK     | `providerThreadId`, `isNew`                                                                  |

#### `reactor` — Session decision logic in ProviderCommandReactor

| Event                        | When                                         | Key Details                                                                                             |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ensure-session.begin`       | Entry to ensureSessionForThread              | `hasExistingSession`, `existingSessionStatus`                                                           |
| `ensure-session.reuse`       | Reusing existing session (no restart needed) | `existingSessionThreadId`                                                                               |
| `ensure-session.restart`     | Restarting session                           | ALL decision flags (`activeSessionMissing`, `providerChanged`, `cwdChanged`, etc.), full `resumeCursor` |
| `ensure-session.fresh-start` | Starting fresh (no prior session)            | `reason`                                                                                                |
| `ensure-session.fork`        | Fork decision                                | `forkType` (`sdk`/`generic`), `sourceProvider`, `targetProvider`                                        |
| `turn-send.dispatching`      | Dispatching turn to provider                 | `inputPreview`, `model`, `hasForkContext`                                                               |

#### `provider-service` — Turn dispatch and session management

| Event             | When                           | Key Details                                                                       |
| ----------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| `session.start`   | After resume cursor resolution | `provider`, `hasResumeCursor`, `cursorSource` (`input`/`binding-fallback`/`none`) |
| `turn.send`       | Turn routing to adapter        | `provider`, `model`                                                               |
| `session.stop`    | Session stop request           | `provider`, `sessionWasActive`                                                    |
| `session.recover` | Recovery attempt from binding  | `provider`, `hasResumeCursor`, `strategy`                                         |

#### `directory` — ProviderSessionDirectory binding changes

| Event            | When                       | Key Details                             |
| ---------------- | -------------------------- | --------------------------------------- |
| `binding.upsert` | Binding created or updated | `provider`, `status`, `hasResumeCursor` |
| `binding.remove` | Binding deleted            | `threadId`                              |

#### `startup` — Server startup recovery

| Event                     | When                        | Key Details                                            |
| ------------------------- | --------------------------- | ------------------------------------------------------ |
| `recovery.begin`          | Startup recovery starts     | `totalThreads`, `wasWorkingCount`, `resumeEnabled`     |
| `recovery.thread.attempt` | Per-thread recovery attempt | `type` (`standalone`/`orchestration`), `sessionStatus` |
| `recovery.thread.result`  | Recovery outcome            | `success`, `error`                                     |
| `recovery.complete`       | Recovery finished           | `wasWorkingIds`                                        |

#### `ingestion` — ProviderRuntimeIngestion event processing

| Event                        | When                                | Key Details                                |
| ---------------------------- | ----------------------------------- | ------------------------------------------ |
| `session-lifecycle.apply`    | Session state applied to read model | `eventType`, `newStatus`, `previousStatus` |
| `session-lifecycle.rejected` | Event rejected by lifecycle guard   | `eventType`, `reason`                      |
| `turn.complete.ingested`     | Turn completion processed           | `turnId`, `status`                         |

## Timeline Logs

Timeline logs are structured JSON lines prefixed with `[timeline]` emitted from both client and server. They share the same format via `formatTimelineLog(scope, event, details)` from `@t3tools/shared/timeline`.

**Format**: `[timeline] {"ts":"ISO","scope":"...","event":"...","threadId":"...",...}`

### Client-Side (scope: `web`)

Emitted via `logWebTimeline` / `warnWebTimeline` from `apps/web/src/timelineLogger.ts`. These appear in the browser console and in `desktop-main.log` for packaged builds.

Key client events:

| Event                                 | When                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `composer.submit.start`               | User submits a message                                                                                      |
| `composer.turn-start.dispatched`      | Turn start sent to server                                                                                   |
| `store.thread-message.apply`          | Message applied to client state                                                                             |
| `store.thread-session.apply`          | Session state applied to client                                                                             |
| `orchestration.startup-snapshot.*`    | Shallow project/thread metadata load for boot, recovery, settings selectors, and lightweight proposal cards |
| `orchestration.thread-content.*`      | Per-thread message/activity/checkpoint hydration                                                            |
| `orchestration.domain-event.received` | Domain event received via WebSocket                                                                         |
| `ws.transport.created`                | WebSocket connection established                                                                            |
| `ws.subscription.disconnected`        | WebSocket subscription lost                                                                                 |

### Server-Side (multiple scopes)

| Scope                         | Area                            |
| ----------------------------- | ------------------------------- |
| `server.ws`                   | WebSocket RPC dispatch          |
| `server.orchestration`        | Orchestration engine commands   |
| `server.orchestration-runs`   | Orchestration run management    |
| `server.orchestration-runner` | Run execution and turn watching |
| `server.provider-reactor`     | Session/turn decisions          |
| `server.provider`             | Provider service turn dispatch  |
| `server.runtime-ingestion`    | Runtime event processing        |
| `server.projection`           | Read model projection updates   |
| `server.startup`              | Server startup phases           |

## Provider Event Logs (NTIVE / CANON)

Per-thread files at `provider/{threadId}.log` contain the raw provider event stream.

- **NTIVE**: Native events from the provider SDK (system/init, stream events, rate limits, results)
- **CANON**: Canonical runtime events (normalized across providers)

These are high-volume (streaming deltas for every token) but contain the raw truth about what the provider received and returned.

### Key events to look for

- `claude/system/init` — New session started, includes `session_id`, `tools`, `model`, `cwd`
- `claude/stream_event/message_start` — Response started, includes `usage` (token counts — low `input_tokens` suggests context loss)
- `claude/result/success` — Turn completed, includes `result` text, `total_cost_usd`, full `usage`
- `claude/rate_limit_event` — Rate limit info after each turn

## Debugging Common Issues

### Context Loss (AI starts fresh, doesn't remember conversation)

This is the highest-priority debugging scenario. Read the `.lifecycle.log` for the affected thread.

**What to look for:**

1. **Timeline gap** — Where did the old session end and the new one start? An 18-hour gap means the app was restarted.

2. **`ensure-session.restart` with `activeSessionMissing: true`** — The in-memory session was lost (app restart, crash). Check if `hasResumeCursor` is true or false:
   - `true`: Resume cursor was preserved in the database binding. The SDK _should_ have resumed. Check `session.start.resume-state` to see if the resume ID was valid.
   - `false`: Resume cursor was lost. The session started fresh — this is the root cause.

3. **`session.start.resume-state` with `resume: null`** — No resume session ID. The SDK created a brand new conversation.

4. **Compare `resumeSessionId` across events** — If it changes between turns, the SDK session was replaced.

5. **`recovery.begin` / `recovery.complete`** — If these appear between the old and new sessions, the app was restarted. Check if the thread was in `wasWorkingIds` (not recovered).

6. **Token counts in `message_start`** — In the NTIVE log, check `cache_creation_input_tokens` on the first message after context loss. If it's ~10K (just system prompt) instead of ~30K+ (conversation history), the SDK started fresh.

### Rate Limit Recovery Failures

1. Look for `stream.exit.rate-limit` — session should be preserved
2. Then `turn.send.stream-recovery` / `stream.recreate.begin` — stream rebuilt
3. If instead you see `session.stop.begin` after the rate limit, something went wrong

### Stuck Turns (UI says "working" but nothing happens)

Follow the timeline sequence from [Observability](observability.md#reading-a-stuck-turn-timeline). The lifecycle log adds visibility into the provider session layer (steps 5-8 of that sequence).

### Orphaned Sessions

Look for `session.start.existing-cleanup` — this means a new session is being started while an old one was still alive. The old one is stopped with `emitExitEvent: false` to prevent it from corrupting the new session's state.

## Useful Commands

### Read lifecycle log for a thread

```bash
cat ~/.t3/userdata/logs/provider/THREAD_ID.lifecycle.log
```

### Tail lifecycle logs live (all threads)

```bash
tail -f ~/.t3/dev/logs/provider/*.lifecycle.log
```

### Find all session starts for a thread

```bash
grep 'session.start.begin' ~/.t3/userdata/logs/provider/THREAD_ID.lifecycle.log
```

### Find context loss indicators

```bash
grep -E 'activeSessionMissing.*true|hasResumeCursor.*false|resume.*null' ~/.t3/userdata/logs/provider/THREAD_ID.lifecycle.log
```

### Follow timeline logs live

```bash
tail -f ~/.t3/userdata/logs/desktop-main.log ~/.t3/userdata/logs/server-child.log | grep '\[timeline\]'
```

### Filter timeline by thread

```bash
grep '"threadId":"THREAD_ID"' ~/.t3/userdata/logs/desktop-main.log ~/.t3/userdata/logs/server-child.log | grep '\[timeline\]'
```

## Best Practices for Adding New Logging

### Use lifecycle logging for session-critical decisions

If you're adding code that affects session state, turn routing, or conversation continuity, add a lifecycle log:

```typescript
yield *
  lfcyl(threadId, {
    scope: "your-module",
    event: "descriptive.event.name",
    sessionId: context.resumeSessionId ?? undefined,
    turnId: context.turnState?.turnId,
    details: {
      // Include all metadata needed to reconstruct the decision
      key: value,
    },
  });
```

### Always include correlation IDs

Every lifecycle log entry should include `threadId` (passed as first argument) and `sessionId` when available. Include `turnId` for turn-scoped events.

### Truncate message content

Never log full user messages or AI responses. Use `truncateForLog(text, 100)` from `@t3tools/shared/timeline` to capture just enough for context.

### Use timeline logging for cross-boundary events

For events that span client-server boundaries or orchestration layers, use `formatTimelineLog(scope, event, details)`. These appear in console, trace files, and desktop logs.

### Scope naming conventions

- `claude-adapter` — Claude SDK adapter internals
- `reactor` — ProviderCommandReactor session decisions
- `provider-service` — ProviderService turn routing
- `directory` — ProviderSessionDirectory persistence
- `startup` — Server startup and recovery
- `ingestion` — ProviderRuntimeIngestion event processing
- `web` — Client-side (browser)
- `server.{module}` — Server-side timeline events

## Source Files

| Component                       | File                                                           |
| ------------------------------- | -------------------------------------------------------------- |
| Lifecycle logger service        | `apps/server/src/provider/Services/ProviderLifecycleLogger.ts` |
| Lifecycle logger implementation | `apps/server/src/provider/Layers/ProviderLifecycleLogger.ts`   |
| Event NDJSON logger             | `apps/server/src/provider/Layers/EventNdjsonLogger.ts`         |
| Timeline log formatter          | `packages/shared/src/timeline.ts`                              |
| Web timeline logger             | `apps/web/src/timelineLogger.ts`                               |
| Rotating file sink              | `packages/shared/src/logging.ts`                               |
| Server logger setup             | `apps/server/src/serverLogger.ts`                              |
| Trace infrastructure            | `apps/server/src/observability/`                               |
| Server config (paths)           | `apps/server/src/config.ts`                                    |
