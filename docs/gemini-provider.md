# Gemini Provider Integration

Gemini support is ACP-first. T3 starts Gemini CLI in ACP mode, creates or loads
an ACP session, and forwards canonical provider runtime events into the same
orchestration pipeline used by Codex and Claude.

## Runtime Access

T3 maps the provider-neutral runtime mode to Gemini CLI approval flags at process
launch:

- `full-access` starts Gemini with `--approval-mode yolo --no-sandbox` and
  `GEMINI_SANDBOX=false`, so tool calls are auto-approved and inherited sandbox
  settings do not unexpectedly constrain the session.
- `approval-required` starts Gemini with `--approval-mode default`, so Gemini
  prompts through ACP `session/request_permission` when tools need approval.

## Project Tools

Gemini sessions receive T3 project tools through ACP `mcpServers`. The server
declares a local stdio MCP bridge named `t3-code` for checkpointed project
threads. The bridge launches `t3 mcp-stdio` with a short-lived project token and
exposes the REST-backed T3 services:

- ticketing
- managed runs
- scheduled tasks
- prompts

Tool discovery or call failures are written to MCP stderr with a `[t3-mcp]`
prefix. The Gemini adapter reports configured MCP servers with
`mcp.status.updated` and forwards MCP-related stderr as `runtime.warning`.

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
