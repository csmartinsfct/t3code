# Claude Agent SDK 0.3.207 Upgrade Design

**Ticket:** T3CO-497  
**Branch:** `feat/provider-capabilities`  
**Status:** Approved for implementation planning

## Goal

Upgrade `@anthropic-ai/claude-agent-sdk` from `0.2.116` to exactly `0.3.207` and adapt T3's Claude runtime to the SDK's changed lifecycle semantics without expanding the ticket into new user-facing Claude features.

The upgrade must improve correctness under interruption, background work, MCP startup, session restart, and partial failure. It must preserve Claude profile isolation and provider resume cursors.

## Scope

### Included

- Pin `@anthropic-ai/claude-agent-sdk` to exactly `0.3.207` in both workspace manifests and regenerate `bun.lock`.
- Validate the SDK's peer dependencies and per-platform native optional dependencies.
- Adapt to nonblocking MCP startup.
- Classify the complete `0.3.207` terminal-reason surface into T3 turn outcomes.
- Use command lifecycle and interrupt receipt data to prevent dropped or incorrectly cancelled queued input.
- Reconcile background-task snapshots with existing task lifecycle events.
- Use SDK reinitialization only for a detected recoverable control-channel gap.
- Remove superseded pre-`0.3.207` compatibility code and locally duplicated SDK types where the pinned SDK supplies authoritative types.
- Update affected provider, packaging, visibility, resource-management, and agent-tool documentation.
- Complete automated, packaging, log, and T3 Browser verification.

### Deferred

- Claude plugin and skill discovery or capability UI. That remains T3CO-498.
- Tool icons and richer tool-call presentation.
- Provider-neutral subagent conversation navigation.
- Prompt-suggestion product behavior.
- AI-generated subagent progress-summary product behavior.
- Conversation rewind UI.
- Other new SDK features that do not correct an existing runtime behavior.

## Version Policy

The dependency is pinned to `0.3.207`, not a caret range. The SDK bundles a Claude Code runtime and changes protocol behavior frequently, so a lockfile alone is not the compatibility boundary.

Any move beyond `0.3.207` requires a separate changelog review and runtime verification. The implementation must not opportunistically advance to a newer release.

## Architecture

### Claude adapter

`apps/server/src/provider/Layers/ClaudeAdapter.ts` remains responsible for:

- Session creation, ownership, and shutdown.
- Prompt and attachment delivery.
- Resume-cursor preservation and recovery.
- Provider request and approval routing.
- Emitting provider-neutral runtime events.

It delegates SDK-version-specific interpretation instead of accumulating more inline branches.

### SDK lifecycle compatibility module

Add `apps/server/src/provider/claude/claudeSdkLifecycle.ts` to own pure interpretation of the pinned SDK lifecycle surface:

- Exhaustive terminal-reason classification.
- Command lifecycle state transitions.
- Interrupt receipt interpretation.
- Background-task snapshot reconciliation.
- Decisions about whether a control-channel gap is recoverable through `reinitialize()`.

The module must expose small typed functions with no session or UI ownership. It consumes exported SDK types wherever available and returns provider-neutral decisions that `ClaudeAdapter` can apply.

### MCP settling module

Add `apps/server/src/provider/claude/claudeMcpSettling.ts` to own nonblocking MCP startup polling:

- Poll `mcpServerStatus()` independently of normal turn startup.
- Stop when all discovered servers are terminal or after an eight-second deadline.
- Treat `connected`, `needs-auth`, `failed`, and `disabled` as terminal states.
- Preserve and return `pending` servers at the deadline.
- Support cancellation when the owning probe or session is stopped.
- Avoid launching duplicate settling loops for the same provider/profile/cwd.

`ProviderMcpStatusCache` remains the owner of project/profile snapshots and stale-while-refresh behavior.

## Runtime Behavior

### Session startup

Normal Claude sessions initialize and accept turns without waiting for every MCP connector. MCP settling runs separately through the provider status path.

The full profiled provider kind and resolved `CLAUDE_CONFIG_DIR` remain authoritative. No state from `claudeAgent:metric` may appear under `claudeAgent:zbd`, or vice versa.

### MCP status

On a cold load, the MCP UI remains in its existing loading state while the first status inventory initializes. During a refresh, the last settled snapshot stays visible with refreshing state rather than disappearing.

The settling loop may publish or return pending state, but it must not mislabel an uninitialized connector as missing, failed, or unauthenticated. After the deadline, unresolved servers remain visibly pending and a later refresh can settle them.

An explicit refresh may call `reloadPlugins()` before settling, matching current behavior. It must not send a model prompt.

### Turn outcomes

Terminal reasons are classified exhaustively. The design uses these provider-neutral outcomes:

- `completed`: the SDK explicitly reports successful completion.
- `interrupted`: user or host interruption stopped active generation or tools.
- `cancelled`: queued or coalesced work was cancelled before meaningful completion.
- `failed`: setup, API, malformed tool use, budget, deferred-tool availability, structured-output exhaustion, or another terminal error prevented completion.

Unknown future terminal reasons must default to failed and produce diagnostic context. They must never default to completed.

Text matching remains only for non-terminal transport exceptions that do not carry the structured result contract. It must not duplicate structured terminal-reason handling.

### Command lifecycle

Track command UUID lifecycle as `queued`, `started`, `completed`, `cancelled`, or `discarded`.

- A command reported completed must not be replayed.
- A cancelled or discarded command must not be reported as successful.
- An interrupted command listed in `still_queued` remains queued and may run later.
- Duplicate lifecycle frames must be idempotent.
- Conflicting regressions produce diagnostics and retain the safest non-success state.

This ticket uses command lifecycle for correctness and logging. It does not add a new user-facing command queue UI.

### Background tasks

`background_tasks_changed` is the authoritative level-triggered snapshot of live background work. Existing `task_started`, `task_progress`, and `task_notification` messages remain the detailed timeline event sources.

Reconciliation must:

- Add live tasks missing from edge events.
- Remove tasks no longer present in the authoritative snapshot.
- Avoid duplicate task rows or duplicate completion events.
- Preserve the latest progress summary and usage data.
- Allow a foreground turn to complete while background work remains active without closing the session prematurely.

### Interrupts

Consume the typed interrupt receipt. Commands in `still_queued` survive the interrupt and remain eligible to execute. Other active work transitions through the normal interrupted/cancelled lifecycle.

The existing public T3 interrupt contract remains unchanged unless a contract extension is strictly required to preserve correctness.

### Reinitialization and process recovery

`Query.reinitialize()` is not a periodic health check and is not used for normal local process exits. It is used only after a detected recoverable control-channel gap where the same SDK query process remains valid and pending permission or dialog state needs to be re-delivered.

Process exit, crash, server restart, and stopped-session recovery continue through T3's existing provider resume-cursor path. No stop or recovery path may delete the provider runtime binding or its cursor.

## Cleanup And Compatibility

The pinned version establishes the SDK compatibility floor.

Remove:

- Optional method checks for APIs guaranteed by `0.3.207`, unless a test double intentionally models absence.
- Pre-`0.3.207` terminal-reason fallbacks superseded by the structured result contract.
- Locally re-declared SDK interfaces that can use exported SDK types directly.
- Temporary aliases, commented migration code, and compatibility TODOs.
- Branches for removed SDK APIs that T3 no longer calls.

A retained fallback must identify a non-SDK compatibility reason and have a focused test. For example, text classification may remain for raw process or transport exceptions that cannot contain an SDK result.

## Packaging

Preserve the packaging guarantees established by T3CO-360:

- Default Claude configuration lets the SDK use its bundled executable.
- An explicitly configured binary path continues to override the bundled executable.
- Staged production dependencies install for the requested target OS and CPU.
- macOS arm64 and x64 artifacts contain the matching Claude SDK native package.
- The lockfile records all required supported-platform optional dependencies.

The implementation must audit the `0.3.207` peer dependency change for `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, and Zod without adding duplicate incompatible versions unnecessarily.

## Error Handling And Diagnostics

- MCP settling timeout is a visible pending state, not a provider failure.
- An MCP status call failure preserves the last settled snapshot and reports the refresh error.
- Unknown terminal reasons are logged with the raw reason and classified as failed.
- Invalid command lifecycle regressions are logged with the command UUID and both states.
- Reinitialization failure falls back to existing process/session recovery without clearing the resume cursor.
- SDK process stderr and control errors continue through the existing lifecycle and provider logs.
- Logs must distinguish session startup, MCP settling, control-channel recovery, and process restart decisions.

## Verification

### Automated tests

Add focused tests for:

- Every `0.3.207` terminal-reason category.
- Unknown terminal reasons failing safely.
- Command lifecycle transitions, idempotency, conflicts, cancellation, discard, and `still_queued` preservation.
- Background-task snapshot reconciliation and duplicate suppression.
- MCP empty-to-pending-to-terminal settling.
- MCP deadline behavior with unresolved pending servers.
- Probe cancellation and coalescing.
- Stale settled snapshots remaining visible during refresh.
- Profile isolation between `claudeAgent:metric` and `claudeAgent:zbd`.
- Resume-cursor preservation through interrupt, stop, failure, and restart paths.
- Bundled executable and custom binary-path selection.
- Target-platform native dependency staging.

Use `bun run test`, never `bun test`.

### T3 Browser verification

The implementation is not complete until it is verified through the T3 Browser against a managed dev run from `feat/provider-capabilities`:

1. Select the zbd Claude profile.
2. Open the MCP panel and observe cold loading or pending state settle accurately.
3. Confirm Slack, Mixpanel, and Notion reach connected state while unauthenticated services reach needs-auth.
4. Make a real read-only Slack request and verify an MCP tool executes successfully.
5. Start and interrupt a Claude turn, then verify a subsequent turn completes normally.
6. Store a unique context token in the thread.
7. Restart the managed dev server.
8. Reopen the same thread and verify Claude recalls the token through the preserved resume cursor.
9. Switch to the other Claude profile and verify MCP and authentication state does not leak between profiles.
10. Inspect the browser console, lifecycle log, provider event log, and timeline logs for uncaught errors, dropped commands, duplicate tasks, or incorrect recovery.

### Completion commands

All focused tests must pass, followed by:

```bash
bun fmt
bun lint
bun typecheck
```

## Documentation

Review and update these documents or skills when their behavior changes:

- `docs/resource-management.md`
- `docs/visibility.md`
- `docs/t3-agent-tools.md`
- `.claude/skills/production-build.md`
- `.claude/skills/provider-integration.md`

Documentation must explain the pinned SDK baseline, nonblocking MCP settling, lifecycle interpretation, recovery boundary, and native packaging behavior.

## Success Criteria

The upgrade is successful when T3 runs exactly SDK `0.3.207`, existing Claude conversations and connectors behave normally, structured lifecycle data prevents silent loss or false success, profile state remains isolated, resume survives a real server restart, native packaging remains valid, no superseded compatibility code remains, and all automated and browser verification passes.
