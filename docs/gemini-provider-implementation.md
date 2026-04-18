# Gemini Provider Implementation Specification

This document turns the provider integration research from T3CO-27 and the
Gemini CLI feasibility work from T3CO-28 into an implementation plan for adding
Gemini as a supported T3 Code provider.

## Decision

Gemini support should be implemented through Gemini CLI ACP mode, not by
scraping the terminal UI and not by treating headless mode as the main chat
runtime.

Gemini CLI ACP mode exposes a long-lived JSON-RPC-over-stdio agent surface with
`initialize`, `authenticate`, `newSession`, `loadSession`, `prompt`, `cancel`,
`setSessionMode`, and `unstable_setSessionModel`. That shape is close enough to
T3 Code's provider adapter contract to justify a first implementation milestone.

The main caveat is payload certainty. Before exposing Gemini in the picker, build
a thin ACP transcript spike that records real payloads for session creation,
prompt streaming, tool calls, approval prompts, cancellation, load/resume, and
model switching. The production adapter should only normalize fields proven by
that transcript.

References:

- Gemini CLI ACP mode: <https://geminicli.com/docs/cli/acp-mode/>
- Gemini CLI headless stream JSON: <https://geminicli.com/docs/cli/headless/>
- Gemini CLI session management: <https://geminicli.com/docs/cli/session-management/>
- Gemini CLI checkpointing: <https://geminicli.com/docs/cli/checkpointing/>
- T3 provider integration map: [T3CO-27](t3://ticket/T3CO-27)
- Gemini feasibility findings: [T3CO-28](t3://ticket/T3CO-28)

## Goals

- Add `gemini` as a first-class provider kind across contracts, settings,
  server snapshots, provider routing, and the web provider/model picker.
- Start, stop, resume, interrupt, and send turns through `gemini --acp`.
- Normalize Gemini ACP runtime notifications into existing
  `ProviderRuntimeEvent` events so orchestration, projections, lifecycle logs,
  and the chat UI remain provider-agnostic.
- Preserve Gemini resume identifiers in `ProviderRuntimeBinding.resumeCursor`.
  Gemini stop paths must follow the existing rule: mark stopped through
  `directory.upsert({ status: "stopped" })` and never remove production
  bindings.
- Support T3 REST tool injection in both MCP delivery modes where Gemini can
  reliably accept the configured tool surface.
- Ship with clear capability flags for unsupported or partially supported Gemini
  behavior instead of pretending parity where Gemini semantics differ.

## Non-Goals

- Do not implement terminal UI automation.
- Do not rely on headless mode for normal multi-turn chat sessions.
- Do not ship Gemini as a fallback to Codex or Claude code paths.
- Do not expose rollback, fork, approval UX, image attachments, or structured
  output until the ACP spike proves each behavior.
- Do not generalize provider profiles beyond the minimum needed for Gemini's
  base provider unless multiple Gemini accounts/profiles become a product
  requirement.

## Current Integration Points

The research found a strong provider adapter boundary, surrounded by many
two-provider assumptions that must be widened deliberately.

### Contracts and Shared Types

Files:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/model.ts`
- `packages/contracts/src/settings.ts`
- `packages/contracts/src/providerRuntime.ts`
- `packages/contracts/src/server.ts`
- `packages/shared/src/model.ts`
- `packages/shared/src/serverSettings.ts`

Required changes:

- Add `"gemini"` to `BASE_PROVIDER_KINDS`, `BaseProviderKind`,
  `ProviderKind`, `baseProviderKind`, `makeProviderKind`, and
  `isValidProviderKind`.
- Add `GeminiModelSelection` to `ModelSelection`.
- Add `GeminiModelOptions`. Start with an empty or near-empty option object
  unless the implementation has proven Gemini-specific toggles that T3 should
  expose.
- Add `gemini` to `ProviderModelOptions`, default model maps, model aliases,
  display names, custom model normalization, API model-id resolution, and tests.
- Add `GeminiSettings` with at least:
  - `enabled`
  - `binaryPath`, default `gemini`
  - `homePath`, mapped to `GEMINI_CLI_HOME` when non-empty
  - `customModels`
  - optional `authMode` or status metadata if the probe can distinguish Google
    login, API key, Vertex AI, and unauthenticated states
- Add matching `ServerSettingsPatch.providers.gemini`.
- Extend raw runtime event source literals with Gemini ACP sources, for example
  `gemini.acp.request`, `gemini.acp.notification`, and
  `gemini.headless.event` if the spike also uses headless probes.

Migration considerations:

- Settings are JSON files decoded through schemas, so adding `providers.gemini`
  with decoding defaults should be additive.
- Existing persisted model selections stay valid because `ModelSelection` is
  widened, not rewritten.
- Review canonicalization logic in
  `apps/server/src/persistence/Migrations/016_CanonicalizeModelSelections.ts`;
  do not edit already-run migrations. If Gemini needs persistence repair, add a
  new migration.

### Server Provider Registration

Files:

- `apps/server/src/provider/Layers/ProviderRegistry.ts`
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- `apps/server/src/provider/Services/ServerProvider.ts`
- `apps/server/src/provider/Services/ProviderAdapter.ts`
- new `apps/server/src/provider/Services/GeminiProvider.ts`
- new `apps/server/src/provider/Layers/GeminiProvider.ts`
- new `apps/server/src/provider/Services/GeminiAdapter.ts`
- new `apps/server/src/provider/Layers/GeminiAdapter.ts`

Required changes:

- Add a `GeminiProvider` status service that checks install, version, auth
  status where possible, enabled settings, configured binary path, and available
  model list.
- Add Gemini to `ProviderRegistryLive` alongside Codex, Claude, and Claude
  profiles.
- Add `GeminiAdapter` to `ProviderAdapterRegistryLive` default adapters.
- Preserve the existing exact-provider, then base-provider lookup behavior.
- Keep provider snapshots generic: Gemini should surface through
  `ServerProvider` with provider `"gemini"`, display name `"Gemini"`, and model
  capabilities that reflect proven behavior.

Gemini provider snapshot requirements:

- `installed`: true only when the configured binary can be executed.
- `version`: parse from `gemini --version` if available.
- `auth`: authenticated only when an ACP or lightweight CLI probe proves a usable
  account or key.
- `models`: start with a static registry of supported aliases and custom models.
  Do not claim account-specific model discovery unless Gemini CLI exposes a
  reliable listing primitive.
- `capabilities`: set unsupported features to false or empty until implemented.

### Gemini ACP Runtime Adapter

Files:

- new `apps/server/src/geminiAcpManager.ts` or
  `apps/server/src/provider/gemini/GeminiAcpManager.ts`
- new Gemini ACP tests near the manager and adapter
- `apps/server/src/provider/Layers/GeminiAdapter.ts`

Recommended shape:

- Mirror `CodexAppServerManager` structurally, but keep Gemini-specific JSON-RPC
  payload handling isolated in a smaller manager.
- Spawn the configured binary with `--acp`.
- Set cwd from `ProviderSessionStartInput.cwd`.
- Set env from server settings:
  - `GEMINI_CLI_HOME` when configured
  - inherited auth env such as `GEMINI_API_KEY`, `GOOGLE_CLOUD_PROJECT`, and ADC
    vars from the T3 process environment
- Perform `initialize` and, if needed, `authenticate`.
- On new sessions, call `newSession` and persist the returned Gemini session id
  as `resumeCursor`.
- On resumed sessions, call `loadSession` with the stored cursor and fail
  explicitly if Gemini rejects it.
- Map `sendTurn` to ACP `prompt`.
- Map `interruptTurn` to ACP `cancel`.
- Map `stopSession` to child-process shutdown plus canonical stopped events.
- Map `listSessions`, `hasSession`, and `readThread` from the manager's active
  in-memory session table and local normalized turn history.

First milestone capability declarations:

- `sessionModelSwitch`: `in-session` through ACP `session/set_model`, falling
  back to `unstable_setSessionModel` for current Gemini CLI builds.
- `rollbackThread`: unsupported or generic-history-only. Return a clear
  provider unsupported error if Gemini cannot rewind through ACP.
- `respondToRequest`: supported only if ACP exposes approval requests with
  stable ids. Otherwise initial Gemini support must require a mode that avoids
  interactive provider approvals.
- `respondToUserInput`: unsupported until Gemini exposes structured user
  questions that can round-trip through ACP.
- `probeRateLimits`: unsupported unless Gemini emits account rate-limit data in
  a reliable probe.

Resume and stop behavior:

- Treat Gemini session ids as cwd/project-scoped, because Gemini stores session
  history under a project hash.
- Include cwd and model in lifecycle logs when resuming so bad cursor/cwd pairs
  are diagnosable.
- Never destroy the T3 binding on stop. Preserve `resumeCursor` exactly as
  returned by Gemini.

### Runtime Event Normalization

Files:

- `packages/contracts/src/providerRuntime.ts`
- `apps/server/src/provider/Layers/GeminiAdapter.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- provider runtime tests

Normalize Gemini ACP events into existing canonical events:

- `session.started`, `session.stopped`, `session.failed`
- `turn.started`, `turn.completed`, `turn.failed`, `turn.interrupted`
- assistant message delta and completion events
- tool start, update, result, and error events
- approval request opened/resolved events if ACP provides approvals
- warning and config events for missing auth, unsupported settings, model
  fallback, and MCP failures
- token usage events if ACP or telemetry exposes usage
- raw debug events with Gemini-specific source labels

Normalization rules:

- Keep raw ACP payloads out of projections unless already represented by
  contracts. Store them in provider logs for debugging.
- Assign stable `providerTurnId`, `providerItemId`, and `providerRequestId`
  values based on Gemini payload ids. If Gemini omits ids, derive deterministic
  ids from the T3 turn id plus sequence numbers inside the manager.
- Prefer emitting less over inventing fake parity. Missing token usage or
  progress should be absent, not guessed.
- Preserve existing ingestion behavior by adapting Gemini to the canonical event
  vocabulary instead of adding Gemini-specific logic to
  `ProviderRuntimeIngestion`.

### Tools, MCP, and Project Context

Files:

- `docs/t3-agent-tools.md`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- `apps/server/src/provider/mcpPromptModeSystemPrompt.ts`
- `apps/server/src/mcpConfigReader.ts`
- `apps/server/src/ws.ts`
- new Gemini MCP config reader

Required changes:

- Add Gemini-specific MCP config discovery. Do not let Gemini fall through to
  Claude MCP config reading.
- Read Gemini MCP servers from the Gemini settings locations supported by the
  CLI, including user-level and project `.gemini` settings when confirmed by the
  spike.
- For `mcpDeliveryMode: "prompt"`, inject the same REST endpoint prompt into
  Gemini prompts or session initialization context.
- For `mcpDeliveryMode: "tools"`, prefer ACP initialize with a T3 MCP server if
  the spike proves Gemini connects to client-provided MCP servers reliably.
- If native tool injection is not reliable in the first milestone, expose Gemini
  only with prompt mode or force prompt mode for Gemini with a visible warning.

Project assumptions:

- Always pass the resolved project/worktree cwd to the Gemini process.
- Treat Gemini's `GEMINI.md`, `.gemini/settings.json`, session history, and
  checkpoints as provider-owned local state.
- Do not mutate Gemini project settings automatically in the first milestone.
  Read and report configuration; leave writes to explicit future work.

### Web App

Files:

- `apps/web/src/session-logic.ts`
- `apps/web/src/providerModels.ts`
- `apps/web/src/modelSelection.ts`
- `apps/web/src/store.ts`
- `apps/web/src/components/chat/ProviderModelPicker.tsx`
- `apps/web/src/components/chat/composerProviderRegistry.tsx`
- `apps/web/src/components/chat/TraitsPicker.tsx`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- browser/test fixtures under `apps/web/src/routes/*.browser.tsx`

Required changes:

- Remove Gemini from any disabled "coming soon" static list when server support
  is ready.
- Add a Gemini icon/display entry and make provider rendering driven by server
  snapshots wherever possible.
- Add Gemini settings:
  - enable/disable toggle
  - binary path
  - Gemini home path
  - auth status and refresh
  - custom models
  - short provider-specific warnings for unsupported approval, image, or native
    tool modes
- Extend provider/model selection helpers so Gemini never falls back to Codex
  because of an unknown provider string.
- Add Gemini to model-option registries with no fake effort or thinking controls.
  The traits picker should hide controls not advertised by model capabilities.
- Ensure default settings and browser fixtures include `providers.gemini` once
  contracts require it.

UI behavior:

- Gemini appears selectable only when enabled and installed.
- If installed but unauthenticated, Gemini appears disabled with an actionable
  status message.
- If native tools or approval-required mode are unsupported, the composer should
  either hide the unsupported mode or show a concise provider warning before the
  turn starts.

### Secondary Inference and Structured Output

Files:

- `apps/server/src/git/Layers/RoutingTextGeneration.ts`
- `apps/server/src/git/Services/TextGeneration.ts`
- `apps/server/src/llm/structuredOutput.ts`
- `apps/server/src/managedRuns/Layers/Inference.ts`
- related prompts and tests

Required changes:

- Stop routing "not Claude" to Codex. Add explicit provider dispatch for Gemini.
- First milestone can choose one of two safe behaviors:
  - route Gemini secondary inference through a Gemini headless JSON runner if
    schema quality is proven, or
  - reject Gemini as a secondary inference provider with an explicit unsupported
    error and UI validation.
- Do not silently use Codex for a user-selected Gemini model.

Deferred:

- Full schema-constrained Gemini structured output.
- Gemini-specific title, branch, commit, PR, and managed-run prompt tuning.
- Gemini rate-limit based reviewer model selection.

## First Parity Milestone

The first milestone should ship Gemini as a normal chat provider with honest
capabilities and no hidden fallback behavior.

Must ship:

- Contracts/settings/model maps accept `gemini`.
- Server settings persist Gemini enabled state, binary path, home path, and
  custom models.
- Provider status discovery reports install, version, enabled, and best-effort
  auth status.
- Web settings let the user configure and refresh Gemini.
- Web picker shows Gemini when the server snapshot includes it and blocks
  selection when unavailable.
- Gemini ACP manager can start `gemini --acp`, initialize, create/load a
  session, send prompts, cancel prompts, and stop sessions.
- Resume cursor persistence works across T3 restarts for the same cwd.
- Assistant text and turn lifecycle events render in the chat timeline.
- Tool events normalize enough for file and shell work to be understandable in
  the timeline if Gemini emits them.
- T3 REST tool prompt-mode injection works.
- Native MCP/tool mode is either working or explicitly disabled for Gemini.
- Unsupported features are declared by capability and produce clear errors.
- Lifecycle logs include Gemini process start, initialize, session id, prompt,
  cancel, load session, stop, and failure details.
- Unit and integration tests cover provider kind widening, settings decode/patch,
  model selection, registry lookup, ACP manager happy path, resume, cancel, and
  unsupported feature errors.

First milestone can defer:

- Provider approval UX if ACP approvals are not proven.
- `respondToUserInput` mapping.
- Rollback and fork through Gemini checkpoints or rewind.
- Image and binary attachment support.
- Native MCP tool mode if prompt mode is reliable.
- Account-specific live model listing.
- Rate-limit probing and reviewer routing.
- Structured-output Gemini runner.
- Multiple Gemini profiles/accounts.

## Implementation Breakdown

1. ACP transcript spike
   - Add a local-only script or test fixture that launches `gemini --acp
--debug`, sends initialize/newSession/prompt/cancel/loadSession, and saves
     redacted JSON-RPC transcripts.
   - Include prompts that cause text-only output, file reads, file writes, shell
     commands, cancellation during a long operation, and any approval path.
   - Decide whether native tools, approvals, resume, and model switching are
     supported for milestone one.

2. Contracts and shared model support
   - Add Gemini provider kind, model selection, model options, settings,
     defaults, aliases, display names, patches, and tests.
   - Update any exhaustive records keyed by `BaseProviderKind`.
   - Replace unknown-provider Codex fallbacks with explicit validation or
     provider snapshot fallback.

3. Server provider status
   - Implement `GeminiProvider` service and layer.
   - Probe binary path, version, enabled settings, and auth.
   - Register Gemini in `ProviderRegistryLive`.

4. Gemini ACP manager
   - Implement process lifecycle, JSON-RPC request ids, response matching,
     notification fan-out, timeout handling, stderr capture, and shutdown.
   - Add fixtures or fake-process tests so the manager can be tested without a
     real Gemini install.

5. Gemini adapter
   - Implement `ProviderAdapterShape`.
   - Maintain active sessions by T3 `threadId`.
   - Normalize ACP notifications to `ProviderRuntimeEvent`.
   - Preserve resume cursors and stopped bindings.
   - Return explicit unsupported errors for unproven capabilities.

6. MCP and tool delivery
   - Add Gemini MCP config discovery.
   - Add prompt-mode injection.
   - Add native tool mode only if ACP initialize can connect to T3's MCP server
     reliably.
   - Update `docs/t3-agent-tools.md` after behavior is implemented.

7. Web UI
   - Add Gemini settings controls and provider status display.
   - Add picker/icon/model-option support.
   - Remove coming-soon treatment.
   - Add tests for unavailable, unauthenticated, enabled, custom model, and
     unsupported mode states.

8. Secondary inference
   - Add explicit Gemini handling in text-generation and managed-run inference.
   - Either implement a Gemini headless runner or block unsupported selection.
   - Add tests proving Gemini never silently falls back to Codex.

9. Documentation and rollout
   - Update `docs/features.md`, `docs/t3-agent-tools.md`,
     `docs/visibility.md`, and any skills that mention provider workflows.
   - Add troubleshooting notes for Gemini auth, missing binary, cwd-scoped
     resume failures, and unsupported modes.

## Testing Strategy

Required commands before completion:

- `bun fmt`
- `bun lint`
- `bun typecheck`

Do not run `bun test`; use `bun run test` for Vitest.

Unit tests:

- Provider kind schema accepts `gemini` and rejects malformed profiled names.
- Settings decode defaults include `providers.gemini`.
- Settings patch accepts Gemini changes.
- Model defaults, aliases, display names, and custom model normalization include
  Gemini.
- Provider registry and adapter registry include Gemini.
- Web model selection and store code do not coerce Gemini to Codex.
- MCP config reader routes Gemini separately from Claude.

Adapter and manager tests:

- Fake ACP process initializes and creates a session.
- `newSession` cursor is persisted into the returned `ProviderSession`.
- `loadSession` uses the stored cursor.
- `prompt` emits canonical assistant text and turn lifecycle events.
- `cancel` emits interrupted or failed lifecycle events consistently.
- Tool calls normalize with stable item ids.
- Unsupported approval, rollback, and user input paths fail with provider
  unsupported errors.
- Child process exit during a turn emits a provider error and leaves the binding
  recoverable.

Integration tests:

- Start a Gemini session, send a text turn, stop, restart T3, and resume with the
  preserved cursor.
- Interrupt a running Gemini turn and verify the session remains reusable or is
  cleanly restarted according to the adapter decision.
- Start with prompt-mode T3 REST tools and verify the model can discover the
  endpoint instructions.
- Verify unavailable and unauthenticated Gemini snapshots disable picker
  selection.
- Verify all stop paths preserve `ProviderRuntimeBinding.resumeCursor`.

Failure-mode tests:

- Missing binary.
- Unsupported Gemini version.
- Auth missing or expired.
- `loadSession` rejected because cwd/project hash changed.
- ACP malformed JSON or request timeout.
- Gemini process exits while a request is pending.
- Tool approval requested when Gemini approvals are disabled.
- Native MCP connection failure.

Manual validation:

- `gemini --acp --debug` transcript for real prompts.
- One file-editing turn in a disposable repo.
- One cancellation while a tool is running.
- One T3 restart/resume cycle.
- One Settings refresh after changing binary path or auth state.

## Observability

Add Gemini-specific lifecycle log markers using the existing provider logging
channels:

- process spawn command, cwd, and configured home path
- ACP initialize start/success/failure
- auth probe result without secret values
- new session id and load session id
- prompt request id and T3 turn id
- cancellation request id and outcome
- unsupported feature decisions
- child-process stderr summaries
- normalized event counts per turn

Provider raw logs should include redacted ACP requests, responses, and
notifications. Do not log prompt text, file contents, API keys, OAuth tokens,
service account JSON, or full tool output unless the existing provider log
policy already permits the equivalent data.

Metrics and traces should tag Gemini with:

- `provider.name = "gemini"`
- `provider.base = "gemini"`
- `provider.model`
- `provider.session_resume = true | false`
- `provider.runtime_mode`
- `provider.interaction_mode`

Update `docs/visibility.md` with Gemini log examples when the adapter lands.

## Rollout Risks

- ACP approval payloads may not support T3's current approval request/response
  UX. Mitigation: ship full-access or prompt-only support first, and gate
  approval-required mode by capability.
- Gemini session ids are project-scoped. Mitigation: include cwd/project hash
  context in logs and reject resume when the cwd differs from the original
  binding.
- `unstable_setSessionModel` may change or be unreliable. Mitigation: use the
  stable `session/set_model` method first, keep the fallback isolated in the ACP
  connection, and surface explicit provider errors if both method names fail.
- Native MCP over ACP may not match T3's current service injection. Mitigation:
  keep prompt-mode support as the first milestone baseline.
- Gemini auth can come from Google login, API key, Vertex AI, or ADC. Mitigation:
  detect only what can be detected safely, surface a generic auth-needed state,
  and avoid storing secrets in T3 settings.
- Existing code has many `BaseProviderKind` exhaustive records. Mitigation:
  widen contracts first, run typecheck early, and avoid Codex fallbacks.
- Structured-output support is unknown. Mitigation: block Gemini selection for
  secondary inference until a Gemini runner is implemented and tested.

## Done Criteria

The Gemini implementation is ready for implementation tickets when:

- The ACP spike confirms or rejects approvals, native MCP, resume, cancellation,
  attachments, model switching, and tool event shapes with redacted transcripts.
- Contracts and settings can represent Gemini without compatibility ambiguity.
- The first parity milestone is decomposed into tickets matching the breakdown
  above.
- Each deferred capability has a product-visible behavior: hidden, disabled,
  explicit unsupported error, or future ticket.
- The test plan covers normal operation, recovery, and failure modes.
