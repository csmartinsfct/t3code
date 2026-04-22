# Dev Environment

## Overview

T3 Code's development loop is orchestrated by `scripts/dev-runner.ts`, invoked through the top-level `bun run dev*` scripts. This doc covers the pieces that make local dev predictable across branches and git worktrees:

- Dev-runner modes (`dev`, `dev:server`, `dev:web`, `dev:desktop`)
- Per-worktree data-dir isolation (prevents migration collisions across branches)
- Seed template + `bun run snapshot-dev`
- Why the server no longer auto-creates a "server" project on startup

## Modes

The dev-runner is a thin Effect-based CLI that builds the env for turbo and spawns it. `scripts/dev-runner.ts` maps each mode to a turbo filter set:

| Mode          | Turbo filter                               | What it runs                                                                                      |
| ------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `dev`         | `@t3tools/contracts`, `@t3tools/web`, `t3` | Contracts + web dev server + headless t3 server                                                   |
| `dev:server`  | `t3`                                       | Just the t3 server (for integration against an external web client)                               |
| `dev:web`     | `@t3tools/web`                             | Just the Vite web server (for working against an already-running t3 server)                       |
| `dev:desktop` | `@t3tools/desktop`, `@t3tools/web`         | Electron main + Vite web. Electron spawns the server as a child (see `apps/desktop/src/main.ts`). |

All modes share the same port/auth/env plumbing built by `createDevRunnerEnv`. Ports default to `3773` (server) and `5733` (web) and can be shifted via `T3CODE_PORT_OFFSET` or `T3CODE_DEV_INSTANCE`. Pass `--kill-port-conflicts` to SIGTERM/SIGKILL any process holding the requested port before starting.

## Per-worktree data-dir isolation

### Problem

Before this isolation existed, every worktree shared `~/.t3/dev/state.sqlite`. A worktree on a branch that added a migration would apply it to the shared DB; any other branch that didn't yet have the migration file crashed on startup with `MigrationHistoryConsistencyError` (the server validates applied migrations against the in-code registry — `apps/server/src/persistence/Migrations.ts`).

### How it works

`scripts/dev-runner.ts` exposes `resolveWorktreeAwareBaseDir` which:

1. Resolves the base (`T3CODE_HOME` env var or flag, default `~/.t3`) — call this `rootBase`.
2. Shells out to `git rev-parse --show-toplevel` and `git rev-parse --git-common-dir` against the current working directory. Any failure (not a git repo, git missing) falls through to `rootBase`.
3. If `dirname(gitCommonDir) === topLevel`, we're in the primary clone → return `rootBase` unchanged (preserves pre-existing behavior for the main checkout).
4. Otherwise we're in a worktree → return `${rootBase}/worktrees/<sha1(topLevel).slice(0,12)>/`. Short SHA-1 keeps paths readable and is collision-free at human scale. Detection is deterministic: the same worktree path always hashes to the same subdir.

The resolved dir is exported as `T3CODE_HOME` to all children (turbo, electron, the server). The server's `deriveServerPaths` (`apps/server/src/config.ts`) then puts `state.sqlite`, `attachments/`, `settings.json`, `keybindings.json`, `logs/`, and its own `worktrees/` subdir under `<T3CODE_HOME>/dev/`.

Production (packaged Electron) never invokes the dev-runner, so it keeps using `~/.t3/userdata/` unconditionally. This logic is dev-only.

### Layout

```
~/.t3/
  dev/                         ← primary clone data (untouched when in a worktree)
    state.sqlite
    attachments/
    settings.json
    keybindings.json
    logs/
  dev-template/                ← frozen seed (created by `bun run snapshot-dev`)
  worktrees/
    <hash>/                    ← per-worktree T3CODE_HOME
      dev/
        state.sqlite           ← seeded from ~/.t3/dev-template/ on first run
        attachments/
        settings.json
        keybindings.json
        logs/                  ← always fresh per worktree
        worktrees/             ← server-owned git worktrees for in-thread isolation
```

The `worktrees/` naming appears at two levels — the outer is per-dev-env isolation (what this doc describes), the inner is the server's thread-level git worktree pool. They don't overlap functionally.

### Seed on first run

If the computed per-worktree dir doesn't exist yet, and `${rootBase}/dev-template/` exists, the dev-runner copies:

- `state.sqlite`, `state.sqlite-wal`, `state.sqlite-shm` (if present)
- `attachments/`
- `settings.json`, `keybindings.json`

into `<worktreeBase>/dev/`. `logs/` is intentionally not copied — each worktree accumulates its own logs.

If no template exists, the worktree starts empty and you configure it manually (create a project, open a thread, etc.) — the dev-runner just logs that no seed was available.

### Lazy orphan cleanup

On every dev-runner launch (in any mode, from any clone), `pruneOrphanWorktreeDirs` runs `git worktree list --porcelain`, computes the 12-char SHA-1 for each live worktree path, and deletes any subdir under `<rootBase>/worktrees/` whose hash is not in that set. This keeps the `worktrees/` tree from growing indefinitely — once you `git worktree remove <path>` (or otherwise delete a checkout), the corresponding data dir is cleaned up on the next dev launch.

Safety net: if `git worktree list` fails (git missing, not inside a repo, etc.) the prune is skipped entirely. Non-hash-shaped directory names are ignored. `removeDir` failures on individual orphans are swallowed silently so one stuck dir doesn't block the rest. Best-effort by design.

## `bun run snapshot-dev`

`scripts/snapshot-dev.ts` captures a frozen copy of `~/.t3/dev/` into `~/.t3/dev-template/`. Use this after you've set up a good mock project + thread + settings in the primary clone — every worktree created afterwards will start from that snapshot.

```sh
bun run snapshot-dev
```

Notes:

- Removes `~/.t3/dev-template/` if it exists, then copies the same files listed above under "Seed on first run".
- Skips `logs/`, `worktrees/`, `browser/`, `userdata/`.
- Prints the number of active (non-deleted) projects captured — useful smoke-signal that you captured the right DB.
- `T3CODE_HOME` is honored — if you customize it, the snapshot source/target shift with it.

## No more "server" auto-bootstrap

Previously the server auto-created a project named after `basename(process.cwd())` on startup when `autoBootstrapProjectFromCwd` was set (default `true` in non-desktop modes). Because `bun run dev` / `dev:server` / `dev:web` start the server with cwd `apps/server/`, every such launch produced a project titled `"server"` — which accumulated over time (26 `"server"` rows in one dev DB).

That behavior is gone. `ServerConfig.autoBootstrapProjectFromCwd`, the CLI flag, the env var, the web-client `bootstrapProjectId` / `bootstrapThreadId` handling, and all related fixtures were removed in [T3CO-368](t3://ticket/T3CO-368). First-run users create a project through the UI (empty state is already handled at `apps/web/src/routes/_chat.index.tsx`); worktrees get a populated project automatically via the seed template.

## Dev env vars (quick reference)

| Var                          | Effect                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `T3CODE_HOME`                | Base dir. Defaults to `~/.t3`. Dev-runner redirects into a worktree subdir when in a git worktree.           |
| `T3CODE_PORT` / `--port`     | Server port. Default `3773`.                                                                                 |
| `T3CODE_PORT_OFFSET`         | Numeric offset applied to both server + web ports.                                                           |
| `T3CODE_DEV_INSTANCE`        | Seed for a hashed port offset; numeric seeds bypass hashing.                                                 |
| `T3CODE_NO_BROWSER`          | `1`/`0` to suppress or force browser auto-open (non-desktop only).                                           |
| `T3CODE_LOG_WS_EVENTS`       | `1` to log outbound WebSocket push traffic.                                                                  |
| `T3CODE_DISABLE_HMR`         | `1` to disable Vite HMR (manual reload on changes). Loaded from shell or gitignored `.env` at monorepo root. |
| `T3CODE_WEB_SOURCEMAP`       | `0`/`false` disables web sourcemaps; `hidden` emits hidden sourcemaps.                                       |
| `T3CODE_KILL_PORT_CONFLICTS` | `1` to SIGTERM/SIGKILL existing listeners on the requested ports.                                            |

## Related files

- `scripts/dev-runner.ts` — mode table, env builder, worktree detection, seed logic.
- `scripts/snapshot-dev.ts` — template capture script.
- `scripts/dev-runner.test.ts` — unit tests for the above, including injectable git + fs fakes.
- `apps/server/src/config.ts` — `deriveServerPaths` computes state dir from `T3CODE_HOME`.
- `apps/server/src/persistence/Migrations.ts` — migration history validator (the thing that blew up before isolation).
- `docs/resource-management.md` — complementary reading on thread content caching, idle timeouts, memory.
