# Cursor Provider Implementation Specification

This document turns the Cursor CLI research from T3CO-393, the provider
integration playbook from T3CO-26/T3CO-27, and the multiple-profile requirement
from T3CO-407 into an implementation plan for adding Cursor as a supported T3
Code provider.

## Decision

Cursor support uses Cursor ACP:

```bash
agent acp
```

T3 spawns `agent acp` as a child process and communicates over newline-delimited
JSON-RPC on stdio. The adapter initializes and authenticates with
`cursor_login`, creates or loads a Cursor ACP session, persists the ACP
`sessionId` as T3's provider resume cursor, sends turns through
`session/prompt`, and normalizes `session/update`, `session/request_permission`,
and Cursor extension methods into canonical provider runtime events.

ACP is the only Cursor runtime transport in T3 Code.

References:

- Cursor CLI overview: <https://docs.cursor.com/en/cli/overview>
- Cursor CLI parameters: <https://docs.cursor.com/en/cli/reference/parameters>
- Cursor CLI ACP: <https://cursor.com/docs/cli/acp>
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
- Support explicit Cursor profiles without auto-discovering local profile
  directories. The default provider is `cursor`; configured profiles are exact
  provider kinds such as `cursor:metric`.
- Start, stop, resume, interrupt, and send turns through `agent acp`.
- Preserve Cursor ACP session ids in `ProviderRuntimeBinding.resumeCursor`. Stop
  paths must mark bindings stopped and must never delete production bindings.
- Normalize Cursor ACP events into existing provider runtime events so logs,
  projections, orchestration, and chat timeline UI stay provider-agnostic.
- Provide honest capability flags for approvals, user input, rollback,
  attachments, MCP behavior, structured output, and secondary inference.
- Add enough tests and manual probes to prevent profile/account mixups,
  duplicate assistant output, orphaned shell children, and resume-cursor loss.

## Non-Goals

- Do not scrape or drive Cursor's interactive terminal UI.
- Do not route Cursor through Codex, Claude, or Gemini-specific adapter code.
- Do not fall back to Cursor's non-ACP print/headless transport for approvals,
  planning, or user input.
- Do not rely on shell aliases or Bash functions as the only production profile
  mechanism.
- Do not implement rollback, fork, embedded file/resource attachment payloads,
  or Cursor-native MCP tool selection until each behavior is verified with the
  local CLI.

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
  T3 normalizes those CLI slugs into ACP-compatible model-family ids before
  exposing them in the model picker.
- Official docs use `cursor-agent`; this local install exposes `agent`. T3 must
  keep the binary configurable, with `agent` as the default for this repo.

### ACP

- `agent acp` starts a Cursor ACP server over newline-delimited JSON-RPC on
  stdio.
- `initialize` returns `authMethods` including `cursor_login`, plus capability
  metadata for loading sessions, MCP transports, images, and session listing.
- `authenticate` with `{ methodId: "cursor_login" }` reused the existing regular
  Cursor login without a keychain prompt in local testing.
- `session/new` returns a `sessionId`, available modes (`agent`, `plan`, `ask`),
  available model ids, and config options.
- `session/set_config_option` accepts `{ sessionId, configId: "mode", value:
"plan" }` and returned updated config options with `currentValue: "plan"`.
- Cursor ACP mode is stateful, so T3 sends `mode: "plan"` for plan turns and
  `mode: "agent"` for normal turns before every prompt.
- ACP model config values can differ from the display slugs returned by the CLI.
  For example, local testing showed raw `composer-2` rejected while
  `composer-2[fast=true]` was accepted from the live `sessionInfo` config
  option list. T3 resolves selected model slugs against the latest ACP
  `availableModels` and `configOptions` before sending `configId: "model"`.
- Mode-change responses may only include the `configOptions` array, not the
  top-level `models.availableModels` shape from `session/new`. Resolve selected
  model names from both shapes before sending a follow-up `configId: "model"`
  update.
- `session/prompt` streams `session/update` notifications for assistant chunks,
  thoughts, tool calls, plan updates, and other lifecycle state.
- In ACP plan mode, Cursor emitted a blocking `cursor/create_plan` request with
  `toolCallId`, `name`, `overview`, `plan`, and `todos`; responding with
  `{ outcome: { outcome: "accepted" } }` let the turn continue and Cursor saved
  the plan file under `~/.cursor/plans/...`.
- The official docs describe `session/request_permission` for tool approvals and
  Cursor extension methods including `cursor/ask_question`, `cursor/create_plan`,
  `cursor/update_todos`, `cursor/task`, and `cursor/generate_image`.
- `scripts/cursor-acp-harness.mjs` is the deterministic local ACP shim for
  approval and user-input UI testing when the live model cannot be forced to
  emit a specific client request. See
  [Cursor ACP Harness](cursor-acp-harness.md).
- Known local nuance: `session/set_config_option` uses `configId`, not
  `optionId`; sending `optionId` returned a schema error.

### MCP

- `agent mcp list` reports configured MCP servers.
- `agent mcp list-tools <identifier>` reports tool names and arguments.
- The official docs state that Cursor CLI uses the same MCP configuration as the
  editor and auto-detects MCP settings. First milestone should expose Cursor MCP
  discovery in the T3 menu, then defer deeper native delivery decisions until
  T3's REST service injection is proven through Cursor turns.

### Interrupts And Child Processes

- Cursor ACP exposes `session/cancel`; T3 uses that for active-turn interrupts.
- Stopping a Cursor session closes the ACP child process after settling the T3
  turn state.
- If future Cursor ACP builds expose stronger cancellation/kill acknowledgements,
  wire those through before adding lower-level child-process cleanup.

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

Follow-up finding: auto-discovering `~/.cursor-profiles/*` is too aggressive for
Cursor because background status probes can trigger macOS keychain prompts for
profile homes. T3 therefore keeps `providers.cursorProfiles` as an explicit
configuration surface but does not auto-register profile directories just
because they exist on disk. T3 also does not synthesize profile HOME,
`CURSOR_CONFIG_DIR`, or `CURSOR_DATA_DIR` paths. Those overrides are inherited
from the base Cursor provider only when set there, or from the explicit profile
fields when set on the profile itself. Because manual Cursor profile entry is
easy to misconfigure and does not solve the keychain-prompt problem, T3 keeps
the profile schema/provider plumbing but does not expose a Settings UI for
adding or editing Cursor profiles yet. The same rollout guard applies to
user-facing model selection and Fork with model menus: `cursor:*` providers may
be registered for internal runtime tests/settings, but visible provider options
filter them out until profile discovery and auth probing are quiet enough.

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

Current UI visibility exception: exact profile IDs must still round-trip through
contracts, settings, provider snapshots, runtime bindings, and logs, but visible
provider/model/fork menus intentionally hide `cursor:*` profile providers. Do
not remove runtime support just because menus hide profiles.

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

Configured Cursor profiles should remain opt-in and advanced/internal until the
auth/keychain behavior is quiet enough for routine background probes. The
default provider should use the regular `agent` command and the user's normal
Cursor login.

For the `metric` profile, the first production-safe settings can be either:

- a checked wrapper script path that performs the same setup as
  `cursor-metric`, or
- explicit `homePath`, `configDir`, and `dataDir` values if the profile account
  is already configured outside T3.

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

Implemented in T3CO-396/T3CO-411:

- Resolve a launch configuration for `cursor` and every explicitly configured
  Cursor profile. Do not auto-discover `~/.cursor-profiles/*`.
- Probe installation with `<launch> --version`.
- Probe auth/account metadata with `<launch> about --format json` when
  available, falling back to `<launch> status` if JSON fails.
- Probe models with `<launch> models` or `<launch> --list-models`; normalize the
  successful probe into ACP-compatible model ids and keep a static built-in model
  list only as fallback.
- Cache status by resolved launch config, not only by binary name.
- Register each profile as a distinct `ServerProvider` with provider kind
  `cursor:<profileId>`.
- Avoid exposing raw account emails in provider status labels.

The picker should start with `composer-2` as T3's Cursor default. When
`agent models` succeeds, the rest of the list should come from locally verified
Cursor models normalized to ACP-compatible ids. Unknown/custom model slugs remain
supported through settings for advanced use.

Deferred:

- Cache status by resolved launch config if Cursor probes become expensive.
- Surface duplicate-account warnings without exposing raw email addresses.
- Promote additional model capability metadata only after the CLI exposes stable
  machine-readable model details.

### Adapter Lifecycle

Files:

- new `apps/server/src/provider/Services/CursorAdapter.ts`
- new `apps/server/src/provider/Layers/CursorAdapter.ts`
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/sessionContextPrompt.ts`

The Cursor adapter registers `cursor` with the provider adapter registry, starts
`agent acp`, initializes and authenticates the ACP server, creates or loads a
Cursor ACP session, persists that `sessionId` in
`ProviderRuntimeBinding.resumeCursor`, and sends each user turn with
`session/prompt`. The same adapter path resolves exact Cursor profile settings,
injects T3 session context only once per matching context hash, rejects
concurrent turns, maps plan/permission/user-input ACP requests into T3 runtime
events, and fails rollback/fork with explicit provider errors.

Recommended lifecycle:

1. `startSession`
   - Validate that the requested exact provider kind is `cursor` or
     `cursor:<profileId>`.
   - Resolve profile settings from the exact provider kind.
   - Build and hash the T3 session context prompt with
     `buildProviderSessionContextPrompt`.
   - Spawn `agent acp` through the resolved launch config.
   - Send `initialize`, then `authenticate` with `methodId: "cursor_login"`.
   - If there is a compatible resume cursor, call `session/load`; otherwise call
     `session/new`.
   - Emit `session.started`, `thread.started`, and ready state with the Cursor
     ACP `sessionId` as provider thread id.
2. `sendTurn`
   - Reject if another Cursor turn is active for the same T3 thread.
   - Build a prompt that injects T3 service guidance only when the stored
     `contextPromptHash` is absent or stale.
   - Apply `session/set_config_option` for the per-turn mode and selected model
     before every prompt. Use `configId`, not `optionId`; normalize display
     slugs to live ACP model option ids when possible.
   - Send `session/prompt` and stream normalized `session/update` notifications
     back to the runtime event queue.
3. `interruptTurn`
   - Mark the active turn cancel requested.
   - Send `session/cancel` to the ACP server.
   - Mark the T3 turn interrupted and preserve the resume cursor.
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
  respondToRequest: "supported through session/request_permission",
  respondToUserInput: "supported through cursor/ask_question",
  probeRateLimits: "unsupported"
}
```

`sessionModelSwitch` is in-session because Cursor ACP exposes
`session/set_config_option` for the model config.

### Runtime Event Normalization

Files:

- `packages/contracts/src/providerRuntime.ts`
- `apps/server/src/provider/Layers/CursorAdapter.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- provider runtime tests and fixtures

Map Cursor ACP events as follows:

| Cursor ACP event                                  | T3 behavior                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session/new` / `session/load`                    | Persist `sessionId` as the provider resume cursor and provider thread id.                                                                                                                                                                                        |
| `session/update` `agent_message_chunk`            | Emit assistant item started on first text delta, then assistant deltas.                                                                                                                                                                                          |
| `session/update` `agent_thought_chunk`            | Emit reasoning deltas.                                                                                                                                                                                                                                           |
| `session/update` `tool_call` / `tool_call_update` | Emit provider-neutral tool lifecycle events.                                                                                                                                                                                                                     |
| `session/update` `plan`                           | Emit `turn.plan.updated`.                                                                                                                                                                                                                                        |
| `session/request_permission`                      | Emit `request.opened`; reply with Cursor's allow/reject option on response.                                                                                                                                                                                      |
| `cursor/create_plan`                              | Emit `turn.proposed.completed` plus a blocking `plan_approval`; reply accepted/rejected/cancelled from the T3 approval decision. Rejected plans persist with `rejected` status, cancelled plans persist with `cancelled` status, and both stop being actionable. |
| `cursor/ask_question`                             | Emit `user-input.requested`; reply with selected option ids.                                                                                                                                                                                                     |
| `session/prompt` success                          | Finish the turn with the returned `stopReason`.                                                                                                                                                                                                                  |
| ACP process or JSON-RPC error                     | Emit runtime error and failed turn.                                                                                                                                                                                                                              |

Raw ACP payloads should be preserved in bounded logs for debugging, but runtime
events should stay provider-neutral.

### Context And T3 Service Injection

Files:

- `apps/server/src/sessionContextPrompt.ts`
- `apps/server/src/provider/Layers/CursorAdapter.ts`
- `docs/t3-agent-tools.md`

Cursor ACP does not currently advertise embedded context support in local
`initialize` output, so T3 uses the same hashing approach as Gemini's text
fallback:

- Build T3 service guidance at session start.
- Inject it into the first user prompt for a Cursor ACP session.
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

- Cursor MCP discovery uses the profile's resolved Cursor settings and the
  project cwd.
- The server-visible MCP menu probes `agent mcp list` first so T3 can surface
  Cursor's own status text, including approval-required states such as `not
loaded (needs approval)`.
- The same menu can run Cursor MCP management commands for visible blocked
  states: `agent mcp enable <identifier>` for approval and
  `agent mcp login <identifier>` for auth/login. T3 invokes these through
  argv-based child processes using the same resolved Cursor launch settings as
  discovery, shows per-server pending state in the composer, and forces MCP
  status refresh after each successful action.
- If the CLI probe fails, T3 falls back to parsing user-level
  `<CURSOR_CONFIG_DIR>/mcp.json` (default `~/.cursor/mcp.json`) and
  project-local `.cursor/mcp.json`.
- Official Cursor ACP docs state that ACP supports project/user `.cursor/mcp.json`
  servers and that dashboard-configured MCP servers are not supported in ACP
  mode.
- T3 REST services continue to be injected through the first Cursor ACP prompt.
  That keeps internal project service delivery provider-neutral and avoids
  writing T3 MCP servers into the user's Cursor config.

Deferred:

- Automatic MCP approval through `--approve-mcps`.
- Native T3 MCP server registration inside Cursor's own MCP configuration.
- Deeper interactive MCP auth callbacks beyond launching `agent mcp login` and
  reporting its process result.

### Attachments

Files:

- `apps/server/src/provider/Layers/CursorAdapter.ts`
- `apps/server/src/provider/Layers/CursorAdapter.test.ts`

Current milestone supports text prompts, image attachments, and path references.
T3 chat attachments are currently image-only at the contract layer; Cursor image
attachments are encoded as ACP `ContentBlock.image` entries when Cursor
advertises image prompt support.

Probe and protocol notes:

- Local `agent acp` initialize probe on 2026-05-03 reported
  `agentCapabilities.promptCapabilities.image: true`.
- ACP schema says `session/prompt.prompt` accepts `ContentBlock[]`; text and
  resource links are baseline, while image blocks require the agent image prompt
  capability.
- The installed CLI currently advertises `embeddedContext: false`, so T3 does
  not embed arbitrary file/resource attachment contents for Cursor. Users should
  reference workspace files by path in prompt text.

Implemented behavior:

- T3 resolves image attachments from the attachment store, base64-encodes the
  bytes, and sends `{ type: "image", data, mimeType, uri }` blocks alongside the
  text prompt.
- If a Cursor ACP process does not advertise `promptCapabilities.image: true`,
  image attachments fail with a provider validation error before
  `session/prompt` is called.
- Embedded file/resource attachment payloads remain unsupported for Cursor until
  Cursor advertises `promptCapabilities.embeddedContext: true` and T3 verifies
  the expected behavior.
- Existing Codex, Claude, and Gemini attachment paths are unchanged.

### Secondary Inference And Structured Output

Files:

- `apps/server/src/git/Layers/RoutingTextGeneration.ts`
- `apps/server/src/llm/structuredOutput.ts`
- `apps/server/src/managedRuns/Layers/Inference.ts`

Cursor is intentionally excluded from secondary inference in this milestone.
Cursor ACP is session-oriented and is not currently wired as a schema-constrained
structured-output transport.

Implemented behavior:

- Settings model pickers for "Text generation model" and "Run inference model"
  hide Cursor and Cursor profiles. These pickers only show Codex, Claude, and
  Gemini because they are the providers wired into T3 secondary inference.
- `RoutingTextGeneration` has an explicit Cursor branch that returns a typed
  `TextGenerationError` for commit messages, PR content, branch names, thread
  titles, and system prompt enhancement instead of falling through to another
  provider.
- Cursor chat defaults and aliases still use `composer-2` for provider/runtime
  conversations. There is no Cursor secondary-inference default model; if a
  stored setting still references Cursor, the web settings UI resolves it back
  to the normal Codex secondary default and the server rejects any direct Cursor
  request explicitly.
- Changelog generation and other schema-bound structured-output flows continue
  to use the existing Codex/Claude/Gemini secondary inference paths. Cursor can
  be added later only after a JSON/schema-constrained runner is implemented and
  malformed-output parsing is tested.

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

Shipped behavior:

- Show the base `cursor` provider in normal chat provider/model menus when it is
  ready. Keep `cursor:<profileId>` providers internal/advanced during the
  guarded rollout so profile probes do not trigger unexpected keychain prompts.
- Preserve `profileId` in contracts, settings, provider snapshots, runtime
  bindings, logs, composer drafts, tickets, and restored thread state even when
  visible menus hide Cursor profiles.
- Hide Cursor and Cursor profiles from secondary-inference selectors such as
  "Text generation model" and "Run inference model".
- Hide unsupported traits rather than showing fake reasoning/thinking controls.
- Allow plan/ask controls only if they map cleanly to existing interaction mode
  UI.
- Keep profile runtime support independent from the base `cursor` provider so
  explicit internal profile tests can still validate exact-provider identity.

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

Cursor ACP lifecycle events are logged as canonical provider runtime events with
raw `cursor.acp.notification`, `cursor.acp.request`, and `cursor.acp.response`
payloads where useful.

Never log raw API keys, tokens, full account emails, or full prompt contents.

## Operator Notes

- Use the regular Cursor profile for day-to-day dogfooding. Avoid enabling
  explicit Cursor profiles unless the profile launch command/home is already
  known to be quiet; macOS keychain prompts can appear during background status
  probes and may not accept the user's normal login password if the profile home
  owns a separate keychain.
- T3 never creates Cursor profile homes, keychains, `HOME`, `CURSOR_CONFIG_DIR`,
  or `CURSOR_DATA_DIR` values. Profile setup is external and explicit.
- Cursor project tools are delivered by prepending T3 REST service instructions
  to the first ACP prompt for the session. T3 does not write MCP servers into
  Cursor config for this milestone.
- For a stuck or suspicious session, inspect the provider lifecycle log first:
  `~/.t3/<env>/logs/provider/<threadId>.lifecycle.log`, then the raw provider
  log at `~/.t3/<env>/logs/provider/<threadId>.log`.
- Common recoveries: send another message to resume a stopped session via
  `session/load`; stop the thread to close the ACP child; disable Cursor or a
  misconfigured profile in settings if status probes are noisy.
- Fork with full Cursor session cloning is intentionally unsupported. A fork can
  preserve visible T3 transcript context, but Cursor ACP does not expose a
  verified provider-native fork primitive in T3 yet.

## Implementation Order

1. Land this specification and feature-doc pointer.
2. Add contracts, settings, model maps, and exact provider helpers for
   `cursor`/`cursor:<profileId>`.
3. Add explicit profile resolution and provider status discovery without
   auto-discovering Cursor profile homes.
4. Add `CursorAcpConnection` with JSON-RPC framing and launch configuration.
5. Add `CursorAdapter` ACP lifecycle and runtime-event normalization for
   assistant/reasoning deltas, tool calls, plan proposals, approvals, user input,
   terminal turn state, resume persistence, and unsupported capability errors.
6. Add ACP cancellation and process close coverage.
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
- provider registry includes the default Cursor provider and explicitly
  configured Cursor profile providers
- status probes use profile launch config and do not inherit ambient HOME
- ACP command/env construction for default and profile launches
- real stdio round-trip coverage using `scripts/cursor-acp-harness.mjs` for
  deterministic `cursor/ask_question` and file-change permission requests
- ACP adapter fixtures for assistant deltas, tool calls, thinking, plan
  proposals, permission requests, user-input requests, successful prompt
  completion, session load, and process errors
- adapter start/resume/stop preserving resume cursors
- same-base different-profile sessions do not reuse cursors
- interrupt cleanup sends `session/cancel` and stops the active turn
- web picker and Fork with model menu display the base Cursor provider while
  hiding `cursor:*` profiles during the guarded rollout

Manual validation before enabling the provider in normal UI:

```bash
agent --version
agent about --format json
agent models
agent acp
agent mcp list
agent mcp list-tools <server-id>
# Optional only when an explicit Cursor profile is being validated:
# bash -lc 'cursor-metric about --format json'
# bash -lc 'cursor-metric acp'
```

For approval and user-input UI paths, use
[Cursor ACP Harness](cursor-acp-harness.md) instead of trying to coerce the live
model into emitting `cursor/ask_question` or a file-edit permission.

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
- Plan approval now uses a full T3 approval round trip, but Cursor ACP extension
  payloads may still evolve and require parser updates.
- Rejected and cancelled Cursor plans are first-class proposed plans with
  distinct `status` values: `"rejected"` for an explicit decline and
  `"cancelled"` for stopping the pending approval. They remain in the timeline
  for audit but are excluded from sidebar `Plan Ready`, composer follow-up, and
  source-plan implementation flows.
- Shell functions are convenient for local profiles but not durable production
  configuration.
- macOS keychain behavior can accidentally share auth across profiles or prompt
  for an unexpected profile keychain. Avoid Cursor profile auto-discovery and
  keep profile probes opt-in.
- ACP extension payloads may evolve. Keep unknown fields in raw payloads and
  parse only fields T3 needs.
- Process interrupts should prefer `session/cancel`, then close the ACP child if
  the session is stopped.
- Cursor history may be cwd-scoped. Resume validation should include cwd.
- Cursor MCP config precedence needs verification before T3 edits or writes any
  Cursor MCP config.

## Done Criteria

- `cursor` and `cursor:<profileId>` are valid provider kinds end to end.
- Default Cursor and any explicitly configured profile can report
  installed/auth status and model lists independently.
- A Cursor ACP session can be created, used for a turn, stopped, resumed with
  `session/load`, and used for another turn without losing context.
- Runtime events render assistant deltas, tool calls, and terminal states in the
  existing chat timeline without duplicate final messages.
- Interrupting an active Cursor turn sends `session/cancel` and settles the T3
  turn once.
- Switching between `cursor` and `cursor:metric` never reuses the wrong resume
  cursor, account, rate-limit key, or provider status.
- Unsupported capabilities fail with explicit provider errors.
- Docs and tests cover the shipped behavior.
