import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Cause, Effect, Exit, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { z } from "zod";

import type { ScheduledTaskError, ProjectId, ThreadId } from "@t3tools/contracts";
import { ScheduledTaskId } from "@t3tools/contracts";
import { ManagedRunService } from "../managedRuns/Services/ManagedRuns";
import { ScheduledTaskService, type ScheduledTaskServiceShape } from "./Services/ScheduledTasks";

const MCP_ROUTE = "/mcp/scheduled-tasks";

const DEV_BYPASS_TOKEN = process.env.NODE_ENV === "production" ? null : "t3-dev-bypass";

function responseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(response.headers.entries());
}

type WorkItem = {
  effect: Effect.Effect<unknown, ScheduledTaskError, never>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

function createEffectBridge() {
  const queue: WorkItem[] = [];
  let waitResolve: (() => void) | null = null;

  return {
    run: <A>(effect: Effect.Effect<A, ScheduledTaskError, never>): Promise<A> =>
      new Promise<A>((resolve, reject) => {
        queue.push({ effect, resolve: resolve as (v: unknown) => void, reject });
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

    pending: () => queue.length,
  };
}

function mcpError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

function createScheduledTasksMcpServer(
  scheduledTasks: ScheduledTaskServiceShape,
  bridge: ReturnType<typeof createEffectBridge>,
) {
  const server = new McpServer(
    { name: "t3-scheduled-tasks", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "list_scheduled_tasks",
    {
      title: "List Scheduled Tasks",
      description: "List all scheduled tasks.",
      inputSchema: {},
    },
    async () => {
      try {
        const jobs = await bridge.run(scheduledTasks.list());
        return { content: [{ type: "text" as const, text: JSON.stringify(jobs, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to list scheduled tasks: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "get_scheduled_task",
    {
      title: "Get Scheduled Task",
      description: "Get details of a specific scheduled task by ID.",
      inputSchema: { jobId: z.string().describe("The scheduled task ID.") },
    },
    async ({ jobId }) => {
      try {
        const job = await bridge.run(
          scheduledTasks.get({ jobId: ScheduledTaskId.makeUnsafe(jobId) }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(job, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to get scheduled task '${jobId}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "create_scheduled_task",
    {
      title: "Create Scheduled Task",
      description:
        "Create a new scheduled task directly. For proposing a task to the user for review, " +
        "use propose_scheduled_task instead.",
      inputSchema: {
        name: z.string().describe("Human-readable name for the scheduled task."),
        description: z.string().optional().describe("Optional description."),
        cronExpression: z.string().describe("Standard 5-field cron expression."),
        projectId: z.string().describe("The project ID for thread creation."),
        skillIds: z.array(z.string()).optional().describe("Optional skill IDs to attach."),
        prompt: z.string().optional().describe("Optional prompt to preload."),
        autoSend: z.boolean().optional().describe("Auto-send the prompt. Default: false."),
      },
    },
    async ({ name, description, cronExpression, projectId, skillIds, prompt, autoSend }) => {
      try {
        const job = await bridge.run(
          scheduledTasks.create({
            name,
            description: description ?? null,
            cronExpression,
            enabled: true,
            jobType: "new_thread",
            newThreadConfig: {
              projectId: projectId as ProjectId,
              ...(skillIds && skillIds.length > 0 ? { skillIds } : {}),
              ...(prompt ? { prompt } : {}),
              autoSend: autoSend ?? false,
            },
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(job, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to create scheduled task: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "update_scheduled_task",
    {
      title: "Update Scheduled Task",
      description: "Update an existing scheduled task.",
      inputSchema: {
        jobId: z.string().describe("The scheduled task ID to update."),
        name: z.string().optional().describe("New name."),
        description: z.string().optional().nullable().describe("New description."),
        cronExpression: z.string().optional().describe("New cron expression."),
        enabled: z.boolean().optional().describe("Enable or disable."),
        projectId: z.string().optional().describe("New project ID."),
        skillIds: z.array(z.string()).optional().describe("New skill IDs."),
        prompt: z.string().optional().describe("New prompt."),
        autoSend: z.boolean().optional().describe("New auto-send setting."),
      },
    },
    async ({
      jobId,
      name,
      description,
      cronExpression,
      enabled,
      projectId,
      skillIds,
      prompt,
      autoSend,
    }) => {
      try {
        const newThreadConfig =
          projectId !== undefined ||
          skillIds !== undefined ||
          prompt !== undefined ||
          autoSend !== undefined
            ? {
                ...(projectId ? { projectId: projectId as ProjectId } : {}),
                ...(skillIds && skillIds.length > 0 ? { skillIds } : {}),
                ...(prompt ? { prompt } : {}),
                ...(autoSend !== undefined ? { autoSend } : {}),
              }
            : undefined;
        const job = await bridge.run(
          scheduledTasks.update({
            jobId: ScheduledTaskId.makeUnsafe(jobId),
            ...(name ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(cronExpression ? { cronExpression } : {}),
            ...(enabled !== undefined ? { enabled } : {}),
            ...(newThreadConfig ? { newThreadConfig: newThreadConfig as never } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(job, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to update scheduled task '${jobId}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "delete_scheduled_task",
    {
      title: "Delete Scheduled Task",
      description: "Delete a scheduled task and all its run history.",
      inputSchema: { jobId: z.string().describe("The scheduled task ID to delete.") },
    },
    async ({ jobId }) => {
      try {
        await bridge.run(scheduledTasks.delete({ jobId: ScheduledTaskId.makeUnsafe(jobId) }));
        return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true }) }] };
      } catch (error) {
        return mcpError(
          `Failed to delete scheduled task '${jobId}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "toggle_scheduled_task",
    {
      title: "Toggle Scheduled Task",
      description: "Enable or disable a scheduled task.",
      inputSchema: {
        jobId: z.string().describe("The scheduled task ID."),
        enabled: z.boolean().describe("Whether to enable or disable the task."),
      },
    },
    async ({ jobId, enabled }) => {
      try {
        const job = await bridge.run(
          scheduledTasks.toggle({ jobId: ScheduledTaskId.makeUnsafe(jobId), enabled }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(job, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to toggle scheduled task '${jobId}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "run_scheduled_task_now",
    {
      title: "Run Scheduled Task Now",
      description: "Manually trigger a scheduled task to run immediately.",
      inputSchema: { jobId: z.string().describe("The scheduled task ID to run.") },
    },
    async ({ jobId }) => {
      try {
        const run = await bridge.run(
          scheduledTasks.runNow({ jobId: ScheduledTaskId.makeUnsafe(jobId) }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(run, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to run scheduled task '${jobId}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "list_scheduled_task_runs",
    {
      title: "List Scheduled Task Runs",
      description: "List run history for a scheduled task.",
      inputSchema: {
        jobId: z.string().describe("The scheduled task ID."),
        limit: z.number().int().positive().optional().describe("Max runs to return."),
      },
    },
    async ({ jobId, limit }) => {
      try {
        const runs = await bridge.run(
          scheduledTasks.listRuns({
            jobId: ScheduledTaskId.makeUnsafe(jobId),
            ...(limit ? { limit } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(runs, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to list runs for scheduled task '${jobId}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "propose_scheduled_task",
    {
      title: "Propose Scheduled Task",
      description:
        "Propose a new scheduled task to the user. The user will see an interactive card in the chat " +
        "where they can review, edit, and accept or reject the proposal. " +
        "IMPORTANT: After calling this tool, you MUST include a code block in your response " +
        "with the language tag `t3:propose-scheduled-task` containing the JSON payload returned by this tool. " +
        "The user will see this as an interactive card they can edit and accept. " +
        "Wait for the user's response before taking further action. " +
        "If accepted, you'll see 'Scheduled task added: <name> (schedule: <expression>)'.",
      inputSchema: {
        name: z.string().describe("Human-readable name for the scheduled task."),
        description: z.string().optional().describe("Optional description."),
        cronExpression: z.string().describe("Standard 5-field cron expression."),
        projectId: z.string().describe("The project ID for thread creation."),
        skillIds: z.array(z.string()).optional().describe("Optional skill IDs to attach."),
        prompt: z.string().optional().describe("Optional prompt to preload."),
        autoSend: z.boolean().optional().describe("Auto-send the prompt. Default: false."),
      },
    },
    async ({ name, description, cronExpression, projectId, skillIds, prompt, autoSend }) => {
      const payload = JSON.stringify({
        name,
        description: description ?? null,
        cronExpression,
        projectId,
        ...(skillIds && skillIds.length > 0 ? { skillIds } : {}),
        ...(prompt ? { prompt } : {}),
        autoSend: autoSend ?? false,
      });
      return {
        content: [
          {
            type: "text" as const,
            text:
              "To propose this scheduled task to the user, include the following code block in your response:\n\n" +
              "```t3:propose-scheduled-task\n" +
              payload +
              "\n" +
              "```\n\n" +
              "The user will see an interactive card where they can review, edit, and accept or reject the proposal. " +
              "Wait for their response before proceeding.",
          },
        ],
      };
    },
  );

  return server;
}

const handleScheduledTasksMcpRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const managedRuns = yield* ManagedRunService;
  const scheduledTasks = yield* ScheduledTaskService;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const authorization = webRequest.headers.get("authorization");

  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!token) {
    return HttpServerResponse.text("Unauthorized", { status: 401 });
  }

  let context: { projectId: ProjectId; threadId: ThreadId } | null = null;
  if (DEV_BYPASS_TOKEN && token === DEV_BYPASS_TOKEN) {
    const url = new URL(webRequest.url, "http://localhost");
    const projectId = url.searchParams.get("projectId");
    const threadId = url.searchParams.get("threadId") ?? "dev-test-thread";
    if (projectId) {
      context = { projectId: projectId as ProjectId, threadId: threadId as ThreadId };
    }
  }
  if (!context) {
    context = yield* managedRuns.resolveContextForToken(token);
  }
  if (context === null) {
    return HttpServerResponse.text("Unauthorized", { status: 401 });
  }

  const bridge = createEffectBridge();
  const server = createScheduledTasksMcpServer(scheduledTasks, bridge);
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
      mcp.error instanceof Error
        ? mcp.error.message
        : "Failed to serve scheduled tasks MCP request.",
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

export const scheduledTasksMcpRouteLayer = Layer.mergeAll(
  HttpRouter.add("POST", MCP_ROUTE, handleScheduledTasksMcpRequest),
  HttpRouter.add("GET", MCP_ROUTE, handleScheduledTasksMcpRequest),
  HttpRouter.add("DELETE", MCP_ROUTE, handleScheduledTasksMcpRequest),
);
