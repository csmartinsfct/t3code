import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { z } from "zod";

import type { ProjectId } from "@t3tools/contracts";
import { PromptManagementError } from "@t3tools/contracts";
import { ManagedRunService } from "../managedRuns/Services/ManagedRuns";
import { PromptManagementService, type PromptManagementShape } from "./Services/PromptManagement";

const MCP_ROUTE = "/mcp/prompts";
const ORCHESTRATION_PROMPT_ID_VALUES = [
  "implement",
  "resume",
  "resumeFreshAgent",
  "review",
  "reReview",
  "reviewFeedback",
] as const;

const DEV_BYPASS_TOKEN = process.env.NODE_ENV === "production" ? null : "t3-dev-bypass";

type AuthContext = {
  readonly allowGlobal: boolean;
  readonly allowedProjectId: ProjectId | null;
};

type WorkItem = {
  effect: Effect.Effect<unknown, PromptManagementError, never>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

function responseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(response.headers.entries());
}

function createEffectBridge() {
  const queue: WorkItem[] = [];
  let waitResolve: (() => void) | null = null;

  return {
    run: <A>(effect: Effect.Effect<A, PromptManagementError, never>): Promise<A> =>
      new Promise<A>((resolve, reject) => {
        queue.push({ effect, resolve: resolve as (value: unknown) => void, reject });
        waitResolve?.();
      }),

    processAll: Effect.gen(function* () {
      while (queue.length > 0) {
        const item = queue.shift()!;
        const exit = yield* Effect.exit(item.effect);
        Exit.match(exit, {
          onFailure: (cause) => item.reject(Cause.squash(cause)),
          onSuccess: (result) => item.resolve(result),
        });
      }
    }),

    waitForWork: () =>
      new Promise<void>((resolve) => {
        if (queue.length > 0) {
          resolve();
          return;
        }
        waitResolve = resolve;
        setTimeout(() => {
          waitResolve = null;
          resolve();
        }, 50);
      }),
  };
}

function mcpJson(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function mcpError(error: unknown) {
  if (Schema.is(PromptManagementError)(error)) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              code: error.code,
              message: error.message,
              validationErrors: error.validationErrors ?? [],
            },
            null,
            2,
          ),
        },
      ],
      isError: true as const,
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            code: "operation_failed",
            message: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
      },
    ],
    isError: true as const,
  };
}

function authorizeScope(
  input: { scope: "global" | "project"; projectId?: string },
  auth: AuthContext,
) {
  if (input.scope === "global") {
    if (!auth.allowGlobal) {
      throw new PromptManagementError({
        code: "scope_not_authorized",
        message: "This MCP session is not allowed to access global prompt scope.",
      });
    }
    if (input.projectId !== undefined) {
      throw new PromptManagementError({
        code: "invalid_scope",
        message: "Global prompt operations must not include a projectId.",
      });
    }
    return { scope: "global" as const };
  }

  if (!input.projectId) {
    throw new PromptManagementError({
      code: "invalid_scope",
      message: "Project-scoped prompt operations must include a projectId.",
    });
  }

  if (auth.allowedProjectId !== null && auth.allowedProjectId !== input.projectId) {
    throw new PromptManagementError({
      code: "scope_not_authorized",
      message: `This MCP session is only allowed to access project ${auth.allowedProjectId}.`,
    });
  }

  return {
    scope: "project" as const,
    projectId: input.projectId as ProjectId,
  };
}

function scopeInput(scope: "global" | "project", projectId?: string) {
  return projectId === undefined ? { scope } : { scope, projectId };
}

function createPromptsMcpServer(
  promptManagement: PromptManagementShape,
  bridge: ReturnType<typeof createEffectBridge>,
  auth: AuthContext,
) {
  const server = new McpServer(
    { name: "t3-prompts", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "list_prompt_definitions",
    {
      title: "List Prompt Definitions",
      description:
        "List backend-owned prompt groups, prompt definitions, supported variables, labels, descriptions, and constraints for the selected scope.",
      inputSchema: {
        scope: z.enum(["global", "project"]).describe("Use 'global' or 'project'."),
        projectId: z
          .string()
          .optional()
          .describe("Required when scope is 'project'. Omit for global scope."),
      },
    },
    async ({ scope, projectId }) => {
      try {
        return mcpJson(
          await bridge.run(
            promptManagement.listPromptDefinitions(
              authorizeScope(scopeInput(scope, projectId), auth),
            ),
          ),
        );
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    "get_prompt_document",
    {
      title: "Get Prompt Document",
      description:
        "Get shipped default, current global, optional project override, and effective resolved prompt state for one prompt id.",
      inputSchema: {
        scope: z.enum(["global", "project"]).describe("Use 'global' or 'project'."),
        projectId: z
          .string()
          .optional()
          .describe("Required when scope is 'project'. Omit for global scope."),
        promptId: z.enum(ORCHESTRATION_PROMPT_ID_VALUES).describe("Prompt id."),
      },
    },
    async ({ scope, projectId, promptId }) => {
      try {
        return mcpJson(
          await bridge.run(
            promptManagement.getPromptDocument({
              ...authorizeScope(scopeInput(scope, projectId), auth),
              promptId,
            }),
          ),
        );
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    "validate_prompt_document",
    {
      title: "Validate Prompt Document",
      description:
        "Validate a prompt document using the backend-owned prompt validator. Returns structured validation errors and the normalized document on success.",
      inputSchema: {
        scope: z.enum(["global", "project"]).describe("Use 'global' or 'project'."),
        projectId: z
          .string()
          .optional()
          .describe("Required when scope is 'project'. Omit for global scope."),
        promptId: z.enum(ORCHESTRATION_PROMPT_ID_VALUES).describe("Prompt id."),
        document: z.any().describe("Prompt document candidate to validate."),
      },
    },
    async ({ scope, projectId, promptId, document }) => {
      try {
        return mcpJson(
          await bridge.run(
            promptManagement.validatePromptDocument({
              ...authorizeScope(scopeInput(scope, projectId), auth),
              promptId,
              document,
            }),
          ),
        );
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    "preview_prompt_document",
    {
      title: "Preview Prompt Document",
      description:
        "Render a backend-owned prompt preview using deterministic representative sample data. If document is omitted, previews the current effective document for the selected scope.",
      inputSchema: {
        scope: z.enum(["global", "project"]).describe("Use 'global' or 'project'."),
        projectId: z
          .string()
          .optional()
          .describe("Required when scope is 'project'. Omit for global scope."),
        promptId: z.enum(ORCHESTRATION_PROMPT_ID_VALUES).describe("Prompt id."),
        document: z
          .any()
          .optional()
          .describe("Optional document to preview instead of the stored one."),
      },
    },
    async ({ scope, projectId, promptId, document }) => {
      try {
        return mcpJson(
          await bridge.run(
            promptManagement.previewPromptDocument({
              ...authorizeScope(scopeInput(scope, projectId), auth),
              promptId,
              ...(document !== undefined ? { document } : {}),
            }),
          ),
        );
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    "update_prompt_document",
    {
      title: "Update Prompt Document",
      description:
        "Write or reset a prompt document for the selected scope. Use document=null to reset a global prompt to the shipped default or clear a project override.",
      inputSchema: {
        scope: z.enum(["global", "project"]).describe("Use 'global' or 'project'."),
        projectId: z
          .string()
          .optional()
          .describe("Required when scope is 'project'. Omit for global scope."),
        promptId: z.enum(ORCHESTRATION_PROMPT_ID_VALUES).describe("Prompt id."),
        document: z
          .any()
          .nullable()
          .describe("Prompt document to persist, or null to reset/clear override."),
      },
    },
    async ({ scope, projectId, promptId, document }) => {
      try {
        return mcpJson(
          await bridge.run(
            promptManagement.updatePromptDocument({
              ...authorizeScope(scopeInput(scope, projectId), auth),
              promptId,
              document,
            }),
          ),
        );
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  return server;
}

const handlePromptsMcpRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const managedRuns = yield* ManagedRunService;
  const promptManagement = yield* PromptManagementService;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const authorization = webRequest.headers.get("authorization");

  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!token) {
    return HttpServerResponse.text("Unauthorized", { status: 401 });
  }

  let auth: AuthContext | null = null;
  if (DEV_BYPASS_TOKEN && token === DEV_BYPASS_TOKEN) {
    auth = { allowGlobal: true, allowedProjectId: null };
  }
  if (!auth) {
    const context = yield* managedRuns.resolveContextForToken(token);
    if (context) {
      auth = { allowGlobal: false, allowedProjectId: context.projectId };
    }
  }
  if (!auth) {
    return HttpServerResponse.text("Unauthorized", { status: 401 });
  }

  const bridge = createEffectBridge();
  const server = createPromptsMcpServer(promptManagement, bridge, auth);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });

  const mcp: { done: boolean; response: Response | null; error: unknown } = {
    done: false,
    response: null,
    error: null,
  };

  const mcpPromise = (async () => {
    try {
      await server.connect(transport);
      mcp.response = await transport.handleRequest(webRequest);
    } catch (error) {
      mcp.error = error;
    } finally {
      mcp.done = true;
      await server.close().catch(() => undefined);
    }
  })();

  while (!mcp.done) {
    yield* bridge.processAll;
    if (!mcp.done) {
      yield* Effect.promise(() => bridge.waitForWork());
    }
  }
  yield* bridge.processAll;
  yield* Effect.promise(() => mcpPromise);

  if (mcp.error || !mcp.response) {
    return HttpServerResponse.text(
      mcp.error instanceof Error ? mcp.error.message : "Failed to serve prompts MCP request.",
      { status: 500 },
    );
  }

  return yield* Effect.tryPromise({
    try: async () => {
      const bytes = new Uint8Array(await mcp.response!.arrayBuffer());
      return HttpServerResponse.uint8Array(bytes, {
        status: mcp.response!.status,
        headers: responseHeaders(mcp.response!),
      });
    },
    catch: () => HttpServerResponse.text("Failed to read MCP response.", { status: 500 }),
  }).pipe(Effect.catch((errorResp) => Effect.succeed(errorResp)));
});

export const promptsMcpRouteLayer = Layer.mergeAll(
  HttpRouter.add("POST", MCP_ROUTE, handlePromptsMcpRequest),
  HttpRouter.add("GET", MCP_ROUTE, handlePromptsMcpRequest),
  HttpRouter.add("DELETE", MCP_ROUTE, handlePromptsMcpRequest),
);
