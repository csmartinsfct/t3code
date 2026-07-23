# Codex Inline Visualizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import native Codex Visualize HTML references into T3 Code's durable Dynamic Chat UI messages.

**Architecture:** A shared parser recognizes generic inline directives without provider knowledge. A server-side Codex materializer validates and resolves `codex-inline-vis` files using the native thread id and configured Codex home, then returns replacement Markdown and existing Dynamic Chat UI metadata for orchestration ingestion.

**Tech Stack:** TypeScript, Effect, Vitest, React iframe `srcDoc`, SQLite-backed orchestration projections.

## Global Constraints

- Resolution is best effort and must never fail assistant completion.
- Only safe `.html` basenames may be read.
- Imported HTML must use the existing Dynamic Chat UI artifact schema and size limit.
- Missing valid references render an inline unavailable message.
- `bun fmt`, `bun lint`, and `bun typecheck` must pass; tests run with `bun run test`.

---

### Task 1: Provider-Neutral Inline Directive Parser

**Files:**

- Create: `packages/shared/src/inlineDirective.ts`
- Create: `packages/shared/src/inlineDirective.test.ts`
- Modify: `packages/shared/package.json`

**Interfaces:**

- Produces: `parseInlineDirectives(text: string): InlineDirective[]`, where each result contains `name`, decoded string `attributes`, `start`, `end`, and `raw`.

- [x] Write failing tests for ordinary text, `::codex-inline-vis{file="chart.html"}`, multiple directives, escaped quotes, and malformed braces.
- [x] Run `bun run --cwd packages/shared test src/inlineDirective.test.ts` and confirm failure because the module is absent.
- [x] Implement the scanner without provider-specific names or filesystem behavior, and export `@t3tools/shared/inlineDirective`.
- [x] Re-run the focused test and confirm it passes.

### Task 2: Codex Visualization Materializer

**Files:**

- Create: `apps/server/src/provider/codexInlineVisualizations.ts`
- Create: `apps/server/src/provider/codexInlineVisualizations.test.ts`
- Modify: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- Modify: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`

**Interfaces:**

- Produces: `materializeCodexInlineVisualizations(input): Effect<{ text: string; artifacts: DynamicChatUiArtifactDocument[] }>`.
- Consumes: native thread id from `event.raw.payload.threadId`, configured provider kind, and the shared directive parser.

- [x] Write failing materializer tests for successful import, custom Codex home, missing file placeholder, unsafe filename preservation, unrelated directives, and size rejection.
- [x] Run `bun run --cwd apps/server test src/provider/codexInlineVisualizations.test.ts` and confirm expected failures.
- [x] Implement bounded native-thread directory discovery, real-path containment checks, HTML reads, deterministic artifact ids, marker replacement, and best-effort error handling.
- [x] Re-run materializer tests and confirm they pass.
- [x] Write failing ingestion tests proving buffered and previously streamed messages are finalized with replaced text and artifact metadata.
- [x] Update assistant finalization to materialize Codex directives before the completion command and replace already-streamed text atomically on completion.
- [x] Run `bun run --cwd apps/server test src/orchestration/Layers/ProviderRuntimeIngestion.test.ts` and confirm the focused tests pass.

### Task 3: Native Fragment Theme Compatibility And Documentation

**Files:**

- Modify: `apps/web/src/components/chat/DynamicChatUiArtifact.tsx`
- Modify: `apps/web/src/components/ChatMarkdown.test.tsx`
- Modify: `docs/dynamic-chat-ui.md`
- Modify: `docs/features.md`
- Modify: `docs/codex-plugin-skills.md`

**Interfaces:**

- Consumes: imported fragments using native Codex Visualize CSS variables.
- Produces: theme-aware rendering in the existing sandboxed iframe.

- [x] Write a failing renderer test that loads a native-style fragment and asserts injected Codex theme aliases are present.
- [x] Add aliases for native background, foreground, border, muted, typography, and six visualization-series variables to the iframe base style.
- [x] Run the native Visualize browser tests and confirm they pass.
- [x] Document native Codex directive import, persistence, fallback behavior, and the deferred `window.openai.sendFollowUpMessage` bridge.
- [x] Run all focused shared/server/web tests.
- [x] Run `bun fmt`, `bun lint`, and `bun typecheck` and resolve all errors.

### Task 4: Historical Message Backfill

**Files:**

- Create: `apps/server/src/provider/codexInlineVisualizationBackfill.ts`
- Create: `apps/server/src/provider/codexInlineVisualizationBackfill.test.ts`
- Modify: `apps/server/src/ws.ts`

- [x] Materialize raw native directives when existing thread content is loaded.
- [x] Resolve the native thread id from the persisted Codex resume cursor without starting a provider session.
- [x] Persist the replacement text and artifact metadata through the orchestration command path.
- [x] Add a regression test covering an existing message, persisted cursor, and visualization file.
- [x] Verify both historical reload and fresh completion flows in the running T3 browser.
