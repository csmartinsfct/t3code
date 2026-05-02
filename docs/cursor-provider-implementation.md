# Cursor Provider Implementation Specification

This document turns the Cursor CLI research from T3CO-393, the provider
integration playbook from T3CO-26/T3CO-27, and the multiple-profile requirement
from T3CO-407 into an implementation plan for adding Cursor as a supported T3
Code provider.

## Decision

Cursor support should be implemented through a process-per-turn CLI adapter
using:

```bash
agent --print --output-format stream-json --resume <session_id> ...
```

Do not automate Cursor's terminal UI and do not wait for a long-lived app-server
or ACP-like protocol. The current CLI already exposes enough for T3's
`ProviderAdapterShape`: a stable chat id, resumable sessions, non-interactive
turn execution, structured stream events, model selection, execution modes, MCP
discovery, and auth/status probes.

The adapter should create or discover a Cursor chat id before the first turn and
persist it as the provider resume cursor. Each turn then spawns a fresh Cursor
process with `--resume <session_id>`. From T3 Code's perspective this is the
same lifecycle shape as the other providers: a command plus a provider-native
resume cursor. The difference is implementation detail: there is no persistent
provider child process between turns.

References:

- Cursor CLI overview: <https://docs.cursor.com/en/cli/overview>
- Cursor CLI parameters: <https://docs.cursor.com/en/cli/reference/parameters>
- Cursor CLI output format:
  <https://docs.cursor.com/en/cli/reference/output-format>
- Cursor CLI MCP: <https://docs.cursor.com/cli/mcp>
- T3 provider integration map: [T3CO-27](t3://ticket/T3CO-27)
- Gemini implementation reference:
  [T3CO-26](t3://ticket/T3CO-26) and
  [Gemini Provider Implementation Specification](gemini-provider-implementation.md)
- Cursor feasibility findings: [T3CO-393](t3://ticket/T3CO-393)
- Cursor multiple-profile requirement: [T3CO-407](t3://ticket/T3CO-407)
- Local skills:
  `.claude/skills/provider-integration.md` and
  `.claude/skills/provider-multiple-profile-support.md`

## Goals

- Add `cursor` as a first-class provider kind across contracts, settings,
  provider snapshots, adapter routing, model selection, orchestration, and the
  web provider/model picker.
- Support Cursor profiles from the first implementation milestone. The default
  provider is `cursor`; profiles are exact provider kinds such as
  `cursor:metric`.
- Start, stop, resume, interrupt, and send turns through the installed Cursor
  CLI using `agent --print --output-format stream-json`.
- Preserve Cursor chat ids in `ProviderRuntimeBinding.resumeCursor`. Stop paths
  must mark bindings stopped and must never delete production bindings.
- Normalize Cursor stream-json events into existing provider runtime events so
  logs, projections, orchestration, and chat timeline UI stay provider-agnostic.
- Provide honest capability flags for approvals, user input, rollback,
  attachments, MCP behavior, structured output, and secondary inference.
- Add enough tests and manual probes to prevent profile/account mixups,
  duplicate assistant output, orphaned shell children, and resume-cursor loss.

## Non-Goals

- Do not scrape or drive Cursor's interactive terminal UI.
- Do not implement a long-lived Cursor transport unless Cursor later exposes a
  stable app-server or ACP-like surface.
- Do not route Cursor through Codex, Claude, or Gemini-specific adapter code.
- Do not claim interactive approval or user-input parity in the first milestone.
- Do not rely on shell aliases or Bash functions as the only production profile
  mechanism.
- Do not implement rollback, fork, rich attachments, or Cursor-native MCP tool
  selection until each behavior is verified with the local CLI.

## Verified CLI Findings

The following findings were validated locally against the installed `agent`
binary, version `2026.05.01-eea359f`, not inferred from docs alone.

### Installation, Status, And Account Probes

- `agent --version` prints the CLI version and exits successfully.
- `agent status` reports authentication state in a human-readable format.
- `agent about --format json` returns CLI version, model, subscription tier,
  platform, architecture, shell, and account metadata. Treat account identifiers
  as sensitive in logs.
- `agent models` returns a line-oriented model list for the current account.
- Official docs use `cursor-agent`; this local install exposes `agent`. T3 must
  keep the binary configurable, with `agent` as the default for this repo.

### Session And Resume

- `agent create-chat` returns a UUID chat id without running a turn.
- `agent --print --output-format stream-json --resume <id> "prompt"` resumes the
  same chat id.
- Resuming with the returned `session_id` preserved prior conversation context.
- `agent ls` currently expects a TUI/raw terminal and failed in a non-TTY probe,
  so it should not be used for status or runtime automation.

### Stream JSON

- `stream-json` emits newline-delimited JSON and ends with a terminal `result`
  event on success.
- Verified event types include `system/init`, `user`, `assistant`, `thinking`,
  `tool_call`, `interaction_query`, and `result`.
- `assistant` events are deltas; the terminal `result.result` contains the
  aggregate assistant text. The adapter must not display both as separate final
  assistant messages.
- Tool events contain start/completion state and provider-specific tool payloads,
  including read, write, and shell tool calls.
- Plan mode emitted `createPlanToolCall` and `interaction_query` data. This is
  useful but should be mapped conservatively until the UI behavior is designed.
- `--output-format json` is too thin for normal runtime use because it only
  emits a terminal result and omits deltas/tool lifecycle events.

### Runtime Modes

- `--mode plan` and `--mode ask` are available. `--plan` is shorthand for plan.
- `--force` and `--yolo` allow commands unless explicitly denied.
- `--sandbox enabled|disabled` and `--trust` are available in print/headless
  mode.
- In non-interactive default mode, approval-required behavior degrades because
  there is no interactive T3 approval round trip. The first implementation
  should map T3 `approval-required` to Cursor's default safe mode and clearly
  surface provider rejections, but not promise interactive approvals.

### MCP

- `agent mcp list` reports configured MCP servers.
- `agent mcp list-tools <identifier>` reports tool names and arguments.
- The official docs state that Cursor CLI uses the same MCP configuration as the
  editor and auto-detects MCP settings. First milestone should expose Cursor MCP
  discovery in the T3 menu, then defer deeper native delivery decisions until
  T3's REST service injection is proven through Cursor turns.

### Interrupts And Child Processes

- Interrupting the parent `agent` process can leave a spawned shell command alive
  unless the process group or process tree is cleaned up.
- Cursor adapter interrupt and stop paths must use process-group/tree cleanup,
  not only `child.kill("SIGINT")` on the direct parent process.

### Multiple Profiles

The local `cursor-metric` Bash function was verified with:

```bash
bash -lc 'type cursor-metric && cursor-metric --version && cursor-metric about --format json'
```

The function launches the same `agent` binary with:

- `HOME=$HOME/.cursor-profiles/metric`
- `CURSOR_CONFIG_DIR=$HOME/.cursor-profiles/metric/.cursor`
- `CURSOR_DATA_DIR=$HOME/.cursor-profiles/metric/.cursor`
- a profile-specific macOS keychain under the profile home
- symlinked `~/.ssh` and `~/.gitconfig`

The probe reported a distinct account from the default profile. Do not log raw
emails or tokens; logs may include a redacted or hashed account label.

## Provider Identity And Profile Model

Cursor must use the same exact-provider-kind model as Codex and Claude profiles.

- Default provider kind: `cursor`
- Profile provider kind: `cursor:<profileId>`
- Example: `cursor:metric`

Exact provider kind must flow through:

- model selections and composer draft persistence
- provider registry snapshots
- provider status probes
- adapter routing and process launch
- runtime events and logs
- rate-limit/cache keys
- provider runtime bindings and resume cursors
- context/token usage events
- MCP discovery

Same-base-provider matching is only for choosing the adapter implementation and
grouping UI. It must not be used as identity after profiles exist.

Profile settings should support both structured environment resolution and, when
needed, wrapper commands:

```ts
interface CursorProfileSettings {
  readonly profileId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly binaryPath?: string; // defaults to providers.cursor.binaryPath
  readonly homePath?: string; // maps to HOME for the child process
  readonly configDir?: string; // maps to CURSOR_CONFIG_DIR
  readonly dataDir?: string; // maps to CURSOR_DATA_DIR
  readonly env?: Record<string, string>;
  readonly launchCommand?: readonly string[]; // advanced wrapper, argv form
  readonly customModels?: readonly CustomModel[];
}
```

`launchCommand` exists for cases like the local `cursor-metric` Bash function
where keychain setup must run before the CLI starts. Prefer an argv/script path
over invoking an ambient shell alias. Status probes and turn execution must use
the same resolved launch configuration so a profile cannot look authenticated
but then run turns under a different account.

For the `metric` profile, the first production-safe settings can be either:

- a checked wrapper script path that performs the same setup as
  `cursor-metric`, or
- structured `homePath`, `configDir`, and `dataDir` plus a small macOS keychain
  bootstrap helper if the wrapper is not used.

Do not rely on `command -v cursor-metric` from the T3 server process; shell
functions live in interactive shell startup files and are not a durable app
configuration surface.

## Resume Cursor Shape

Use an opaque Cursor resume cursor with enough metadata to validate resumes and
avoid cross-profile reuse:

```ts
interface CursorResumeCursor {
  readonly version: 1;
  readonly sessionId: string;
  readonly cwd: string;
  readonly provider: "cursor" | `cursor:${string}`;
  readonly model?: string;
  readonly contextPromptHash?: string;
  readonly contextPromptInjected?: boolean;
}
```

Rules:

- Persist the cursor under the exact provider binding.
- Never reuse a `cursor` cursor for `cursor:metric`, or the reverse.
- Never delete a production binding on stop. Use stopped/closed state updates
  that preserve `resumeCursor`.
- Treat `sessionId` and `cwd` as coupled. If the cwd changes, log it and start a
  new Cursor chat unless a future probe proves cross-cwd resume is safe.
- Store `contextPromptHash` so T3 service guidance is not injected repeatedly
  into the same Cursor chat.

## Current Integration Points

### Contracts And Shared Types

Files:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/model.ts`
- `packages/contracts/src/settings.ts`
- `packages/contracts/src/ticketing.ts`
- `packages/contracts/src/providerRuntime.ts`
- `packages/shared/src/model.ts`
- `packages/shared/src/review.ts`

Required changes:

- Add `"cursor"` to `BASE_PROVIDER_KINDS`, base/exact provider helpers, and
  validation.
- Add `CursorModelSelection` with `provider: "cursor"`, optional `profileId`,
  `model`, and an initially empty `options` object.
- Make `modelSelectionProviderKind` return `cursor:<profileId>` when a Cursor
  profile is selected.
- Add `CursorModelOptions` and include it in `ProviderModelOptions`.
- Add Cursor entries to default model maps, aliases, provider display names, and
  review model heuristics.
- Add `CursorSettings` and `cursorProfiles` to `ServerSettings.providers`.
- Add matching patch schemas for settings and model selections.
- Add or extend tests so model selections preserve `profileId` and do not
  normalize a profiled Cursor selection back to `cursor`.

### Server Provider Status

Files:

- new `apps/server/src/provider/Services/CursorProvider.ts`
- new `apps/server/src/provider/Layers/CursorProvider.ts`
- `apps/server/src/provider/Layers/ProviderRegistry.ts`
- `apps/server/src/serverSettings.ts`

Implemented in T3CO-396:

- Resolve a launch configuration for `cursor` and every configured/discovered
  Cursor profile.
- Probe installation with `<launch> --version`.
- Probe auth/account metadata with `<launch> about --format json` when
  available, falling back to `<launch> status` if JSON fails.
- Probe models with `<launch> models` or `<launch> --list-models`; keep a static
  built-in model list as fallback.
- Cache status by resolved launch config, not only by binary name.
- Register each profile as a distinct `ServerProvider` with provider kind
  `cursor:<profileId>`.
- Avoid exposing raw account emails in provider status labels.

Built-in models should start with locally verified names from `agent models` plus
documented examples such as `gpt-5`, `sonnet-4`, and `sonnet-4-thinking`.
Unknown/custom model slugs remain supported through settings.

Deferred:

- Cache status by resolved launch config if Cursor probes become expensive.
- Surface duplicate-account warnings without exposing raw email addresses.
- Promote additional model capability metadata only after the CLI exposes stable
  machine-readable model details.

### Turn Runner And Stream Parser

Files:

- `apps/server/src/provider/cursor/CursorTurnRunner.ts`
- `apps/server/src/provider/cursor/CursorStreamJson.ts`
- focused tests beside those files

Implemented in T3CO-397:

- Build argv from pure inputs so tests can pin command construction.
- Spawn the resolved Cursor launch config with cwd, environment, and stdio
  suitable for NDJSON parsing.
- Always pass `--print --output-format stream-json`.
- Optionally pass `--stream-partial-output`; the flag is supported locally and
  covered by args-builder tests.
- Pass `--resume <sessionId>` after the first chat has been created.
- Pass `--model <model>` per turn when requested.
- Pass runtime flags:
  - `full-access`: `--force --sandbox disabled --trust`
  - `approval-required`: no force flag, optionally `--sandbox enabled`
  - `plan`: `--mode plan`
  - `ask`: `--mode ask`
- Read stdout line by line, parse each JSON line, and ignore unknown fields.
- Treat malformed JSON as a provider process error with raw line redaction.
- Capture stderr separately and include bounded excerpts in lifecycle logs.
- Resolve completion only after process exit and a successful terminal `result`.
- Treat non-zero exit, missing terminal result, or result `is_error: true` as a
  failed turn.

Deferred to adapter/process-hardening tickets:

- Clean up the entire process group/tree on interrupt, stop, timeout, and
  process exit.

### Adapter Lifecycle

Files:

- new `apps/server/src/provider/Services/CursorAdapter.ts`
- new `apps/server/src/provider/Layers/CursorAdapter.ts`
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/sessionContextPrompt.ts`

T3CO-398 landed the first Cursor adapter milestone. The adapter registers
`cursor` with the provider adapter registry, creates a Cursor chat id with
`agent create-chat` during `startSession`, persists that id in
`ProviderRuntimeBinding.resumeCursor`, and runs each user turn through a fresh
`agent --print --output-format stream-json --resume <session_id>` process. The
same adapter path resolves exact Cursor profile settings, injects T3 session
context only once per matching context hash, rejects concurrent turns, and fails
rollback, fork, approval, and user-input APIs with explicit provider errors.

Recommended lifecycle:

1. `startSession`
   - Validate that the requested exact provider kind is `cursor` or
     `cursor:<profileId>`.
   - Resolve profile settings from the exact provider kind.
   - Build and hash the T3 session context prompt with
     `buildProviderSessionContextPrompt`.
   - If there is a compatible resume cursor for the same exact provider and cwd,
     reuse it.
   - Otherwise call `agent create-chat` through the resolved launch config and
     persist the returned chat id before any turn is started.
   - Emit `session.started`, `thread.started`, and ready state with the Cursor
     chat id as provider thread id.
2. `sendTurn`
   - Reject if another Cursor turn is active for the same T3 thread.
   - Build a prompt that injects T3 service guidance only when the stored
     `contextPromptHash` is absent or stale.
   - Spawn a `CursorTurnRunner` process and stream normalized events back to the
     runtime event queue.
   - Update the stored cursor with `session_id` from `system/init` or `result`
     if Cursor returns a newer value.
3. `interruptTurn`
   - Mark the active turn cancel requested.
   - Interrupt the active adapter fiber and mark the T3 turn interrupted.
   - Follow-up hardening should own the full process group/tree and perform
     explicit cleanup on interrupt, stop, timeout, and process exit.
   - Emit interrupted state only once.
4. `stopSession`
   - If a turn is active, interrupt and clean it up.
   - Mark the in-memory context stopped.
   - Emit stopped/closed runtime events.
   - Let the provider runtime directory preserve the resume cursor.
5. `stopAll`
   - Iterate active sessions and call the same stop path.

Capability declarations for the first milestone:

```ts
{
  sessionModelSwitch: "in-session",
  rollbackThread: "unsupported",
  respondToRequest: "unsupported",
  respondToUserInput: "unsupported",
  probeRateLimits: "unsupported"
}
```

`sessionModelSwitch` can be treated as in-session because T3 starts a new Cursor
process per turn and can pass `--model` with the same `--resume` chat id. Keep a
test that resumes one Cursor chat with two model flags before relying on this in
UI polish.

### Runtime Event Normalization

Files:

- `packages/contracts/src/providerRuntime.ts`
- `apps/server/src/provider/Layers/CursorAdapter.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- provider runtime tests and fixtures

Map Cursor stream-json events as follows:

| Cursor event                                  | T3 behavior                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `system/init`                                 | Record provider session metadata, update resume cursor, emit ready/running metadata if needed.                               |
| `user`                                        | Log raw provider echo only; do not create a duplicate user message.                                                          |
| `assistant`                                   | Emit assistant item started on the first text delta, then assistant deltas.                                                  |
| `thinking`                                    | Emit reasoning deltas if the runtime contract supports them; otherwise preserve in raw provider logs only.                   |
| `tool_call` `started`                         | Emit tool-call started with provider tool name, call id, and redacted args.                                                  |
| `tool_call` `completed`                       | Emit tool-call completed or failed with bounded result output.                                                               |
| `interaction_query`                           | Initially log and surface as unsupported provider interaction; map plan requests after UX is designed.                       |
| `result` success                              | Finish the turn, record duration/request id/session id, and avoid duplicating aggregate text already emitted through deltas. |
| non-zero exit, stderr error, missing `result` | Emit runtime error and failed turn.                                                                                          |

The parser should preserve the raw event in bounded logs for debugging, but
runtime events should stay provider-neutral.

### Context And T3 Service Injection

Files:

- `apps/server/src/sessionContextPrompt.ts`
- `apps/server/src/provider/Layers/CursorAdapter.ts`
- `docs/t3-agent-tools.md`

Cursor print mode does not expose a separate system-prompt channel. Use the same
hashing approach as Gemini's embedded context fallback:

- Build T3 service guidance at session start.
- Inject it into the first user prompt for a Cursor chat.
- Store `contextPromptHash` and `contextPromptInjected` in the Cursor resume
  cursor.
- On resume, re-inject only if the hash changed.
- Keep project title, worktree path, and REST endpoint guidance in this prompt.

Cursor reads `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules` automatically per the
official docs. T3's injected prompt should complement those project rules, not
duplicate them.

### MCP Discovery And Tool Delivery

Files:

- `apps/server/src/mcpConfigReader.ts`
- `apps/server/src/ws.ts`
- `apps/server/src/provider/Layers/ProviderMcpStatusCache.ts`
- `docs/t3-agent-tools.md`

First milestone:

- Add Cursor MCP discovery using the profile's resolved Cursor config and the
  project cwd.
- Prefer CLI probes (`agent mcp list`, `agent mcp list-tools <id>`) for the
  server-visible MCP menu if they are fast enough.
- If CLI probes are too slow, parse Cursor's MCP config files only after
  documenting the exact precedence and shape.
- Continue injecting T3 REST services through the session prompt because it is
  provider-neutral and already works for providers without native tool delivery.

Deferred:

- Automatic MCP approval through `--approve-mcps`.
- Native T3 MCP server registration inside Cursor's own MCP configuration.
- Interactive MCP auth/login flows.

### Attachments

Files:

- `apps/server/src/provider/Layers/CursorAdapter.ts`
- attachment validation helpers used by Claude/Gemini adapters

First milestone should support text prompts and path references only. Cursor CLI
supports file context through prompt text and project tools, but a stable
non-interactive attachment payload was not verified.

Recommended behavior:

- For text/file attachments that T3 can safely read, summarize them into the
  prompt with bounded size limits.
- For image or binary attachments, return a clear unsupported-provider error
  until a local probe verifies a stable CLI contract.
- Keep attachment errors before turn start so no partial provider run is
  recorded for invalid input.

### Secondary Inference And Structured Output

Files:

- `apps/server/src/git/Layers/RoutingTextGeneration.ts`
- `apps/server/src/llm/structuredOutput.ts`
- `apps/server/src/managedRuns/Layers/Inference.ts`

Cursor should not become the default secondary inference provider in the first
milestone. Cursor print mode can return `--output-format json`, but that output
is a terminal text aggregate, not schema-constrained structured output.

First milestone:

- Add Cursor model-selection support where contracts require it.
- Route Cursor secondary inference to an explicit unsupported error unless a
  caller opts into plain text generation.
- Do not use Cursor for structured output until a schema-constrained flow is
  implemented and tested.

### Web UI

Files:

- `apps/web/src/modelSelection.ts`
- `apps/web/src/session-logic.ts`
- `apps/web/src/composerDraftStore.ts`
- `apps/web/src/components/chat/ProviderModelPicker.tsx`
- `apps/web/src/components/chat/ProviderModelPicker.browser.tsx`
- `apps/web/src/components/chat/composerProviderRegistry.tsx`
- `apps/web/src/components/ChatView.tsx`
- settings panels and fixtures that enumerate provider settings

Required behavior:

- Show `cursor` and each enabled `cursor:<profileId>` as distinct provider
  entries.
- Display profile labels in selected model buttons, e.g. `Cursor / metric`.
- Persist `profileId` in composer drafts, tickets, and restored thread state.
- Hide unsupported traits rather than showing fake reasoning/thinking controls.
- Allow plan/ask controls only if they map cleanly to existing interaction mode
  UI.
- Keep profile entries selectable even when the default `cursor` provider is
  disabled, if the profile itself is enabled.

### Observability

Files:

- `docs/visibility.md`
- provider lifecycle log helpers
- `apps/server/src/observability/Attributes.ts`

Add a `cursor-adapter` lifecycle category and log:

- exact provider kind
- resolved cwd
- resolved binary or launch command label
- Cursor CLI version
- redacted account label/hash
- Cursor session id
- runtime mode and model
- whether context prompt was injected or skipped by hash
- process exit code/signal
- interrupt cleanup actions

Never log raw API keys, tokens, full account emails, or full prompt contents.

## Implementation Order

1. Land this specification and feature-doc pointer.
2. Add contracts, settings, model maps, and exact provider helpers for
   `cursor`/`cursor:<profileId>`.
3. Add profile resolution and provider status discovery.
4. Add `CursorTurnRunner` and `CursorStreamJson` with fixture-driven tests.
5. Add `CursorAdapter` lifecycle and runtime-event normalization. (Done in
   T3CO-398 for assistant/reasoning deltas, token usage, terminal turn state,
   resume persistence, and unsupported capability errors.)
6. Add process-tree interrupt cleanup.
7. Wire web provider picker, composer traits, draft persistence, and settings.
8. Add MCP discovery and document the initial T3 REST service injection path.
9. Decide attachment and secondary inference behavior with local probes.
10. Update docs and skills after behavior lands.

## Testing Strategy

Required automated tests:

- contract decode/encode for `cursor` and `cursor:<profileId>`
- model-selection normalization preserving Cursor `profileId`
- settings defaults and patches for `providers.cursor` and
  `providers.cursorProfiles`
- provider registry includes default and profile Cursor providers
- status probes use profile launch config and do not inherit ambient HOME
- turn-runner argv/env construction for default and profile launches
- stream-json parser fixtures for assistant deltas, tool calls, thinking,
  interaction queries, success, non-zero exit, malformed JSON, and missing
  terminal result
- adapter start/resume/stop preserving resume cursors
- same-base different-profile sessions do not reuse cursors
- interrupt cleanup kills child shell processes
- web picker displays and persists profile selections

Manual validation before enabling the provider in normal UI:

```bash
agent --version
agent about --format json
agent models
agent create-chat
agent --print --output-format stream-json --resume <id> "Say one short sentence."
agent --print --output-format stream-json --resume <id> --mode plan "Plan a tiny change only."
agent mcp list
agent mcp list-tools <server-id>
bash -lc 'cursor-metric about --format json'
bash -lc 'cursor-metric create-chat'
bash -lc 'cursor-metric --print --output-format stream-json --resume <id> "Say one short sentence."'
```

Before marking each implementation ticket complete, run:

```bash
bun fmt
bun lint
bun typecheck
```

Do not run `bun test`; use `bun run test` for any targeted Vitest suites.

## Rollout Risks

- Cursor CLI is beta and event fields may grow. Parser must ignore unknown
  fields and tests must pin only fields T3 depends on.
- Non-interactive approvals are not a full T3 approval round trip.
- Shell functions are convenient for local profiles but not durable production
  configuration.
- macOS keychain behavior can accidentally share auth across profiles unless
  each profile launch uses the intended HOME/keychain setup.
- `result.result` duplicates assistant text emitted as deltas.
- Process interrupts can orphan shell children unless the adapter owns process
  group/tree cleanup.
- Cursor history may be cwd-scoped. Resume validation should include cwd.
- Cursor MCP config precedence needs verification before T3 edits or writes any
  Cursor MCP config.

## Done Criteria

- `cursor` and `cursor:<profileId>` are valid provider kinds end to end.
- Default Cursor and at least one configured profile can report installed/auth
  status and model lists independently.
- A Cursor chat can be created, used for a turn, stopped, resumed, and used for
  another turn without losing context.
- Runtime events render assistant deltas, tool calls, and terminal states in the
  existing chat timeline without duplicate final messages.
- Interrupting an active Cursor turn cleans up shell children.
- Switching between `cursor` and `cursor:metric` never reuses the wrong resume
  cursor, account, rate-limit key, or provider status.
- Unsupported capabilities fail with explicit provider errors.
- Docs and tests cover the shipped behavior.
