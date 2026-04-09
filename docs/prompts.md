# Prompts

T3 Code exposes orchestration prompt management through one backend-owned service that powers both the UI and an explicit MCP management endpoint.

## Overview

The prompt-management surface covers the four orchestration prompt ids:

- `implement`
- `resume`
- `review`
- `reviewFeedback`

Every prompt id belongs to the `orchestration` prompt group and is stored as a prompt-template document with:

- shipped defaults from `DEFAULT_SERVER_SETTINGS.promptDefaults.orchestration`
- resolved global documents from `settings.prompts.orchestration`
- sparse project overrides from `project.promptOverrides.orchestration`

Effective prompt resolution order is:

1. project override
2. current global document
3. shipped default

Validation and preview rendering are always backend-owned. The server never trusts raw UI or MCP input without validating it first.

## Native API

The shared `NativeApi` exposes prompt management under `api.prompts`:

- `listDefinitions(input)`
- `getDocument(input)`
- `validateDocument(input)`
- `previewDocument(input)`
- `updateDocument(input)`

These methods are backed by websocket RPCs implemented in `apps/server/src/ws.ts` and consumed by the web client through `apps/web/src/wsRpcClient.ts`.

## MCP Endpoint

Prompt management is also available over MCP at:

- `http://localhost:3773/mcp/prompts` in dev

Auth:

- Dev: `Authorization: Bearer t3-dev-bypass`
- Provider-managed MCP sessions: the managed-runs issued bearer token

Exact MCP tools:

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

## Validation And Preview

Validation uses the shared prompt-template validator from `packages/shared/src/promptTemplates.ts`.

Preview rendering is deterministic:

- rendering happens on the server
- previews use a fixed representative sample dataset labeled `representative-sample-v1`
- the response includes both the rendered preview text and the variables that were used

This keeps UI preview output and MCP preview output aligned.

## File Map

```
packages/contracts/src/promptManagement.ts            # Prompt-management schemas and errors
apps/server/src/prompts/Layers/PromptManagement.ts    # Backend prompt-management service
apps/server/src/prompts/http.ts                       # MCP route at /mcp/prompts
apps/server/src/ws.ts                                 # WebSocket RPC handlers
apps/web/src/wsRpcClient.ts                           # Web client prompt RPC adapter
apps/web/src/wsNativeApi.ts                           # Native API prompt facade
```
