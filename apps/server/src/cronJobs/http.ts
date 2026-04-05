import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Cause, Effect, Exit, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { z } from "zod";

import type { CronJobError, ProjectId, ThreadId } from "@t3tools/contracts";
import { CronJobId } from "@t3tools/contracts";
import { ManagedRunService } from "../managedRuns/Services/ManagedRuns";
import { CronJobService, type CronJobServiceShape } from "./Services/CronJobs";

const MCP_ROUTE = "/mcp/cron-jobs";

const DEV_BYPASS_TOKEN = process.env.NODE_ENV === "production" ? null : "t3-dev-bypass";

function responseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(response.headers.entries());
}

type WorkItem = {
  effect: Effect.Effect<unknown, CronJobError, never>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

function createEffectBridge() {
  const queue: WorkItem[] = [];
  let waitResolve: (() => void) | null = null;

  return {
    run: <A>(effect: Effect.Effect<A, CronJobError, never>): Promise<A> =>
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

function createCronJobsMcpServer(
  cronJobs: CronJobServiceShape,
  bridge: ReturnType<typeof createEffectBridge>,
) {
  const server = new McpServer(
    { name: "t3-cron-jobs", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "list_cron_jobs",
    {
      title: "List Cron Jobs",
      description: "List all scheduled cron jobs.",
      inputSchema: {},
    },
    async () => {
      try {
        const jobs = await bridge.run(cronJobs.list());
        return { content: [{ type: "text" as const, text: JSON.stringify(jobs, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to list cron jobs: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "get_cron_job",
    {
      title: "Get Cron Job",
      description: "Get details of a specific cron job by ID.",
      inputSchema: { jobId: z.string().describe("The cron job ID.") },
    },
    async ({ jobId }) => {
      try {
        const job = await bridge.run(cronJobs.get({ jobId: CronJobId.makeUnsafe(jobId) }));
        return { content: [{ type: "text" as const, text: JSON.stringify(job, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to get cron job '${jobId}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "create_cron_job",
    {
      title: "Create Cron Job",
      description:
        "Create a new scheduled cron job directly. For proposing a job to the user for review, " +
        "use propose_cron_job instead.",
      inputSchema: {
        name: z.string().describe("Human-readable name for the cron job."),
        description: z.string().optional().describe("Optional description."),
        cronExpression: z.string().describe("Standard 5-field cron expression."),
        projectId: z.string().describe("The project ID for thread creation."),
        skillId: z.string().optional().describe("Optional skill ID to attach."),
        prompt: z.string().optional().describe("Optional prompt to preload."),
        autoSend: z.boolean().optional().describe("Auto-send the prompt. Default: false."),
      },
    },
    async ({ name, description, cronExpression, projectId, skillId, prompt, autoSend }) => {
      try {
        const job = await bridge.run(
          cronJobs.create({
            name,
            description: description ?? null,
            cronExpression,
            enabled: true,
            jobType: "new_thread",
            newThreadConfig: {
              projectId: projectId as ProjectId,
              ...(skillId ? { skillId } : {}),
              ...(prompt ? { prompt } : {}),
              autoSend: autoSend ?? false,
            },
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(job, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to create cron job: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "update_cron_job",
    {
      title: "Update Cron Job",
      description: "Update an existing cron job.",
      inputSchema: {
        jobId: z.string().describe("The cron job ID to update."),
        name: z.string().optional().describe("New name."),
        description: z.string().optional().nullable().describe("New description."),
        cronExpression: z.string().optional().describe("New cron expression."),
        enabled: z.boolean().optional().describe("Enable or disable."),
        projectId: z.string().optional().describe("New project ID."),
        skillId: z.string().optional().describe("New skill ID."),
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
      skillId,
      prompt,
      autoSend,
    }) => {
      try {
        const newThreadConfig =
          projectId !== undefined ||
          skillId !== undefined ||
          prompt !== undefined ||
          autoSend !== undefined
            ? {
                ...(projectId ? { projectId: projectId as ProjectId } : {}),
                ...(skillId ? { skillId } : {}),
                ...(prompt ? { prompt } : {}),
                ...(autoSend !== undefined ? { autoSend } : {}),
              }
            : undefined;
        const job = await bridge.run(
          cronJobs.update({
            jobId: CronJobId.makeUnsafe(jobId),
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
          `Failed to update cron job '${jobId}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "delete_cron_job",
    {
      title: "Delete Cron Job",
      description: "Delete a cron job and all its run history.",
      inputSchema: { jobId: z.string().describe("The cron job ID to delete.") },
    },
    async ({ jobId }) => {
      try {
        await bridge.run(cronJobs.delete({ jobId: CronJobId.makeUnsafe(jobId) }));
        return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true }) }] };
      } catch (error) {
        return mcpError(
          `Failed to delete cron job '${jobId}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "toggle_cron_job",
    {
      title: "Toggle Cron Job",
      description: "Enable or disable a cron job.",
      inputSchema: {
        jobId: z.string().describe("The cron job ID."),
        enabled: z.boolean().describe("Whether to enable or disable the job."),
      },
    },
    async ({ jobId, enabled }) => {
      try {
        const job = await bridge.run(
          cronJobs.toggle({ jobId: CronJobId.makeUnsafe(jobId), enabled }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(job, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to toggle cron job '${jobId}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "run_cron_job_now",
    {
      title: "Run Cron Job Now",
      description: "Manually trigger a cron job to run immediately.",
      inputSchema: { jobId: z.string().describe("The cron job ID to run.") },
    },
    async ({ jobId }) => {
      try {
        const run = await bridge.run(cronJobs.runNow({ jobId: CronJobId.makeUnsafe(jobId) }));
        return { content: [{ type: "text" as const, text: JSON.stringify(run, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to run cron job '${jobId}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "list_cron_job_runs",
    {
      title: "List Cron Job Runs",
      description: "List run history for a cron job.",
      inputSchema: {
        jobId: z.string().describe("The cron job ID."),
        limit: z.number().int().positive().optional().describe("Max runs to return."),
      },
    },
    async ({ jobId, limit }) => {
      try {
        const runs = await bridge.run(
          cronJobs.listRuns({
            jobId: CronJobId.makeUnsafe(jobId),
            ...(limit ? { limit } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(runs, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to list runs for cron job '${jobId}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "propose_cron_job",
    {
      title: "Propose Cron Job",
      description:
        "Propose a new cron job to the user. The user will see an interactive card in the chat " +
        "where they can review, edit, and accept or reject the proposal. " +
        "IMPORTANT: After calling this tool, you MUST include a code block in your response " +
        "with the language tag `t3:propose-cron` containing the JSON payload returned by this tool. " +
        "The user will see this as an interactive card they can edit and accept. " +
        "Wait for the user's response before taking further action. " +
        "If accepted, you'll see 'Cron job added: <name> (schedule: <expression>)'.",
      inputSchema: {
        name: z.string().describe("Human-readable name for the cron job."),
        description: z.string().optional().describe("Optional description."),
        cronExpression: z.string().describe("Standard 5-field cron expression."),
        projectId: z.string().describe("The project ID for thread creation."),
        skillId: z.string().optional().describe("Optional skill ID to attach."),
        prompt: z.string().optional().describe("Optional prompt to preload."),
        autoSend: z.boolean().optional().describe("Auto-send the prompt. Default: false."),
      },
    },
    async ({ name, description, cronExpression, projectId, skillId, prompt, autoSend }) => {
      const payload = JSON.stringify({
        name,
        description: description ?? null,
        cronExpression,
        projectId,
        ...(skillId ? { skillId } : {}),
        ...(prompt ? { prompt } : {}),
        autoSend: autoSend ?? false,
      });
      return {
        content: [
          {
            type: "text" as const,
            text:
              "To propose this cron job to the user, include the following code block in your response:\n\n" +
              "```t3:propose-cron\n" +
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

const handleCronJobsMcpRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const managedRuns = yield* ManagedRunService;
  const cronJobs = yield* CronJobService;
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
  const server = createCronJobsMcpServer(cronJobs, bridge);
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
      mcp.error instanceof Error ? mcp.error.message : "Failed to serve cron jobs MCP request.",
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

export const cronJobsMcpRouteLayer = Layer.mergeAll(
  HttpRouter.add("POST", MCP_ROUTE, handleCronJobsMcpRequest),
  HttpRouter.add("GET", MCP_ROUTE, handleCronJobsMcpRequest),
  HttpRouter.add("DELETE", MCP_ROUTE, handleCronJobsMcpRequest),
);
