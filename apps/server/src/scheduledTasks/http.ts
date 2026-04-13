import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import type { ProjectId } from "@t3tools/contracts";
import { ScheduledTaskId } from "@t3tools/contracts";
import {
  parseToolCallBody,
  resolveAuth,
  respondError,
  respondOk,
  type ToolDefinition,
} from "../restResponse";
import { ScheduledTaskService, type ScheduledTaskServiceShape } from "./Services/ScheduledTasks";

const API_ROUTE = "/api/scheduled-tasks";

// ---------------------------------------------------------------------------
// Tool definitions (for GET discovery)
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_scheduled_tasks",
    title: "List Scheduled Tasks",
    description: "List all scheduled tasks.",
    inputSchema: {},
  },
  {
    name: "get_scheduled_task",
    title: "Get Scheduled Task",
    description: "Get details of a specific scheduled task by ID.",
    inputSchema: {
      jobId: { type: "string", description: "The scheduled task ID." },
    },
  },
  {
    name: "create_scheduled_task",
    title: "Create Scheduled Task",
    description:
      "Create a new scheduled task directly. For proposing a task to the user for review, " +
      "use propose_scheduled_task instead.",
    inputSchema: {
      name: { type: "string", description: "Human-readable name for the scheduled task." },
      description: { type: "string", optional: true, description: "Optional description." },
      cronExpression: { type: "string", description: "Standard 5-field cron expression." },
      projectId: { type: "string", description: "The project ID for thread creation." },
      skillIds: {
        type: "array",
        optional: true,
        items: { type: "string" },
        description: "Optional skill IDs to attach.",
      },
      prompt: { type: "string", optional: true, description: "Optional prompt to preload." },
      autoSend: {
        type: "boolean",
        optional: true,
        description: "Auto-send the prompt. Default: false.",
      },
    },
  },
  {
    name: "update_scheduled_task",
    title: "Update Scheduled Task",
    description: "Update an existing scheduled task.",
    inputSchema: {
      jobId: { type: "string", description: "The scheduled task ID to update." },
      name: { type: "string", optional: true, description: "New name." },
      description: {
        type: "string",
        optional: true,
        nullable: true,
        description: "New description.",
      },
      cronExpression: { type: "string", optional: true, description: "New cron expression." },
      enabled: { type: "boolean", optional: true, description: "Enable or disable." },
      projectId: { type: "string", optional: true, description: "New project ID." },
      skillIds: {
        type: "array",
        optional: true,
        items: { type: "string" },
        description: "New skill IDs.",
      },
      prompt: { type: "string", optional: true, description: "New prompt." },
      autoSend: { type: "boolean", optional: true, description: "New auto-send setting." },
    },
  },
  {
    name: "delete_scheduled_task",
    title: "Delete Scheduled Task",
    description: "Delete a scheduled task and all its run history.",
    inputSchema: {
      jobId: { type: "string", description: "The scheduled task ID to delete." },
    },
  },
  {
    name: "toggle_scheduled_task",
    title: "Toggle Scheduled Task",
    description: "Enable or disable a scheduled task.",
    inputSchema: {
      jobId: { type: "string", description: "The scheduled task ID." },
      enabled: { type: "boolean", description: "Whether to enable or disable the task." },
    },
  },
  {
    name: "run_scheduled_task_now",
    title: "Run Scheduled Task Now",
    description: "Manually trigger a scheduled task to run immediately.",
    inputSchema: {
      jobId: { type: "string", description: "The scheduled task ID to run." },
    },
  },
  {
    name: "list_scheduled_task_runs",
    title: "List Scheduled Task Runs",
    description: "List run history for a scheduled task.",
    inputSchema: {
      jobId: { type: "string", description: "The scheduled task ID." },
      limit: {
        type: "number",
        optional: true,
        description: "Max runs to return.",
      },
    },
  },
  {
    name: "propose_scheduled_task",
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
      name: { type: "string", description: "Human-readable name for the scheduled task." },
      description: { type: "string", optional: true, description: "Optional description." },
      cronExpression: { type: "string", description: "Standard 5-field cron expression." },
      projectId: { type: "string", description: "The project ID for thread creation." },
      skillIds: {
        type: "array",
        optional: true,
        items: { type: "string" },
        description: "Optional skill IDs to attach.",
      },
      prompt: { type: "string", optional: true, description: "Optional prompt to preload." },
      autoSend: {
        type: "boolean",
        optional: true,
        description: "Auto-send the prompt. Default: false.",
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

function toolHandlers(ctx: { scheduledTasks: ScheduledTaskServiceShape }) {
  const { scheduledTasks } = ctx;

  return {
    list_scheduled_tasks: (_input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const jobs = yield* scheduledTasks.list();
        return respondOk(jobs);
      }),

    get_scheduled_task: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const jobId = input.jobId as string;
        const job = yield* scheduledTasks.get({ jobId: ScheduledTaskId.makeUnsafe(jobId) });
        return respondOk(job);
      }),

    create_scheduled_task: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const name = input.name as string;
        const description = input.description as string | undefined;
        const cronExpression = input.cronExpression as string;
        const projectId = input.projectId as string;
        const skillIds = input.skillIds as string[] | undefined;
        const prompt = input.prompt as string | undefined;
        const autoSend = input.autoSend as boolean | undefined;

        const job = yield* scheduledTasks.create({
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
        });
        return respondOk(job);
      }),

    update_scheduled_task: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const jobId = input.jobId as string;
        const name = input.name as string | undefined;
        const description = input.description as string | undefined | null;
        const cronExpression = input.cronExpression as string | undefined;
        const enabled = input.enabled as boolean | undefined;
        const projectId = input.projectId as string | undefined;
        const skillIds = input.skillIds as string[] | undefined;
        const prompt = input.prompt as string | undefined;
        const autoSend = input.autoSend as boolean | undefined;

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

        const job = yield* scheduledTasks.update({
          jobId: ScheduledTaskId.makeUnsafe(jobId),
          ...(name ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(cronExpression ? { cronExpression } : {}),
          ...(enabled !== undefined ? { enabled } : {}),
          ...(newThreadConfig ? { newThreadConfig: newThreadConfig as never } : {}),
        });
        return respondOk(job);
      }),

    delete_scheduled_task: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const jobId = input.jobId as string;
        yield* scheduledTasks.delete({ jobId: ScheduledTaskId.makeUnsafe(jobId) });
        return respondOk({ deleted: true });
      }),

    toggle_scheduled_task: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const jobId = input.jobId as string;
        const enabled = input.enabled as boolean;
        const job = yield* scheduledTasks.toggle({
          jobId: ScheduledTaskId.makeUnsafe(jobId),
          enabled,
        });
        return respondOk(job);
      }),

    run_scheduled_task_now: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const jobId = input.jobId as string;
        const run = yield* scheduledTasks.runNow({
          jobId: ScheduledTaskId.makeUnsafe(jobId),
        });
        return respondOk(run);
      }),

    list_scheduled_task_runs: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const jobId = input.jobId as string;
        const limit = input.limit as number | undefined;
        const runs = yield* scheduledTasks.listRuns({
          jobId: ScheduledTaskId.makeUnsafe(jobId),
          ...(limit ? { limit } : {}),
        });
        return respondOk(runs);
      }),

    propose_scheduled_task: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        yield* Effect.void;
        const name = input.name as string;
        const description = input.description as string | undefined;
        const cronExpression = input.cronExpression as string;
        const projectId = input.projectId as string;
        const skillIds = input.skillIds as string[] | undefined;
        const prompt = input.prompt as string | undefined;
        const autoSend = input.autoSend as boolean | undefined;

        const payload = JSON.stringify({
          name,
          description: description ?? null,
          cronExpression,
          projectId,
          ...(skillIds && skillIds.length > 0 ? { skillIds } : {}),
          ...(prompt ? { prompt } : {}),
          autoSend: autoSend ?? false,
        });
        return respondOk({
          instruction:
            "To propose this scheduled task to the user, include the following code block in your response:\n\n" +
            "```t3:propose-scheduled-task\n" +
            payload +
            "\n" +
            "```\n\n" +
            "The user will see an interactive card where they can review, edit, and accept or reject the proposal. " +
            "Wait for their response before proceeding.",
        });
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
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const auth = yield* resolveAuth(webRequest);
  if (!auth) return respondError("Unauthorized", 401);
  return respondOk(TOOL_DEFINITIONS, "Available tools");
});

const handlePost = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const auth = yield* resolveAuth(webRequest);
  if (!auth) return respondError("Unauthorized", 401);

  const body = yield* Effect.promise(() => parseToolCallBody(webRequest));
  if (!body) return respondError("Invalid request body. Expected: { tool: string, input: object }");

  const scheduledTasks = yield* ScheduledTaskService;
  const handlers = toolHandlers({ scheduledTasks });

  const handler = handlers[body.tool];
  if (!handler) return respondError(`Unknown tool: ${body.tool}`);

  return yield* handler(body.input).pipe(
    Effect.catch((error) =>
      Effect.succeed(respondError(error instanceof Error ? error.message : String(error), 500)),
    ),
  );
});

// ---------------------------------------------------------------------------
// Route layer
// ---------------------------------------------------------------------------

export const scheduledTasksRouteLayer = Layer.mergeAll(
  HttpRouter.add("GET", API_ROUTE, handleGet),
  HttpRouter.add("POST", API_ROUTE, handlePost),
);
