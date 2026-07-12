# Claude Agent SDK 0.3.207 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin Claude Agent SDK 0.3.207, adapt T3 to its lifecycle and nonblocking MCP behavior, and show accurate live background activity inside the existing actions group without duplicating task history.

**Architecture:** Keep `ClaudeAdapter` as the session owner while moving pinned-SDK interpretation into pure Claude lifecycle and MCP-settling modules. Add one provider-neutral replacement-snapshot event, persist it through normal orchestration ingestion, derive only the latest snapshot in the web client, and render it as ephemeral status within the existing work card. Preserve detailed task history through the existing `task.started`, `task.progress`, and `task.completed` events.

**Tech Stack:** TypeScript, Effect, Claude Agent SDK 0.3.207, Effect Schema contracts, React, Vitest, Bun, T3 Browser

---

## Global Constraints

- Work in `.claude/worktrees/provider-capabilities` on `feat/provider-capabilities`.
- Pin `@anthropic-ai/claude-agent-sdk` to exactly `0.3.207`; do not advance beyond it.
- Never call `directory.remove(threadId)` in production code. Every stop and recovery path must preserve `ProviderRuntimeBinding.resumeCursor`.
- Treat `background_tasks_changed` as a process-scoped level signal with replacement semantics. Never correlate its IDs with task edge events, and clear the snapshot on process start, stop, exit, and restart.
- Treat command lifecycle frames and interrupt `still_queued` UUIDs as diagnostics only because SDK 0.3.207 exposes no stable caller-supplied message UUID.
- Use `bun run test`, never `bun test`.
- Do not finish until focused tests, `bun fmt`, `bun lint`, `bun typecheck`, packaging checks, and T3 Browser verification pass.
- Remove superseded compatibility branches and locally duplicated SDK types. Do not leave migration TODOs or dead fallbacks.

## File Map

**Create**

- `apps/server/src/provider/claude/claudeSdkLifecycle.ts`: exhaustive terminal classification and background snapshot normalization.
- `apps/server/src/provider/claude/claudeSdkLifecycle.test.ts`: pinned-SDK lifecycle tests.
- `apps/server/src/provider/claude/claudeMcpSettling.ts`: cancellable status polling with an eight-second deadline.
- `apps/server/src/provider/claude/claudeMcpSettling.test.ts`: deterministic settling tests using injected clock and sleep functions.

**Modify**

- `package.json`, `apps/server/package.json`, `bun.lock`: exact dependency pin and resolved dependency graph.
- `packages/contracts/src/providerRuntime.ts`: provider-neutral `task.background.changed` runtime event.
- `apps/server/src/provider/Layers/ClaudeAdapter.ts`: consume new SDK messages, reset background state on process start, classify results, log interrupt receipts, and settle MCP status.
- `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`: adapter integration and cleanup tests.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`: persist background replacement snapshots as hidden activities.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`: ingestion tests.
- `apps/server/src/provider/Layers/ProviderMcpStatusCache.ts`: preserve stale snapshots on refresh failure and publish settled results.
- `apps/server/src/provider/Layers/ProviderMcpStatusCache.test.ts`: refresh and profile-isolation tests.
- `apps/web/src/session-logic.ts`, `apps/web/src/session-logic.test.ts`: derive the latest live background snapshot and exclude snapshot events from history.
- `apps/web/src/components/ChatView.tsx`: pass live background state to the timeline.
- `apps/web/src/components/chat/MessagesTimeline.tsx`: render live status in the existing work card.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts`, `apps/web/src/components/chat/MessagesTimeline.logic.test.ts`: attach status to the latest work group and provide an empty-group fallback.
- `apps/web/src/components/chat/MessagesTimeline.test.tsx`: visual behavior tests.
- `scripts/build-desktop-artifact.ts` and existing packaging tests only if the 0.3.207 native package layout requires a staging change.
- `docs/resource-management.md`, `docs/visibility.md`, `docs/t3-agent-tools.md`, `.claude/skills/production-build.md`, `.claude/skills/provider-integration.md`: document the new compatibility boundary and verification flow.

### Task 1: Pin SDK 0.3.207 And Align Its Public Types

**Files:**

- Modify: `package.json`
- Modify: `apps/server/package.json`
- Modify: `bun.lock`
- Modify: `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- Test: `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`

- [ ] **Step 1: Add a dependency-resolution assertion before changing the lockfile**

Run the current resolution and retain the output in the task notes:

```bash
bun pm ls --all | rg '@anthropic-ai/claude-agent-sdk|@anthropic-ai/sdk|@modelcontextprotocol/sdk|zod'
```

Expected: Claude Agent SDK resolves to `0.2.116`; peer and transitive versions are visible for comparison.

- [ ] **Step 2: Replace both caret ranges with the exact target**

Set both manifests to:

```json
"@anthropic-ai/claude-agent-sdk": "0.3.207"
```

- [ ] **Step 3: Regenerate the lockfile and inspect platform packages**

Run:

```bash
bun install
bun pm ls --all | rg '@anthropic-ai/claude-agent-sdk|@anthropic-ai/sdk|@modelcontextprotocol/sdk|zod'
rg -n '@anthropic-ai/claude-agent-sdk|claude-code.*(darwin|linux|win32)' bun.lock
```

Expected: the workspace resolves exactly `0.3.207`, peer dependencies have no avoidable duplicate incompatible major, and supported native optional packages remain represented in `bun.lock`.

Also verify `node -p "require('@anthropic-ai/claude-agent-sdk/package.json').claudeCodeVersion"` prints the expected bundled Claude Code version `2.1.207`.

- [ ] **Step 4: Replace local query method shapes with exported 0.3.207 response types**

Update imports and the runtime interface so interrupt receipts and reinitialization are typed:

```ts
import type {
  SDKControlGetContextUsageResponse,
  SDKControlInitializeResponse,
  SDKControlInterruptResponse,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
  TerminalReason,
} from "@anthropic-ai/claude-agent-sdk";

interface ClaudeQueryRuntime extends AsyncIterable<SDKMessage> {
  readonly interrupt: () => Promise<SDKControlInterruptResponse | undefined>;
  readonly reinitialize: () => Promise<SDKControlInitializeResponse>;
  // Keep the existing public methods below this point.
}
```

Remove optional method checks only where 0.3.207 guarantees the method. Keep optional methods that model a genuinely optional runtime capability or an intentionally partial test double.

- [ ] **Step 5: Run typechecking to expose the migration surface**

Run:

```bash
bun typecheck
```

Expected: failures are limited to deliberate 0.3.207 API shape changes. Record them before fixing so removed APIs are not silently re-created as local compatibility types.

- [ ] **Step 6: Commit the dependency boundary**

```bash
git add package.json apps/server/package.json bun.lock apps/server/src/provider/Layers/ClaudeAdapter.ts apps/server/src/provider/Layers/ClaudeAdapter.test.ts
git commit -m "build: pin Claude Agent SDK 0.3.207"
```

### Task 2: Add Provider-Neutral Background Activity Contracts

**Files:**

- Modify: `packages/contracts/src/providerRuntime.ts`
- Modify: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- Test: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`

- [ ] **Step 1: Write a failing ingestion test for replacement snapshots**

Add a runtime event fixture with two tasks, followed by an empty replacement:

```ts
const runningEvent: ProviderRuntimeEvent = {
  type: "task.background.changed",
  eventId: asEventId("evt-background-running"),
  provider: "claudeAgent",
  createdAt: "2026-07-12T12:00:00.000Z",
  threadId: asThreadId("thread-1"),
  turnId: asTurnId("turn-1"),
  payload: {
    tasks: [
      {
        taskId: RuntimeTaskId.makeUnsafe("shell-1"),
        taskType: "shell",
        description: "Run dev server",
      },
      {
        taskId: RuntimeTaskId.makeUnsafe("agent-1"),
        taskType: "subagent",
        description: "Inspect tests",
      },
    ],
  },
};

const idleEvent: ProviderRuntimeEvent = {
  type: "task.background.changed",
  eventId: asEventId("evt-background-idle"),
  provider: "claudeAgent",
  createdAt: "2026-07-12T12:00:01.000Z",
  threadId: asThreadId("thread-1"),
  turnId: asTurnId("turn-1"),
  payload: { tasks: [] },
};
```

Assert that ingestion stores both activities as `task.background.changed`, keeps the full replacement payload, and does not change the active turn state.

- [ ] **Step 2: Run the focused test and verify the schema rejects the new event**

```bash
bun run test --filter=t3 -- ProviderRuntimeIngestion.test.ts
```

Expected: FAIL because `task.background.changed` is not in `ProviderRuntimeEventV2`.

- [ ] **Step 3: Add the contract**

Add the event literal, payload, event schema, and union member:

```ts
const TaskBackgroundChangedType = Schema.Literal("task.background.changed");

const BackgroundTask = Schema.Struct({
  taskId: RuntimeTaskId,
  taskType: TrimmedNonEmptyStringSchema,
  description: TrimmedNonEmptyStringSchema,
});

export const TaskBackgroundChangedPayload = Schema.Struct({
  tasks: Schema.Array(BackgroundTask),
});
export type TaskBackgroundChangedPayload = typeof TaskBackgroundChangedPayload.Type;

const ProviderRuntimeTaskBackgroundChangedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: TaskBackgroundChangedType,
  payload: TaskBackgroundChangedPayload,
});
```

Also add `task.background.changed` to `ProviderRuntimeEventType` and `ProviderRuntimeTaskBackgroundChangedEvent` to `ProviderRuntimeEventV2`.

- [ ] **Step 4: Persist snapshots without turning them into visible work history**

Add this ingestion branch:

```ts
case "task.background.changed": {
  const count = event.payload.tasks.length;
  return [{
    id: event.eventId,
    createdAt: event.createdAt,
    tone: "info",
    kind: "task.background.changed",
    summary: count === 0 ? "Background work idle" : `${count} background ${count === 1 ? "task" : "tasks"} running`,
    payload: { tasks: event.payload.tasks },
    turnId: toTurnId(event.turnId) ?? null,
    ...maybeSequence,
  }];
}
```

- [ ] **Step 5: Run contract and ingestion tests**

```bash
bun run test --filter=@t3tools/contracts
bun run test --filter=t3 -- ProviderRuntimeIngestion.test.ts
```

Expected: PASS; replacement activities are persisted but active turn/session projections are unchanged.

- [ ] **Step 6: Commit the provider-neutral event**

```bash
git add packages/contracts/src/providerRuntime.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
git commit -m "feat: add background activity snapshots"
```

### Task 3: Derive And Render Live Background Status In The Existing Work Card

**Files:**

- Modify: `apps/web/src/session-logic.ts`
- Modify: `apps/web/src/session-logic.test.ts`
- Modify: `apps/web/src/components/ChatView.tsx`
- Modify: `apps/web/src/components/chat/MessagesTimeline.logic.ts`
- Modify: `apps/web/src/components/chat/MessagesTimeline.logic.test.ts`
- Modify: `apps/web/src/components/chat/MessagesTimeline.tsx`
- Modify: `apps/web/src/components/chat/MessagesTimeline.test.tsx`

- [ ] **Step 1: Write failing selector tests for latest-snapshot semantics**

Cover a two-task snapshot followed by an empty snapshot, malformed payload entries, and unrelated providers:

```ts
expect(deriveLiveBackgroundTasks([runningActivity])).toEqual({
  createdAt: runningActivity.createdAt,
  tasks: [
    { taskId: "shell-1", taskType: "shell", description: "Run dev server" },
    { taskId: "agent-1", taskType: "subagent", description: "Inspect tests" },
  ],
});
expect(deriveLiveBackgroundTasks([runningActivity, idleActivity])?.tasks).toEqual([]);
expect(deriveWorkLogEntries([runningActivity], undefined)).toEqual([]);
```

- [ ] **Step 2: Run the focused selector tests and verify failure**

```bash
bun run test --filter=@t3tools/web -- session-logic.test.ts
```

Expected: FAIL because `deriveLiveBackgroundTasks` does not exist and snapshot activity is not filtered.

- [ ] **Step 3: Implement the latest-snapshot selector**

Add a provider-neutral web type and defensive parser:

```ts
export interface LiveBackgroundTaskSnapshot {
  createdAt: string;
  tasks: Array<{ taskId: string; taskType: string; description: string }>;
}

export function deriveLiveBackgroundTasks(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): LiveBackgroundTaskSnapshot | null {
  const latest = [...activities]
    .toSorted(compareActivitiesByOrder)
    .findLast((activity) => activity.kind === "task.background.changed");
  if (!latest) return null;
  const payload = asRecord(latest.payload);
  const rawTasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
  const tasks = rawTasks.flatMap((value) => {
    const task = asRecord(value);
    const taskId = asTrimmedString(task?.taskId);
    const taskType = asTrimmedString(task?.taskType);
    const description = asTrimmedString(task?.description);
    return taskId && taskType && description ? [{ taskId, taskType, description }] : [];
  });
  return { createdAt: latest.createdAt, tasks };
}
```

Filter `task.background.changed` from `deriveWorkLogEntries`; it is state, not timeline history.

- [ ] **Step 4: Write failing timeline tests**

Assert these behaviors:

```tsx
render(<MessagesTimeline {...baseProps} liveBackgroundTasks={runningSnapshot} />);
expect(screen.getByText("2 background tasks running")).toBeVisible();
expect(screen.getByTitle("shell: Run dev server; subagent: Inspect tests")).toBeVisible();

rerender(
  <MessagesTimeline {...baseProps} liveBackgroundTasks={{ ...runningSnapshot, tasks: [] }} />,
);
expect(screen.queryByText(/background tasks running/)).toBeNull();
expect(screen.getByText("Ran command")).toBeVisible();
```

Add a no-work-entry case and assert that an ephemeral work card is rendered so live activity is never invisible.

Also assert `estimateMessagesTimelineRowHeight` adds one stable 32 px status row so virtualized content cannot overlap the following message.

- [ ] **Step 5: Run the focused timeline tests and verify failure**

```bash
bun run test --filter=@t3tools/web -- MessagesTimeline.logic.test.ts MessagesTimeline.test.tsx
```

Expected: FAIL because the timeline does not accept or render live background tasks.

- [ ] **Step 6: Attach status to the latest work group with a fallback group**

Extend the work-row shape:

```ts
| {
    kind: "work";
    id: string;
    createdAt: string;
    groupedEntries: WorkLogEntry[];
    liveBackgroundTasks?: LiveBackgroundTaskSnapshot;
  }
```

After deriving normal rows, attach a non-empty snapshot to the latest work row. If none exists, insert a work row with `id: "live-background-work"`, an empty `groupedEntries` array, and the snapshot immediately before the working indicator. Empty snapshots attach nothing.

Update `estimateWorkRowHeight` to add 32 px when `liveBackgroundTasks.tasks.length > 0`; keep the card dimensions stable while the count or descriptions change.

- [ ] **Step 7: Render one compact status line inside the card**

Pass `deriveLiveBackgroundTasks(threadActivities)` from `ChatView` into `MessagesTimeline`. In the work-card body render:

```tsx
{
  row.liveBackgroundTasks && row.liveBackgroundTasks.tasks.length > 0 && (
    <div
      className="flex items-center gap-2 px-1 py-1 text-[11px] text-muted-foreground/70"
      title={row.liveBackgroundTasks.tasks
        .map((task) => `${task.taskType}: ${task.description}`)
        .join("; ")}
    >
      <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
      <span>
        {row.liveBackgroundTasks.tasks.length} background{" "}
        {row.liveBackgroundTasks.tasks.length === 1 ? "task" : "tasks"} running
      </span>
    </div>
  );
}
```

Keep the existing command/tool rows unchanged. The status line disappears when the latest replacement is empty; no completion row is synthesized.

- [ ] **Step 8: Run selector and timeline tests**

```bash
bun run test --filter=@t3tools/web -- session-logic.test.ts MessagesTimeline.logic.test.ts MessagesTimeline.test.tsx
```

Expected: PASS, including no-entry fallback, replacement-to-empty, preserved action history, and singular/plural labels.

- [ ] **Step 9: Commit the actions-group integration**

```bash
git add apps/web/src/session-logic.ts apps/web/src/session-logic.test.ts apps/web/src/components/ChatView.tsx apps/web/src/components/chat/MessagesTimeline.logic.ts apps/web/src/components/chat/MessagesTimeline.logic.test.ts apps/web/src/components/chat/MessagesTimeline.tsx apps/web/src/components/chat/MessagesTimeline.test.tsx
git commit -m "feat: show live background activity"
```

### Task 4: Interpret SDK 0.3.207 Lifecycle And Emit Background Snapshots

**Files:**

- Create: `apps/server/src/provider/claude/claudeSdkLifecycle.ts`
- Create: `apps/server/src/provider/claude/claudeSdkLifecycle.test.ts`
- Modify: `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- Modify: `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`

- [ ] **Step 1: Write failing pure lifecycle tests**

Use a table covering every 0.3.207 `TerminalReason`:

```ts
const expected: Record<TerminalReason, ProviderRuntimeTurnStatus> = {
  completed: "completed",
  background_requested: "completed",
  tool_deferred: "completed",
  aborted_streaming: "interrupted",
  aborted_tools: "interrupted",
  hook_stopped: "cancelled",
  blocking_limit: "failed",
  rapid_refill_breaker: "failed",
  prompt_too_long: "failed",
  image_error: "failed",
  model_error: "failed",
  api_error: "failed",
  malformed_tool_use_exhausted: "failed",
  stop_hook_prevented: "failed",
  max_turns: "failed",
  budget_exhausted: "failed",
  structured_output_retry_exhausted: "failed",
  tool_deferred_unavailable: "failed",
  turn_setup_failed: "failed",
};
```

Also assert unknown runtime strings classify as failed with `known: false`, and background task normalization trims values, preserves unknown task types, and drops invalid entries.

- [ ] **Step 2: Run the lifecycle test and verify failure**

```bash
bun run test --filter=t3 -- claudeSdkLifecycle.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure compatibility module**

Expose these functions and types:

```ts
export interface ClaudeTerminalDecision {
  status: ProviderRuntimeTurnStatus;
  known: boolean;
  terminalReason: string;
}

export function classifyClaudeTerminalReason(reason: string): ClaudeTerminalDecision;

export function normalizeClaudeBackgroundTasks(
  tasks: SDKBackgroundTasksChangedMessage["tasks"],
): TaskBackgroundChangedPayload["tasks"];
```

Implement classification with one exhaustive mapping. Make TypeScript reject a missing or misspelled 0.3.207 reason:

```ts
const TERMINAL_STATUS = {
  completed: "completed",
  background_requested: "completed",
  tool_deferred: "completed",
  aborted_streaming: "interrupted",
  aborted_tools: "interrupted",
  hook_stopped: "cancelled",
  blocking_limit: "failed",
  rapid_refill_breaker: "failed",
  prompt_too_long: "failed",
  image_error: "failed",
  model_error: "failed",
  api_error: "failed",
  malformed_tool_use_exhausted: "failed",
  stop_hook_prevented: "failed",
  max_turns: "failed",
  budget_exhausted: "failed",
  structured_output_retry_exhausted: "failed",
  tool_deferred_unavailable: "failed",
  turn_setup_failed: "failed",
} satisfies Record<TerminalReason, ProviderRuntimeTurnStatus>;
```

The function must return `{ status: "failed", known: false, terminalReason: reason }` for a future unknown string.

- [ ] **Step 4: Write failing adapter tests for process reset, replacement, and diagnostics**

Add tests that:

1. Starting a session emits `task.background.changed` with `tasks: []` before any non-empty snapshot.
2. An SDK `background_tasks_changed` message emits one normalized replacement event.
3. A second empty message emits an empty replacement and no `task.completed` event.
4. Unknown task types survive normalization.
5. `interrupt()` returning `{ subtype: "success", still_queued: ["sdk-uuid"] }` logs diagnostics but does not enqueue, remove, or replay a T3 prompt.
6. Unknown terminal reasons produce `failed` plus a runtime diagnostic.
7. Explicit stop and process exit emit an empty replacement before session teardown without deleting the provider binding or resume cursor.

- [ ] **Step 5: Run adapter tests and verify failure**

```bash
bun run test --filter=t3 -- ClaudeAdapter.test.ts
```

Expected: FAIL on missing event handling and old terminal classification.

- [ ] **Step 6: Integrate lifecycle handling in the adapter**

Add an emitter:

```ts
const emitBackgroundTasksChanged = Effect.fn("emitBackgroundTasksChanged")(function* (
  context: ClaudeSessionContext,
  tasks: TaskBackgroundChangedPayload["tasks"],
) {
  context.liveBackgroundTasks = tasks;
  const stamp = yield* makeEventStamp();
  yield* offerRuntimeEvent({
    type: "task.background.changed",
    eventId: stamp.eventId,
    provider: context.session.provider,
    createdAt: stamp.createdAt,
    threadId: context.session.threadId,
    ...(context.turnState ? { turnId: context.turnState.turnId } : {}),
    payload: { tasks },
    providerRefs: nativeProviderRefs(context),
  });
});
```

Add `liveBackgroundTasks` to `ClaudeSessionContext`, initialize it to `[]`, and emit an empty snapshot each time a new SDK query process is installed, including recovery/restart paths. Emit an empty replacement before explicit stop or process-exit teardown when the current set is non-empty; this update must not remove the runtime binding. Handle the SDK message:

```ts
case "background_tasks_changed":
  yield* emitBackgroundTasksChanged(
    context,
    normalizeClaudeBackgroundTasks(message.tasks),
  );
  return;
```

Do not call `completeTurn`, emit `task.completed`, or close the session from this branch.

- [ ] **Step 7: Replace result text fallbacks only where structured terminal reasons exist**

Use `classifyClaudeTerminalReason(result.terminal_reason)` when present. Keep text classification solely for raw stream/process exceptions that cannot carry an SDK result. Emit a `runtime.diagnostic` with the raw unknown reason before failing the turn.

- [ ] **Step 8: Consume the interrupt receipt without queue mutation**

```ts
const receipt =
  yield *
  Effect.tryPromise({
    try: () => context.query.interrupt(),
    catch: (cause) => toRequestError(threadId, "turn/interrupt", cause),
  });
if (receipt?.still_queued.length) {
  yield *
    emitRuntimeDiagnostic(context, {
      category: "interrupt_receipt",
      summary: "Claude interrupt left SDK commands queued",
      data: { stillQueued: receipt.still_queued },
    });
}
```

Do not match these UUIDs to `PromptQueueItem`, T3 message IDs, or turn IDs.

- [ ] **Step 9: Audit reinitialization conservatively**

Search for a concrete 0.3.207 recoverable control-channel gap:

```bash
rg -n 'control|permission|dialog|reinitial|pendingApprovals|pendingUserInputs' apps/server/src/provider/Layers/ClaudeAdapter.ts
```

If no existing detected same-process gap exists, add no speculative `reinitialize()` call. Keep it typed for future use and document that process exits continue through resume-cursor recovery. If a concrete same-process gap already exists, call `reinitialize()` only in that branch, catch failure, and fall back to existing recovery without deleting the binding.

- [ ] **Step 10: Run lifecycle and adapter tests**

```bash
bun run test --filter=t3 -- claudeSdkLifecycle.test.ts ClaudeAdapter.test.ts
```

Expected: PASS; process starts and exits clear background state, snapshots replace, interrupts do not mutate queued input, resume cursors survive teardown, and every terminal reason has an explicit outcome.

- [ ] **Step 11: Commit lifecycle compatibility**

```bash
git add apps/server/src/provider/claude/claudeSdkLifecycle.ts apps/server/src/provider/claude/claudeSdkLifecycle.test.ts apps/server/src/provider/Layers/ClaudeAdapter.ts apps/server/src/provider/Layers/ClaudeAdapter.test.ts
git commit -m "feat: adapt Claude SDK lifecycle events"
```

### Task 5: Settle Nonblocking MCP Startup

**Files:**

- Create: `apps/server/src/provider/claude/claudeMcpSettling.ts`
- Create: `apps/server/src/provider/claude/claudeMcpSettling.test.ts`
- Modify: `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- Modify: `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`
- Modify: `apps/server/src/provider/Layers/ProviderMcpStatusCache.ts`
- Modify: `apps/server/src/provider/Layers/ProviderMcpStatusCache.test.ts`

- [ ] **Step 1: Write failing deterministic settling tests**

Cover these sequences:

```ts
[][{ name: "slack", status: "pending" }][{ name: "slack", status: "connected" }];
```

Also cover a permanently pending server at 8 seconds, terminal `connected`, `needs-auth`, `failed`, and `disabled` statuses, abort cancellation, and no duplicate reload call.

- [ ] **Step 2: Run the focused test and verify failure**

```bash
bun run test --filter=t3 -- claudeMcpSettling.test.ts
```

Expected: FAIL because the settling module does not exist.

- [ ] **Step 3: Implement the cancellable polling helper**

Use this interface:

```ts
export interface SettleClaudeMcpInput {
  readStatus: () => Promise<McpServerStatus[]>;
  signal: AbortSignal;
  deadlineMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export async function settleClaudeMcpServers(
  input: SettleClaudeMcpInput,
): Promise<McpServerStatus[]>;
```

Defaults are an 8,000 ms deadline and 250 ms polling. Return once a non-empty inventory contains no `pending` status. If the deadline expires, return the latest inventory including pending servers. Throw an abort error when `signal.aborted`.

- [ ] **Step 4: Write failing adapter and cache tests**

Assert that active and hidden probes both poll until terminal state, hidden probes never send a model prompt, query resources close after success/error/abort, concurrent project requests still coalesce, refresh failure preserves the previous server list, and `claudeAgent:metric` cannot overwrite `claudeAgent:zbd`.

- [ ] **Step 5: Integrate settling in both probe paths**

Call `reloadPlugins()` once when requested, then pass `mcpServerStatus()` into `settleClaudeMcpServers`. Reuse the hidden probe's `AbortController`; abort it in `Effect.ensuring` before closing query resources.

Keep `ProviderMcpStatusCache`'s existing project-level in-flight coalescing. On refresh error, retain the previous `servers`, `serverNames`, and `updatedAt`, remove `refreshing`, and attach the refresh error instead of replacing the snapshot with an empty error result.

- [ ] **Step 6: Run settling, adapter, and cache tests**

```bash
bun run test --filter=t3 -- claudeMcpSettling.test.ts ClaudeAdapter.test.ts ProviderMcpStatusCache.test.ts
```

Expected: PASS; pending services settle without blocking session turns, timeout preserves pending status, stale data survives refresh failure, and profiles remain isolated.

- [ ] **Step 7: Commit MCP settling**

```bash
git add apps/server/src/provider/claude/claudeMcpSettling.ts apps/server/src/provider/claude/claudeMcpSettling.test.ts apps/server/src/provider/Layers/ClaudeAdapter.ts apps/server/src/provider/Layers/ClaudeAdapter.test.ts apps/server/src/provider/Layers/ProviderMcpStatusCache.ts apps/server/src/provider/Layers/ProviderMcpStatusCache.test.ts
git commit -m "fix: settle Claude MCP startup state"
```

### Task 6: Audit Packaging, Remove Dead Compatibility Code, And Update Docs

**Files:**

- Modify if required: `scripts/build-desktop-artifact.ts`
- Modify existing packaging tests associated with `scripts/build-desktop-artifact.ts`
- Modify: `docs/resource-management.md`
- Modify: `docs/visibility.md`
- Modify: `docs/t3-agent-tools.md`
- Modify: `.claude/skills/production-build.md`
- Modify: `.claude/skills/provider-integration.md`

- [ ] **Step 1: Audit the staged package layout for both macOS architectures**

```bash
npm view @anthropic-ai/claude-agent-sdk@0.3.207 optionalDependencies peerDependencies --json
rg -n 'claude-agent-sdk|optionalDependencies|supportedArchitectures|darwin|arm64|x64' scripts package.json apps/desktop apps/server bun.lock
```

Expected: the bundled executable and native packages required by 0.3.207 are identified for darwin-arm64 and darwin-x64.

- [ ] **Step 2: Extend the existing packaging assertion only if layout changed**

The assertion must verify:

```ts
expect(stagedPackageVersion).toBe("0.3.207");
expect(stagedNativePackage).toMatch(targetArch === "arm64" ? /darwin-arm64/ : /darwin-x64/);
```

Preserve custom `pathToClaudeCodeExecutable` override behavior while allowing the default SDK bundled executable.

- [ ] **Step 3: Remove superseded compatibility code**

Run:

```bash
rg -n '0\.2\.|SDK ≥|terminal_reason|as unknown as|reloadPlugins\?|mcpServerStatus\?|reinitialize\?|TODO.*Claude|compat' apps/server/src/provider/Layers/ClaudeAdapter.ts apps/server/src/provider/claude
```

Delete old structured-result fallbacks, duplicate SDK interfaces, optional checks for guaranteed 0.3.207 APIs, migration comments, and unreachable branches. Retain only raw transport/process text classification and partial test-double allowances, each with a focused test explaining why.

- [ ] **Step 4: Update operational docs and skills**

Document all of the following explicitly:

- Exact SDK 0.3.207 pin and upgrade review policy.
- Bundled Claude Code 2.1.207 runtime associated with that SDK pin.
- Nonblocking MCP startup, eight-second settling, pending semantics, stale-while-refresh, and profile isolation.
- Background level snapshots versus detailed task edge events.
- Existing actions-group live indicator and process-start reset.
- Diagnostic-only interrupt receipt behavior.
- Resume-cursor recovery boundary and prohibition on deleting bindings.
- Bundled executable, custom override, and native target staging.
- T3 Browser as the required provider-integration verification surface, replacing stale Chrome DevTools wording where this workflow is described.

- [ ] **Step 5: Run packaging-focused verification**

Run the existing focused packaging tests discovered in Step 1, then:

```bash
bun run test:desktop-smoke
```

Expected: PASS. If a full artifact is necessary to inspect native staging, run the smallest architecture-specific artifact command supported by the environment and record its path and package contents.

- [ ] **Step 6: Commit cleanup and docs**

```bash
git add scripts/build-desktop-artifact.ts docs/resource-management.md docs/visibility.md docs/t3-agent-tools.md .claude/skills/production-build.md .claude/skills/provider-integration.md apps/server/src/provider/Layers/ClaudeAdapter.ts apps/server/src/provider/claude
git add -u
git commit -m "docs: document Claude SDK compatibility boundary"
```

### Task 7: Full Automated And T3 Browser Verification

**Files:**

- Modify only if verification exposes a defect: files owned by Tasks 1-6
- Record evidence in: `[T3CO-497](t3://ticket/T3CO-497)` comment

- [ ] **Step 1: Run all focused suites together**

```bash
bun run test --filter=@t3tools/contracts
bun run test --filter=t3 -- claudeSdkLifecycle.test.ts claudeMcpSettling.test.ts ClaudeAdapter.test.ts ProviderMcpStatusCache.test.ts ProviderRuntimeIngestion.test.ts
bun run test --filter=@t3tools/web -- session-logic.test.ts MessagesTimeline.logic.test.ts MessagesTimeline.test.tsx
```

Expected: all pass with no unhandled rejection, leaked timer, or open query warning.

- [ ] **Step 2: Run repository completion checks**

```bash
bun fmt
bun lint
bun typecheck
git diff --check
```

Expected: all commands exit 0. Review formatter changes before proceeding and keep unrelated files untouched.

- [ ] **Step 3: Start the branch through T3 Managed Runs**

Use `list_managed_runs`, find the existing web/dev action by command, and launch it with:

```text
cwd=/Users/cristianomartins/Desktop/code/experiments/T3 Code/.claude/worktrees/provider-capabilities
```

Do not start the long-running server directly from a shell. Wait for the managed run to report healthy and record the assigned URL.

- [ ] **Step 4: Verify Claude profile MCP settling in T3 Browser**

Using the dev project ID and `/api/browser`:

1. Open the managed dev URL.
2. Select the zbd Claude profile.
3. Open the MCP panel.
4. Observe initial loading/pending state without a model message.
5. Confirm Slack, Mixpanel, and Notion settle to connected.
6. Confirm unauthenticated connectors settle to needs-auth rather than missing or failed.
7. Trigger refresh and verify the previous snapshot remains visible while refreshing.
8. Make a real read-only Slack request and verify an MCP tool executes.

Expected: no profile leakage, no prompt created by the hidden probe, and no console error.

- [ ] **Step 5: Verify background shell and subagent UX**

In one Claude thread ask for:

```text
Start a harmless shell command in the background that waits for 10 seconds, then reports completion. While it runs, start a small background subagent that lists the top-level package names. Do not modify files.
```

Verify:

- The existing work/actions card displays `2 background tasks running` while both are live.
- The title/tooltip identifies shell and subagent descriptions.
- The count drops as each task completes and disappears at zero.
- Existing command, task progress, and completion rows remain and are not duplicated.
- The foreground response can complete while background status remains live.

- [ ] **Step 6: Verify interruption and resume-cursor preservation**

1. Start a long Claude response and interrupt it.
2. Send a subsequent message and verify it completes normally.
3. Generate a unique token with `printf 'T3CO497-%s\n' "$(date +%s)"` and ask Claude to remember the printed value.
4. Stop/restart the managed dev run.
5. Reopen the same thread and ask Claude for the token.
6. Verify no stale background indicator survives process restart.

Expected: the token is recalled from the provider resume cursor, the binding remains present, and the new process begins with an empty background snapshot.

- [ ] **Step 7: Verify profile isolation and inspect logs**

Switch to the second Claude profile and verify connector and background state do not leak. Export the thread ID copied from the tested thread URL, then inspect:

```bash
read -r -p 'Thread ID from the tested browser URL: ' THREAD_ID
test -n "$THREAD_ID"
sed -n '1,240p' ~/.t3/worktrees/*/dev/logs/provider/"$THREAD_ID".lifecycle.log
rg -n 'background_tasks_changed|interrupt|terminal_reason|mcp|reinitial|resume' ~/.t3/worktrees/*/dev/logs/provider/"$THREAD_ID".log
rg '\[timeline\]' ~/.t3/worktrees/*/dev/logs/desktop-main.log ~/.t3/worktrees/*/dev/logs/server-child.log
```

Expected: explicit process-reset and MCP-settling decisions, no dropped commands, duplicate task events, stale background snapshot, uncaught error, or resume-cursor deletion.

- [ ] **Step 8: Fix verification defects with focused regression tests**

For every defect, first add a failing test to the owning suite, run it to confirm failure, apply the smallest fix, rerun the focused suite, and repeat Steps 2 and the affected browser scenario.

- [ ] **Step 9: Commit final verification fixes**

```bash
git status --short
git add packages/contracts/src/providerRuntime.ts apps/server/src/provider/claude apps/server/src/provider/Layers/ClaudeAdapter.ts apps/server/src/provider/Layers/ClaudeAdapter.test.ts apps/server/src/provider/Layers/ProviderMcpStatusCache.ts apps/server/src/provider/Layers/ProviderMcpStatusCache.test.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts apps/web/src/session-logic.ts apps/web/src/session-logic.test.ts apps/web/src/components/ChatView.tsx apps/web/src/components/chat/MessagesTimeline.tsx apps/web/src/components/chat/MessagesTimeline.logic.ts apps/web/src/components/chat/MessagesTimeline.logic.test.ts apps/web/src/components/chat/MessagesTimeline.test.tsx
git commit -m "fix: harden Claude SDK upgrade verification"
```

Skip this commit when verification required no code changes.

- [ ] **Step 10: Add ticket evidence and mark criteria accurately**

Comment on `[T3CO-497](t3://ticket/T3CO-497)` with:

- Exact dependency resolution.
- Focused test and completion-command results.
- Managed run URL and tested Claude profile.
- Browser evidence for MCP, Slack, background shell, background subagent, interrupt, restart/resume, and profile isolation.
- Relevant lifecycle/provider log paths.
- Packaging result.
- Any genuinely deferred behavior, limited to T3CO-498 and T3CO-501.

Only mark acceptance criteria met when their corresponding automated and browser evidence exists.

## Completion Review

Before declaring the ticket complete:

1. Compare every design-spec Included item against Tasks 1-7.
2. Search the final diff for dead compatibility branches, duplicate SDK interfaces, migration TODOs, and accidental provider-specific web logic.
3. Confirm `background_tasks_changed` is never correlated with task edge IDs and never synthesizes permanent task history.
4. Confirm every process start, stop, exit, and restart leaves an empty replacement snapshot at the process boundary.
5. Confirm every stop/recovery path preserves the provider runtime binding and resume cursor.
6. Confirm no implementation from T3CO-498 or T3CO-501 slipped into this upgrade.
