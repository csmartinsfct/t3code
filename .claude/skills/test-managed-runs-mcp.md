# test-managed-runs-mcp

Test the T3 Managed Runs MCP endpoint end-to-end using the dev bypass token.

## Prerequisites

- Electron dev server running (use `start-electron-dev` skill)
- Find the server port from the Electron dev output: `grep "Listening on" <output-file>`

## Dev Bypass Token

The MCP endpoint accepts a dev-only bypass token `t3-dev-bypass` (disabled in production via `NODE_ENV`). Pass project/thread context via query params:

```
Authorization: Bearer t3-dev-bypass
URL: http://127.0.0.1:<PORT>/mcp/managed-runs?projectId=<PROJECT_ID>&threadId=<THREAD_ID>
```

All requests require headers:

```
Content-Type: application/json
Accept: application/json, text/event-stream
```

## Find Project IDs

```bash
sqlite3 ~/.t3/dev/state.sqlite "SELECT project_id, workspace_root FROM projection_projects"
```

## Available Tools

| Tool                     | Description                                               |
| ------------------------ | --------------------------------------------------------- |
| `list_managed_runs`      | List active runs (pass `includeHistorical: true` for all) |
| `launch_project_script`  | Launch a project action as a managed run                  |
| `get_managed_run`        | Get full run details with evidence                        |
| `get_managed_run_logs`   | Get timestamped PTY logs                                  |
| `stop_managed_run`       | Stop a live run                                           |
| `propose_project_script` | Get a propose-action code block template                  |

## Test Commands

Replace `PORT`, `PROJECT_ID`, and `THREAD_ID` with actual values.

### List tools

```bash
curl -s -X POST "http://127.0.0.1:$PORT/mcp/managed-runs?projectId=$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | python3 -m json.tool
```

### List active managed runs

```bash
curl -s -X POST "http://127.0.0.1:$PORT/mcp/managed-runs?projectId=$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_managed_runs","arguments":{}},"id":2}'
```

### Launch a project script

```bash
curl -s -X POST "http://127.0.0.1:$PORT/mcp/managed-runs?projectId=$PROJECT_ID&threadId=$THREAD_ID" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"launch_project_script","arguments":{"scriptId":"<SCRIPT_ID>"}},"id":3}'
```

### Get run details

```bash
curl -s -X POST "http://127.0.0.1:$PORT/mcp/managed-runs?projectId=$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_managed_run","arguments":{"runId":"<RUN_ID>"}},"id":4}'
```

### Get run logs

```bash
curl -s -X POST "http://127.0.0.1:$PORT/mcp/managed-runs?projectId=$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_managed_run_logs","arguments":{"runId":"<RUN_ID>","tailLines":10}},"id":5}'
```

### Stop a run

```bash
curl -s -X POST "http://127.0.0.1:$PORT/mcp/managed-runs?projectId=$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"stop_managed_run","arguments":{"runId":"<RUN_ID>"}},"id":6}'
```

### Propose a new action

```bash
curl -s -X POST "http://127.0.0.1:$PORT/mcp/managed-runs?projectId=$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"propose_project_script","arguments":{"name":"Dev Server","command":"npm run dev","icon":"play"}},"id":7}'
```

## Full E2E Test Script

Run a complete lifecycle test (list → launch → verify → logs → dedup → stop → verify):

```bash
PORT=<PORT>
PROJECT_ID=<PROJECT_ID>
THREAD_ID=<THREAD_ID>
SCRIPT_ID=<SCRIPT_ID>
URL="http://127.0.0.1:$PORT/mcp/managed-runs?projectId=$PROJECT_ID&threadId=$THREAD_ID"
H=(-H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "Authorization: Bearer t3-dev-bypass")

# 1. List (should be empty or show existing)
curl -s -X POST "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"list_managed_runs\",\"arguments\":{}},\"id\":1}"

# 2. Launch
LAUNCH=$(curl -s -X POST "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"launch_project_script\",\"arguments\":{\"scriptId\":\"$SCRIPT_ID\"}},\"id\":2}")
RUN_ID=$(echo "$LAUNCH" | python3 -c "import sys,json; print(json.loads(json.load(sys.stdin)['result']['content'][0]['text'])['runId'])")
echo "RUN_ID=$RUN_ID"

# 3. Wait for startup
sleep 5

# 4. Get details (check URL detection)
curl -s -X POST "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"get_managed_run\",\"arguments\":{\"runId\":\"$RUN_ID\"}},\"id\":3}"

# 5. Get logs
curl -s -X POST "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"get_managed_run_logs\",\"arguments\":{\"runId\":\"$RUN_ID\",\"tailLines\":5}},\"id\":4}"

# 6. Dedup (should error)
curl -s -X POST "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"launch_project_script\",\"arguments\":{\"scriptId\":\"$SCRIPT_ID\"}},\"id\":5}"

# 7. Stop
curl -s -X POST "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"stop_managed_run\",\"arguments\":{\"runId\":\"$RUN_ID\"}},\"id\":6}"

# 8. Verify stopped
sleep 1
curl -s -X POST "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"list_managed_runs\",\"arguments\":{}},\"id\":7}"
```

## Troubleshooting

- **401 Unauthorized**: Check bearer token is `t3-dev-bypass` and `projectId` query param is set
- **SQL errors**: Check Electron dev console for `[managed-runs-mcp] tool error:` lines
- **Stale "running" rows from previous sessions**: Clean up with `sqlite3 ~/.t3/dev/state.sqlite "UPDATE managed_runs SET status = 'lost' WHERE status IN ('starting', 'running')"`
- **"Not under live T3 control"**: The run exists in DB but this server instance doesn't have a live terminal for it — it's from a previous session

## Key Files

- `apps/server/src/managedRuns/http.ts` — MCP endpoint (JSON-RPC dispatch)
- `apps/server/src/managedRuns/Services/ManagedRuns.ts` — Service interface
- `apps/server/src/managedRuns/Layers/ManagedRuns.ts` — Service implementation
- `apps/server/src/persistence/Layers/ManagedRuns.ts` — SQL repository
- `apps/server/src/managedRuns/systemPrompt.ts` — System prompt injected into providers
