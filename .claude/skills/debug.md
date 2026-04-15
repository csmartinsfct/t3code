# debug

Investigate a bug using T3 Code's logging infrastructure. Always inspect logs before making code changes.

## Usage

`/debug` — start a general investigation (will ask for threadId)
`/debug THREAD_ID` — investigate a specific thread

## Log File Locations

Logs live under `~/.t3/{env}/logs/` where `{env}` is:

- `userdata` — production (packaged desktop app)
- `dev` — development (`bun run dev` / `bun run dev:desktop`)

Key files for a given `THREAD_ID`:

| File                                 | What it contains                                                   |
| ------------------------------------ | ------------------------------------------------------------------ |
| `provider/{THREAD_ID}.lifecycle.log` | Session decisions, state transitions, recovery (small, read first) |
| `provider/{THREAD_ID}.log`           | Raw provider events, streaming data, token counts (large)          |
| `server.trace.ndjson`                | Effect spans, timing, embedded logs (all threads)                  |
| `desktop-main.log`                   | Electron renderer timeline breadcrumbs (desktop builds only)       |
| `server-child.log`                   | Embedded server stdout/stderr (desktop builds only)                |

## Step 1: Determine the environment

Check which environment the bug occurred in:

- **Production**: `~/.t3/userdata/logs/`
- **Dev**: `~/.t3/dev/logs/`

If the user doesn't specify, check both:

```bash
ls -la ~/.t3/userdata/logs/provider/ 2>/dev/null | head -5
ls -la ~/.t3/dev/logs/provider/ 2>/dev/null | head -5
```

## Step 2: Read the lifecycle log

This is the most important file. It shows every session decision point in chronological order.

```bash
cat ~/.t3/{ENV}/logs/provider/{THREAD_ID}.lifecycle.log
```

If the file doesn't exist, the thread predates the lifecycle logging implementation (added in T3CO-297). Fall back to Step 3.

Look for:

- **Timeline gaps** — large time jumps between events indicate app restarts
- **`ensure-session.restart`** — why was the session restarted? Check the flags
- **`session.start.resume-state`** — was a resume cursor available?
- **`stream.exit`** — how did the stream end? (`rate-limit`, `error`, `interrupted`, `success`)
- **`recovery.begin` / `recovery.complete`** — was the thread recovered after restart?

## Step 3: Check the provider event log

For token count analysis and raw SDK behavior:

```bash
# See all session inits (new sessions)
grep 'system/init' ~/.t3/{ENV}/logs/provider/{THREAD_ID}.log

# See all distinct provider session IDs
grep -o '"providerThreadId":"[^"]*"' ~/.t3/{ENV}/logs/provider/{THREAD_ID}.log | sort -u

# Check token counts on first message of each session (low input_tokens = context loss)
grep 'message_start' ~/.t3/{ENV}/logs/provider/{THREAD_ID}.log | python3 -c "
import sys, json
for line in sys.stdin:
    idx = line.index('{')
    data = json.loads(line[idx:])
    usage = data.get('event', {}).get('event', {}).get('message', {}).get('usage', {})
    if usage:
        print(f'input={usage.get(\"input_tokens\",0)} cache_create={usage.get(\"cache_creation_input_tokens\",0)} cache_read={usage.get(\"cache_read_input_tokens\",0)}')
"
```

Context loss indicator: `cache_creation_input_tokens` drops from ~30K+ to ~10K (just system prompt, no conversation history).

## Step 4: Check timeline logs

For cross-boundary event flow (client to server to provider):

```bash
# Filter timeline by thread
grep '"threadId":"{THREAD_ID}"' ~/.t3/{ENV}/logs/desktop-main.log ~/.t3/{ENV}/logs/server-child.log 2>/dev/null | grep '\[timeline\]'

# Or from the server trace
grep '{THREAD_ID}' ~/.t3/{ENV}/logs/server.trace.ndjson | head -20
```

## Step 5: Reproduce (if needed)

If past logs are insufficient, reproduce the bug:

1. **Tail lifecycle logs live**:

```bash
tail -f ~/.t3/dev/logs/provider/*.lifecycle.log
```

2. **Use chrome-devtools MCP** to interact with the running app:
   - Take screenshots to observe UI state
   - Click elements to trigger actions
   - Evaluate scripts to inspect client-side state
   - Navigate to specific threads

3. **Trigger the bug** while watching the logs

4. **Read the lifecycle log** after reproduction to see exactly what happened

## Common Bug Patterns

### Context Loss (AI doesn't remember conversation)

**Lifecycle log indicators:**

- `ensure-session.restart` with `activeSessionMissing: true` — session died (app restart, crash)
- `ensure-session.restart` with `hasResumeCursor: false` — resume cursor lost
- `session.start.resume-state` with `resume: null` — no session ID to resume
- `recovery.complete` with thread NOT in recovery — thread wasn't auto-resumed after restart

**Event log indicators:**

- New `system/init` event with different `providerThreadId` than previous session
- `message_start` with low `cache_creation_input_tokens` (~10K instead of ~30K+)

### Rate Limit Recovery Failure

**Lifecycle log indicators:**

- `stream.exit.rate-limit` — session should be preserved
- Then `turn.send.stream-recovery` / `stream.recreate.begin` — stream rebuilt
- If `session.stop.begin` appears instead of recovery — something went wrong

### Stuck Turn (UI says "working" but nothing happens)

Follow the timeline sequence. Check where the event flow stops:

1. `web / composer.submit.start` → `server.ws / orchestration.dispatch.received` (client→server)
2. `server.provider-reactor / turn-send.start` → `server.provider / send-turn.start` (orchestration→provider)
3. `server.provider / runtime-event` → `server.runtime-ingestion / runtime-event.received` (provider→ingestion)
4. `server.projection / thread-message.upserted` → `web / store.thread-message.apply` (server→client)

### Orphaned Sessions

**Lifecycle log indicators:**

- `session.start.existing-cleanup` — old session being stopped before new one starts
- Two rapid `session.start.success` events for the same thread — session was replaced
- `session.stop.already-stopped` — attempted to stop an already-dead session

## Step 6: Report findings

After investigation, summarize:

1. **What happened** — the sequence of events from the logs
2. **Root cause** — which specific event/decision led to the bug
3. **What's missing** — if logs don't cover the failure path, note what additional logging would help

Reference: [Visibility docs](docs/visibility.md) for the full logging reference.
