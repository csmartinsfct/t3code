# test-orchestration

End-to-end test of the T3 Code orchestration system using real AI models, the dev server, and browser automation via chrome-devtools MCP.

## Prerequisites

- Dev server running (`bun run dev` from repo root). Note the server port and web port from the output.
- Chrome DevTools MCP connected to the browser.
- The "Test" project exists in T3 Code (project title: "Test", workspace: `/Users/cristianomartins/Desktop/code/experiments/test_orchestration/t3code`).

## Test Repository

The test repo is a clone of the Codex open-source repo at:

```
/Users/cristianomartins/Desktop/code/experiments/test_orchestration/t3code
```

**Always reset to main before testing** so orchestration starts from a clean state:

```bash
cd /Users/cristianomartins/Desktop/code/experiments/test_orchestration/t3code
git checkout main
git reset --hard origin/main
git clean -fd
```

## Setup: Create Test Tickets

Use the ticketing MCP to create a parent ticket with two sub-tickets. Find the Test project ID first:

```bash
sqlite3 ~/.t3/dev/state.sqlite "SELECT project_id FROM projection_projects WHERE title = 'Test'"
```

Then create the tickets (replace `$PORT` and `$PROJECT_ID`):

```bash
URL="http://127.0.0.1:$PORT/mcp/ticketing?projectId=$PROJECT_ID"
H=(-H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "Authorization: Bearer t3-dev-bypass")

# 1. Create parent ticket
PARENT=$(curl -s -X POST "$URL" "${H[@]}" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_ticket","arguments":{"title":"Rename sidebar Projects label","description":"Update the sidebar section label in two steps.","status":"todo"}}}')
PARENT_ID=$(echo "$PARENT" | python3 -c "import sys,json; print(json.loads(json.load(sys.stdin)['result']['content'][0]['text'])['identifier'])")
echo "Parent: $PARENT_ID"

# 2. Sub-ticket 1: rename to "All Projects"
curl -s -X POST "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"create_ticket\",\"arguments\":{\"title\":\"Rename sidebar label from 'Projects' to 'All Projects'\",\"description\":\"Find the sidebar section heading that reads 'Projects' and change it to 'All Projects'. Run bun fmt, bun lint, and bun typecheck after.\",\"status\":\"todo\",\"parentId\":\"$PARENT_ID\",\"acceptanceCriteria\":[{\"text\":\"Sidebar heading reads 'All Projects' instead of 'Projects'\"},{\"text\":\"bun fmt, bun lint, and bun typecheck all pass\"}]}}}"

# 3. Sub-ticket 2: rename to "Every Project" (depends on ticket 1 implicitly via order)
curl -s -X POST "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"create_ticket\",\"arguments\":{\"title\":\"Rename sidebar label from 'All Projects' to 'Every Project'\",\"description\":\"Change the sidebar section heading from 'All Projects' to 'Every Project'. Run bun fmt, bun lint, and bun typecheck after.\",\"status\":\"todo\",\"parentId\":\"$PARENT_ID\",\"acceptanceCriteria\":[{\"text\":\"Sidebar heading reads 'Every Project'\"},{\"text\":\"bun fmt, bun lint, and bun typecheck all pass\"}]}}}"
```

## Test Execution

All testing is done via the **chrome-devtools MCP** (snapshots, clicks, screenshots). The general flow:

### 1. Navigate to the Board

- Open the app in the browser at the web dev port (e.g., `http://localhost:5733`)
- Click the "Test" project in the sidebar
- Click the "Board" tab to see the Kanban board
- Verify the newly created tickets appear in the "To Do" column

### 2. Start Orchestration

- Select the two sub-tickets on the board (click one, then Alt+click the other)
- Click the "Orchestrate" button in the selection bar
- In the confirm dialog, verify:
  - Both tickets are listed in execution order
  - Implementer and Reviewer model selections are shown (from Settings > Orchestration)
- Click "Start Orchestration"
- Verify the app navigates to the orchestration thread

### 3. Monitor Orchestration Progress

- Watch the orchestration timeline in the main panel
- Take periodic screenshots to verify:
  - Ticket status changes to "In Progress" on the board
  - Implementation turns appear in the timeline
  - Review turns appear after implementation
  - Ticket status moves to "Done" after approval
- Verify both tickets complete sequentially

### 4. Verify Results

- Check the board: both sub-tickets should be "Done"
- Check the test repo has the expected changes:

```bash
cd /Users/cristianomartins/Desktop/code/experiments/test_orchestration/t3code
git diff main -- '**/Sidebar*' | head -30
```

## Additional Test Scenarios

Depending on what is being tested, also verify these operations. Each requires starting a fresh orchestration run (reset repo, create new tickets).

### Test Pause

- Start orchestration as above
- While the first ticket is being worked on (status: "In Progress"), click the pause button in the orchestration thread header
- Verify the orchestration pauses (timeline shows "Orchestration paused")
- Verify ticket status remains "In Progress" (not reset)

### Test Resume

- After pausing (above), click the resume button
- Verify orchestration continues from where it left off
- Verify the ticket completes normally

### Test Send Message to Active Agent

- Start orchestration
- While a ticket is being worked on, type a message in the composer and send it
- Verify the orchestration pauses (sending a user message interrupts the active agent)
- The message should appear in the orchestration timeline

### Test Cancel

- Start orchestration
- Click the cancel button (or use the menu) during execution
- Verify orchestration stops permanently (status: "Canceled")
- Verify tickets are not left in a broken state

## Troubleshooting

- **Orchestration doesn't start**: Check that models are configured in Settings > Orchestration and the selected providers are enabled
- **Agent errors**: Check the server terminal output for provider session errors
- **Stale runs**: Clean up with `sqlite3 ~/.t3/dev/state.sqlite "UPDATE orchestration_runs SET status = 'canceled' WHERE status IN ('pending', 'running', 'paused')"`
- **Test repo dirty**: Reset with `cd /Users/cristianomartins/Desktop/code/experiments/test_orchestration/t3code && git checkout main && git reset --hard origin/main && git clean -fd`

## Key Files

- `apps/server/src/orchestrationRuns/Layers/OrchestrationRunRunner.ts` -- Execution loop
- `apps/server/src/orchestrationRuns/Layers/OrchestrationRuns.ts` -- Run creation, thread setup
- `apps/web/src/components/management/KanbanBoard.tsx` -- Board UI, orchestration trigger
- `apps/web/src/components/management/OrchestrateConfirmDialog.tsx` -- Confirm dialog
- `packages/shared/src/review.ts` -- Review prompt building
