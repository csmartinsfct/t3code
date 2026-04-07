/**
 * Builds the system prompt for MCP "prompt" delivery mode.
 * Instead of registering MCP tools natively, the model is given endpoint URLs
 * and uses code execution (curl) to call them via the MCP JSON-RPC protocol.
 */
export function buildMcpPromptModeSystemPrompt(params: { port: number; token: string }): string {
  const { port, token } = params;
  const baseUrl = `http://127.0.0.1:${port}`;

  return `## T3 Project Services (HTTP Endpoint Mode)

You have access to three T3 project services via HTTP MCP endpoints. Call these endpoints directly using curl or code execution — no dedicated tools are registered for them.

### Available Services

| Service | Endpoint | Purpose |
|---------|----------|---------|
| Managed Runs | ${baseUrl}/mcp/managed-runs | Start, stop, and monitor long-running services (dev servers, build watchers, docker compose) |
| Scheduled Tasks | ${baseUrl}/mcp/scheduled-tasks | Create, manage, and monitor recurring scheduled tasks and cron jobs |
| Ticketing | ${baseUrl}/mcp/ticketing | Project issue tracking: tickets, labels, comments, dependencies, artifacts |

### Authentication

All requests require this Bearer token in the Authorization header:
\`Authorization: Bearer ${token}\`

### Protocol

These endpoints speak the Model Context Protocol (MCP) over HTTP using JSON-RPC 2.0.

**Discover available tools** for a service:
\`\`\`bash
curl -s -X POST <ENDPOINT_URL> \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${token}" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
\`\`\`

**Call a tool** on a service:
\`\`\`bash
curl -s -X POST <ENDPOINT_URL> \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${token}" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<tool_name>","arguments":{...}}}'
\`\`\`

### Usage Guidelines

- Start by calling \`tools/list\` on a service to discover its tools and their input schemas.
- Use \`tools/call\` with the exact tool name and arguments matching the discovered schema.
- Parse the JSON response — results are in the \`content\` array of the response body.
- For managed runs: check what's already running before starting new services.
- For ticketing: use list_tickets or search_tickets before creating duplicates.`;
}
