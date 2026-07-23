# provider-integration

End-to-end playbook for adding a new coding-agent provider (Codex, Claude, Gemini, …) to T3 Code, auditing an existing one, or reviewing a provider integration ticket. The sequence and pitfalls below come from the full Gemini integration (T3CO-26 and its follow-ups), recorded so the next provider takes a day of work instead of a week.

This skill is exhaustive. Use the **Fast Checklist** at the bottom as a surface lookup; use the phased playbook as the actual build order.

---

## When to use

- Adding a new base provider (e.g. a fourth CLI alongside Codex, Claude, Gemini).
- Auditing whether an existing provider has parity across all surfaces.
- Reviewing a ticket titled "Add X provider" or "Extend provider surface for X".

The scope is large (contracts, adapter, orchestration, UI, docs, tests). Break the work across sub-tickets: research spike → contracts → adapter skeleton → per-surface tickets → audit.

---

## Prerequisites

1. **A ticket** (or parent + sub-tickets) with a `worktree` field set. Put every commit on a dedicated worktree branch so the main branch stays clean while the integration lands in many steps.
2. **AGENTS.md in the worktree** — read it first. The "NEVER destroy provider session resume cursors" rule is a blocker on design: every stop path must go through `directory.upsert({ status: "stopped" })`, never `directory.remove`.
3. **A running dev stack** via T3 managed runs (see `.claude/skills/start-electron-dev.md`) so you can verify each phase in the Chromium UI via `chrome-devtools` MCP as it lands.

---

## Phase 0 — Transcript spike

Before touching contracts, produce a redacted JSON-RPC (or whatever the CLI's agent mode speaks) transcript of the real binary. For Gemini this was `gemini --acp --debug`; for Codex it's `codex app-server`; for Claude it's the Claude Agent SDK.

Record:

- `initialize` handshake and the server's advertised capabilities.
- `session/new` (or equivalent) payload + response — what is the session id shape, does it accept `mcpServers`, does it accept a system prompt, does it return a capability flag?
- `session/load`, `session/fork` if exposed.
- `prompt` request/response including text, attachments, embedded-context forms.
- `cancel` mid-turn: does the server send a `turn.aborted`-like notification, or does the prompt-request just reject with "cancelled"?
- Notifications during a turn: text deltas, thinking/reasoning deltas, tool-call lifecycles (started/updated/completed), plan updates, usage updates.
- `session/request_permission` shape (approval events): what fields identify the tool, what options are offered, what outcomes are accepted.
- Any structured user-input request.
- Error shapes from malformed requests, timeouts, and unauthenticated state.
- `setModel` / `setMode` semantics: can the model change mid-session? Is there a stable method name or only `unstable_*`?

**Deliverable:** a plan doc like `docs/<provider>-provider-implementation.md` (Gemini's plan is at `docs/gemini-provider-implementation.md`). Sections: decision, goals, non-goals, per-file change list, capability declarations for the first milestone, deferred items, testing strategy, rollout risks. Commit this doc alone (`6c835112` pattern). Everything below references it.

---

## Phase 1 — Contracts (must compile-break the codebase)

Widen the provider union FIRST. Every provider-specific map in the codebase typechecks against `Record<BaseProviderKind, …>`, so adding a new kind causes compiler errors exactly where maps need to be extended. Lean on those errors as a TODO list.

File: `packages/contracts/src/orchestration.ts`

- Add `"<provider>"` to `BASE_PROVIDER_KINDS` (line 45-ish).
- Add `<Provider>ModelSelection` struct with `provider: Literal("<provider>")`, optional `profileId`, `model: TrimmedNonEmptyString`, optional `options`.
- Add it to the `ModelSelection` union.
- Update `modelSelectionProviderKind` to accept profiled kinds for the new provider if it supports profiles (Gemini didn't; Claude does).
- Update any `isValidProviderKind` check that enumerates provider prefixes.

File: `packages/contracts/src/model.ts`

- Add `<Provider>ModelOptions` struct. Start empty (`Schema.Struct({})`) unless the spike proves provider-specific toggles. Gemini has none; Codex has `reasoningEffort` + `fastMode`; Claude has `effort` + `thinking` + `fastMode` + `contextWindow`.
- Add `<Provider>` entry to `ProviderModelOptions`.
- Add `<Provider>` entry to `DEFAULT_MODEL_BY_PROVIDER` and `DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER`.
- Add `<Provider>` entry to `MODEL_SLUG_ALIASES_BY_PROVIDER` (canonical slug + human-friendly aliases for the picker).
- Add `<Provider>` entry to `PROVIDER_DISPLAY_NAMES`.

File: `packages/contracts/src/settings.ts`

- Add `<Provider>Settings` struct with `enabled`, `binaryPath` (defaults to CLI name), `homePath`/`configDir` (provider-specific), `customModels`. Follow the `makeBinaryPathSetting` pattern used by Codex.
- Add `<Provider>` entry to `ServerSettings.providers`.
- Add `<Provider>SettingsPatch` and include it in `ServerSettingsPatch.providers`.
- Add `<Provider>ModelOptionsPatch` (if options are non-empty) and include the `<Provider>` arm of `ModelSelectionPatch`.

File: `packages/contracts/src/providerRuntime.ts`

- No contract change is required if the runtime-event schema is already provider-neutral (it is today). Only extend the `raw.source` literal enum if you want lifecycle logs to tag the provider-specific transport (e.g. `gemini.acp.notification`).

File: `packages/shared/src/model.ts`

- Add `<Provider>` fallback to `inferBaseProviderKindFromModelSlug` (slug-prefix heuristic). This is what `normalizeModelSelectionProvider` uses to correct a model selection whose `provider` field drifted from its slug — a real bug Gemini shipped first (fork fix `b553e7ff`).
- Extend `normalizeModelOptionsWithCapabilities` helpers if the provider has options.

File: `packages/shared/src/review.ts`

- Update any review-model selection heuristic that enumerates providers.

**Commit after contracts land** (`0b9a8495` pattern). At this point the web and server code should be riddled with typecheck errors where provider-specific maps are missing a branch. Those errors are your map.

---

## Phase 2 — Server provider status service

File: `apps/server/src/provider/Services/<Provider>Provider.ts` (new, thin service tag).

File: `apps/server/src/provider/Layers/<Provider>Provider.ts` (new, the live layer).

- Implement `checkProviderStatus` that returns a `ServerProvider` snapshot.
- `installed`: probe the binary via a version subcommand (e.g. `gemini --version`). Use `spawnAndCollect` from `providerSnapshot` helpers.
- `version`: parse from the version probe output.
- `auth`: provider-specific. For Gemini, this is a multi-branch decision tree over `<GEMINI_CLI_HOME>/settings.json` (`security.auth.selectedType`), environment variables (`GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`), and cached OAuth files. For Codex, it's an `auth.json` file; for Claude, it's the presence of a valid config-dir credential. Be explicit about the `status: "authenticated" | "unauthenticated" | "unknown"` distinction — the UI renders each differently.
- `models`: call `providerModelsFromSettings(BUILT_IN_MODELS, PROVIDER, settings.customModels)` with a built-in model list. The list goes in this file too; include `slug`, `name`, `isCustom: false`, `capabilities`.
- `capabilities`: `reasoningEffortLevels`, `supportsFastMode`, `supportsThinkingToggle`, `supportsPlan`, `contextWindowOptions`, `promptInjectedEffortLevels`. Set unsupported ones to empty/false. The traits picker hides controls that aren't advertised.

Register the live layer in `apps/server/src/provider/Layers/ProviderRegistry.ts`. Preserve the exact-provider-then-base-provider lookup order.

**Commit after status probe is reliable** (tests asserting the auth-state branches, see `91fbeba5`).

---

## Phase 3 — Protocol transport

File: `apps/server/src/provider/<provider>/<Provider>AcpConnection.ts` (or `<Provider>Manager.ts` — whatever the CLI's protocol warrants).

Implement the JSON-RPC / stdio bridge. Keep it minimal and testable: export the args-builder and env-builder as pure functions so unit tests can pin their output without spawning a real process. Gemini's `buildGeminiAcpArgs` / `buildGeminiAcpEnv` pattern (exported at `apps/server/src/provider/gemini/GeminiAcpConnection.ts:176-202`) is the template.

Required behaviors:

- Spawn the binary with `cwd`, `env`, `stdio: ["pipe", "pipe", "pipe"]`.
- Line-buffered JSON-RPC reader (readline).
- Pending-request map keyed by JSON-RPC id with timeout + reject-on-exit semantics.
- Separate notification, incoming-request, and stderr callbacks.
- A `requestWithFallback(primary, fallback, params)` helper — the CLI may rename methods between versions (`session/set_model` ↔ `unstable_setSessionModel`). Fall through on `-32601 method not found`.
- `close()` that idempotently kills the child, closes the readers, and rejects all pending requests.

Write focused tests for the helpers (args/env) and a fixture-driven test for the full connection if you can stub child_process. Gemini's `GeminiAcpConnection.test.ts` is small and covers the full-access vs supervised launch contract.

---

## Phase 4 — Adapter: session + turn lifecycle

File: `apps/server/src/provider/Services/<Provider>Adapter.ts` (service tag).

File: `apps/server/src/provider/Layers/<Provider>Adapter.ts` (the live layer).

This is the biggest file (Gemini's is 1700+ lines). Structure it in this order:

### 4a. Resume-cursor shape

Define a `<Provider>ResumeCursor` interface. Minimum: the provider-native session id + cwd. If your `session.exited` preserves any project-hash binding, include that. The cursor is opaque to T3 — the directory merely stores and returns it — but your adapter must handle three shapes on input:

- `undefined` — start a fresh session.
- `{ sessionId, cwd }` — resume an existing session via `session/load`.
- `{ sessionId, cwd, fork: true }` — fork an existing session via `session/fork`. Return a NEW session id in the result cursor.

Gemini also stores `contextPromptHash` + `contextPromptInjected` on the cursor so it doesn't re-inject the same embedded context on every resume. See the "session context" phase below.

### 4b. Per-session state (in-memory)

```ts
interface <Provider>SessionContext {
  session: ProviderSession;
  readonly connection: <Provider>Connection;
  readonly providerSessionId: string;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  // session-context injection state (see below)
  readonly sessionContextPrompt?: string;
  readonly sessionContextPromptHash?: string;
  sessionContextPromptInjected: boolean;
  activeTurn: <Provider>TurnState | undefined;
  stopped: boolean;
}
```

The `activeTurn` state carries turnId, assistantItemId, `assistantStarted` (so we only emit `item.started` on the first real delta), and any per-turn buffers (see streaming-sanitizer pitfall below).

### 4c. `startSession`

1. Validate the requested provider matches this adapter.
2. Load `serverSettings.providers.<provider>`.
3. Resolve `cwd`, `model`, checkpointContext.
4. Issue an MCP access token via `managedRunService.issueMcpAccess(projectId, threadId)` if checkpointContext + `serverConfig.port > 0`. This token is used in the injected REST prompt (see "Session context" phase).
5. Build the session-context prompt via `buildProviderSessionContextPrompt` from `sessionContextPrompt.ts`, hash it with `hashProviderSessionContextPrompt`.
6. Compute `sessionContextPromptInjected`: true iff the resume cursor already contains a matching hash (avoid double-injection on resume).
7. Create the transport connection (args+env derived from `runtimeMode` — see next section).
8. Inside an `Effect.gen`:
   - `initialize`
   - Branch: `forkSession` if `resumeCursor.fork`, else use `resumeSessionId` as-is if a non-fork resume (the `session/load` call happens AFTER we set up the context — see (11)), else `newSession`.
   - Build the `ProviderSession` record with the returned sessionId + updated resume cursor.
   - Populate the in-memory `<Provider>SessionContext`, set `sessions.set(threadId, context)`.
   - Drain any buffered stderr through `handleStderr`.
   - `loadSession` if non-fork resume.
   - `setModel` if a model was requested.
   - Emit lifecycle events: `session.started`, `thread.started` (with `providerThreadId`), `session.state.changed state: "ready"`, `account.rate-limits.updated` (status=`unknown` if the provider doesn't expose it via the protocol).
9. On failure: `sessions.delete(threadId)`, `connection.close()`. Rethrow.

Emit events via a queue that the layer exposes as `streamEvents: Stream.fromQueue(runtimeEventQueue)`. The orchestration layer drains this.

### 4d. `sendTurn`

1. `getContext(threadId)`. Fail with `SessionClosedError` if already stopped.
2. Reject if an `activeTurn` exists.
3. Validate text-or-attachment input; load + validate images with `resolveAttachmentPath` and a MIME-type allowlist (`GEMINI_SUPPORTED_IMAGE_MIME_TYPES`-style). Send the provider-unsupported validation error BEFORE opening a turn if the attachment is invalid.
4. If the requested model differs from the session's current model AND the capability declares `sessionModelSwitch: "in-session"`, call `connection.setModel`. Update `context.session.model`.
5. If `interactionMode` is set, map it to the provider-native mode (`setMode`). For plan mode: map `plan` and `plan-accept` to the provider's plan mode. For default mode: branch on `runtimeMode` — `full-access` sends yolo/yolo-equivalent; `approval-required` sends default.
6. Create `activeTurn`, emit `session.state.changed running` + `turn.started`.
7. Build the prompt input (see next section about session-context injection).
8. `Effect.forkDetach(connection.prompt({...})).pipe(Effect.match({...}))`:
   - `onSuccess(result)`: emit `thread.token-usage.updated` from `tokenUsageFromPromptResult` if the response contains usage, then call `finishTurn("completed" | "interrupted", { stopReason })`.
   - `onFailure(cause)`: emit `runtime.error` with the message, then `finishTurn("failed", { errorMessage })`.
9. Return `{ threadId, turnId, resumeCursor }` immediately (don't wait for completion).

### 4e. `interruptTurn`

1. `getContext`. If no `activeTurn` (or turnId mismatch), no-op.
2. Set `activeTurn.cancelRequested = true`.
3. `connection.cancel(providerSessionId)`.
4. Emit `turn.aborted` with `reason: "cancelled"`.

### 4f. `stopSession`

```ts
context.stopped = true;
context.connection.close();
updateSession(context, { status: "closed", activeTurnId: undefined });
sessions.delete(threadId);
offerRuntimeEvent({ ...eventBase, type: "session.state.changed", payload: { state: "stopped" } });
offerRuntimeEvent({ ...eventBase, type: "session.exited", payload: { exitKind: "graceful" } });
```

**Critical:** `sessions.delete(threadId)` only removes the adapter's in-memory context — it does NOT remove the directory binding. `ProviderService.stopSession` will `directory.upsert({ status: "stopped" })` after your adapter returns, which preserves the resume cursor. Never call `directory.remove`.

Also **critical:** the `session.exited` payload shape must match Codex/Claude. Use `{ exitKind: "graceful" }`. Do not invent fields like `recoverable: true` — that was a Gemini bug we had to fix.

### 4g. `respondToRequest` and `respondToUserInput`

Both pull from their respective `pending*` maps, call `connection.respond({ id, result/error })`, delete from the map, emit `request.resolved` / `user-input.resolved`. Map canonical decisions (`accept`/`acceptForSession`/`decline`/`cancel`) to the provider-native option IDs via `optionForDecision(options, decision)` with a fallback chain — `acceptForSession` falls back to `accept` when the provider only offers `allow_once`.

### 4h. `readThread`, `stopAll`, `rollbackThread`

- `readThread` returns `{ threadId, turns: context.turns }`. In production today it's unused by orchestration; tests still call it.
- `stopAll` maps over `sessions.keys()` and calls `stopSession`.
- `rollbackThread` — if the protocol doesn't expose rollback, fail with `ProviderAdapterRequestError` and a precise message explaining why. Declare `capabilities.conversationRollback: "unsupported"` (see next section). The checkpoint reactor will gate on this.

### 4i. Capability declaration

```ts
capabilities: {
  sessionModelSwitch: "in-session" | "restart-session" | "unsupported",
  conversationRollback: "provider" | "unsupported",
},
```

The `CheckpointReactor` calls `providerService.getCapabilities(provider)` before trimming turns. If `conversationRollback === "unsupported"` and a revert would trim history, it fails the revert and appends an activity entry instead of leaving fs and provider state out of sync. Always declare this honestly.

---

## Phase 5 — Runtime event normalization

File: your `<Provider>Adapter.ts` (same file).

The adapter owns the mapping from provider-native events to T3's canonical `ProviderRuntimeEvent`. Every event it emits must be a legal shape from `packages/contracts/src/providerRuntime.ts`. Consumers in `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` switch on `event.type` — if you emit a type no consumer reads, the event is dead (a Gemini bug: `mcp.status.updated` was emitted and never consumed).

Events every adapter must emit:

- `session.started` (with optional `resume`)
- `thread.started` (with `providerThreadId`)
- `session.state.changed` — state transitions: `ready`, `running`, `error`, `stopped`
- `session.exited` — `{ exitKind: "graceful" | "error" }` on stop or crash
- `account.rate-limits.updated` — at session start; `status: "unknown"` is fine if the provider doesn't expose rate-limits natively (Gemini's case)
- `turn.started`, `turn.completed`, `turn.aborted`
- `item.started`, `item.updated`, `item.completed` — for tool calls, assistant messages, etc.
- `content.delta` — streaming text deltas with `streamKind: "assistant_text" | "reasoning_text"`
- `thread.token-usage.updated` — every time the provider reports usage
- `thread.metadata.updated` — for title updates
- `request.opened`, `request.resolved` — approval flow
- `user-input.requested`, `user-input.resolved` — structured input
- `runtime.warning`, `runtime.error`

If you consider emitting something outside this list, either wire a consumer in `ProviderRuntimeIngestion` + `apps/web` at the same time, or don't emit it.

**`raw` field** on each event: set `source` to a provider-specific literal (`gemini.acp.notification`, `gemini.acp.request`, `gemini.acp.response`), and attach the original payload. Provider log files and the developer debug panel rely on this.

---

## Phase 6 — Session context prompt (REST-via-shell)

File: `apps/server/src/provider/sessionContextPrompt.ts`.

All supported providers reach T3's project services (managed runs, scheduled tasks, ticketing, prompts) the same way: through a shared `buildT3ServiceInjectionPrompt` string. Your adapter delivers it via the provider's native "put this in front of the model" mechanism:

- Codex: `appendDeveloperInstructions` at session start.
- Claude: `systemPrompt.append` at session start.
- Gemini: ACP embedded-context resource on the first user prompt (ACP `session/new`/`session/load` don't accept a system-prompt field).
- Cursor: prepend to the first ACP `session/prompt` text for the session, guarded by a resume-cursor context hash.

Whatever the mechanism, call `buildProviderSessionContextPrompt` with `threadId`, project title, workspace root, worktree, system prompt, and — if `serverConfig.port > 0` and there's a checkpoint context — a `serviceContext` containing the MCP token and admin prompts. Hash the returned string with `hashProviderSessionContextPrompt` and stash it on the resume cursor so unchanged prompts aren't re-injected on the next session start.

**Pitfall — streaming context-reference leak.** If the injected context uses a sentinel URI (Gemini uses `t3://session/context`), the model may cite it in output. A per-delta `replace(/t3:\/\/session\/context/, "")` is insufficient because the URI may span delta boundaries (e.g. delta1 = `"ok@"`, delta2 = `"t3://session/context"` → user sees `"ok@"`). Use the `sanitizeGeminiStreamChunk` + `flushGeminiSanitizeTail` pattern from `GeminiAdapter.ts`:

- Maintain a per-turn tail buffer.
- On each delta, concat `prev + delta`, apply the full-sentinel regex on the combined buffer, then check if the trailing bytes could still be the start of a sentinel (case-insensitive prefix match against the plain-URI forms AND the markdown-link form `](t3://session/context)`). If so, hold those bytes as the next tail; emit the rest.
- On turn end, flush the residual tail through the non-streaming sanitizer.
- See `FU-1` tests in `GeminiAdapter.test.ts` for the parameterized split-boundary coverage.

Unless your new provider uses a different URI scheme, reuse this code verbatim — extract it from the Gemini adapter into a shared helper the moment you need it twice.

---

## Phase 7 — Runtime access mode (approval-required vs full-access)

The `runtimeMode` is a T3-neutral concept: `"full-access"` means tool calls are auto-approved, `"approval-required"` means every write/exec needs a user click.

Two places to map it:

1. **Process spawn args** (at `startSession`). Many CLIs set approval mode by flag at launch. Gemini's helper `geminiLaunchOptionsFromRuntimeMode` returns `{ approvalMode: "yolo", sandbox: false }` for full-access and `{ approvalMode: "default" }` for supervised. **This is why `ProviderCommandReactor` restarts the session when `runtimeModeChanged` is true** (`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:412`) — a runtime mode change must re-spawn the process, not just send `setMode`.

2. **Per-turn mode** (at `sendTurn`). Map `interactionMode` × `runtimeMode` to the provider's per-turn mode:

   ```ts
   function providerModeFromInteractionMode(
     interactionMode: ProviderInteractionMode | undefined,
     runtimeMode: RuntimeMode,
   ): <ProviderMode> | null {
     switch (interactionMode) {
       case "plan":
       case "plan-accept":
         return "plan";
       case "default":
         return runtimeMode === "full-access" ? "yolo" : "default";
       case undefined:
         return null;
     }
   }
   ```

   Call `connection.setMode` with the result.

**Test this end-to-end** by verifying that switching runtime mode from the composer produces a new spawn with the new args. A focused test on the args/env builder is cheap — see `GeminiAcpConnection.test.ts` and the FU-4 tests in `GeminiAdapter.test.ts` (they assert on `createConnection.options.approvalMode` / `sandbox`).

---

## Phase 8 — Approvals and user input

Provider protocols model approvals differently. Gemini's ACP sends a `session/request_permission` JSON-RPC request with a `toolCall` + `options` array; the adapter turns this into a `request.opened` runtime event with a canonical `ProviderRequestKind`.

Steps:

1. On the provider request, bail with a `cancelled` outcome if there is no active turn (stale permission request after `cancel`).
2. Mint an `ApprovalRequestId`, store the JSON-RPC id + the options list in `pendingApprovals`.
3. Classify the tool call into a canonical request type via `canonicalPermissionRequestType`:
   - **Prefer the protocol's explicit kind first.** Gemini ACP sends `toolCall.kind: "execute" | "edit" | "read" | ...`; map those directly via a lookup table.
   - Fall back to **word-boundary regexes** on `name` and `title` only. Do NOT scan `toolCallId` — provider-generated ids frequently embed tokens like `write`/`read`/`mcp` that have no semantic meaning.
   - Return `"unknown"` rather than force-classifying as `dynamic_tool_call` when nothing matches.
4. Emit `request.opened` with `{ requestType, detail, args }`.
5. On `respondToRequest`, look up `pendingApprovals`, translate the canonical decision to a provider option via `optionForDecision` (accept → allow_once, acceptForSession → allow_always falling back to allow_once, decline → reject_once falling back to reject_always, cancel → `cancelled` outcome), `connection.respond`, emit `request.resolved`.

User input (structured question) flow is analogous with `pendingUserInputs` and `user-input.requested` / `user-input.resolved`. If the provider doesn't expose structured user input, reject unknown methods with JSON-RPC `-32601` immediately so sessions don't hang waiting for a UI flow that doesn't exist.

---

## Phase 9 — Attachments

If the provider supports multimodal prompts:

- Define an allowlist of accepted MIME types (Gemini: PNG/JPEG/WebP/GIF).
- Implement `loadImages(attachments)` that resolves each attachment via `resolveAttachmentPath({ attachmentsDir: serverConfig.attachmentsDir, attachment })`, verifies it exists, reads + base64-encodes, and returns the provider-native content blocks.
- Validate EARLY: fail with `ProviderAdapterValidationError` before opening a turn on unsupported MIME type, missing file, or oversize. The composer-level check is not sufficient; the adapter is the source of truth.
- If secondary inference paths (structured output, text generation, managed-run inference) can't carry attachments, reject with an explicit unsupported error from those paths too. Gemini does this at `GeminiTextGeneration.rejectAttachmentStructuredGeneration`.

---

## Phase 10 — Token usage and rate limits

Two orthogonal signals:

### 10a. Per-thread token usage

Emit `thread.token-usage.updated` from two sources:

- **Streaming usage updates** during a turn (Gemini's `usage_update` session updates). Map to `{ usedTokens, maxTokens? }` with `compactsAutomatically: true` if the provider auto-compacts its context window.
- **Prompt-result usage** at turn end. Map each field the provider reports (input/output/thought/cached-read/total tokens) to `ThreadTokenUsageSnapshot`. Set `lastInputTokens`, `lastOutputTokens`, `lastReasoningOutputTokens`, `lastCachedInputTokens` so the UI can show per-turn usage alongside running totals.
- Missing fields should be absent from the emitted payload, not guessed. Prefer emitting less over inventing parity.

### 10b. Account-level quota / rate limits

Two delivery mechanisms:

- **Protocol-native** (e.g. Claude's rate-limit headers): emit `account.rate-limits.updated` with absolute or percent values in the adapter as they arrive.
- **Out-of-band poller** (Gemini's Code Assist quota endpoint, polled every 60s via `fetchGeminiOAuthUsage`). Pattern:
  - Per-home cache keyed by resolved `homePath`, with TTL + backoff (55s cache, additive 60s 429 backoff, 5-min project-id cache).
  - Token refresh via OAuth refresh token when the cached access token has expired. For Gemini we reuse the public installed-app client credentials from Gemini CLI.
  - Normalize each bucket to `{ tier, utilization: 1 - remainingFraction, resetsAt }` and push through `rateLimitsCache.setOAuthTiers(provider, tiers, warning?)`.
  - Surface "retrying in Xm" warnings when backoff is active so the UI meter can show the degraded state instead of stale numbers.

Web: make sure `apps/web/src/lib/rateLimit.ts` renders the tiers you send. Gemini's quota tiles dropped cleanly in because the renderer is provider-neutral.

---

## Phase 11 — Secondary inference and structured output

T3 routes "not the chat turn" inference (commit messages, PR bodies, branch names, thread titles, managed-run inference) through `RoutingTextGeneration`. Every provider must be explicit — **no silent fallback to Codex** for unknown providers.

File: `apps/server/src/git/Layers/RoutingTextGeneration.ts`

- Add a `<Provider>TextGen` ServiceMap tag and an `Internal<Provider>Layer`.
- Dispatch via `baseProviderKind(provider)` in the `route` function. TypeScript exhaustiveness will catch a missing branch.

File: `apps/server/src/git/Layers/<Provider>TextGeneration.ts` (new)

- Wrap `run<Provider>StructuredOutput` per operation.
- Use the same Effect schemas as Codex/Claude so the output types stay aligned.

File: `apps/server/src/llm/structuredOutput.ts`

- Add `run<Provider>StructuredOutput` that runs the binary in an ephemeral / read-only mode (Gemini uses `--approval-mode plan`; Codex uses `-s read-only --ephemeral`). Parse the output envelope, decode with the target schema.
- If the provider doesn't expose a JSON-schema flag, prompt it explicitly to return a single JSON object and parse the CLI envelope. Gemini's `runGeminiStructuredOutput` uses that approach.

File: `apps/server/src/managedRuns/Layers/Inference.ts`

- Either implement a provider runner, OR return an explicit unsupported result before falling through to another provider. Gemini does the latter.

---

## Phase 12 — Checkpoint reactor guard

File: `apps/server/src/orchestration/Layers/CheckpointReactor.ts`

When a user reverts checkpoints, the reactor may need to trim turns off the provider's conversation state (so fs and conversation stay consistent). For providers whose protocol doesn't expose rollback:

```ts
if (rolledBackTurns > 0) {
  const capabilities = yield * providerService.getCapabilities(sessionRuntime.value.provider);
  if (capabilities.conversationRollback === "unsupported") {
    yield *
      appendRevertFailureActivity({
        threadId,
        turnCount: event.payload.turnCount,
        detail: `Checkpoint revert is unavailable for ${sessionRuntime.value.provider} because provider conversation rollback is unsupported.`,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
    return;
  }
}
```

Your adapter's `rollbackThread` should fail with a clear error as a belt-and-braces measure. Do NOT silently succeed and let fs drift from conversation state — that's worse than a user-visible error.

---

## Phase 13 — Fork behavior

File: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

Find the `forkSource` branch. SDK-level forks are only used when source and target have the same `baseProviderKind` + same `profileId`. Add your new provider:

```ts
if (
  ((sourceBase === "claudeAgent" && targetBase === "claudeAgent") ||
    (sourceBase === "gemini" && targetBase === "gemini") ||
    (sourceBase === "<provider>" && targetBase === "<provider>")) &&
  sameProfile &&
  forkSource.resumeCursor
) {
  // pass resumeCursor with { ...cursor, fork: true } to startSession
}
```

Cross-provider forks fall back to generic context injection (copy text). The adapter's own `startSession` handles the `fork: true` flag on the cursor.

**Pitfall: projection-time provider drift.** When a thread is forked (or its model is switched), the `modelSelection.provider` can drift from the actual model slug (`"provider: codex, model: gemini-3.1-pro-preview"` — a real bug fixed in `b553e7ff`). `ProjectionPipeline` and `projector.ts` now normalize every incoming `modelSelection` through `normalizeModelSelectionProvider`, which infers the provider from the model slug. Make sure your new provider's slug prefix is covered in `inferBaseProviderKindFromModelSlug` (phase 1).

---

## Phase 14 — MCP config discovery

File: `apps/server/src/mcpConfigReader.ts`

The composer MCP menu mirrors user-configured MCP servers from disk. Add a `resolve<Provider>McpServerNames` function that reads the provider's settings files (Gemini: `<GEMINI_CLI_HOME>/settings.json` + `<cwd>/.gemini/settings.json`; Codex: TOML; Claude: `~/.claude.json` + `.mcp.json`), extracts `mcpServers` keys, and respects any `allowed` / `excluded` filters.

File: `apps/server/src/ws.ts`

Wire the new `resolve<Provider>McpServerNames` into the `resolveProviderMcpServers` handler. Also ensure file watchers set up via `ensureWatchDirForFile` cover the new config paths so the menu refreshes when the user edits settings.

Today T3 does NOT register its own `t3-code` MCP bridge for any provider — project services are delivered via REST-via-shell (phase 6). User-level MCP config is still honored by the provider CLI itself; the menu just reflects it. A future native-MCP mode would slot into `buildT3ServiceInjectionPrompt` and per-adapter session setup.

---

## Phase 15 — Web UI

File: `apps/web/src/components/chat/ProviderModelPicker.tsx` (+ `.browser.tsx`)

- Add an icon entry for the new provider.
- Confirm the picker's "disabled reason" chain surfaces each state: `disabled` → "Disabled"; `!installed` → "Not installed"; `auth.status === "unauthenticated"` → "Not authenticated"; `status === "warning"` → "Needs attention"; else "Unavailable". Gemini added this granularity in `91fbeba5`.

File: `apps/web/src/components/chat/composerProviderRegistry.tsx`

- Add a registry entry. Traits menu content may be null if the provider has no model options (Gemini's case).

File: `apps/web/src/components/chat/TraitsPicker.tsx`

- Add a branch if the provider exposes distinct controls.

File: `apps/web/src/components/settings/SettingsPanels.tsx`

- Add a panel with: enable toggle, binary path, home/config path, custom models, refresh button, auth status display.

File: `apps/web/src/modelSelection.ts` + `apps/web/src/session-logic.ts` + `apps/web/src/store.ts`

- Update `makeAppModelSelection` and any provider-switching helpers. Use `makeProviderModelSelection` from `packages/shared/src/model.ts` (added in `b553e7ff`).
- Update fallbacks: never coerce an unknown provider to Codex silently. Propagate the error to the picker.

File: `apps/web/src/components/ChatView.tsx` + `apps/web/src/components/KeybindingsToast.browser.tsx` + `apps/web/src/components/chat/ProviderModelPicker.browser.tsx`

- If the provider needs any new icon import, it usually lands here.
- The runtime-mode toggle button (`LockIcon`/`LockOpenIcon`) + `CompactComposerControlsMenu` "Access" section already work for any provider — no changes.

File: `apps/web/src/routes/__root.browser.tsx`

- Confirm test fixtures include the new `providers.<provider>` defaults so the route stays typecheck-clean.

**UI behavior:**

- Gemini appears selectable only when enabled + installed + authenticated.
- If installed but unauthenticated, Gemini appears disabled in the picker with the actionable status line.
- Model traits that the capability map does not expose must be hidden.

---

## Phase 16 — Tests

At minimum:

- **Contracts**: `packages/contracts/src/provider.test.ts` accepts the new kind and rejects malformed profiled names. `packages/contracts/src/settings.test.ts` has decode defaults for the new provider. `packages/contracts/src/ticketing.test.ts` accepts the new arm.
- **Model selection**: `apps/web/src/modelSelection.test.ts` and `packages/shared/src/model.test.ts` — default, alias, display name, custom model normalization, and `inferBaseProviderKindFromModelSlug` coverage for the new prefix.
- **Provider registry**: `apps/server/src/provider/Layers/ProviderRegistry.test.ts` and `ProviderAdapterRegistry.test.ts` resolve the new provider.
- **Adapter**: start, send text turn, model switch, interrupt, stop, approval happy path, approval with unsupported option, user input, attachment validation, attachment send, context-leak sanitation (single-delta AND split-boundary — use a parameterized test over every split index), fork (returns new cursor), resume (skips re-injection when hash matches), runtime-mode → launch args (full-access AND supervised), unsupported rollback fails cleanly.
- **Permission classification**: `canonicalPermissionRequestType` — ACP-kind wins over heuristics, snake_case identifiers don't false-match, `toolCallId` is ignored, `unknown` is returned when nothing matches.
- **Provider status**: install missing, version parse, each auth-mode branch, timeout handling.
- **MCP config reader**: user-level, project-local, allowed/excluded filters.
- **REST injection prompt**: `restEndpointSystemPrompt.test.ts` — the wording is provider-neutral.
- **CheckpointReactor**: revert fails when rollback is unsupported and turns would be trimmed.
- **ProviderCommandReactor**: `"restarts the provider session when runtime mode is updated on the thread"` test covers the restart invariant; verify it still passes for your adapter.

Write tests BEFORE or alongside implementation for each phase. The Gemini adapter test file is ~1300 lines — plan for it.

---

## Phase 17 — Docs

- `docs/<provider>-provider.md` — reference doc. Sections: runtime access, project tools, approvals, usage & limits, resume/fork/rollback, turn diffs, attachments, structured output, authentication detection.
- `docs/features.md` — add the provider under the providers section; update any feature table that enumerates providers.
- `docs/t3-agent-tools.md` — no change needed unless you alter the injection path.
- `docs/visibility.md` — add lifecycle log examples for the new provider.
- `AGENTS.md` — update the "Package Roles" or any section that enumerates providers.
- Provider parity skill — extend THIS file if the new provider surfaces a case not covered.

---

## Pitfalls learned from Gemini

Keep this list in mind during implementation and re-audit during PR review:

1. **Streaming context-reference leaks.** Per-delta regex replacement is not sufficient when the sentinel can span delta boundaries. Use a tail buffer + pending-markdown-link detection. See phase 6.
2. **Runtime-mode changes require session restart.** CLI approval flags are set at spawn. `setMode` alone does NOT change sandbox/approval behavior of the running process. Confirm `ProviderCommandReactor` restarts on `runtimeModeChanged`.
3. **Don't destroy resume cursors.** Ever. AGENTS.md rule #1.
4. **`session.exited` taxonomy.** Match `{ exitKind: "graceful" }` / `{ exitKind: "error" }` exactly; don't invent extra fields like `recoverable` unless you also wire consumers.
5. **Dead runtime events.** If you emit an event type nothing consumes, either wire a consumer or drop the emission. Gemini shipped a dead `mcp.status.updated` that we had to remove.
6. **Provider-kind drift after fork.** A forked thread's `modelSelection.provider` can drift from the model slug. Projector normalization (`normalizeModelSelectionProvider`) covers this — make sure your slug prefix is in `inferBaseProviderKindFromModelSlug`.
7. **Tool-call classification heuristics.** Prefer the protocol's explicit kind. Fall back to word-boundary regex on `name` / `title` ONLY. Never scan `toolCallId`.
8. **Capability honesty.** Declare `conversationRollback: "unsupported"` if the protocol doesn't support it. The checkpoint reactor relies on this to avoid fs/conversation desync.
9. **No silent Codex fallback in secondary inference.** Every text-generation path must dispatch explicitly on provider; unknown providers must error, not route to Codex.
10. **Attachment validation at adapter boundary.** Don't rely on composer-level checks.
11. **Timeouts + timeouts + timeouts.** The JSON-RPC transport must reject pending requests on child exit. Tests for "child process exits while a request is pending" catch a whole class of hang bugs.
12. **`readThread` is mostly unused in production.** Don't over-invest. The adapter's in-memory `turns` array is fine for the surface the tests assert on.

---

## Fast checklist (surface lookup)

Use when auditing or reviewing. Each bullet maps to one or more phases above.

- [ ] Contracts: `BASE_PROVIDER_KINDS`, `ModelSelection` union, `ModelOptions`, `ProviderModelOptions`, `DEFAULT_MODEL_BY_PROVIDER`, `MODEL_SLUG_ALIASES_BY_PROVIDER`, `PROVIDER_DISPLAY_NAMES`, `ProviderSettings`, `ServerSettingsPatch`, `isValidProviderKind`. (Phase 1)
- [ ] `inferBaseProviderKindFromModelSlug` covers the new slug prefix. (Phase 1)
- [ ] Provider status service: install, version, auth branches, models, capabilities. Registered in `ProviderRegistryLive`. (Phase 2)
- [ ] Transport layer: pure args/env builders, pending-request map with timeouts, stderr + notification + incoming-request callbacks, `close()` idempotent. (Phase 3)
- [ ] Adapter: start/send/interrupt/stop/respondToRequest/respondToUserInput/readThread/stopAll/rollbackThread; `streamEvents` stream; `sessions.delete` but never `directory.remove`. (Phase 4)
- [ ] Capability declaration: honest `sessionModelSwitch` and `conversationRollback`. (Phase 4i)
- [ ] Runtime events cover lifecycle, turns, items, deltas, approvals, user-input, metadata, usage, warnings, errors. (Phase 5)
- [ ] Session-context prompt routed through `buildT3ServiceInjectionPrompt`; cursor stores hash + injected flag; streaming sanitizer for any sentinel URI. (Phase 6)
- [ ] Runtime-mode → launch args + per-turn mode; reactor restarts on mode change. (Phase 7)
- [ ] Approval classification via ACP kind first, word-boundary regex fallback, no `toolCallId` scanning. (Phase 8)
- [ ] Attachment MIME allowlist + adapter-level validation; secondary flows reject cleanly. (Phase 9)
- [ ] Token usage from updates AND prompt results; account rate-limits either native or polled. (Phase 10)
- [ ] Secondary inference + structured output + managed-run inference have explicit provider branches; no Codex fallback. (Phase 11)
- [ ] Checkpoint reactor capability guard in place. (Phase 12)
- [ ] Fork whitelist updated in `ProviderCommandReactor`. (Phase 13)
- [ ] MCP config discovery + file watchers. (Phase 14)
- [ ] Web picker, settings panel, composer registry, traits, fixtures. (Phase 15)
- [ ] Tests at every phase; parameterized split-boundary coverage for streaming sanitizer. (Phase 16)
- [ ] Docs in `<provider>-provider.md`, `features.md`, `visibility.md`. (Phase 17)

## TypeScript guards

Add a guard anywhere a provider-specific map can drift. Good patterns:

```ts
const PROVIDER_CONFIG: Record<BaseProviderKind, ProviderConfig> = {
  codex: codexConfig,
  claudeAgent: claudeConfig,
  gemini: geminiConfig,
};
```

```ts
expect(Object.keys(PROVIDER_CONFIG).toSorted()).toEqual([...BASE_PROVIDER_KINDS].toSorted());
```

Use the shared provider union as the source of truth. A new provider should fail typecheck or a focused test until the relevant model-selection, status, adapter, and UI surfaces are wired.

## Claude SDK compatibility boundary

Claude is pinned exactly to `@anthropic-ai/claude-agent-sdk` `0.3.207`, which
ships Claude Code `2.1.207`. Treat that pair as one runtime boundary. Before a
future upgrade, review the SDK changelog, exported control and message types,
terminal reasons, peer ranges, bundled Claude Code version, and native optional
package layout.

Keep these provider-specific guarantees intact:

- MCP probing is background work and must not block session startup. Settle
  empty and pending inventories for a strict eight seconds, including hung
  reads; preserve pending rows at the deadline, propagate cancellation, retain
  settled rows through refresh/error, and key snapshots by full profile kind.
- `background_tasks_changed` replaces the process-scoped live set. Detailed
  task messages remain independent edge events and retained action history. The
  actions group owns the live count, and process start, stop, exit, and
  resume-cursor restart clear it.
- Interrupt `still_queued` UUIDs are diagnostic only in `0.3.207`. They do not
  identify T3 inputs and must not mutate the queue. Structured terminal reasons
  remain authoritative; raw text classification is only for transport/process
  failures without a structured result.
- Do not call `Query.reinitialize()` speculatively or after process exit. Recover
  an exited process by starting a new query from the persisted resume cursor.
  Stop paths upsert the binding as stopped and never delete it.
- Let the SDK use its bundled target-native `claude` executable by default;
  preserve an explicit `pathToClaudeCodeExecutable` override. Desktop staging
  installs production dependencies for the requested OS and CPU.

## T3 Browser verification

T3 Browser is the required surface for UI and provider verification. Start the
branch through a T3 managed run, then use the project-scoped `/api/browser`
tools so automation exercises the same embedded browser surface the user sees:

1. Reload the app and inspect console logs for new errors.
2. Open the provider/model picker and confirm the provider, icon, profile label, model list, custom models, context badge, and rate-limit meter render as expected.
3. Start a real provider turn and watch the work log for tool calls, approvals, token usage, runtime warnings, and completion state.
4. Test full-access and approval-required modes when the provider supports tool permissions.
5. Verify configured MCP servers are discovered in the MCP menu when the provider exposes them.
6. Exercise attachments, structured output, fork/resume, and diff/checkpoint flows when the ticket touches those behaviors.
7. Inspect lifecycle and provider logs for ambiguous failures, slow provider startup, lost resume cursors, or missing runtime events.

## Completion

Before closing a phase ticket:

1. Run the focused tests that cover the changed provider surface.
2. Run `bun fmt`, `bun lint`, and `bun typecheck`.
3. Record any provider limitations in docs and in the ticket comment.
4. Mark acceptance criteria met only after the automated checks and T3 Browser verification relevant to the ticket have passed.
5. Commit all work for the phase in a single, tightly-scoped commit that names the phase (`Add <provider> session context prompt injection`, `Implement <provider> approval flow`, etc.). Follow the Gemini commit sequence for inspiration — each commit there is scoped to one phase or one fix.
