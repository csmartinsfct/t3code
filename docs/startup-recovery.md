# Startup Recovery

T3 Code persists orchestration/thread session projections, but provider processes do not survive a full server restart. That means a thread or orchestration run can be stored as `running` even though no live worker is attached anymore.

This doc covers how startup recovery turns that stale persisted state into either automatic recovery or a lightweight UI hint.

## Server Setting

`settings.resumeAgentsOnStartup` controls startup behavior for stale work:

- `false` by default
- `true` enables automatic recovery during server startup

The setting lives in Settings > General as `Resume agents on startup`.

## Startup Detection

After the server starts keybindings, settings, and orchestration reactors, it scans the orchestration read model for stale work:

- standalone threads with `session.status === "running"` and an `activeTurnId`
- orchestration runs persisted as `running`

The startup pass deliberately skips threads/runs that were actually blocked on approval or user input before shutdown. Those were not meaningfully "working", and callback state does not survive a restart.

## Startup Snapshot And Lazy Thread Content

The web app can initialize sidebar and header state with `orchestration.getStartupSnapshot`. This RPC returns all projects plus shallow thread metadata for every known thread, including archived threads, without loading heavyweight per-thread content.

Thread metadata includes the summary fields the shell needs without deriving them from nested arrays:

- latest user activity
- pending approval and pending user-input counts
- actionable plan state
- latest turn status
- latest session status
- last activity summary

Full content for a thread is loaded on demand through `orchestration.getThreadContent({ threadId })`. The response contains that thread's messages, activities, checkpoints, proposed plans, and a `sequence` value computed from the projection state so clients can reconcile any live domain events that arrive while the content RPC is in flight.

While this request is in flight, chat routes must keep the active thread shell stable: title, project, model/runtime controls, worktree-aware file explorer access, and the latest shallow activity summary render from metadata immediately. Message timelines, plan state, and diff state show loading shells instead of empty states, and the composer remains disabled until the thread content is present.

Orchestration parent routes also hydrate the required child-thread content before deriving the combined timeline. The switcher can still render from run and ticket metadata while child messages load, but the parent timeline stays in a loading state until the parent and ordered child threads are hydrated.

The older `orchestration.getSnapshot` RPC remains available during migration for callers that still need the full read model in one response.

## Auto Resume

When `resumeAgentsOnStartup` is enabled, recovery is initiated by the server exactly once during startup:

- standalone threads dispatch the same user turn text used by manual recovery: `Resume`
- orchestration runs call the orchestration runner resume path, the same backend path used by the Resume action in the UI

The orchestration runner treats a persisted `running` run with no active in-memory runner as a stale run and recovers it instead of short-circuiting as "already running". This keeps startup recovery idempotent on the server side while still preserving normal in-memory no-op behavior for truly active runs.

If startup auto-resume fails for a thread or orchestration run, the server does not pretend the work is active. The UI falls back to the client-side `Was working` marker instead.

## Was Working

When `resumeAgentsOnStartup` is disabled, or when startup auto-resume fails, the server includes a `startupWasWorkingThreadIds` list in the welcome payload.

The web app stores that marker in client-only UI state:

- it is not written back into persisted orchestration/session state
- it renders as `Was working` in orange text
- it has no spinner
- it clears automatically when the user opens that thread
- it also clears automatically as soon as the client observes authoritative live activity again
  for that thread (or for an orchestration child/run that proves the parent orchestration thread is
  genuinely working again)

This keeps the sidebar honest while still giving users a quick reminder of what had been active before shutdown.
