import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import type { ProjectId, ProjectScript, ThreadId } from "@t3tools/contracts";
import { ManagedRunId, TrimmedNonEmptyString } from "@t3tools/contracts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import {
  parseToolCallBody,
  resolveAuth,
  respondError,
  respondOk,
  type ToolDefinition,
} from "../restResponse";
import { ManagedRunService, type ManagedRunServiceShape } from "./Services/ManagedRuns";

const API_ROUTE = "/api/managed-runs";

function resolveScript(scripts: ReadonlyArray<ProjectScript>, scriptId: string) {
  return scripts.find((s) => s.id === scriptId);
}

// ---------------------------------------------------------------------------
// Tool definitions (for GET discovery)
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "launch_project_script",
    title: "Launch Project Script",
    description:
      "Launch a project action/script as a managed run. Use this instead of running long-lived " +
      "services (dev servers, docker compose, watchers, etc.) directly in the terminal. " +
      "The run is tracked by T3 with lifecycle management, URL detection, and log capture. " +
      "Fails if a run for the same script is already active — check list_managed_runs first.",
    inputSchema: {
      scriptId: { type: "string", description: "The ID of the project script to launch." },
      cwd: {
        type: "string",
        optional: true,
        description: "Override working directory for the run.",
      },
    },
  },
  {
    name: "list_managed_runs",
    title: "List Managed Runs",
    description:
      "List active managed runs and all available project actions for the current project. " +
      "Check this before launching or proposing a new action to avoid duplicates.",
    inputSchema: {
      includeHistorical: {
        type: "boolean",
        optional: true,
        description: "Also show completed/failed/stopped runs.",
      },
    },
  },
  {
    name: "get_managed_run",
    title: "Get Managed Run",
    description:
      "Read full metadata and evidence for one managed run, including detected URLs and ports.",
    inputSchema: {
      runId: { type: "string", description: "The managed run ID." },
    },
  },
  {
    name: "get_managed_run_logs",
    title: "Get Managed Run Logs",
    description:
      "Read timestamped line logs for one managed run. Returns full logs by default; " +
      "use tailLines to get only the most recent N lines.",
    inputSchema: {
      runId: { type: "string", description: "The managed run ID." },
      stream: {
        type: "string",
        optional: true,
        enum: ["pty", "stdout", "stderr"],
        description: "Log stream to read.",
      },
      tailLines: {
        type: "number",
        optional: true,
        description: "Return only the most recent N lines.",
      },
    },
  },
  {
    name: "stop_managed_run",
    title: "Stop Managed Run",
    description: "Stop a managed run that is still under live T3 control.",
    inputSchema: {
      runId: { type: "string", description: "The managed run ID." },
    },
  },
  {
    name: "propose_project_script",
    title: "Propose Project Script",
    description:
      "Propose a new project action/script to the user. The user will see an interactive card " +
      "in the chat where they can review, edit, and accept or reject the proposal. " +
      "Use this when you need to start a service but no matching project action exists yet. " +
      "IMPORTANT: After calling this tool, you MUST include a code block in your response " +
      "with the language tag `t3:propose-action` containing the JSON payload returned by this tool. " +
      "Available icons: play, test, lint, configure, build, debug. Default is play.",
    inputSchema: {
      name: { type: "string", description: "Human-readable name for the action." },
      command: { type: "string", description: "Shell command to run." },
      icon: {
        type: "string",
        optional: true,
        enum: ["play", "test", "lint", "configure", "build", "debug"],
        description: "Icon for the action. Default: play.",
      },
      services: {
        type: "array",
        optional: true,
        description: "Declared services this command launches, each with a health check.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            healthCheck: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["url", "docker", "port", "command"] },
                url: { type: "string", optional: true },
                container: { type: "string", optional: true },
                port: { type: "number", optional: true },
                host: { type: "string", optional: true },
                command: { type: "string", optional: true },
                cwd: { type: "string", optional: true },
              },
            },
          },
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

type ToolContext = {
  managedRuns: ManagedRunServiceShape;
  projectId: ProjectId;
  threadId: ThreadId;
  scripts: ReadonlyArray<ProjectScript>;
};

function toolHandlers(ctx: ToolContext) {
  const { managedRuns, projectId, threadId, scripts } = ctx;

  return {
    launch_project_script: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const scriptId = input.scriptId as string;
        const cwd = input.cwd as string | undefined;

        const activeRuns = yield* managedRuns.list({ projectId });
        const alreadyRunning = activeRuns.find(
          (r) => r.scriptId === scriptId && (r.status === "starting" || r.status === "running"),
        );
        if (alreadyRunning) {
          return respondError(
            `Script '${scriptId}' is already running as managed run '${alreadyRunning.runId}' ` +
              `(status: ${alreadyRunning.status}). ` +
              `Use get_managed_run or get_managed_run_logs to inspect it, or stop_managed_run to restart it.`,
          );
        }

        const result = yield* managedRuns.launchProjectScript({
          projectId,
          threadId,
          scriptId: TrimmedNonEmptyString.makeUnsafe(scriptId),
          ...(cwd ? { cwd: TrimmedNonEmptyString.makeUnsafe(cwd) } : {}),
        });
        const script = resolveScript(scripts, scriptId);
        return respondOk({
          launched: true,
          runId: result.run.runId,
          name: script?.name ?? scriptId,
          command: script?.command ?? "unknown",
          status: result.run.status,
          terminalPid: result.run.terminalPid,
        });
      }),

    list_managed_runs: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const includeHistorical = input.includeHistorical as boolean | undefined;
        const runs = yield* managedRuns.list({
          projectId,
          ...(includeHistorical !== undefined ? { includeHistorical } : {}),
        });
        const enriched = runs.map((run) => {
          const script = resolveScript(scripts, run.scriptId);
          return {
            ...run,
            name: script?.name ?? run.scriptId,
            command: script?.command ?? "unknown",
          };
        });
        const availableActions = scripts.map((s) => ({
          scriptId: s.id,
          name: s.name,
          command: s.command,
          services: s.services,
        }));
        return respondOk({ runs: enriched, availableActions });
      }),

    get_managed_run: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const runId = input.runId as string;
        const run = yield* managedRuns.get({ runId: ManagedRunId.makeUnsafe(runId) });
        const script = resolveScript(scripts, run.scriptId);
        return respondOk({
          ...run,
          name: script?.name ?? run.scriptId,
          command: script?.command ?? "unknown",
        });
      }),

    get_managed_run_logs: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const runId = input.runId as string;
        const stream = input.stream as "pty" | "stdout" | "stderr" | undefined;
        const tailLines = input.tailLines as number | undefined;
        const lines = yield* managedRuns.getLogs({
          runId: ManagedRunId.makeUnsafe(runId),
          ...(stream ? { stream } : {}),
          ...(tailLines ? { tailLines } : {}),
        });
        return respondOk(lines);
      }),

    stop_managed_run: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const runId = input.runId as string;
        yield* managedRuns.stop({ runId: ManagedRunId.makeUnsafe(runId) });
        return respondOk({ stopped: true });
      }),

    propose_project_script: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        yield* Effect.void;
        const name = input.name as string;
        const command = input.command as string;
        const icon = (input.icon as string) ?? "play";
        const services = input.services as unknown[] | undefined;

        const payload = JSON.stringify({
          name,
          command,
          icon,
          ...(services ? { services } : {}),
        });
        return respondOk({
          instruction:
            "To propose this action to the user, include the following code block in your response:\n\n" +
            "```t3:propose-action\n" +
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

  // Resolve project scripts
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const readModel = yield* snapshotQuery
    .getSnapshot()
    .pipe(Effect.catch(() => Effect.succeed(null)));
  const project = readModel?.projects.find((p) => p.id === auth.projectId);
  const scripts = project?.scripts ?? [];

  const managedRuns = yield* ManagedRunService;
  const handlers = toolHandlers({
    managedRuns,
    projectId: auth.projectId,
    threadId: auth.threadId,
    scripts,
  });

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

export const managedRunsRouteLayer = Layer.mergeAll(
  HttpRouter.add("GET", API_ROUTE, handleGet),
  HttpRouter.add("POST", API_ROUTE, handlePost),
);
