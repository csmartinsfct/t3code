import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Cause, Effect, Exit, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { z } from "zod";

import type { ManagedRunError, ProjectId, ProjectScript, ThreadId } from "@t3tools/contracts";
import { ManagedRunId, TrimmedNonEmptyString } from "@t3tools/contracts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { ManagedRunService, type ManagedRunServiceShape } from "./Services/ManagedRuns";

const MCP_ROUTE = "/mcp/managed-runs";

// Dev-only bypass token for direct MCP testing. Remove before shipping.
const DEV_BYPASS_TOKEN = process.env.NODE_ENV === "production" ? null : "t3-dev-bypass";

function responseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(response.headers.entries());
}

/**
 * Bridge between MCP SDK async tool callbacks and the Effect fiber.
 * Tool callbacks push work items onto a queue; the Effect fiber polls
 * and executes them, preserving the SQLite connection scope.
 */
type WorkItem = {
  effect: Effect.Effect<unknown, ManagedRunError, never>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

function createEffectBridge() {
  const queue: WorkItem[] = [];
  let waitResolve: (() => void) | null = null;

  return {
    /** Called from MCP tool callbacks (async context) */
    run: <A>(effect: Effect.Effect<A, ManagedRunError, never>): Promise<A> =>
      new Promise<A>((resolve, reject) => {
        queue.push({ effect, resolve: resolve as (v: unknown) => void, reject });
        // Wake up the Effect fiber if it's waiting
        waitResolve?.();
      }),

    /** Called from the Effect fiber to process queued work */
    processAll: Effect.gen(function* () {
      while (queue.length > 0) {
        const item = queue.shift()!;
        const exit = yield* Effect.exit(item.effect);
        Exit.match(exit, {
          onFailure: (cause) => {
            item.reject(Cause.squash(cause));
          },
          onSuccess: (result) => {
            item.resolve(result);
          },
        });
      }
    }),

    /** Wait until a work item is queued or timeout */
    waitForWork: () =>
      new Promise<void>((resolve) => {
        if (queue.length > 0) {
          resolve();
          return;
        }
        waitResolve = resolve;
        // Timeout to avoid infinite hang
        setTimeout(() => {
          waitResolve = null;
          resolve();
        }, 50);
      }),

    pending: () => queue.length,
  };
}

function resolveScript(scripts: ReadonlyArray<ProjectScript>, scriptId: string) {
  return scripts.find((s) => s.id === scriptId);
}

/**
 * Create MCP server with all managed-run tools. Tool callbacks use the bridge
 * to execute Effects in the parent fiber's context.
 */
function createMcpServer(
  managedRuns: ManagedRunServiceShape,
  projectId: ProjectId,
  threadId: ThreadId,
  scripts: ReadonlyArray<ProjectScript>,
  bridge: ReturnType<typeof createEffectBridge>,
) {
  const server = new McpServer(
    { name: "t3-managed-runs", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "launch_project_script",
    {
      title: "Launch Project Script",
      description:
        "Launch a project action/script as a managed run. Use this instead of running long-lived " +
        "services (dev servers, docker compose, watchers, etc.) directly in the terminal. " +
        "The run is tracked by T3 with lifecycle management, URL detection, and log capture. " +
        "Fails if a run for the same script is already active — check list_managed_runs first.",
      inputSchema: {
        scriptId: z
          .string()
          .describe(
            "The ID of the project script to launch (from the project's configured actions).",
          ),
        cwd: z.string().optional().describe("Override working directory for the run."),
      },
    },
    async ({ scriptId, cwd }) => {
      const activeRuns = await bridge.run(managedRuns.list({ projectId }));
      const alreadyRunning = activeRuns.find(
        (r) => r.scriptId === scriptId && (r.status === "starting" || r.status === "running"),
      );
      if (alreadyRunning) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Script '${scriptId}' is already running as managed run '${alreadyRunning.runId}' ` +
                `(status: ${alreadyRunning.status}). ` +
                `Use get_managed_run or get_managed_run_logs to inspect it, or stop_managed_run to restart it.`,
            },
          ],
          isError: true,
        };
      }
      try {
        const result = await bridge.run(
          managedRuns.launchProjectScript({
            projectId,
            threadId,
            scriptId: TrimmedNonEmptyString.makeUnsafe(scriptId),
            ...(cwd ? { cwd: TrimmedNonEmptyString.makeUnsafe(cwd) } : {}),
          }),
        );
        const script = resolveScript(scripts, scriptId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  launched: true,
                  runId: result.run.runId,
                  name: script?.name ?? scriptId,
                  command: script?.command ?? "unknown",
                  status: result.run.status,
                  terminalPid: result.run.terminalPid,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to launch script '${scriptId}': ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list_managed_runs",
    {
      title: "List Managed Runs",
      description:
        "List active managed runs for the current project. Check this before launching a new " +
        "service to avoid duplicates. Use includeHistorical to also see completed/failed/stopped runs.",
      inputSchema: { includeHistorical: z.boolean().optional() },
    },
    async ({ includeHistorical }) => {
      const runs = await bridge.run(
        managedRuns.list({
          projectId,
          ...(includeHistorical !== undefined ? { includeHistorical } : {}),
        }),
      );
      const enriched = runs.map((run) => {
        const script = resolveScript(scripts, run.scriptId);
        return {
          ...run,
          name: script?.name ?? run.scriptId,
          command: script?.command ?? "unknown",
        };
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
    },
  );

  server.registerTool(
    "get_managed_run",
    {
      title: "Get Managed Run",
      description:
        "Read full metadata and evidence for one managed run, including detected URLs and ports.",
      inputSchema: { runId: z.string() },
    },
    async ({ runId }) => {
      const run = await bridge.run(managedRuns.get({ runId: ManagedRunId.makeUnsafe(runId) }));
      const script = resolveScript(scripts, run.scriptId);
      const enriched = {
        ...run,
        name: script?.name ?? run.scriptId,
        command: script?.command ?? "unknown",
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
    },
  );

  server.registerTool(
    "get_managed_run_logs",
    {
      title: "Get Managed Run Logs",
      description:
        "Read timestamped line logs for one managed run. Returns full logs by default; " +
        "use tailLines to get only the most recent N lines.",
      inputSchema: {
        runId: z.string(),
        stream: z.enum(["pty", "stdout", "stderr"]).optional(),
        tailLines: z.number().int().positive().optional(),
      },
    },
    async ({ runId, stream, tailLines }) => {
      const lines = await bridge.run(
        managedRuns.getLogs({
          runId: ManagedRunId.makeUnsafe(runId),
          ...(stream ? { stream } : {}),
          ...(tailLines ? { tailLines } : {}),
        }),
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(lines, null, 2) }] };
    },
  );

  server.registerTool(
    "stop_managed_run",
    {
      title: "Stop Managed Run",
      description: "Stop a managed run that is still under live T3 control.",
      inputSchema: { runId: z.string() },
    },
    async ({ runId }) => {
      await bridge.run(managedRuns.stop({ runId: ManagedRunId.makeUnsafe(runId) }));
      return { content: [{ type: "text" as const, text: JSON.stringify({ stopped: true }) }] };
    },
  );

  server.registerTool(
    "propose_project_script",
    {
      title: "Propose Project Script",
      description:
        "Propose a new project action/script to the user. The user will see an interactive card " +
        "in the chat where they can review, edit, and accept or reject the proposal. " +
        "Use this when you need to start a service but no matching project action exists yet. " +
        "IMPORTANT: After calling this tool, you MUST include a code block in your response " +
        "with the language tag `t3:propose-action` containing the JSON payload returned by this tool. " +
        "The user will see this as an interactive card they can edit and accept. " +
        "Wait for the user's response before taking further action. " +
        "If accepted, you'll see 'Action added: <name> (id: <id>, command: <command>)' " +
        "and can then use launch_project_script to start it. " +
        "Available icons: play, test, lint, configure, build, debug. Default is play.",
      inputSchema: {
        name: z
          .string()
          .describe("Human-readable name for the action (e.g. 'Dev Server', 'Run Tests')."),
        command: z.string().describe("Shell command to run (e.g. 'npm run dev', 'bun test')."),
        icon: z
          .enum(["play", "test", "lint", "configure", "build", "debug"])
          .optional()
          .describe("Icon for the action. Default: play."),
        services: z
          .array(
            z.object({
              name: z.string(),
              healthCheck: z.object({
                type: z.enum(["url", "docker", "port", "command"]),
                url: z.string().optional(),
                container: z.string().optional(),
                port: z.number().int().optional(),
                host: z.string().optional(),
                command: z.string().optional(),
                cwd: z.string().optional(),
              }),
            }),
          )
          .optional()
          .describe("Declared services this command launches, each with a health check."),
      },
    },
    async ({ name, command, icon, services }) => {
      const payload = JSON.stringify({
        name,
        command,
        icon: icon ?? "play",
        ...(services ? { services } : {}),
      });
      return {
        content: [
          {
            type: "text" as const,
            text:
              "To propose this action to the user, include the following code block in your response:\n\n" +
              "```t3:propose-action\n" +
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

const handleManagedRunsMcpRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const managedRuns = yield* ManagedRunService;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const authorization = webRequest.headers.get("authorization");

  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!token) {
    return HttpServerResponse.text("Unauthorized", { status: 401 });
  }

  // Resolve context
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

  // Resolve project scripts
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const readModel = yield* snapshotQuery
    .getSnapshot()
    .pipe(Effect.catch(() => Effect.succeed(null)));
  const project = readModel?.projects.find((p) => p.id === context.projectId);
  const scripts = project?.scripts ?? [];

  // Create bridge + MCP server
  const bridge = createEffectBridge();
  const server = createMcpServer(managedRuns, context.projectId, context.threadId, scripts, bridge);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });

  // Start the MCP request in the background.
  // Tool callbacks call bridge.run() which queues work for the Effect fiber.
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

  // Process bridge work items in this fiber (preserving SQLite connection scope)
  // while waiting for the MCP SDK to finish handling the request
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
      mcp.error instanceof Error ? mcp.error.message : "Failed to serve managed runs MCP request.",
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

export const managedRunsMcpRouteLayer = Layer.mergeAll(
  HttpRouter.add("POST", MCP_ROUTE, handleManagedRunsMcpRequest),
  HttpRouter.add("GET", MCP_ROUTE, handleManagedRunsMcpRequest),
  HttpRouter.add("DELETE", MCP_ROUTE, handleManagedRunsMcpRequest),
);
