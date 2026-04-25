import readline from "node:readline";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  readonly jsonrpc?: "2.0";
  readonly id?: JsonRpcId;
  readonly method?: string;
  readonly params?: unknown;
}

interface T3ToolDefinition {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

const MCP_PROTOCOL_VERSION = "2024-11-05";

const SERVICE_ENDPOINTS = {
  "managed-runs": "/api/managed-runs",
  "scheduled-tasks": "/api/scheduled-tasks",
  ticketing: "/api/ticketing",
  prompts: "/api/prompts",
  "dynamic-chat-ui": "/api/dynamic-chat-ui",
} as const;

type ServiceName = keyof typeof SERVICE_ENDPOINTS;

const SERVICE_NAMES = Object.keys(SERVICE_ENDPOINTS) as ReadonlyArray<ServiceName>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeProtocolMessage(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeDiagnostic(message: string): void {
  process.stderr.write(`[t3-mcp] ${message}\n`);
}

function makeErrorResponse(id: JsonRpcId | undefined, code: number, message: string): unknown {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
    },
  };
}

function makeResultResponse(id: JsonRpcId | undefined, result: unknown): unknown {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  };
}

function serviceFromToolName(toolName: string): { service: ServiceName; tool: string } | null {
  const separatorIndex = toolName.indexOf("__");
  if (separatorIndex <= 0) {
    return null;
  }
  const service = toolName.slice(0, separatorIndex) as ServiceName;
  if (!SERVICE_NAMES.includes(service)) {
    return null;
  }
  const tool = toolName.slice(separatorIndex + 2);
  return tool.length > 0 ? { service, tool } : null;
}

function mcpToolName(service: ServiceName, toolName: string): string {
  return `${service}__${toolName}`;
}

function normalizeSchemaNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeSchemaNode);
  }
  if (!isRecord(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "optional" || key === "nullable") {
      continue;
    }
    output[key] = normalizeSchemaNode(nested);
  }

  if (value.nullable === true) {
    const type = value.type;
    if (typeof type === "string") {
      output.type = [type, "null"];
    } else if (Array.isArray(type) && !type.includes("null")) {
      output.type = [...type, "null"];
    } else if (!("type" in output) && !("anyOf" in output) && !("oneOf" in output)) {
      output.anyOf = [{ ...output }, { type: "null" }];
    }
  }

  return output;
}

function inputSchemaForTool(definition: T3ToolDefinition): Record<string, unknown> {
  const rawSchema = definition.inputSchema ?? {};
  if (
    rawSchema.type === "object" &&
    isRecord(rawSchema.properties) &&
    (Array.isArray(rawSchema.required) || rawSchema.required === undefined)
  ) {
    return normalizeSchemaNode(rawSchema) as Record<string, unknown>;
  }

  const properties: Record<string, unknown> = {};
  const required: Array<string> = [];
  for (const [name, propertySchema] of Object.entries(rawSchema)) {
    properties[name] = normalizeSchemaNode(propertySchema);
    if (!isRecord(propertySchema) || propertySchema.optional !== true) {
      required.push(name);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function endpointUrl(baseUrl: string, service: ServiceName): string {
  return new URL(SERVICE_ENDPOINTS[service], baseUrl).toString();
}

async function fetchServiceTools(input: {
  readonly baseUrl: string;
  readonly token: string;
  readonly service: ServiceName;
}): Promise<ReadonlyArray<T3ToolDefinition>> {
  const response = await fetch(endpointUrl(input.baseUrl, input.service), {
    headers: {
      Authorization: `Bearer ${input.token}`,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !isRecord(body) || body.error) {
    const detail =
      isRecord(body) && typeof body.error === "string" ? body.error : response.statusText;
    throw new Error(`${input.service} discovery failed: ${detail}`);
  }
  const envelopeData = isRecord(body.data) ? body.data.data : undefined;
  return Array.isArray(envelopeData) ? (envelopeData as ReadonlyArray<T3ToolDefinition>) : [];
}

async function listTools(input: { readonly baseUrl: string; readonly token: string }) {
  const tools: Array<Record<string, unknown>> = [];
  for (const service of SERVICE_NAMES) {
    try {
      const definitions = await fetchServiceTools({ ...input, service });
      for (const definition of definitions) {
        tools.push({
          name: mcpToolName(service, definition.name),
          title: definition.title ?? definition.name,
          description:
            definition.description ?? `Call the T3 ${service} service tool ${definition.name}.`,
          inputSchema: inputSchemaForTool(definition),
        });
      }
    } catch (error) {
      writeDiagnostic(error instanceof Error ? error.message : String(error));
    }
  }
  return { tools };
}

async function callTool(input: {
  readonly baseUrl: string;
  readonly token: string;
  readonly name: string;
  readonly arguments: unknown;
}) {
  const parsed = serviceFromToolName(input.name);
  if (!parsed) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown T3 MCP tool: ${input.name}` }],
    };
  }

  const response = await fetch(endpointUrl(input.baseUrl, parsed.service), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tool: parsed.tool,
      input: isRecord(input.arguments) ? input.arguments : {},
    }),
  });
  const body = await response.json().catch(() => null);
  const failed = !response.ok || !isRecord(body) || body.error;
  const responseData = isRecord(body) && isRecord(body.data) ? (body.data.data ?? body) : body;
  const text = JSON.stringify(responseData, null, 2);
  if (failed) {
    const detail =
      isRecord(body) && typeof body.error === "string" ? body.error : response.statusText;
    writeDiagnostic(`${input.name} failed: ${detail}`);
    return {
      isError: true,
      content: [{ type: "text", text: detail || text }],
    };
  }

  return {
    content: [{ type: "text", text }],
  };
}

async function handleRequest(input: {
  readonly request: JsonRpcRequest;
  readonly baseUrl: string;
  readonly token: string;
}): Promise<unknown | null> {
  const { request } = input;
  if (!request.method) {
    return makeErrorResponse(request.id, -32600, "Invalid JSON-RPC request.");
  }

  switch (request.method) {
    case "initialize":
      return makeResultResponse(request.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "t3-code",
          version: "0.0.0",
        },
      });

    case "notifications/initialized":
      return null;

    case "ping":
      return makeResultResponse(request.id, {});

    case "tools/list":
      return makeResultResponse(request.id, await listTools(input));

    case "tools/call": {
      const params = isRecord(request.params) ? request.params : {};
      const name = typeof params.name === "string" ? params.name : "";
      return makeResultResponse(
        request.id,
        await callTool({
          ...input,
          name,
          arguments: params.arguments,
        }),
      );
    }

    case "resources/list":
      return makeResultResponse(request.id, { resources: [] });

    case "prompts/list":
      return makeResultResponse(request.id, { prompts: [] });

    default:
      return makeErrorResponse(
        request.id,
        -32601,
        `T3 MCP stdio server does not implement ${request.method}.`,
      );
  }
}

export async function runT3GeminiMcpStdio(): Promise<void> {
  const token = process.env.T3_MCP_TOKEN?.trim();
  const baseUrl =
    process.env.T3_MCP_BASE_URL?.trim() ??
    (process.env.T3_MCP_PORT ? `http://127.0.0.1:${process.env.T3_MCP_PORT}` : "");

  if (!token || !baseUrl) {
    writeDiagnostic("Missing T3_MCP_TOKEN or T3_MCP_BASE_URL/T3_MCP_PORT.");
  }

  const input = readline.createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  input.on("line", (line) => {
    void (async () => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        writeProtocolMessage(makeErrorResponse(null, -32700, "Parse error."));
        return;
      }
      if (!isRecord(parsed)) {
        writeProtocolMessage(makeErrorResponse(null, -32600, "Invalid JSON-RPC request."));
        return;
      }
      const request = parsed as JsonRpcRequest;
      if (request.id === undefined && request.method?.startsWith("notifications/")) {
        return;
      }
      try {
        const response = await handleRequest({
          request,
          baseUrl,
          token: token ?? "",
        });
        if (response) {
          writeProtocolMessage(response);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeDiagnostic(message);
        writeProtocolMessage(makeErrorResponse(request.id, -32603, message));
      }
    })();
  });

  await new Promise<void>((resolve) => {
    input.on("close", resolve);
  });
}
