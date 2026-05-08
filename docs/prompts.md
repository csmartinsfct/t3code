# Prompts

T3 Code exposes orchestration and admin prompt management through one backend-owned service that powers both the UI and an explicit REST management endpoint.

## Overview

The prompt-management surface covers the six orchestration prompt ids:

- `implement`
- `resume`
- `resumeFreshAgent`
- `review`
- `reReview`
- `reviewFeedback`

These prompt ids belong to the `orchestration` prompt group and are stored as prompt-template documents with:

- shipped defaults from `DEFAULT_SERVER_SETTINGS.promptDefaults.orchestration`
- resolved global documents from `settings.prompts.orchestration`
- sparse project overrides from `project.promptOverrides.orchestration`

`PROMPT_TEMPLATE_VERSION` tracks the document format, not the shipped prompt text. Text-only changes to default prompts must keep the existing version so persisted settings, project overrides, and orchestration-run overrides remain readable.

Effective prompt resolution order is:

1. project override
2. current global document
3. shipped default

Validation and preview rendering are always backend-owned. The server never trusts raw UI or REST API input without validating it first.

The same service also exposes global-only admin prompts:

- `general`
- `managedRuns`
- `scheduledTasks`
- `ticketing`
- `browser`
- `dynamicChatUi`

Admin prompts are injected into provider chat sessions through `buildT3ServiceInjectionPrompt`. They describe T3 service access for visible chat agents. `dynamicChatUi` is the parent-agent instruction that explains when and how to call `create_dynamic_chat_ui_from_prompt`; visual generation constraints stay in the Dynamic UI design guide instead.

Review-specific behavior:

- `review` is used for review iteration `1`
- `reReview` is used for review iteration `2+`
- `reviewFeedback` is still the implementer-facing prompt that carries structured review findings back to the working thread

Because orchestration prompts are resolved at dispatch time, existing runs pick up prompt changes on later resume/review turns too. That includes startup auto-resume: when enabled, the server reuses the same backend orchestration resume path as the UI Resume action.

## Native API

The shared `NativeApi` exposes prompt management under `api.prompts`:

- `listDefinitions(input)`
- `getDocument(input)`
- `validateDocument(input)`
- `previewDocument(input)`
- `updateDocument(input)`

These methods are backed by websocket RPCs implemented in `apps/server/src/ws.ts` and consumed by the web client through `apps/web/src/wsRpcClient.ts`.

## REST Endpoint

Prompt management is also available over REST at:

- `http://localhost:3773/api/prompts` in dev

Auth:

- Dev: `Authorization: Bearer t3-dev-bypass`
- Provider-managed sessions: the managed-runs issued bearer token

Available tools:

- `list_prompt_definitions`
- `get_prompt_document`
- `validate_prompt_document`
- `preview_prompt_document`
- `update_prompt_document`

All tool calls require an explicit scope object shape via arguments:

- Global scope: `{ "scope": "global" }`
- Project scope: `{ "scope": "project", "projectId": "<uuid>" }`

`update_prompt_document` uses `document: null` to:

- reset a global prompt back to the shipped default
- clear a project override so the project inherits the resolved global prompt again

Managed-run bearer tokens are restricted to their issued `projectId` and cannot access global scope. The dev bypass token can access both global and project scope.

## Block Conditions

Each prompt block has an optional `when` condition that controls whether the block is rendered. Two condition families exist:

- `exists` — renders the block when a prompt variable (e.g. `worktree`, `reviewSummary`) has a non-empty value. Supported on orchestration prompts only.
- `runtime` — renders the block when the current T3 server runtime matches a given mode. Supported on admin prompts only.

The `runtime` condition carries a `match` field with one of:

- `devElectron` — `bun run dev:desktop` (server launched by Electron, dev URL present)
- `devWeb` — `bun run dev` (standalone dev server, no Electron)
- `prodElectron` — packaged Electron app (production DMG)
- `prodWeb` — standalone production server (reserved for future deployed scenarios)
- `anyDev` — `devElectron || devWeb`
- `anyElectron` — `devElectron || prodElectron`

At injection time, admin prompt blocks are filtered against the current server runtime (derived from `ServerConfig.devUrl` and `ServerConfig.mode`). Preview rendering in Settings uses the same current runtime so what you see matches what the agent receives.

## Dynamic UI Design Guide

Settings -> Prompts includes a separate Dynamic UI section for the hidden Dynamic UI builder. It exposes:

- `Builder Prompt` — the provider-level instruction prompt for the hidden builder session. It contains the output contract, iframe constraints, and `{{...}}` placeholders for request-specific context. Edits are stored in `settings.dynamicChatUi.builderPromptOverride`; the actual UI request is also sent as the builder turn message.
- `Design Language` — the effective `docs/design-language.md` content. Edits are stored in `settings.dynamicChatUi.designGuideOverride`.

These are not prompt-template documents and are not injected into the parent chat agent. They are loaded only by `/api/dynamic-chat-ui` when the hidden builder session generates or revises a chat UI artifact. See [Dynamic Chat UI](dynamic-chat-ui.md).

## Validation And Preview

Validation uses the shared prompt-template validator from `packages/shared/src/promptTemplates.ts`.

Preview rendering is deterministic:

- rendering happens on the server
- previews use a fixed representative sample dataset labeled `representative-sample-v1`
- the response includes both the rendered preview text and the variables that were used

This keeps UI preview output and REST API preview output aligned.

## File Map

```
packages/contracts/src/promptManagement.ts            # Prompt-management schemas and errors
apps/server/src/prompts/Layers/PromptManagement.ts    # Backend prompt-management service
apps/server/src/prompts/http.ts                       # REST route at /api/prompts
apps/server/src/ws.ts                                 # WebSocket RPC handlers
apps/web/src/wsRpcClient.ts                           # Web client prompt RPC adapter
apps/web/src/wsNativeApi.ts                           # Native API prompt facade
apps/web/src/components/settings/DynamicChatUiPromptSection.tsx # Dynamic UI design guide editor
```
