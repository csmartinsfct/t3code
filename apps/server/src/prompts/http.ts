import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import type { OrchestrationPromptId, ProjectId } from "@t3tools/contracts";
import { PromptManagementError } from "@t3tools/contracts";
import { ManagedRunService } from "../managedRuns/Services/ManagedRuns";
import {
  extractBearerToken,
  parseToolCallBody,
  respondError,
  respondOk,
  type ToolDefinition,
} from "../restResponse";
import { PromptManagementService, type PromptManagementShape } from "./Services/PromptManagement";

const API_ROUTE = "/api/prompts";

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

// ---------------------------------------------------------------------------
// Scope authorization (business logic)
// ---------------------------------------------------------------------------

function authorizeScope(
  input: { scope: "global" | "project"; projectId?: string },
  auth: AuthContext,
) {
  if (input.scope === "global") {
    if (!auth.allowGlobal) {
      throw new PromptManagementError({
        code: "scope_not_authorized",
        message: "This session is not allowed to access global prompt scope.",
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
      message: `This session is only allowed to access project ${auth.allowedProjectId}.`,
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

// ---------------------------------------------------------------------------
// Tool definitions (for GET discovery)
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_prompt_definitions",
    title: "List Prompt Definitions",
    description:
      "List backend-owned prompt groups, prompt definitions, supported variables, labels, descriptions, and constraints for the selected scope.",
    inputSchema: {
      scope: {
        type: "string",
        enum: ["global", "project"],
        description: "Use 'global' or 'project'.",
      },
      projectId: {
        type: "string",
        optional: true,
        description: "Required when scope is 'project'. Omit for global scope.",
      },
    },
  },
  {
    name: "get_prompt_document",
    title: "Get Prompt Document",
    description:
      "Get shipped default, current global, optional project override, and effective resolved prompt state for one prompt id.",
    inputSchema: {
      scope: {
        type: "string",
        enum: ["global", "project"],
        description: "Use 'global' or 'project'.",
      },
      projectId: {
        type: "string",
        optional: true,
        description: "Required when scope is 'project'. Omit for global scope.",
      },
      promptId: {
        type: "string",
        enum: [...ORCHESTRATION_PROMPT_ID_VALUES],
        description: "Prompt id.",
      },
    },
  },
  {
    name: "validate_prompt_document",
    title: "Validate Prompt Document",
    description:
      "Validate a prompt document using the backend-owned prompt validator. Returns structured validation errors and the normalized document on success.",
    inputSchema: {
      scope: {
        type: "string",
        enum: ["global", "project"],
        description: "Use 'global' or 'project'.",
      },
      projectId: {
        type: "string",
        optional: true,
        description: "Required when scope is 'project'. Omit for global scope.",
      },
      promptId: {
        type: "string",
        enum: [...ORCHESTRATION_PROMPT_ID_VALUES],
        description: "Prompt id.",
      },
      document: {
        type: "object",
        description: "Prompt document candidate to validate.",
      },
    },
  },
  {
    name: "preview_prompt_document",
    title: "Preview Prompt Document",
    description:
      "Render a backend-owned prompt preview using deterministic representative sample data. If document is omitted, previews the current effective document for the selected scope.",
    inputSchema: {
      scope: {
        type: "string",
        enum: ["global", "project"],
        description: "Use 'global' or 'project'.",
      },
      projectId: {
        type: "string",
        optional: true,
        description: "Required when scope is 'project'. Omit for global scope.",
      },
      promptId: {
        type: "string",
        enum: [...ORCHESTRATION_PROMPT_ID_VALUES],
        description: "Prompt id.",
      },
      document: {
        type: "object",
        optional: true,
        description: "Optional document to preview instead of the stored one.",
      },
    },
  },
  {
    name: "update_prompt_document",
    title: "Update Prompt Document",
    description:
      "Write or reset a prompt document for the selected scope. Use document=null to reset a global prompt to the shipped default or clear a project override.",
    inputSchema: {
      scope: {
        type: "string",
        enum: ["global", "project"],
        description: "Use 'global' or 'project'.",
      },
      projectId: {
        type: "string",
        optional: true,
        description: "Required when scope is 'project'. Omit for global scope.",
      },
      promptId: {
        type: "string",
        enum: [...ORCHESTRATION_PROMPT_ID_VALUES],
        description: "Prompt id.",
      },
      document: {
        type: "object",
        nullable: true,
        description: "Prompt document to persist, or null to reset/clear override.",
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

function toolHandlers(ctx: { promptManagement: PromptManagementShape; auth: AuthContext }) {
  const { promptManagement, auth } = ctx;

  return {
    list_prompt_definitions: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const scope = input.scope as "global" | "project";
        const projectId = input.projectId as string | undefined;
        const result = yield* promptManagement.listPromptDefinitions(
          authorizeScope(scopeInput(scope, projectId), auth),
        );
        return respondOk(result);
      }),

    get_prompt_document: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const scope = input.scope as "global" | "project";
        const projectId = input.projectId as string | undefined;
        const promptId = input.promptId as OrchestrationPromptId;
        const result = yield* promptManagement.getPromptDocument({
          ...authorizeScope(scopeInput(scope, projectId), auth),
          promptId,
        });
        return respondOk(result);
      }),

    validate_prompt_document: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const scope = input.scope as "global" | "project";
        const projectId = input.projectId as string | undefined;
        const promptId = input.promptId as OrchestrationPromptId;
        const document = input.document;
        const result = yield* promptManagement.validatePromptDocument({
          ...authorizeScope(scopeInput(scope, projectId), auth),
          promptId,
          document,
        });
        return respondOk(result);
      }),

    preview_prompt_document: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const scope = input.scope as "global" | "project";
        const projectId = input.projectId as string | undefined;
        const promptId = input.promptId as OrchestrationPromptId;
        const document = input.document;
        const result = yield* promptManagement.previewPromptDocument({
          ...authorizeScope(scopeInput(scope, projectId), auth),
          promptId,
          ...(document !== undefined ? { document } : {}),
        });
        return respondOk(result);
      }),

    update_prompt_document: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const scope = input.scope as "global" | "project";
        const projectId = input.projectId as string | undefined;
        const promptId = input.promptId as OrchestrationPromptId;
        const document = input.document;
        const result = yield* promptManagement.updatePromptDocument({
          ...authorizeScope(scopeInput(scope, projectId), auth),
          promptId,
          document,
        });
        return respondOk(result);
      }),
  } as Record<
    string,
    (input: Record<string, unknown>) => Effect.Effect<HttpServerResponse.HttpServerResponse, Error>
  >;
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

const handleGet = Effect.gen(function* () {
  return respondOk(TOOL_DEFINITIONS, "Available tools");
});

const handlePost = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const managedRuns = yield* ManagedRunService;
  const promptManagement = yield* PromptManagementService;
  const webRequest = yield* HttpServerRequest.toWeb(request);

  // --- Custom auth: prompts needs allowGlobal / allowedProjectId ---
  const token = extractBearerToken(webRequest);
  if (!token) return respondError("Unauthorized", 401);

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
  if (!auth) return respondError("Unauthorized", 401);

  // --- Parse tool call body ---
  const body = yield* Effect.promise(() => parseToolCallBody(webRequest));
  if (!body) return respondError("Invalid request body. Expected: { tool: string, input: object }");

  const handlers = toolHandlers({ promptManagement, auth });
  const handler = handlers[body.tool];
  if (!handler) return respondError(`Unknown tool: ${body.tool}`);

  return yield* handler(body.input).pipe(
    Effect.catch((error) => {
      if (Schema.is(PromptManagementError)(error)) {
        return Effect.succeed(
          respondError(
            JSON.stringify({
              code: error.code,
              message: error.message,
              validationErrors: error.validationErrors ?? [],
            }),
            400,
          ),
        );
      }
      return Effect.succeed(
        respondError(error instanceof Error ? error.message : String(error), 500),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// Route layer
// ---------------------------------------------------------------------------

export const promptsRouteLayer = Layer.mergeAll(
  HttpRouter.add("GET", API_ROUTE, handleGet),
  HttpRouter.add("POST", API_ROUTE, handlePost),
);
