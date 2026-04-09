import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Cause, Effect, Exit, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { z } from "zod";

import type { TicketingError, ProjectId, ThreadId } from "@t3tools/contracts";
import { LabelId, CommentId, ArtifactId } from "@t3tools/contracts";
import { ManagedRunService } from "../managedRuns/Services/ManagedRuns";
import { TicketingService, type TicketingServiceShape } from "./Services/Ticketing";

const MCP_ROUTE = "/mcp/ticketing";

const DEV_BYPASS_TOKEN = process.env.NODE_ENV === "production" ? null : "t3-dev-bypass";

function responseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(response.headers.entries());
}

type WorkItem = {
  effect: Effect.Effect<unknown, TicketingError, never>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

function createEffectBridge() {
  const queue: WorkItem[] = [];
  let waitResolve: (() => void) | null = null;

  return {
    run: <A>(effect: Effect.Effect<A, TicketingError, never>): Promise<A> =>
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

// ---------------------------------------------------------------------------
// MCP response transformation — strip ticket UUIDs, use identifiers
// ---------------------------------------------------------------------------

type IdMap = ReadonlyMap<string, string>;

/** Collect ticket UUIDs referenced by ticket-like objects that need identifier resolution. */
function collectTicketUuids(obj: unknown): string[] {
  const uuids: string[] = [];
  if (!obj || typeof obj !== "object") return uuids;
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    const o = v as Record<string, unknown>;
    // Ticket / TicketSummary — has identifier + id
    if (typeof o.id === "string" && typeof o.identifier === "string") {
      uuids.push(o.id);
      if (typeof o.parentId === "string") uuids.push(o.parentId);
    }
    // TicketDependency — has ticketId + dependsOnTicketId
    if (typeof o.ticketId === "string" && typeof o.dependsOnTicketId === "string") {
      uuids.push(o.ticketId, o.dependsOnTicketId);
    }
    // Comment / Artifact / HistoryEntry — has ticketId but not dependsOnTicketId
    if (typeof o.ticketId === "string" && !("dependsOnTicketId" in o)) {
      uuids.push(o.ticketId);
    }
    // Recurse into known container fields
    for (const key of [
      "subTickets",
      "dependencies",
      "comments",
      "artifacts",
      "children",
      "ticket",
    ]) {
      if (key in o) walk(o[key]);
    }
  };
  walk(obj);
  return uuids;
}

/** Transform a response to replace ticket UUIDs with identifiers for MCP output. */
function transformForMcp(obj: unknown, idMap: IdMap): unknown {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((item) => transformForMcp(item, idMap));

  const o = obj as Record<string, unknown>;

  // TicketTreeNode — has { ticket, children, dependencies }
  if ("ticket" in o && "children" in o && "dependencies" in o) {
    return {
      ticket: transformForMcp(o.ticket, idMap),
      children: transformForMcp(o.children, idMap),
      dependencies: transformForMcp(o.dependencies, idMap),
    };
  }

  // Ticket / TicketSummary — has identifier + id
  if (typeof o.id === "string" && typeof o.identifier === "string") {
    const { id: _id, projectId: _pid, ticketNumber: _tn, parentId, ...rest } = o;
    const result: Record<string, unknown> = {
      ...rest,
      parentIdentifier: typeof parentId === "string" ? (idMap.get(parentId) ?? parentId) : null,
    };
    // Recurse into nested fields
    for (const key of ["subTickets", "dependencies", "comments", "artifacts"]) {
      if (key in result) result[key] = transformForMcp(result[key], idMap);
    }
    return result;
  }

  // TicketDependency — has ticketId + dependsOnTicketId
  if (typeof o.ticketId === "string" && typeof o.dependsOnTicketId === "string") {
    return {
      identifier: idMap.get(o.ticketId) ?? o.ticketId,
      dependsOnIdentifier: idMap.get(o.dependsOnTicketId) ?? o.dependsOnTicketId,
      title: o.title,
      status: o.status,
    };
  }

  // Comment — has ticketId + body
  if (typeof o.ticketId === "string" && typeof o.body === "string") {
    const { ticketId, ...rest } = o;
    return { ...rest, ticketIdentifier: idMap.get(ticketId) ?? ticketId };
  }

  // Artifact — has ticketId + type + payload
  if ("ticketId" in o && typeof o.type === "string" && "payload" in o) {
    const { ticketId, ...rest } = o;
    if (typeof ticketId === "string") {
      return { ...rest, ticketIdentifier: idMap.get(ticketId) ?? ticketId };
    }
    return rest;
  }

  // HistoryEntry — has ticketId + action + changes
  if (typeof o.ticketId === "string" && typeof o.action === "string" && "changes" in o) {
    const { ticketId, ...rest } = o;
    return { ...rest, ticketIdentifier: idMap.get(ticketId) ?? ticketId };
  }

  return obj;
}

function createTicketingMcpServer(
  ticketing: TicketingServiceShape,
  bridge: ReturnType<typeof createEffectBridge>,
  context: { projectId: ProjectId },
) {
  const server = new McpServer(
    { name: "t3-ticketing", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  /** Resolve a ticket UUID or human-readable identifier (e.g. "ZBD-7") to the canonical TicketId. */
  const resolve = (idOrIdentifier: string) => bridge.run(ticketing.resolveId(idOrIdentifier));

  /** Resolve identifiers and transform a response object for MCP output. */
  async function mcpJson(response: unknown): Promise<string> {
    const uuids = collectTicketUuids(response);
    // Batch-resolve any ticket UUIDs we haven't seen
    const unique = [...new Set(uuids)].filter(Boolean);
    const idMap: IdMap =
      unique.length > 0
        ? await bridge.run(ticketing.resolveIdentifiers(unique))
        : new Map<string, string>();
    return JSON.stringify(transformForMcp(response, idMap), null, 2);
  }

  // ---- Tickets ----

  server.registerTool(
    "list_tickets",
    {
      title: "List Tickets",
      description: "List tickets for the current project with optional filters.",
      inputSchema: {
        status: z
          .array(
            z.enum(["backlog", "todo", "in_progress", "blocked", "in_review", "done", "canceled"]),
          )
          .optional()
          .describe("Filter by status(es)."),
        priority: z
          .array(z.enum(["none", "low", "medium", "high", "urgent"]))
          .optional()
          .describe("Filter by priority(ies)."),
        parentId: z
          .string()
          .optional()
          .nullable()
          .describe("Filter by parent ticket identifier (e.g. 'ZBD-7')."),
        labelId: z.string().optional().describe("Filter by label ID."),
        search: z.string().optional().describe("Search in title/description/identifier."),
        includeArchived: z.boolean().optional().describe("Include archived tickets."),
        limit: z.number().int().positive().optional().describe("Max results."),
        offset: z.number().int().nonnegative().optional().describe("Offset for pagination."),
      },
    },
    async ({ status, priority, parentId, labelId, search, includeArchived, limit, offset }) => {
      try {
        const resolvedParentId =
          parentId !== undefined
            ? parentId
              ? ((await resolve(parentId)) as never)
              : (null as never)
            : undefined;
        const tickets = await bridge.run(
          ticketing.list({
            projectId: context.projectId,
            ...(status ? { status: status as never } : {}),
            ...(priority ? { priority: priority as never } : {}),
            ...(resolvedParentId !== undefined ? { parentId: resolvedParentId } : {}),
            ...(labelId ? { labelId: LabelId.makeUnsafe(labelId) } : {}),
            ...(search ? { search } : {}),
            ...(includeArchived !== undefined ? { includeArchived } : {}),
            ...(limit ? { limit } : {}),
            ...(offset ? { offset } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: await mcpJson(tickets) }] };
      } catch (error) {
        return mcpError(
          `Failed to list tickets: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "get_ticket",
    {
      title: "Get Ticket",
      description: "Get full details of a ticket by ID or identifier (e.g. 'ZBD-7').",
      inputSchema: {
        id: z.string().describe("The ticket identifier (e.g. 'ZBD-7')."),
      },
    },
    async ({ id }) => {
      try {
        const resolved = await resolve(id);
        const ticket = await bridge.run(
          ticketing.getById({ id: resolved, projectId: context.projectId }),
        );
        return { content: [{ type: "text" as const, text: await mcpJson(ticket) }] };
      } catch (error) {
        return mcpError(
          `Failed to get ticket '${id}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "create_ticket",
    {
      title: "Create Ticket",
      description: "Create a new ticket in the current project.",
      inputSchema: {
        title: z.string().describe("Ticket title."),
        description: z.string().optional().describe("Ticket description."),
        parentId: z
          .string()
          .optional()
          .describe("Parent ticket identifier (e.g. 'ZBD-7') for sub-tickets."),
        status: z
          .enum(["backlog", "todo", "in_progress", "blocked", "in_review", "done", "canceled"])
          .optional()
          .describe("Initial status (default: backlog)."),
        priority: z
          .enum(["none", "low", "medium", "high", "urgent"])
          .optional()
          .describe("Priority (default: none)."),
        labelIds: z.array(z.string()).optional().describe("Label IDs to attach."),
        dependencyIds: z
          .array(z.string())
          .optional()
          .describe("Ticket IDs or identifiers this depends on."),
        worktree: z
          .string()
          .optional()
          .describe("Git worktree/branch name for isolated development."),
        acceptanceCriteria: z
          .array(
            z.object({
              text: z.string().describe("Criterion text."),
              status: z
                .enum(["pending", "met", "not_met"])
                .optional()
                .default("pending")
                .describe("Initial status (default: pending)."),
            }),
          )
          .optional()
          .describe("Acceptance criteria for the ticket."),
        implementerModel: z
          .object({
            provider: z.enum(["codex", "claudeAgent"]).describe("Provider kind."),
            model: z.string().describe("Model slug."),
            profileId: z.string().optional().describe("Claude profile ID (if applicable)."),
          })
          .optional()
          .describe("Optional model override for the implementer agent during orchestration."),
        reviewerModel: z
          .object({
            provider: z.enum(["codex", "claudeAgent"]).describe("Provider kind."),
            model: z.string().describe("Model slug."),
            profileId: z.string().optional().describe("Claude profile ID (if applicable)."),
          })
          .optional()
          .describe("Optional model override for the reviewer agent during orchestration."),
      },
    },
    async ({
      title,
      description,
      parentId,
      status,
      priority,
      labelIds,
      dependencyIds,
      worktree,
      acceptanceCriteria,
      implementerModel,
      reviewerModel,
    }) => {
      try {
        const resolvedParentId = parentId ? await resolve(parentId) : undefined;
        const resolvedDepIds = dependencyIds
          ? await Promise.all(dependencyIds.map(resolve))
          : undefined;
        const ticket = await bridge.run(
          ticketing.create({
            projectId: context.projectId,
            title,
            ...(description ? { description } : {}),
            ...(resolvedParentId ? { parentId: resolvedParentId } : {}),
            ...(status ? { status: status as never } : {}),
            ...(priority ? { priority: priority as never } : {}),
            ...(labelIds ? { labelIds: labelIds.map((id) => LabelId.makeUnsafe(id)) } : {}),
            ...(resolvedDepIds ? { dependencyIds: resolvedDepIds } : {}),
            ...(worktree ? { worktree } : {}),
            ...(acceptanceCriteria
              ? {
                  acceptanceCriteria: acceptanceCriteria.map((c) => ({
                    text: c.text,
                    status: c.status ?? ("pending" as const),
                    reason: null,
                    verifiedBy: null,
                    verifiedAt: null,
                  })),
                }
              : {}),
            ...(implementerModel ? { implementerModelOverride: implementerModel as never } : {}),
            ...(reviewerModel ? { reviewerModelOverride: reviewerModel as never } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: await mcpJson(ticket) }] };
      } catch (error) {
        return mcpError(
          `Failed to create ticket: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "update_ticket",
    {
      title: "Update Ticket",
      description: "Update an existing ticket.",
      inputSchema: {
        id: z.string().describe("The ticket identifier (e.g. 'ZBD-7') to update."),
        title: z.string().optional().describe("New title."),
        description: z.string().optional().nullable().describe("New description."),
        status: z
          .enum(["backlog", "todo", "in_progress", "blocked", "in_review", "done", "canceled"])
          .optional()
          .describe("New status."),
        priority: z
          .enum(["none", "low", "medium", "high", "urgent"])
          .optional()
          .describe("New priority."),
        parentId: z
          .string()
          .optional()
          .nullable()
          .describe("New parent ticket identifier (e.g. 'ZBD-7')."),
        sortOrder: z.number().optional().describe("New sort order."),
        worktree: z
          .string()
          .optional()
          .nullable()
          .describe("Git worktree/branch name. Set to null to clear."),
        acceptanceCriteria: z
          .array(
            z.object({
              text: z.string().describe("Criterion text."),
              status: z
                .enum(["pending", "met", "not_met"])
                .optional()
                .default("pending")
                .describe("Status (default: pending)."),
            }),
          )
          .optional()
          .nullable()
          .describe("Replace acceptance criteria. Pass null to clear."),
        implementerModel: z
          .object({
            provider: z.enum(["codex", "claudeAgent"]).describe("Provider kind."),
            model: z.string().describe("Model slug."),
            profileId: z.string().optional().describe("Claude profile ID (if applicable)."),
          })
          .optional()
          .nullable()
          .describe("Model override for the implementer agent. Pass null to clear."),
        reviewerModel: z
          .object({
            provider: z.enum(["codex", "claudeAgent"]).describe("Provider kind."),
            model: z.string().describe("Model slug."),
            profileId: z.string().optional().describe("Claude profile ID (if applicable)."),
          })
          .optional()
          .nullable()
          .describe("Model override for the reviewer agent. Pass null to clear."),
      },
    },
    async ({
      id,
      title,
      description,
      status,
      priority,
      parentId,
      sortOrder,
      worktree,
      acceptanceCriteria,
      implementerModel,
      reviewerModel,
    }) => {
      try {
        const resolvedId = await resolve(id);
        const resolvedParentId =
          parentId !== undefined
            ? parentId
              ? ((await resolve(parentId)) as never)
              : null
            : undefined;
        const mappedCriteria =
          acceptanceCriteria !== undefined
            ? acceptanceCriteria
              ? acceptanceCriteria.map((c) => ({
                  text: c.text,
                  status: c.status ?? ("pending" as const),
                  reason: null,
                  verifiedBy: null,
                  verifiedAt: null,
                }))
              : null
            : undefined;
        const ticket = await bridge.run(
          ticketing.update({
            id: resolvedId,
            ...(title ? { title } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(status ? { status: status as never } : {}),
            ...(priority ? { priority: priority as never } : {}),
            ...(resolvedParentId !== undefined ? { parentId: resolvedParentId } : {}),
            ...(sortOrder !== undefined ? { sortOrder } : {}),
            ...(worktree !== undefined ? { worktree } : {}),
            ...(mappedCriteria !== undefined ? { acceptanceCriteria: mappedCriteria } : {}),
            ...(implementerModel !== undefined
              ? { implementerModelOverride: implementerModel as never }
              : {}),
            ...(reviewerModel !== undefined
              ? { reviewerModelOverride: reviewerModel as never }
              : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: await mcpJson(ticket) }] };
      } catch (error) {
        return mcpError(
          `Failed to update ticket '${id}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "delete_ticket",
    {
      title: "Delete Ticket",
      description: "Delete a ticket and all its data.",
      inputSchema: {
        id: z.string().describe("The ticket identifier (e.g. 'ZBD-7') to delete."),
      },
    },
    async ({ id }) => {
      try {
        const resolvedId = await resolve(id);
        await bridge.run(ticketing.delete({ id: resolvedId }));
        return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true }) }] };
      } catch (error) {
        return mcpError(
          `Failed to delete ticket '${id}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "search_tickets",
    {
      title: "Search Tickets",
      description: "Search tickets by text query.",
      inputSchema: {
        query: z.string().describe("Search query."),
        limit: z.number().int().positive().optional().describe("Max results."),
      },
    },
    async ({ query, limit }) => {
      try {
        const tickets = await bridge.run(
          ticketing.search({
            projectId: context.projectId,
            query,
            ...(limit ? { limit } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: await mcpJson(tickets) }] };
      } catch (error) {
        return mcpError(
          `Failed to search tickets: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "get_ticket_tree",
    {
      title: "Get Ticket Tree",
      description: "Get hierarchical tree of tickets for the current project.",
      inputSchema: {
        rootTicketId: z
          .string()
          .optional()
          .describe("Optional root ticket identifier (e.g. 'ZBD-7')."),
      },
    },
    async ({ rootTicketId }) => {
      try {
        const resolvedRoot = rootTicketId ? await resolve(rootTicketId) : undefined;
        const tree = await bridge.run(
          ticketing.getTree({
            projectId: context.projectId,
            ...(resolvedRoot ? { rootTicketId: resolvedRoot } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: await mcpJson(tree) }] };
      } catch (error) {
        return mcpError(
          `Failed to get ticket tree: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "reorder_tickets",
    {
      title: "Reorder Tickets",
      description: "Reorder tickets by setting sort order values.",
      inputSchema: {
        items: z
          .array(z.object({ id: z.string(), sortOrder: z.number() }))
          .describe("Array of {id or identifier, sortOrder} pairs."),
      },
    },
    async ({ items }) => {
      try {
        const resolved = await Promise.all(
          items.map(async (i) => ({ id: await resolve(i.id), sortOrder: i.sortOrder })),
        );
        await bridge.run(ticketing.reorder({ items: resolved }));
        return { content: [{ type: "text" as const, text: JSON.stringify({ reordered: true }) }] };
      } catch (error) {
        return mcpError(
          `Failed to reorder tickets: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  // ---- Dependencies ----

  server.registerTool(
    "set_ticket_dependencies",
    {
      title: "Set Ticket Dependencies",
      description: "Replace all dependencies for a ticket.",
      inputSchema: {
        ticketId: z.string().describe("The ticket identifier (e.g. 'ZBD-7')."),
        dependsOnTicketIds: z
          .array(z.string())
          .describe("Ticket identifiers this depends on (e.g. 'ZBD-7')."),
      },
    },
    async ({ ticketId, dependsOnTicketIds }) => {
      try {
        const resolvedTicketId = await resolve(ticketId);
        const resolvedDepIds = await Promise.all(dependsOnTicketIds.map(resolve));
        await bridge.run(
          ticketing.setDependencies({
            ticketId: resolvedTicketId,
            dependsOnTicketIds: resolvedDepIds,
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify({ updated: true }) }] };
      } catch (error) {
        return mcpError(
          `Failed to set dependencies: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "add_ticket_dependency",
    {
      title: "Add Ticket Dependency",
      description: "Add a dependency between two tickets.",
      inputSchema: {
        ticketId: z.string().describe("The ticket identifier (e.g. 'ZBD-7')."),
        dependsOnTicketId: z.string().describe("The dependency identifier (e.g. 'ZBD-7')."),
      },
    },
    async ({ ticketId, dependsOnTicketId }) => {
      try {
        const resolvedTicketId = await resolve(ticketId);
        const resolvedDepId = await resolve(dependsOnTicketId);
        await bridge.run(
          ticketing.addDependency({
            ticketId: resolvedTicketId,
            dependsOnTicketId: resolvedDepId,
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify({ added: true }) }] };
      } catch (error) {
        return mcpError(
          `Failed to add dependency: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "remove_ticket_dependency",
    {
      title: "Remove Ticket Dependency",
      description: "Remove a dependency between two tickets.",
      inputSchema: {
        ticketId: z.string().describe("The ticket identifier (e.g. 'ZBD-7')."),
        dependsOnTicketId: z.string().describe("The dependency identifier (e.g. 'ZBD-7')."),
      },
    },
    async ({ ticketId, dependsOnTicketId }) => {
      try {
        const resolvedTicketId = await resolve(ticketId);
        const resolvedDepId = await resolve(dependsOnTicketId);
        await bridge.run(
          ticketing.removeDependency({
            ticketId: resolvedTicketId,
            dependsOnTicketId: resolvedDepId,
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify({ removed: true }) }] };
      } catch (error) {
        return mcpError(
          `Failed to remove dependency: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  // ---- Criteria ----

  server.registerTool(
    "update_criterion_status",
    {
      title: "Update Acceptance Criterion Status",
      description: "Update the status of an acceptance criterion on a ticket.",
      inputSchema: {
        ticketId: z.string().describe("The ticket identifier (e.g. 'ZBD-7')."),
        index: z.number().int().nonnegative().describe("Criterion index (0-based)."),
        status: z.enum(["pending", "met", "not_met"]).describe("New status."),
        reason: z.string().optional().describe("Optional reason for the status change."),
      },
    },
    async ({ ticketId, index, status, reason }) => {
      try {
        const resolvedTicketId = await resolve(ticketId);
        const ticket = await bridge.run(
          ticketing.updateCriterionStatus({
            ticketId: resolvedTicketId,
            index,
            status,
            ...(reason ? { reason } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: await mcpJson(ticket) }] };
      } catch (error) {
        return mcpError(
          `Failed to update criterion: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  // ---- History ----

  server.registerTool(
    "get_ticket_history",
    {
      title: "Get Ticket History",
      description: "Get audit history for a ticket.",
      inputSchema: {
        ticketId: z.string().describe("The ticket identifier (e.g. 'ZBD-7')."),
        limit: z.number().int().positive().optional().describe("Max entries."),
      },
    },
    async ({ ticketId, limit }) => {
      try {
        const resolvedTicketId = await resolve(ticketId);
        const history = await bridge.run(
          ticketing.getHistory({
            ticketId: resolvedTicketId,
            ...(limit ? { limit } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: await mcpJson(history) }] };
      } catch (error) {
        return mcpError(
          `Failed to get history: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  // ---- Labels ----

  server.registerTool(
    "list_labels",
    {
      title: "List Labels",
      description: "List all labels for the current project.",
      inputSchema: {},
    },
    async () => {
      try {
        const labels = await bridge.run(ticketing.listLabels({ projectId: context.projectId }));
        return { content: [{ type: "text" as const, text: JSON.stringify(labels, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to list labels: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "create_label",
    {
      title: "Create Label",
      description: "Create a new label for the current project.",
      inputSchema: {
        name: z.string().describe("Label name."),
        color: z.string().describe("Label color (hex, e.g. #ff0000)."),
      },
    },
    async ({ name, color }) => {
      try {
        const label = await bridge.run(
          ticketing.createLabel({ projectId: context.projectId, name, color }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(label, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to create label: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "update_label",
    {
      title: "Update Label",
      description: "Update an existing label.",
      inputSchema: {
        id: z.string().describe("The label ID."),
        name: z.string().optional().describe("New name."),
        color: z.string().optional().describe("New color."),
      },
    },
    async ({ id, name, color }) => {
      try {
        const label = await bridge.run(
          ticketing.updateLabel({
            id: LabelId.makeUnsafe(id),
            ...(name ? { name } : {}),
            ...(color ? { color } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(label, null, 2) }] };
      } catch (error) {
        return mcpError(
          `Failed to update label '${id}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "delete_label",
    {
      title: "Delete Label",
      description: "Delete a label.",
      inputSchema: { id: z.string().describe("The label ID.") },
    },
    async ({ id }) => {
      try {
        await bridge.run(ticketing.deleteLabel({ id: LabelId.makeUnsafe(id) }));
        return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true }) }] };
      } catch (error) {
        return mcpError(
          `Failed to delete label '${id}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "add_ticket_label",
    {
      title: "Add Label to Ticket",
      description: "Add a label to a ticket.",
      inputSchema: {
        ticketId: z.string().describe("The ticket identifier (e.g. 'ZBD-7')."),
        labelId: z.string().describe("The label ID."),
      },
    },
    async ({ ticketId, labelId }) => {
      try {
        const resolvedTicketId = await resolve(ticketId);
        await bridge.run(
          ticketing.addTicketLabel({
            ticketId: resolvedTicketId,
            labelId: LabelId.makeUnsafe(labelId),
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify({ added: true }) }] };
      } catch (error) {
        return mcpError(
          `Failed to add label: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "remove_ticket_label",
    {
      title: "Remove Label from Ticket",
      description: "Remove a label from a ticket.",
      inputSchema: {
        ticketId: z.string().describe("The ticket identifier (e.g. 'ZBD-7')."),
        labelId: z.string().describe("The label ID."),
      },
    },
    async ({ ticketId, labelId }) => {
      try {
        const resolvedTicketId = await resolve(ticketId);
        await bridge.run(
          ticketing.removeTicketLabel({
            ticketId: resolvedTicketId,
            labelId: LabelId.makeUnsafe(labelId),
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify({ removed: true }) }] };
      } catch (error) {
        return mcpError(
          `Failed to remove label: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  // ---- Comments ----

  server.registerTool(
    "list_ticket_comments",
    {
      title: "List Ticket Comments",
      description: "List comments on a ticket.",
      inputSchema: {
        ticketId: z.string().describe("The ticket identifier (e.g. 'ZBD-7')."),
        limit: z.number().int().positive().optional().describe("Max comments."),
      },
    },
    async ({ ticketId, limit }) => {
      try {
        const resolvedTicketId = await resolve(ticketId);
        const comments = await bridge.run(
          ticketing.listComments({
            ticketId: resolvedTicketId,
            ...(limit ? { limit } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: await mcpJson(comments) }] };
      } catch (error) {
        return mcpError(
          `Failed to list comments: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "create_comment",
    {
      title: "Create Comment",
      description: "Add a comment to a ticket.",
      inputSchema: {
        ticketId: z.string().describe("The ticket identifier (e.g. 'ZBD-7')."),
        parentId: z.string().optional().describe("Parent comment ID for threaded replies."),
        authorType: z.enum(["human", "llm"]).describe("Author type."),
        authorName: z.string().describe("Author display name."),
        authorModel: z.string().optional().describe("Model name if authorType is 'llm'."),
        body: z.string().describe("Comment body text."),
      },
    },
    async ({ ticketId, parentId, authorType, authorName, authorModel, body }) => {
      try {
        const resolvedTicketId = await resolve(ticketId);
        const comment = await bridge.run(
          ticketing.createComment({
            ticketId: resolvedTicketId,
            ...(parentId ? { parentId: CommentId.makeUnsafe(parentId) } : {}),
            authorType,
            authorName,
            ...(authorModel ? { authorModel } : {}),
            body,
          }),
        );
        return { content: [{ type: "text" as const, text: await mcpJson(comment) }] };
      } catch (error) {
        return mcpError(
          `Failed to create comment: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "update_comment",
    {
      title: "Update Comment",
      description: "Update a comment's body.",
      inputSchema: {
        id: z.string().describe("The comment ID."),
        body: z.string().describe("New body text."),
      },
    },
    async ({ id, body }) => {
      try {
        const comment = await bridge.run(
          ticketing.updateComment({ id: CommentId.makeUnsafe(id), body }),
        );
        return { content: [{ type: "text" as const, text: await mcpJson(comment) }] };
      } catch (error) {
        return mcpError(
          `Failed to update comment '${id}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "delete_comment",
    {
      title: "Delete Comment",
      description: "Delete a comment.",
      inputSchema: { id: z.string().describe("The comment ID.") },
    },
    async ({ id }) => {
      try {
        await bridge.run(ticketing.deleteComment({ id: CommentId.makeUnsafe(id) }));
        return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true }) }] };
      } catch (error) {
        return mcpError(
          `Failed to delete comment '${id}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  // ---- Artifacts ----

  server.registerTool(
    "list_ticket_artifacts",
    {
      title: "List Ticket Artifacts",
      description: "List artifacts attached to a ticket.",
      inputSchema: {
        ticketId: z.string().describe("The ticket identifier (e.g. 'ZBD-7')."),
      },
    },
    async ({ ticketId }) => {
      try {
        const resolvedTicketId = await resolve(ticketId);
        const artifacts = await bridge.run(ticketing.listArtifacts({ ticketId: resolvedTicketId }));
        return { content: [{ type: "text" as const, text: await mcpJson(artifacts) }] };
      } catch (error) {
        return mcpError(
          `Failed to list artifacts: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "create_artifact",
    {
      title: "Create Artifact",
      description: "Attach an artifact to a ticket or comment.",
      inputSchema: {
        ticketId: z
          .string()
          .optional()
          .describe("The ticket identifier (e.g. 'ZBD-7'). Mutually exclusive with commentId."),
        commentId: z
          .string()
          .optional()
          .describe("The comment ID (mutually exclusive with ticketId)."),
        type: z.enum(["figma_url", "mermaid", "image"]).describe("Artifact type."),
        title: z.string().optional().describe("Display title."),
        payload: z
          .any()
          .describe(
            "Type-specific payload (e.g. {url} for figma_url, {source} for mermaid, {url, alt} for image).",
          ),
      },
    },
    async ({ ticketId, commentId, type, title, payload }) => {
      try {
        const resolvedTicketId = ticketId ? await resolve(ticketId) : undefined;
        const artifact = await bridge.run(
          ticketing.createArtifact({
            ...(resolvedTicketId ? { ticketId: resolvedTicketId } : {}),
            ...(commentId ? { commentId: CommentId.makeUnsafe(commentId) } : {}),
            type,
            ...(title ? { title } : {}),
            payload,
          }),
        );
        return { content: [{ type: "text" as const, text: await mcpJson(artifact) }] };
      } catch (error) {
        return mcpError(
          `Failed to create artifact: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "delete_artifact",
    {
      title: "Delete Artifact",
      description: "Delete an artifact.",
      inputSchema: { id: z.string().describe("The artifact ID.") },
    },
    async ({ id }) => {
      try {
        await bridge.run(ticketing.deleteArtifact({ id: ArtifactId.makeUnsafe(id) }));
        return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true }) }] };
      } catch (error) {
        return mcpError(
          `Failed to delete artifact '${id}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  return server;
}

const handleTicketingMcpRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const managedRuns = yield* ManagedRunService;
  const ticketing = yield* TicketingService;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const authorization = webRequest.headers.get("authorization");

  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!token) {
    return HttpServerResponse.text("Unauthorized", { status: 401 });
  }

  let mcpContext: { projectId: ProjectId; threadId: ThreadId } | null = null;
  if (DEV_BYPASS_TOKEN && token === DEV_BYPASS_TOKEN) {
    const url = new URL(webRequest.url, "http://localhost");
    const projectId = url.searchParams.get("projectId");
    const threadId = url.searchParams.get("threadId") ?? "dev-test-thread";
    if (projectId) {
      mcpContext = { projectId: projectId as ProjectId, threadId: threadId as ThreadId };
    }
  }
  if (!mcpContext) {
    mcpContext = yield* managedRuns.resolveContextForToken(token);
  }
  if (mcpContext === null) {
    return HttpServerResponse.text("Unauthorized", { status: 401 });
  }

  const bridge = createEffectBridge();
  const server = createTicketingMcpServer(ticketing, bridge, {
    projectId: mcpContext.projectId,
  });
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
      mcp.error instanceof Error ? mcp.error.message : "Failed to serve ticketing MCP request.",
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

export const ticketingMcpRouteLayer = Layer.mergeAll(
  HttpRouter.add("POST", MCP_ROUTE, handleTicketingMcpRequest),
  HttpRouter.add("GET", MCP_ROUTE, handleTicketingMcpRequest),
  HttpRouter.add("DELETE", MCP_ROUTE, handleTicketingMcpRequest),
);
