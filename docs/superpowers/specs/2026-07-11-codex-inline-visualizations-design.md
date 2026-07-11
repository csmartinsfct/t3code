# Codex Inline Visualizations Design

## Goal

Render native Codex Visualize plugin output inside T3 Code by importing the HTML fragment referenced by `::codex-inline-vis{file="...html"}` into the existing Dynamic Chat UI artifact pipeline.

## Directive Boundary

Add a provider-neutral parser for inline directives shaped like `::name{key="value"}`. The parser preserves source ranges and attributes so callers can replace recognized directives without teaching Markdown rendering about provider behavior.

The first consumer is a Codex-specific visualization materializer. It processes only `codex-inline-vis` directives with one safe basename ending in `.html`. Malformed directives, paths containing directory traversal, and unrelated directive names remain ordinary message text.

## Resolution And Persistence

Codex writes visualization fragments beneath `<CODEX_HOME>/visualizations/YYYY/MM/DD/<native-thread-id>/`. The materializer obtains the native thread id from the raw `item/completed` event and resolves the requested basename only within matching thread directories under the configured Codex home.

Successful imports are converted into the existing `t3:dynamic-chat-ui` marker plus `dynamicChatUiArtifacts` message metadata. The HTML is persisted in T3's message projection, so reopening the thread does not depend on the original Codex file still existing.

Resolution is best effort. Missing, unreadable, stale, or oversized files replace the directive with the inline message `_Preview unavailable: visualization file was removed._`. A failure must not fail or delay assistant-message completion.

## Rendering

The existing sandboxed Dynamic Chat UI iframe remains the only visualization renderer. Its injected base styles gain aliases for the Codex Visualize theme variables used by native fragments, including `--background`, `--foreground`, `--border`, `--muted-foreground`, `--viz-series-1` through `--viz-series-6`, and `--font-size-base`.

This change supports HTML/CSS/JavaScript fragments, responsive height, theme changes, and approved CDN imports through the renderer's existing behavior. `window.openai.sendFollowUpMessage` is outside this first pass and can later be mapped through the iframe event bridge without changing directive parsing or artifact persistence.

## Safety

- Accept only a basename, never an absolute or relative path.
- Require the `.html` suffix case-insensitively.
- Resolve the configured Codex profile home rather than assuming `~/.codex`.
- Verify the real file path remains under the matched native-thread directory.
- Reuse the existing Dynamic Chat UI HTML-size limit.
- Preserve unresolved malformed directives literally; emit the unavailable placeholder only for valid visualization references that could not be materialized.

## Verification

- Unit-test generic directive parsing, source ranges, escapes, malformed input, and unrelated text.
- Unit-test Codex file resolution, custom homes, traversal rejection, missing files, successful marker/metadata creation, and persisted HTML.
- Test ingestion with buffered and already-streamed assistant text so completion replaces the directive in both modes.
- Test renderer token injection for native visualization fragments.
- Run `bun fmt`, `bun lint`, and `bun typecheck`.
