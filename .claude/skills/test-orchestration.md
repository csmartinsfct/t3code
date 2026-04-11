# test-orchestration

End-to-end test of the T3 Code orchestration system using real AI models, the dev server, and browser automation via chrome-devtools MCP.

## Prerequisites

- Dev server running (`bun run dev` from repo root). Note the server port and web port from the output.
- Chrome DevTools MCP connected to the browser.
- The live test project exists in T3 Code for workspace `/Users/cristianomartins/Desktop/code/experiments/t3_code_real_test`.
- The project currently shows up in the UI as `t3_code_real_test`. Do not assume the older `Test` project row is valid; it may be stale or soft-deleted in `~/.t3/dev/state.sqlite`.

## Test Repository

The test repo is a clone of the Codex open-source repo at:

```
/Users/cristianomartins/Desktop/code/experiments/t3_code_real_test
```

**Always reset to main before testing** so orchestration starts from a clean state:

```bash
cd /Users/cristianomartins/Desktop/code/experiments/t3_code_real_test
git checkout main
git reset --hard HEAD
git clean -fd
```

## Setup: Resolve The Live Project And Thread

With the dev bypass token, ticketing MCP requests must include both `projectId` and a valid `threadId`. The old default `threadId=dev-test-thread` no longer works reliably.

Find the live project by workspace root, not by project title:

```bash
sqlite3 ~/.t3/dev/state.sqlite "
  SELECT project_id, title, workspace_root
  FROM projection_projects
  WHERE workspace_root = '/Users/cristianomartins/Desktop/code/experiments/t3_code_real_test'
    AND deleted_at IS NULL
"
```

Then create or select a thread for that project in the UI and capture its thread id from the browser URL (`http://localhost:<web-port>/<thread-id>`), or query it from SQLite:

```bash
sqlite3 ~/.t3/dev/state.sqlite "
  SELECT thread_id, title, updated_at
  FROM projection_threads
  WHERE project_id = '$PROJECT_ID'
    AND deleted_at IS NULL
  ORDER BY updated_at DESC
  LIMIT 10
"
```

## Setup: Create Test Tickets

Use a ticket set that matches the current contents of the test repo. At the moment the repo is a small Vite starter app, so the most reliable happy-path scenario is a sequential rename of the hero heading in `src/App.tsx`.

Create a parent ticket plus two ordered sub-tickets (replace `$PORT`, `$PROJECT_ID`, and `$THREAD_ID`):

```bash
URL="http://127.0.0.1:$PORT/mcp/ticketing?projectId=$PROJECT_ID&threadId=$THREAD_ID"
H=(-H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "Authorization: Bearer t3-dev-bypass")

# 1. Create parent ticket
PARENT=$(curl -s -X POST "$URL" "${H[@]}" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_ticket","arguments":{"title":"Update starter heading in two steps","description":"Change the starter hero heading sequentially in two short steps.","status":"todo"}}}')
PARENT_ID=$(echo "$PARENT" | python3 -c "import sys,json; print(json.loads(json.load(sys.stdin)['result']['content'][0]['text'])['identifier'])")
echo "Parent: $PARENT_ID"

# 2. Sub-ticket 1: Get started -> Start here
CHILD1=$(curl -s -X POST "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"create_ticket\",\"arguments\":{\"title\":\"Rename hero heading from 'Get started' to 'Start here'\",\"description\":\"Update the hero heading in src/App.tsx from 'Get started' to 'Start here'. Run pnpm lint and pnpm build after the change.\",\"status\":\"todo\",\"parentId\":\"$PARENT_ID\",\"acceptanceCriteria\":[{\"text\":\"The hero heading reads 'Start here'\"},{\"text\":\"pnpm lint passes\"},{\"text\":\"pnpm build passes\"}]}}}")
CHILD1_ID=$(echo "$CHILD1" | python3 -c "import sys,json; print(json.loads(json.load(sys.stdin)['result']['content'][0]['text'])['identifier'])")

# 3. Sub-ticket 2: Start here -> Get going
CHILD2=$(curl -s -X POST "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"create_ticket\",\"arguments\":{\"title\":\"Rename hero heading from 'Start here' to 'Get going'\",\"description\":\"Change the same hero heading in src/App.tsx from 'Start here' to 'Get going'. Run pnpm lint and pnpm build after the change.\",\"status\":\"todo\",\"parentId\":\"$PARENT_ID\",\"acceptanceCriteria\":[{\"text\":\"The hero heading reads 'Get going'\"},{\"text\":\"pnpm lint passes\"},{\"text\":\"pnpm build passes\"}]}}}")
CHILD2_ID=$(echo "$CHILD2" | python3 -c "import sys,json; print(json.loads(json.load(sys.stdin)['result']['content'][0]['text'])['identifier'])")

# 4. Add an explicit dependency so ticket 2 cannot run before ticket 1
curl -s -X POST "$URL" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"add_ticket_dependency\",\"arguments\":{\"ticketId\":\"$CHILD2_ID\",\"dependsOnTicketId\":\"$CHILD1_ID\"}}}"
```

## Test Execution

All testing is done via the **chrome-devtools MCP** (snapshots, clicks, screenshots). The general flow:

### 1. Navigate to the Board

- Open the app in the browser at the web dev port (e.g., `http://localhost:5733`)
- Click the `t3_code_real_test` project in the sidebar
- Click the "Board" tab to see the Kanban board
- Verify the new parent ticket appears in the "To Do" column

### 2. Start Orchestration

- Open the parent ticket from the board
- Use the parent ticket's action menu and click "Orchestrate"
- In the confirm dialog, verify:
  - Both tickets are listed in execution order
  - Implementer and Reviewer model selections are shown (from Settings > Orchestration)
- Click "Start Orchestration"
- Verify the app navigates to the orchestration thread

### 3. Monitor Orchestration Progress

- Watch the orchestration timeline in the main panel
- Take periodic screenshots to verify:
  - The first child ticket changes to "In Progress" on the parent ticket detail or board
  - Implementation turns appear in the timeline
  - Review turns appear after implementation
  - The run advances to the second child only after the first child clears review
  - Ticket status moves to "Done" after approval
- Verify both tickets complete sequentially

### 4. Verify Results

- Check the board: both sub-tickets should be "Done"
- Check the test repo has the expected changes:

```bash
cd /Users/cristianomartins/Desktop/code/experiments/t3_code_real_test
git status --short --branch
git log --oneline -n 5
rg -n "Get going|Start here|Get started" src/App.tsx
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
- Open the active implementation child thread via "Implementation -> Open thread"
- While a ticket is being worked on, type a message in that child-thread composer and send it
- Verify the orchestration pauses (sending a user message interrupts the active agent)
- The message should appear in the child-thread timeline and the orchestration thread should show the paused state

### Test Cancel

- Start orchestration
- Click the cancel button (or use the menu) during execution
- Verify orchestration stops permanently (status: "Canceled")
- Verify tickets are not left in a broken state

## Expected Findings

- The current happy-path scenario should complete successfully with two sequential commits.
- The current control-path scenario exposes a real bug: cancel can leave the active ticket and parent ticket stuck in `in_progress` even after the run header shows `Canceled`.

## Troubleshooting

- **Orchestration doesn't start**: Check that models are configured in Settings > Orchestration and the selected providers are enabled
- **Ticket creation fails with `Unknown origin thread`**: Add a real `threadId` query param to the ticketing MCP URL. The dev bypass path no longer works reliably with the old implicit `dev-test-thread` default.
- **The old `Test` project id shows up in SQLite**: Ignore soft-deleted or stale project rows and resolve the live project by `workspace_root`.
- **The test task doesn't match the repo anymore**: Inspect `src/App.tsx`, `package.json`, and the current workspace before creating tickets. Always make the orchestration task match the actual test repo contents.
- **Agent errors**: Check the server terminal output for provider session errors
- **Stale runs**: Clean up with `sqlite3 ~/.t3/dev/state.sqlite "UPDATE orchestration_runs SET status = 'canceled' WHERE status IN ('pending', 'running', 'paused')"`
- **Test repo dirty**: Reset with `cd /Users/cristianomartins/Desktop/code/experiments/t3_code_real_test && git checkout main && git reset --hard HEAD && git clean -fd`

## Key Files

- `apps/server/src/orchestrationRuns/Layers/OrchestrationRunRunner.ts` -- Execution loop
- `apps/server/src/orchestrationRuns/Layers/OrchestrationRuns.ts` -- Run creation, thread setup
- `apps/web/src/components/management/KanbanBoard.tsx` -- Board UI, orchestration trigger
- `apps/web/src/components/management/OrchestrateConfirmDialog.tsx` -- Confirm dialog
- `packages/shared/src/review.ts` -- Review prompt building
