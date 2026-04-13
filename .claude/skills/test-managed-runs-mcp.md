# test-managed-runs-mcp

Test the T3 Managed Runs REST endpoint end-to-end using the dev bypass token.

## Prerequisites

- Electron dev server running (use `start-electron-dev` skill)
- Find the server port from the Electron dev output: `grep "Listening on" <output-file>`

## Dev Bypass Token

The REST endpoint accepts a dev-only bypass token `t3-dev-bypass` (disabled in production via `NODE_ENV`). Pass project/thread context via query params:

```
Authorization: Bearer t3-dev-bypass
URL: http://127.0.0.1:<PORT>/api/managed-runs?projectId=<PROJECT_ID>&threadId=<THREAD_ID>
```

POST requests require headers:

```
Content-Type: application/json
Authorization: Bearer <token>
```

## Find Project IDs

```bash
sqlite3 ~/.t3/dev/state.sqlite "SELECT project_id, workspace_root FROM projection_projects"
```

## Available Tools

| Tool                     | Description                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `list_managed_runs`      | List active runs (pass `includeHistorical: true` for all)                                                         |
| `launch_project_script`  | Launch a project action as a managed run. Optional `cwd` to override working directory.                           |
| `get_managed_run`        | Get full run details with evidence                                                                                |
| `get_managed_run_logs`   | Get timestamped logs. Optional `stream` filter (`pty`/`stdout`/`stderr`) and `tailLines`.                         |
| `stop_managed_run`       | Stop a live run                                                                                                   |
| `propose_project_script` | Propose a new action with optional `services` (health checks). Returns a `t3:propose-action` code block template. |

## Test Commands

Replace `PORT`, `PROJECT_ID`, and `THREAD_ID` with actual values.

### List tools

```bash
curl -s "http://127.0.0.1:$PORT/api/managed-runs?projectId=$PROJECT_ID" \
  -H "Authorization: Bearer t3-dev-bypass" | python3 -m json.tool
```

### List active managed runs

```bash
curl -s -X POST "http://127.0.0.1:$PORT/api/managed-runs?projectId=$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"tool":"list_managed_runs","input":{}}'
```

### Launch a project script

```bash
curl -s -X POST "http://127.0.0.1:$PORT/api/managed-runs?projectId=$PROJECT_ID&threadId=$THREAD_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"tool":"launch_project_script","input":{"scriptId":"<SCRIPT_ID>"}}'
```

With optional `cwd` override:

```bash
curl -s -X POST "http://127.0.0.1:$PORT/api/managed-runs?projectId=$PROJECT_ID&threadId=$THREAD_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"tool":"launch_project_script","input":{"scriptId":"<SCRIPT_ID>","cwd":"/path/to/dir"}}'
```

### Get run details

```bash
curl -s -X POST "http://127.0.0.1:$PORT/api/managed-runs?projectId=$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"tool":"get_managed_run","input":{"runId":"<RUN_ID>"}}'
```

### Get run logs

```bash
curl -s -X POST "http://127.0.0.1:$PORT/api/managed-runs?projectId=$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"tool":"get_managed_run_logs","input":{"runId":"<RUN_ID>","tailLines":10}}'
```

With optional `stream` filter (`pty`, `stdout`, or `stderr`):

```bash
curl -s -X POST "http://127.0.0.1:$PORT/api/managed-runs?projectId=$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"tool":"get_managed_run_logs","input":{"runId":"<RUN_ID>","stream":"stderr","tailLines":20}}'
```

### Stop a run

```bash
curl -s -X POST "http://127.0.0.1:$PORT/api/managed-runs?projectId=$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"tool":"stop_managed_run","input":{"runId":"<RUN_ID>"}}'
```

### Propose a new action (simple)

```bash
curl -s -X POST "http://127.0.0.1:$PORT/api/managed-runs?projectId=$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"tool":"propose_project_script","input":{"name":"Dev Server","command":"npm run dev","icon":"play"}}'
```

### Propose a new action (with services)

```bash
curl -s -X POST "http://127.0.0.1:$PORT/api/managed-runs?projectId=$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer t3-dev-bypass" \
  -d '{"tool":"propose_project_script","input":{"name":"Supabase","command":"npx supabase start","icon":"play","services":[{"name":"Supabase API","healthCheck":{"type":"url","url":"http://127.0.0.1:54321"}},{"name":"Supabase DB","healthCheck":{"type":"docker","container":"supabase_db"}}]}}'
```

Health check types for services:

- `url`: `{"type":"url","url":"http://localhost:PORT"}`
- `docker`: `{"type":"docker","container":"container_name"}`
- `port`: `{"type":"port","port":3000}` (optional `host`)
- `command`: `{"type":"command","command":"pg_isready"}` (optional `cwd`)

## Full E2E Test Script

Run a complete lifecycle test (list → launch → verify → logs → dedup → stop → verify):

```bash
PORT=<PORT>
PROJECT_ID=<PROJECT_ID>
THREAD_ID=<THREAD_ID>
SCRIPT_ID=<SCRIPT_ID>
URL="http://127.0.0.1:$PORT/api/managed-runs?projectId=$PROJECT_ID&threadId=$THREAD_ID"
H=(-H "Content-Type: application/json" -H "Authorization: Bearer t3-dev-bypass")

# 1. List (should be empty or show existing)
curl -s -X POST "$URL" "${H[@]}" -d "{\"tool\":\"list_managed_runs\",\"input\":{}}"

# 2. Launch
LAUNCH=$(curl -s -X POST "$URL" "${H[@]}" -d "{\"tool\":\"launch_project_script\",\"input\":{\"scriptId\":\"$SCRIPT_ID\"}}")
RUN_ID=$(echo "$LAUNCH" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['runId'])")
echo "RUN_ID=$RUN_ID"

# 3. Wait for startup
sleep 5

# 4. Get details (check URL detection)
curl -s -X POST "$URL" "${H[@]}" -d "{\"tool\":\"get_managed_run\",\"input\":{\"runId\":\"$RUN_ID\"}}"

# 5. Get logs
curl -s -X POST "$URL" "${H[@]}" -d "{\"tool\":\"get_managed_run_logs\",\"input\":{\"runId\":\"$RUN_ID\",\"tailLines\":5}}"

# 6. Dedup (should error)
curl -s -X POST "$URL" "${H[@]}" -d "{\"tool\":\"launch_project_script\",\"input\":{\"scriptId\":\"$SCRIPT_ID\"}}"

# 7. Stop
curl -s -X POST "$URL" "${H[@]}" -d "{\"tool\":\"stop_managed_run\",\"input\":{\"runId\":\"$RUN_ID\"}}"

# 8. Verify stopped
sleep 1
curl -s -X POST "$URL" "${H[@]}" -d "{\"tool\":\"list_managed_runs\",\"input\":{}}"
```

## Troubleshooting

- **401 Unauthorized**: Check bearer token is `t3-dev-bypass` and `projectId` query param is set
- **SQL errors**: Check Electron dev console for `[managed-runs-mcp] tool error:` lines
- **Stale "running" rows from previous sessions**: Clean up with `sqlite3 ~/.t3/dev/state.sqlite "UPDATE managed_runs SET status = 'lost' WHERE status IN ('starting', 'running')"`
- **"Not under live T3 control"**: The run exists in DB but this server instance doesn't have a live terminal for it — it's from a previous session

## Key Files

- `apps/server/src/managedRuns/http.ts` — REST endpoint (tool dispatch)
- `apps/server/src/managedRuns/Services/ManagedRuns.ts` — Service interface
- `apps/server/src/managedRuns/Layers/ManagedRuns.ts` — Service implementation
- `apps/server/src/persistence/Layers/ManagedRuns.ts` — SQL repository
- `apps/server/src/managedRuns/systemPrompt.ts` — System prompt injected into providers
