# provider-multiple-profile-support

Guide for adding or auditing multiple-profile support for any T3 Code provider. Use this when a provider needs separate accounts, homes, config directories, auth stores, session routing, model picker entries, rate/session limits, or context reporting per profile.

The core rule: a profile is not just a display label. It must be a distinct provider identity from contracts through UI, provider process environment, runtime events, persistence, rate-limit caches, and verification.

---

## When to use

- Adding profile support to an existing provider.
- Adding a second profile for a provider that already has a default provider.
- Auditing a bug where selecting a profile works visually but sessions, limits, context, or auth still come from the default account.
- Reviewing a profile-related change for regressions in resume cursors, rate limits, context meters, or picker state.

Read `.claude/skills/debug.md` first for reported bugs. Always inspect logs before changing code.

---

## Mental model

Treat each provider profile as an exact provider kind:

- Default provider: `provider`
- Profile provider: `provider:profileId`

The exact provider kind must flow through:

- Model selection and draft persistence.
- Provider registry snapshots.
- Session start and resume.
- Provider adapter process launch.
- Runtime events.
- Rate-limit cache keys.
- Context/token usage events.
- UI display and filtering.
- Logs and tests.

Never rely on "same base provider" as identity once profiles exist. Same-base matching is only useful for grouping UI menus or choosing the adapter implementation. It is not sufficient for session routing, resume cursors, limits, or telemetry.

---

## Phase 1 - Contracts and shared helpers

Update provider/profile contracts first so type errors reveal missing surfaces.

Key files:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/model.ts`
- `packages/contracts/src/settings.ts`
- `packages/contracts/src/ticketing.ts`
- `packages/shared/src/model.ts`
- `packages/shared/src/review.ts`

Checklist:

- Add or reuse a `ProviderKind` shape that can represent `base:profileId`.
- Add helpers equivalent to:
  - `makeProviderKind(base, profileId)`
  - `baseProviderKind(provider)`
  - `providerProfileId(provider)`
- Add `profileId` to the provider's model-selection schema if profiles can be chosen from the composer.
- Make `modelSelectionProviderKind(selection)` return the exact profiled provider when `profileId` is present.
- Keep `ModelSelectionPatch`, ticket model selections, default model maps, slug aliases, and display names in sync.
- Preserve profile metadata through normalization. A model slug may imply the base provider, but it must not erase an explicit `profileId`.

Test targets:

- `modelSelectionProviderKind` returns `provider:profile`.
- Normalization does not collapse a profiled model selection back to the default provider.
- Ticket/orchestration model selections decode and encode profiled selections.

---

## Phase 2 - Settings and profile discovery

Profiles need a deterministic source of truth plus automatic discovery when that matches the provider's local layout.

Typical files:

- `packages/contracts/src/settings.ts`
- `apps/server/src/provider/<provider>ProfileDiscovery.ts`
- `apps/server/src/provider/Layers/ProviderRegistry.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`

Checklist:

- Add settings for configured profiles, usually `providers.<provider>Profiles`.
- Include per-profile:
  - `profileId`
  - `displayName`
  - `enabled`
  - provider binary override if useful
  - provider home/config directory override
  - custom models if model availability can vary by profile
- Add discovery for conventional profile homes, for example `~/.provider-*`.
- Exclude the default home from discovery. The default provider already owns it.
- Merge configured and discovered profiles. Configured profiles should win when ids collide.
- Register every merged profile in `ProviderRegistryLive` as a distinct provider entry.
- Show discovered profile cards in Settings without requiring users to duplicate config manually.

Do not make discovery depend on ambient environment variables like `CODEX_HOME` or a shell's current config directory. The app should resolve profile paths from settings and known conventions.

---

## Phase 3 - Provider status and auth

Provider status must be checked per profile, using the profile's own binary and home/config path.

Typical files:

- `apps/server/src/provider/Layers/<Provider>Provider.ts`
- `apps/server/src/provider/Services/<Provider>Provider.ts`
- `apps/server/src/provider/Layers/ProviderRegistry.test.ts`

Checklist:

- `checkProviderStatus` accepts or resolves the exact profile settings.
- Version checks use the configured binary path.
- Auth checks run with the profile-specific home/config directory in the child process environment.
- Account/capability probes are cached by both `binaryPath` and resolved home/config path.
- Provider snapshot uses the exact provider kind, not the base provider.
- `displayName` should include the profile label, for example `Provider (metric)`.
- If account metadata is available, surface it as a non-secret auth type/label.
- If duplicate account identifiers can be detected across profiles, warn. That usually means profile routing works but both homes are logged into the same account.

Auth storage pitfall:

- Multiple profiles require credential storage to be scoped by profile home/config directory.
- Some CLIs default to an OS keychain or shared store. In that case, switching accounts can overwrite the default account for every profile.
- Prefer explicit file-scoped or profile-scoped credential storage when the provider supports it.
- Verify the resolved account, not just that `login status` says "authenticated".
- Never print tokens, refresh tokens, cookies, or raw credential files. Hash stable account ids if you need to compare identities.

Status tests should cover:

- Default provider uses default home/config even if the parent process has an ambient profile env var.
- Profile provider uses its configured/discovered home/config.
- Two profiles with the same base provider are reported as distinct `ServerProvider` entries.
- Duplicate auth/account detection, if implemented, does not expose secrets.

---

## Phase 4 - Adapter routing and process launch

This is where many profile bugs hide. The adapter must use the exact provider kind to resolve the runtime home/config path before spawning or resuming a provider process.

Typical files:

- `apps/server/src/provider/Layers/<Provider>Adapter.ts`
- Provider process manager, for example `apps/server/src/codexAppServerManager.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

Checklist:

- `startSession` validates the requested provider, but should route by exact provider kind.
- Resolve `profileId` from `modelSelection.profileId` or `providerProfileId(provider)`.
- Resolve home/config path from settings or discovery. Do not inherit ambient env vars.
- Pass the resolved path into the manager/process launch explicitly.
- Spawn with provider-specific env, for example `{ PROVIDER_HOME: resolvedHome }`.
- Persist `ProviderSession.provider` as the exact provider kind.
- Emit runtime events with the exact provider kind.
- Store resume cursors under the exact provider binding.
- Never reuse a resume cursor across `provider` and `provider:profile`, even if the base provider and model are the same.
- If a user changes only the profile while staying on the same base provider, treat it as a provider change for session purposes. Restart or create a new provider session as appropriate.

Resume cursor safety:

- Follow the repo rule: never delete provider runtime bindings in production code.
- Stop paths should mark bindings stopped while preserving resume cursors.
- Profile changes must not overwrite the default profile's cursor.
- Fork/resume logic must preserve profile identity.

Tests should cover:

- Default session path under default home/config.
- Profile session path under profile home/config.
- Ambient env cannot hijack default sessions.
- Same-base different-profile model changes do not reuse cursors.
- Runtime events from profile sessions carry `provider:profile`.

---

## Phase 5 - Composer, picker, and draft state

The UI must display and persist profile identity, not just the base provider and model slug.

Typical files:

- `apps/web/src/components/chat/ProviderModelPicker.tsx`
- `apps/web/src/components/chat/ProviderModelPicker.browser.tsx`
- `apps/web/src/composerDraftStore.ts`
- `apps/web/src/session-logic.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/rpc/serverState.ts`

Checklist:

- Build picker groups from server provider snapshots, including profile providers.
- Display profile labels in selected models, for example `Model · profile`.
- When a profiled provider is selected, write `profileId` into the model selection.
- Persist `profileId` in composer drafts.
- Restore `profileId` when reopening a thread.
- Keep profile identity through command dispatch and websocket RPC payloads.
- Do not gray out or hide profile entries because the base provider already exists.
- When deriving display names, prefer the server provider `displayName` for profile entries.

Picker tests should cover:

- Default and profile entries both appear.
- Selecting a profile shows the profile label in the composer.
- Selection state survives draft reload.
- Claude-style profile behavior and the new provider profile behavior are consistent.

---

## Phase 6 - Rate limits and session limits

Rate limits are account/profile-level state. They must be keyed by exact provider kind and must not fall back from a profile to the default provider unless the product deliberately chooses that behavior and labels it clearly.

Typical files:

- Provider adapter event mapping, for example `apps/server/src/provider/Layers/<Provider>Adapter.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/server/src/provider/Services/ProviderRateLimitsCache.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/ws.ts`
- `apps/web/src/rpc/serverState.ts`
- Chat usage UI components

Event flow:

1. Provider process emits provider-native account/session-limit data.
2. Adapter maps it to `account.rate-limits.updated` or a provider-neutral runtime event.
3. Runtime ingestion normalizes the payload.
4. `ProviderRateLimitsCache` stores it under `event.provider`.
5. Websocket stream sends cache snapshots to the UI.
6. UI picks the limit snapshot for the active exact provider.

Checklist:

- Adapter emits limit events with exact provider kind.
- Normalizer handles the provider's payload shape without dropping profile identity.
- Cache key is exact provider kind.
- Startup probes include default and every profile where applicable.
- OAuth/API polling loops enumerate configured and discovered profiles.
- If polling deduplicates by token/account, it must fan out the fetched tiers to every exact provider in that credential group.
- UI uses exact provider lookup for limits. Avoid "base provider fallback" because it masks profile bugs.
- If no exact snapshot exists, show unavailable/unknown state rather than borrowing the default provider's limits.

Bug pattern:

- UI says profile is selected, logs show profile provider, but limits match default.
- Check whether `account.rate-limits.updated` carries `provider:profile`.
- Check whether the cache stores `provider:profile` separately.
- Check whether the UI filters exact provider or falls back to base provider.
- If all code paths are exact, compare account identifiers. The two profile homes may be logged into the same account.

Manual verification:

```bash
rg -n 'thread/started|account/rateLimits/updated' ~/.t3/dev/logs/provider/{THREAD_ID}.log
```

Look for:

- `provider:"provider"` versus `provider:"provider:profile"`.
- Provider session path under the expected home/config directory.
- Different limit payloads when the profiles are actually different accounts.

---

## Phase 7 - Context reporting and token usage

Context reporting is thread-level, but profile support can still break it when events are routed through the wrong provider/session.

Typical files:

- Provider adapter event mapping.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- Projection turn repository and session logic.
- `apps/web/src/components/chat/ContextWindowMeter.tsx`
- `apps/web/src/components/chat/TraitsPicker.tsx`

Event flow:

1. Provider emits token/context usage, often provider-specific.
2. Adapter maps it to `thread.token-usage.updated`.
3. Runtime ingestion stores a `ThreadTokenUsageSnapshot`.
4. Chat UI reads the current thread's projected usage and renders the context meter.

Checklist:

- Token/context events include the exact provider kind and thread id.
- Profile session restart does not leave stale usage from the old provider session attached to a new thread turn.
- Model context-window capabilities are resolved from the selected provider/profile model.
- If a profile has different available models or context options, use that profile provider snapshot.
- Context meter should be per thread. Rate/session limits should be per exact provider. Do not mix these concepts.

Tests should cover:

- Profile session emits `thread.token-usage.updated` and the projection updates the active thread.
- CamelCase and snake_case provider payloads normalize correctly if the provider has both.
- Context window display remains correct after profile selection and model switch.

---

## Phase 8 - Logs and debugging

For any profile bug, collect both UI state and provider logs. Screenshots alone are not enough.

First files to inspect:

- `~/.t3/dev/logs/provider/{THREAD_ID}.lifecycle.log`
- `~/.t3/dev/logs/provider/{THREAD_ID}.log`
- `~/.t3/userdata/logs/provider/{THREAD_ID}.lifecycle.log`
- `~/.t3/userdata/logs/provider/{THREAD_ID}.log`

Useful checks:

```bash
# Session decisions and exact provider used by T3
cat ~/.t3/dev/logs/provider/{THREAD_ID}.lifecycle.log

# Native session path, exact provider, limits, token usage
rg -n 'thread/started|account/rateLimits/updated|thread/tokenUsage/updated' \
  ~/.t3/dev/logs/provider/{THREAD_ID}.log
```

What to prove:

- The composer selection included the intended profile.
- The thread model selection persisted `profileId`.
- The provider service started the exact provider.
- The provider process used the intended home/config path.
- The provider-native session file, if any, is under the expected profile directory.
- Runtime events include exact provider kind.
- Rate-limit cache/UI reads exact provider limits.
- Auth/account identity is actually different across profiles.

Credential comparison:

- Do not print credential files.
- Compare stable non-secret metadata when the provider exposes it.
- If only an account id exists in a credential file, hash it before logging.
- If both homes hash to the same account id, the product is working but the local auth setup is not.

---

## Phase 9 - Browser verification

Use Chrome DevTools MCP or the T3 browser service to test the real UI.

Minimum manual test:

1. Restart the dev stack so provider subprocesses do not hold stale auth/config.
2. Create a new default-provider thread.
3. Select the same model under the default provider.
4. Send a tiny prompt.
5. Open the usage popover and record limits/context.
6. Inspect raw logs for session path and exact provider.
7. Create a new profile-provider thread.
8. Select the same model under the profile provider.
9. Send a tiny prompt.
10. Open the usage popover and record limits/context.
11. Inspect raw logs for session path and exact provider.

Passing result:

- Default session launches from default home/config.
- Profile session launches from profile home/config.
- UI selected labels are distinct.
- Logs show distinct exact providers.
- Rate/session limits are distinct when the accounts are distinct.
- Context usage belongs to the active thread and does not leak across threads.

If limits are still identical:

- First check whether the raw provider limit payloads are identical.
- If raw payloads differ but UI is identical, the bug is in cache/UI selection.
- If raw payloads are identical and session paths are correct, the homes are likely authenticated to the same account or using shared credential storage.

---

## Phase 10 - Required test matrix

Run focused tests while developing, then the repo-required checks before handoff.

Focused test areas:

- Contracts: provider kind and model selection profile id.
- Profile discovery and merge precedence.
- Provider registry includes profile providers.
- Provider status uses profile home/config.
- Adapter launches default and profile homes correctly.
- Same-base profile switch does not reuse resume cursors.
- Runtime events preserve exact provider.
- Rate-limit ingestion stores exact provider keys.
- UI picker displays and persists profile labels.
- Context meter still updates from `thread.token-usage.updated`.

Before completion:

```bash
bun fmt
bun lint
bun typecheck
```

Use `bun run test`, never `bun test`.

---

## Fast audit checklist

- Contracts support `provider:profile` and `ModelSelection.profileId`.
- Settings have configured profiles and discovery has conventional profile dirs.
- Provider registry exposes every profile as a `ServerProvider`.
- Provider status checks pass profile home/config to the CLI.
- Adapter resolves exact provider to exact home/config.
- Provider process launch ignores ambient profile env for default sessions.
- Provider sessions and resume cursors are keyed by exact provider.
- Runtime events carry exact provider.
- Rate-limit cache keys exact provider.
- OAuth/session-limit pollers include all profiles.
- UI picker writes and displays `profileId`.
- Composer drafts preserve `profileId`.
- UI rate limits use exact provider, not base-provider fallback.
- Context usage stays thread-level and updates after profile selection.
- Logs prove session path, exact provider, limits, and token usage.
- Auth storage is profile-scoped and accounts are actually distinct.
