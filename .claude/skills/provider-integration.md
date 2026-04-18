# provider-integration

Use this checklist when adding a provider, auditing provider parity, or reviewing a provider
integration ticket. The goal is to make provider behavior predictable across the UI, server,
tools, logs, and recovery flows before the provider is considered complete.

## Start Here

1. Pull the ticket details and mark the ticket in progress.
2. Confirm the worktree and branch before editing.
3. Read `AGENTS.md`, then inspect the existing provider paths for Codex, Claude, and Gemini.
4. Search for the provider union first. New providers must be added through the shared
   provider kind surfaces before local UI or server maps are extended.
5. Add a compile-time or test-time guard for every provider map you create. Prefer
   `Record<BaseProviderKind, ...>` and tests that compare keys to `BASE_PROVIDER_KINDS`.

## Provider Surfaces

Check these surfaces before calling the provider integrated:

- Contracts: `BASE_PROVIDER_KINDS`, `ProviderKind`, model-selection schemas, settings schemas,
  runtime modes, approvals, attachments, token usage, rate-limit, and provider event contracts.
- Model selection: provider picker entries, custom model settings, profile ids, default models,
  model option dispatch, model-switch behavior, and persisted selection fallback.
- Provider status: install detection, version detection, authentication state, account/profile
  labels, model discovery, capabilities, and clear unauthenticated or degraded states.
- Adapter registration: provider registry, adapter registry, provider layer wiring, binary
  launch arguments, session start, session stop, read-thread, and runtime event forwarding.
- Session context: project system prompt, session context resources, prompt rendering, context
  leak prevention, resume cursor preservation, startup recovery, fork, and provider limitations.
- Tools: T3 project tools, MCP delivery, configured provider MCP servers, tool status events,
  tool-call logs, cancellation, and provider-specific stderr warnings.
- Approvals and user input: runtime mode mapping, full-access behavior, per-call approval,
  approve-for-session behavior, declined calls, cancelled calls, and structured user questions.
- Attachments: accepted MIME types, validation, provider transport blocks, multimodal limits,
  and predictable unsupported errors for secondary flows that cannot carry files.
- Structured output: secondary generation provider choice, schema prompting or schema flags,
  JSON parsing, validation errors, retries if supported, and model override behavior.
- Usage and limits: token usage events, context window display, compaction behavior, quota or
  rate-limit polling, refresh cadence, account-specific uncertainty, and missing-field handling.
- Diff and checkpoints: turn ids, checkpoint creation, turn diff display, full-thread diff,
  revert behavior, provider conversation rollback, and fail-safe handling for unsupported rollback.
- Documentation: provider docs, feature docs, agent-tools docs, visibility/debugging docs, and
  any provider limitation that affects user expectations.
- Tests: focused unit tests for adapter behavior, contracts, model selection, settings, tool
  delivery, approvals, session recovery, structured output, and checkpoint behavior.

## TypeScript Guards

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

Use the shared provider union as the source of truth. A new provider should fail typecheck or a
focused test until the relevant model-selection, status, adapter, and UI surfaces are wired.

## Chrome DevTools MCP Verification

For UI and provider interactions, verify with Chrome DevTools MCP instead of a detached browser:

1. Reload the app and inspect console logs for new errors.
2. Open the provider/model picker and confirm the provider, icon, profile label, model list,
   custom models, context badge, and rate-limit meter render as expected.
3. Start a real provider turn and watch the work log for tool calls, approvals, token usage,
   runtime warnings, and completion state.
4. Test full-access and approval-required modes when the provider supports tool permissions.
5. Verify configured MCP servers are discovered in the MCP menu when the provider exposes them.
6. Exercise attachments, structured output, fork/resume, and diff/checkpoint flows when the
   ticket touches those behaviors.
7. Inspect lifecycle and provider logs for ambiguous failures, slow provider startup, lost
   resume cursors, or missing runtime events.

## Completion

Before closing the ticket:

1. Run the focused tests that cover the changed provider surface.
2. Run `bun fmt`, `bun lint`, and `bun typecheck`.
3. Record any provider limitations in docs and in the ticket comment.
4. Mark acceptance criteria met only after the automated checks and Chrome DevTools MCP
   verification relevant to the ticket have passed.
5. Commit all work for the ticket in one commit.
