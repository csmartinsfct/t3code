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

This keeps the sidebar honest while still giving users a quick reminder of what had been active before shutdown.
