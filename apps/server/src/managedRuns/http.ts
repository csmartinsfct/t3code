import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import type { ProjectId, ProjectScript, ThreadId } from "@t3tools/contracts";
import { ManagedRunId, TrimmedNonEmptyString } from "@t3tools/contracts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import {
  parseToolCallBody,
  resolveAuth,
  respondError,
  respondErrorFromCause,
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
      "use tailLines to get only the most recent N lines. For composite runs that have " +
      "multiple services, pass `serviceId` to read just that service's logs.",
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
      serviceId: {
        type: "string",
        optional: true,
        description:
          "For composite runs, restrict the result to a single service's NDJSON file. " +
          "Omit for legacy single-process runs (or to merge across services).",
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
      "Available icons: play, test, lint, configure, build, debug. Default is play. " +
      "Two shapes are supported: (1) Legacy single-process — provide a top-level `command` " +
      "and optionally declare `services` to name them. (2) Composite multi-service — omit " +
      "the top-level `command` and provide a per-service `command` for every entry in " +
      "`services`. Composite actions launch each service in its own subprocess with its own " +
      "log tab, which is the right shape when an action launches multiple discrete services " +
      "(a backend + a frontend, multiple workers, etc.) and you want their logs separated. " +
      "T3 detects each service's health automatically from its logs — never specify a health check.",
    inputSchema: {
      name: { type: "string", description: "Human-readable name for the action." },
      command: {
        type: "string",
        optional: true,
        description:
          "Shell command to run. Omit for composite actions where every service has its own `command`.",
      },
      icon: {
        type: "string",
        optional: true,
        enum: ["play", "test", "lint", "configure", "build", "debug"],
        description: "Icon for the action. Default: play.",
      },
      services: {
        type: "array",
        optional: true,
        description:
          "Declared services. For composite actions, every entry must include its own `command`. " +
          "For legacy actions, services are just named metadata (T3 infers their health from logs).",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Human-readable service name." },
            command: {
              type: "string",
              optional: true,
              description:
                "If set, this service runs as its own subprocess (composite action) and gets " +
                "its own log tab. Mutually exclusive with the top-level `command`.",
            },
            cwd: {
              type: "string",
              optional: true,
              description: "Per-service working directory override (composite actions only).",
            },
            env: {
              type: "object",
              optional: true,
              description:
                "Per-service environment overrides layered on top of the action env (composite actions only).",
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
        const rawServiceId = input.serviceId as string | undefined;
        // Validate serviceId tightly — it joins into a file path (`<runId>/<serviceId>.ndjson`),
        // so anything outside `[a-z0-9-]` would allow path traversal.
        if (rawServiceId !== undefined && !/^[a-z0-9-]+$/.test(rawServiceId)) {
          return respondError(`Invalid serviceId: ${rawServiceId}`);
        }
        const lines = yield* managedRuns.getLogs({
          runId: ManagedRunId.makeUnsafe(runId),
          ...(stream ? { stream } : {}),
          ...(tailLines ? { tailLines } : {}),
          ...(rawServiceId ? { serviceId: rawServiceId } : {}),
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
        const command = (input.command as string | undefined) ?? "";
        const icon = (input.icon as string) ?? "play";
        const services = input.services as unknown[] | undefined;

        // T3 infers health from logs at runtime, so the propose surface no
        // longer accepts a per-service `healthCheck`. Reject loudly rather
        // than silently dropping it — that keeps the system prompt and the
        // tool's contract honest.
        if (Array.isArray(services)) {
          for (const service of services) {
            if (
              typeof service === "object" &&
              service !== null &&
              "healthCheck" in (service as Record<string, unknown>)
            ) {
              return respondError(
                "Health checks are inferred from logs; remove the `healthCheck` field from each service.",
              );
            }
          }
        }
        const sanitizedServices = services;
        const payload = JSON.stringify({
          name,
          ...(command.length > 0 ? { command } : { command: "" }),
          icon,
          ...(sanitizedServices ? { services: sanitizedServices } : {}),
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
  const projectOption = yield* snapshotQuery
    .getProjectById(auth.projectId)
    .pipe(Effect.catch(() => Effect.succeed(Option.none())));
  const project = Option.getOrNull(projectOption);
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
    Effect.catchCause((cause) => Effect.succeed(respondErrorFromCause(cause))),
  );
});

// ---------------------------------------------------------------------------
// Route layer
// ---------------------------------------------------------------------------

export const managedRunsRouteLayer = Layer.mergeAll(
  HttpRouter.add("GET", API_ROUTE, handleGet),
  HttpRouter.add("POST", API_ROUTE, handlePost),
);
