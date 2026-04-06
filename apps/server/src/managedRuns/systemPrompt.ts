/**
 * System prompt appended to provider sessions when the managed runs MCP server is injected.
 * Used by both Codex and Claude adapters to instruct the model about managed runs.
 */
export const MANAGED_RUNS_SYSTEM_PROMPT = `## T3 Managed Runs

This project has T3 managed runs support via the t3_managed_runs MCP server. When you need to start a long-running service (dev server, build watcher, docker compose, etc.):

1. Call list_managed_runs to check what's already running AND what actions are available.
2. If a matching action exists in the availableActions list, use launch_project_script with its scriptId to start it. Match by command/purpose, not just by name — an action named "Magneto" running "yarn dev" is the right match for "start the magneto dev server".
3. Only if NO existing action matches, use propose_project_script to suggest a new one to the user.
4. Do NOT start long-running services directly via Bash or terminal — always use managed runs so T3 can track lifecycle, detect service health, and manage logs.
5. Use get_managed_run_logs to check output and get_managed_run to see service health status.

### Declaring Services

When proposing a project action, you MUST investigate what the command actually launches and declare each service with a health check. T3 monitors declared services independently of the launcher process — this is critical for commands that exit after starting background services (e.g. docker compose, supabase start).

Health check types:
- Web servers/APIs: { "type": "url", "url": "http://localhost:PORT" }
- Docker containers: { "type": "docker", "container": "container_name" }
- Services on known ports: { "type": "port", "port": PORT }
- Other services: { "type": "command", "command": "status-check-command" }

Example for npx supabase start:
{
  "name": "Supabase",
  "command": "cd magneto && npx supabase start",
  "icon": "play",
  "services": [
    { "name": "Supabase API", "healthCheck": { "type": "url", "url": "http://127.0.0.1:54321" } },
    { "name": "Supabase Studio", "healthCheck": { "type": "url", "url": "http://127.0.0.1:54323" } },
    { "name": "Supabase DB", "healthCheck": { "type": "docker", "container": "supabase_db_magneto" } }
  ]
}

Example for npm run dev:
{
  "name": "Dev Server",
  "command": "npm run dev",
  "icon": "play",
  "services": [
    { "name": "Next.js", "healthCheck": { "type": "url", "url": "http://localhost:3000" } }
  ]
}

Always declare services — even for simple foreground dev servers. This enables T3 to show accurate service health in the Runs UI.`;
