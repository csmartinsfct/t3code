# Cursor ACP Harness

`scripts/cursor-acp-harness.mjs` is a deterministic local ACP server for Cursor
provider testing. It is not a model. It speaks the same newline-delimited
JSON-RPC transport that `agent acp` exposes, so T3 exercises the normal Cursor
ACP connection, adapter, server event ingestion, and UI approval/input paths
without spending model time or depending on model behavior.

## Use In T3

Temporarily point the default Cursor provider at the harness:

```json
{
  "providers": {
    "cursor": {
      "enabled": true,
      "launchCommand": ["node", "/absolute/path/to/t3_code_cursor/scripts/cursor-acp-harness.mjs"]
    }
  }
}
```

T3 appends `acp` to configured Cursor launch commands, matching the real Cursor
wrapper path. The harness ignores that trailing argument.

Send one of these prompts in a Cursor thread:

- `T3_CURSOR_HARNESS_ASK_QUESTION` emits `cursor/ask_question`.
- `T3_CURSOR_HARNESS_FILE_APPROVAL` emits `session/request_permission` with
  `toolCall.kind: "edit"`, which T3 maps to `file_change_approval`.
- `T3_CURSOR_HARNESS_COMMAND_APPROVAL` emits `session/request_permission` with
  `toolCall.kind: "execute"`, useful when checking the command approval card.

The same scenarios can be forced for every prompt with
`T3_CURSOR_ACP_HARNESS_SCENARIO=ask-question`, `file-approval`, or
`command-approval`.

## Expected Results

For `T3_CURSOR_HARNESS_ASK_QUESTION`, the timeline should show a pending user
input card. Answering it sends an ACP response shaped like:

```json
{
  "outcome": {
    "outcome": "answered",
    "answers": [{ "questionId": "next_step", "selectedOptionIds": ["continue"] }]
  }
}
```

For `T3_CURSOR_HARNESS_FILE_APPROVAL`, the timeline should show a file-change
approval card. Accepting it sends:

```json
{ "outcome": { "outcome": "selected", "optionId": "allow-once" } }
```

Declining sends `reject-once`.

When recording a manual run, capture:

- Thread id from the URL or provider lifecycle log filename.
- Lifecycle log:
  `~/.t3/<env>/logs/provider/<threadId>.lifecycle.log`
- Raw provider event log:
  `~/.t3/<env>/logs/provider/<threadId>.log`
- Scenario prompt and decision clicked in the UI.

## Automated Coverage

`apps/server/src/provider/cursor/CursorAcpConnection.test.ts` launches the
harness as a real child process and verifies both deterministic request types
round-trip over stdio:

```bash
bun --filter t3 test src/provider/cursor/CursorAcpConnection.test.ts
```
