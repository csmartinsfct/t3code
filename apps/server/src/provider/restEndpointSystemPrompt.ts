import type { PromptDocumentV1 } from "@t3tools/contracts";

/** Render an admin prompt document by joining all block texts. */
export function renderAdminPromptDocument(document: PromptDocumentV1): string {
  return document.blocks.map((b) => b.text).join("");
}

/**
 * Builds a short environment header injected at the top of the service system prompt.
 * Tells the agent which T3 server instance it is connected to (port, dev vs prod,
 * data directory) so it can fall back to direct DB/API access when needed.
 *
 * In production builds, data directory and database path are only exposed to
 * the "T3 Code" project to prevent regular consumer threads from accessing
 * internal state directly.
 */
export function buildEnvironmentHeader(params: {
  port: number;
  isDev: boolean;
  projectTitle?: string;
}): string {
  const { port, isDev, projectTitle } = params;
  const env = isDev ? "development" : "production";
  const lines = [`## T3 Server Environment`, ``, `- **Build:** ${env}`];
  if (!isDev) {
    lines.push(`- **Port:** ${port}`);
    lines.push(`- **Base URL:** http://localhost:${port}`);
  }
  // Expose data directory / database only in dev or for the T3 Code project itself
  if (isDev || projectTitle === "T3 Code") {
    const dataDir = isDev ? "~/.t3/dev/" : "~/.t3/userdata/";
    lines.push(`- **Data directory:** ${dataDir}`);
    lines.push(`- **Database:** ${dataDir}state.sqlite`);
  }
  if (isDev) {
    lines.push(`- **Dev bypass token:** \`t3-dev-bypass\` (for direct REST API calls)`);
  }
  return lines.join("\n");
}

/**
 * Builds the system prompt that describes the T3 REST API endpoints.
 * Injected into AI sessions so agents can discover and call project services.
 *
 * All supported providers currently reach the T3 services through this
 * REST-via-shell path. A future native-MCP mode would be wired through the
 * same seam (`buildT3ServiceInjectionPrompt` + per-provider session setup).
 */
export function buildRestEndpointSystemPrompt(params: { port: number; token: string }): string {
  const { port, token } = params;
  const baseUrl = `http://127.0.0.1:${port}`;

  return `## T3 Project Services (REST API)

You have access to several T3 project services via REST HTTP endpoints. Call these endpoints directly using curl or code execution — no dedicated tools are registered for them.

### Available Services

| Service | Endpoint | Purpose |
|---------|----------|---------|
| Managed Runs | ${baseUrl}/api/managed-runs | Start, stop, and monitor long-running services (dev servers, build watchers, docker compose) |
| Scheduled Tasks | ${baseUrl}/api/scheduled-tasks | Create, manage, and monitor recurring scheduled tasks and cron jobs |
| Ticketing | ${baseUrl}/api/ticketing | Project issue tracking: tickets, labels, comments, dependencies, artifacts |
| Prompts | ${baseUrl}/api/prompts | Prompt definitions, validation, preview rendering, and explicit prompt updates |
| Session Restart | ${baseUrl}/api/session-restart | Restart the current agent session (after installing an MCP or when a tool is stuck) |

### Authentication

All requests require this Bearer token in the Authorization header:
\`Authorization: Bearer ${token}\`

### Protocol

**Discover available tools** for a service:
\`\`\`bash
curl -s <ENDPOINT_URL> \\
  -H "Authorization: Bearer ${token}"
\`\`\`

**Call a tool** on a service:
\`\`\`bash
curl -s -X POST <ENDPOINT_URL> \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${token}" \\
  -d '{"tool":"<tool_name>","input":{...}}'
\`\`\`

### Response Format

All responses use this envelope:
- **Success:** \`{"data": {"message": "OK", "data": <result>}, "error": null}\`
- **Error:** \`{"data": null, "error": "<error message>"}\`

### Usage Guidelines

- Start by calling \`GET <ENDPOINT_URL>\` on a service to discover its tools and their input schemas.
- Use \`POST\` with \`{"tool":"<tool_name>","input":{...}}\` to call a tool.
- Parse the JSON response — results are in \`response.data.data\`.
- For managed runs: check what's already running before starting new services.
- For ticketing: use list_tickets or search_tickets before creating duplicates.
- When mentioning a ticket identifier in your chat reply, use markdown like \`[ZBD-7](t3://ticket/ZBD-7)\` with the exact identifier returned by the ticketing tool.
- For prompts: use explicit scope arguments. Provider-issued bearer tokens only allow project scope, not global scope.`;
}
