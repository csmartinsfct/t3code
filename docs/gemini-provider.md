# Gemini Provider Integration

Gemini support is ACP-first. T3 starts Gemini CLI in ACP mode, creates or loads
an ACP session, and forwards canonical provider runtime events into the same
orchestration pipeline used by Codex and Claude.

## Provider Parity Checklist

Future provider additions and parity audits should start from the
[provider-integration skill](../.claude/skills/provider-integration.md). That
checklist captures the model selection, session lifecycle, tool delivery,
approval, attachment, structured-output, usage, checkpoint, documentation, and
Chrome DevTools MCP verification surfaces validated while bringing Gemini to
parity.

## Runtime Access

T3 maps the provider-neutral runtime mode to Gemini CLI approval flags at process
launch:

- `full-access` starts Gemini with `--approval-mode yolo --no-sandbox` and
  `GEMINI_SANDBOX=false`, so tool calls are auto-approved and inherited sandbox
  settings do not unexpectedly constrain the session.
- `approval-required` starts Gemini with `--approval-mode default`, so Gemini
  prompts through ACP `session/request_permission` when tools need approval.

## Project Tools

T3 exposes its project services (managed runs, scheduled tasks, ticketing,
prompts) to every provider the same way: the session-start injection includes a
REST endpoint table and a short-lived Bearer token via
`buildT3ServiceInjectionPrompt`. Gemini receives this as an ACP embedded-context
resource on the first user turn; Codex receives it through
`appendDeveloperInstructions`; Claude receives it through `systemPrompt.append`;
Cursor receives it through its first ACP prompt. All supported providers call
the endpoints with their native shell/bash tool.

User-configured MCP servers discovered in `<GEMINI_CLI_HOME>/settings.json` and
`<cwd>/.gemini/settings.json` are still surfaced in the composer MCP menu and
loaded by the Gemini CLI itself. T3 does not write into those files. A future
native-MCP delivery mode for any provider would route through the same helper.

MCP-related stderr from Gemini is still forwarded as `runtime.warning` so
connection issues with user-registered MCP servers remain visible.

## Approvals And User Input

Gemini ACP `session/request_permission` requests are normalized into
`request.opened` events. T3 maps user decisions back to ACP permission outcomes:

- `accept` -> `allow_once`
- `acceptForSession` -> `allow_always`, falling back to `allow_once`
- `decline` -> `reject_once`, falling back to `reject_always`
- `cancel` -> ACP `cancelled`

Unknown Gemini client requests receive a JSON-RPC `-32601` error immediately, so
sessions do not wait forever for unsupported UI flows. Structured user-input
requests are supported when Gemini sends question data compatible with T3's
canonical `user-input.requested` shape.

## Usage And Limits

Gemini ACP exposes reliable per-thread context usage through:

- `usage_update` session updates: `used` and `size`
- prompt responses: `usage.inputTokens`, `usage.outputTokens`,
  `usage.thoughtTokens`, `usage.cachedReadTokens`, and `usage.totalTokens`

T3 emits those as `thread.token-usage.updated`. Missing Gemini fields are left
unset.

For Google-login Code Assist accounts, T3 also reads Gemini CLI's cached OAuth
credentials and polls the same Code Assist quota endpoint used by Gemini CLI.
The response contains per-model quota buckets with `remainingFraction` and
optional `resetTime`; T3 normalizes those into the shared rate-limit meter as
used percentages. Absolute request counts are only shown when a provider exposes
them through the shared contract; Gemini quota buckets are currently displayed as
percent used per model.

## Resume, Fork, And Rollback

Gemini resume cursors store the ACP `sessionId` and are preserved on stop/close
paths by the provider session directory. Restart recovery loads the same ACP
session with `session/load`.

Forks use Gemini ACP `session/fork` when the source and target provider are both
Gemini with the same profile. T3 passes a resume cursor with `fork: true`; the
Gemini adapter returns a new cursor containing the forked ACP `sessionId`.

Gemini ACP does not expose rollback. T3 therefore reports rollback as an
explicit product limitation instead of trimming local state while provider state
continues from a different point.

Gemini CLI does expose an interactive `/rewind` command in the terminal UI, but
that command is not available through ACP. The installed CLI implements rewind
by opening an interactive picker, rewriting Gemini's recorded conversation file,
and calling an internal `setHistory(...)` method. ACP 0.38.2 exposes session
new/load/fork, prompt, cancel, mode, and model control, but no stable
non-interactive rewind or rollback request. Because T3 checkpoint revert must
restore filesystem state and provider conversation state together, the Gemini
adapter declares conversation rollback as unsupported and the checkpoint reactor
fails Gemini revert requests before restoring files.

## Turn Diffs

Gemini emits canonical `turn.started` and `turn.completed` runtime events with a
T3 turn id for each prompt. T3's Diff panel is driven by provider-neutral git
checkpoints captured from those turn lifecycle events, so Gemini does not need a
provider-native diff stream for per-turn file diffs. ACP `turn.diff.updated`
events are still supported as placeholder checkpoints when a provider emits
them, but Gemini parity relies on the same checkpoint reactor path used by the
other providers.

## Attachments

Gemini chat turns accept image attachments through ACP image content blocks. T3
currently allows PNG, JPEG, WebP, and GIF. Unsupported image MIME types fail
before prompt submission with a user-facing validation message.

Gemini CLI headless structured-output mode does not expose image inputs, so
secondary generation with attachments reports a predictable unsupported error.

## Structured Output

Gemini CLI does not currently expose a JSON-schema flag comparable to Codex
`--output-schema` or Claude `--json-schema`. For background generation, T3
prompts Gemini to return a single JSON value, parses the CLI JSON envelope, and
validates the model payload with the same Effect schema used by other providers.

## Authentication Detection

Gemini status detection distinguishes the states available from CLI files and
environment variables:

- installed: from `gemini --version`
- API key auth: `GEMINI_API_KEY`, or `GOOGLE_API_KEY` for compatible modes
- Google login: `settings.json` selected type `LOGIN_WITH_GOOGLE` plus
  `oauth_creds.json`
- Vertex AI: selected type `USE_VERTEX_AI` plus either
  `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`, or `GOOGLE_API_KEY`
- unknown auth: cached credentials or Google Cloud hints without enough
  selected-mode evidence
- unauthenticated: selected auth mode is missing required credentials, or no
  known auth signal is present

Provider status detection only checks credential file presence and optional
cached account labels. The Gemini quota poller reads cached OAuth token material
only to call Google's Code Assist quota endpoint; token values are never logged
or displayed.
