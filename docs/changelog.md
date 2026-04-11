# Changelog

The desktop build pipeline owns a machine-generated changelog that is baked into Settings and shipped with packaged artifacts.

## Files

- Machine cache: `.generated/changelog/cache.json`
- Runtime asset consumed by the web UI: `apps/web/public/generated/changelog.json`
- Settings route: `/settings/changelog`
- Build hook: `scripts/generate-changelog.ts`, invoked from `scripts/build-desktop-artifact.ts`

## Generation Flow

1. `scripts/generate-changelog.ts` resolves `HEAD` and loads the cache if present.
2. If the cache's `lastProcessedCommit` is not an ancestor of `HEAD` (force-push, rebase, or missing commit), the generator rebuilds from scratch.
3. Otherwise it only processes the new commit range from `lastProcessedCommit..HEAD`.
4. Rebuilds are intentionally capped to a recent-history window (`T3CODE_CHANGELOG_REBUILD_MAX_COMMITS`, default `50`) so packaging stays practical even on long-lived repos.
5. For each batch it gathers committed metadata only:
   - commit SHA
   - authored timestamp/date
   - subject/body
   - changed file paths
6. It runs `codex exec` with an isolated `CODEX_HOME` that copies only `auth.json`.

This intentionally disables MCP/config-driven tools while still allowing authenticated structured-output calls.

## Validation And Provenance

- Codex is asked for strict structured JSON release-note groups.
- The model-facing schema is intentionally simple for CLI compatibility.
- Before writing anything, the script re-validates the final cache and shipped asset against stricter shared contracts in `packages/contracts/src/changelog.ts`.
- The cache and asset both preserve provenance such as:
  - `lastProcessedCommit`
  - `rebuildCommitLimit`
  - per-batch commit ranges
  - included commit SHAs
  - prompt version
  - model name
  - `mcpDisabled`

## Packaging Behavior

`scripts/build-desktop-artifact.ts` always refreshes the changelog before packaging.

- When a fresh `bun run build:desktop` happens, Vite picks up the regenerated public asset.
- When `--skip-build` is used, the build script still copies the generated changelog asset into `apps/server/dist/client/generated/changelog.json` so the packaged app ships the latest committed notes.

## Settings UI

The Settings sidebar footer includes a `Changelog` entry that navigates to `/settings/changelog`.

The page fetches `/generated/changelog.json`, validates it at runtime, and renders entries grouped by date without depending on GitHub or a live git checkout.
