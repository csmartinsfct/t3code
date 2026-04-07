import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Cause, Effect, Exit, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { z } from "zod";

import type { TicketingError, ProjectId, ThreadId } from "@t3tools/contracts";
import { TicketId, LabelId, CommentId, ArtifactId } from "@t3tools/contracts";
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

function createTicketingMcpServer(
  ticketing: TicketingServiceShape,
  bridge: ReturnType<typeof createEffectBridge>,
  context: { projectId: ProjectId },
) {
  const server = new McpServer(
    { name: "t3-ticketing", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  // ---- Tickets ----

  server.registerTool(
    "list_tickets",
    {
      title: "List Tickets",
      description: "List tickets for the current project with optional filters.",
      inputSchema: {
        status: z.array(z.string()).optional().describe("Filter by status(es)."),
        priority: z.array(z.string()).optional().describe("Filter by priority(ies)."),
        parentId: z.string().optional().nullable().describe("Filter by parent ticket ID."),
        labelId: z.string().optional().describe("Filter by label ID."),
        search: z.string().optional().describe("Search in title/description/identifier."),
        includeArchived: z.boolean().optional().describe("Include archived tickets."),
        limit: z.number().int().positive().optional().describe("Max results."),
        offset: z.number().int().nonnegative().optional().describe("Offset for pagination."),
      },
    },
    async ({ status, priority, parentId, labelId, search, includeArchived, limit, offset }) => {
      try {
        const tickets = await bridge.run(
          ticketing.list({
            projectId: context.projectId,
            ...(status ? { status: status as never } : {}),
            ...(priority ? { priority: priority as never } : {}),
            ...(parentId !== undefined ? { parentId: (parentId ?? null) as never } : {}),
            ...(labelId ? { labelId: LabelId.makeUnsafe(labelId) } : {}),
            ...(search ? { search } : {}),
            ...(includeArchived !== undefined ? { includeArchived } : {}),
            ...(limit ? { limit } : {}),
            ...(offset ? { offset } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(tickets, null, 2) }] };
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
      description: "Get full details of a ticket by ID.",
      inputSchema: { id: z.string().describe("The ticket ID.") },
    },
    async ({ id }) => {
      try {
        const ticket = await bridge.run(ticketing.getById({ id: TicketId.makeUnsafe(id) }));
        return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
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
        parentId: z.string().optional().describe("Parent ticket ID for sub-tickets."),
        status: z.string().optional().describe("Initial status (default: backlog)."),
        priority: z.string().optional().describe("Priority (default: none)."),
        labelIds: z.array(z.string()).optional().describe("Label IDs to attach."),
        dependencyIds: z.array(z.string()).optional().describe("Ticket IDs this depends on."),
      },
    },
    async ({ title, description, parentId, status, priority, labelIds, dependencyIds }) => {
      try {
        const ticket = await bridge.run(
          ticketing.create({
            projectId: context.projectId,
            title,
            ...(description ? { description } : {}),
            ...(parentId ? { parentId: TicketId.makeUnsafe(parentId) } : {}),
            ...(status ? { status: status as never } : {}),
            ...(priority ? { priority: priority as never } : {}),
            ...(labelIds ? { labelIds: labelIds.map((id) => LabelId.makeUnsafe(id)) } : {}),
            ...(dependencyIds
              ? { dependencyIds: dependencyIds.map((id) => TicketId.makeUnsafe(id)) }
              : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
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
        id: z.string().describe("The ticket ID to update."),
        title: z.string().optional().describe("New title."),
        description: z.string().optional().nullable().describe("New description."),
        status: z.string().optional().describe("New status."),
        priority: z.string().optional().describe("New priority."),
        parentId: z.string().optional().nullable().describe("New parent ticket ID."),
        sortOrder: z.number().optional().describe("New sort order."),
      },
    },
    async ({ id, title, description, status, priority, parentId, sortOrder }) => {
      try {
        const ticket = await bridge.run(
          ticketing.update({
            id: TicketId.makeUnsafe(id),
            ...(title ? { title } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(status ? { status: status as never } : {}),
            ...(priority ? { priority: priority as never } : {}),
            ...(parentId !== undefined
              ? { parentId: parentId ? (TicketId.makeUnsafe(parentId) as never) : null }
              : {}),
            ...(sortOrder !== undefined ? { sortOrder } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
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
      inputSchema: { id: z.string().describe("The ticket ID to delete.") },
    },
    async ({ id }) => {
      try {
        await bridge.run(ticketing.delete({ id: TicketId.makeUnsafe(id) }));
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
        return { content: [{ type: "text" as const, text: JSON.stringify(tickets, null, 2) }] };
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
        rootTicketId: z.string().optional().describe("Optional root ticket ID."),
      },
    },
    async ({ rootTicketId }) => {
      try {
        const tree = await bridge.run(
          ticketing.getTree({
            projectId: context.projectId,
            ...(rootTicketId ? { rootTicketId: TicketId.makeUnsafe(rootTicketId) } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(tree, null, 2) }] };
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
          .describe("Array of {id, sortOrder} pairs."),
      },
    },
    async ({ items }) => {
      try {
        await bridge.run(
          ticketing.reorder({
            items: items.map((i) => ({ id: TicketId.makeUnsafe(i.id), sortOrder: i.sortOrder })),
          }),
        );
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
        ticketId: z.string().describe("The ticket ID."),
        dependsOnTicketIds: z.array(z.string()).describe("Ticket IDs this depends on."),
      },
    },
    async ({ ticketId, dependsOnTicketIds }) => {
      try {
        await bridge.run(
          ticketing.setDependencies({
            ticketId: TicketId.makeUnsafe(ticketId),
            dependsOnTicketIds: dependsOnTicketIds.map((id) => TicketId.makeUnsafe(id)),
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
        ticketId: z.string().describe("The ticket that depends on another."),
        dependsOnTicketId: z.string().describe("The ticket being depended on."),
      },
    },
    async ({ ticketId, dependsOnTicketId }) => {
      try {
        await bridge.run(
          ticketing.addDependency({
            ticketId: TicketId.makeUnsafe(ticketId),
            dependsOnTicketId: TicketId.makeUnsafe(dependsOnTicketId),
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
        ticketId: z.string().describe("The ticket ID."),
        dependsOnTicketId: z.string().describe("The dependency to remove."),
      },
    },
    async ({ ticketId, dependsOnTicketId }) => {
      try {
        await bridge.run(
          ticketing.removeDependency({
            ticketId: TicketId.makeUnsafe(ticketId),
            dependsOnTicketId: TicketId.makeUnsafe(dependsOnTicketId),
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
        ticketId: z.string().describe("The ticket ID."),
        index: z.number().int().nonnegative().describe("Criterion index (0-based)."),
        status: z.enum(["pending", "met", "not_met"]).describe("New status."),
        reason: z.string().optional().describe("Optional reason for the status change."),
      },
    },
    async ({ ticketId, index, status, reason }) => {
      try {
        const ticket = await bridge.run(
          ticketing.updateCriterionStatus({
            ticketId: TicketId.makeUnsafe(ticketId),
            index,
            status,
            ...(reason ? { reason } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
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
        ticketId: z.string().describe("The ticket ID."),
        limit: z.number().int().positive().optional().describe("Max entries."),
      },
    },
    async ({ ticketId, limit }) => {
      try {
        const history = await bridge.run(
          ticketing.getHistory({
            ticketId: TicketId.makeUnsafe(ticketId),
            ...(limit ? { limit } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(history, null, 2) }] };
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
        ticketId: z.string().describe("The ticket ID."),
        labelId: z.string().describe("The label ID."),
      },
    },
    async ({ ticketId, labelId }) => {
      try {
        await bridge.run(
          ticketing.addTicketLabel({
            ticketId: TicketId.makeUnsafe(ticketId),
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
        ticketId: z.string().describe("The ticket ID."),
        labelId: z.string().describe("The label ID."),
      },
    },
    async ({ ticketId, labelId }) => {
      try {
        await bridge.run(
          ticketing.removeTicketLabel({
            ticketId: TicketId.makeUnsafe(ticketId),
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
        ticketId: z.string().describe("The ticket ID."),
        limit: z.number().int().positive().optional().describe("Max comments."),
      },
    },
    async ({ ticketId, limit }) => {
      try {
        const comments = await bridge.run(
          ticketing.listComments({
            ticketId: TicketId.makeUnsafe(ticketId),
            ...(limit ? { limit } : {}),
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(comments, null, 2) }] };
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
        ticketId: z.string().describe("The ticket ID."),
        parentId: z.string().optional().describe("Parent comment ID for threaded replies."),
        authorType: z.enum(["human", "llm"]).describe("Author type."),
        authorName: z.string().describe("Author display name."),
        authorModel: z.string().optional().describe("Model name if authorType is 'llm'."),
        body: z.string().describe("Comment body text."),
      },
    },
    async ({ ticketId, parentId, authorType, authorName, authorModel, body }) => {
      try {
        const comment = await bridge.run(
          ticketing.createComment({
            ticketId: TicketId.makeUnsafe(ticketId),
            ...(parentId ? { parentId: CommentId.makeUnsafe(parentId) } : {}),
            authorType,
            authorName,
            ...(authorModel ? { authorModel } : {}),
            body,
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(comment, null, 2) }] };
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
        return { content: [{ type: "text" as const, text: JSON.stringify(comment, null, 2) }] };
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
      inputSchema: { ticketId: z.string().describe("The ticket ID.") },
    },
    async ({ ticketId }) => {
      try {
        const artifacts = await bridge.run(
          ticketing.listArtifacts({ ticketId: TicketId.makeUnsafe(ticketId) }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(artifacts, null, 2) }] };
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
          .describe("The ticket ID (mutually exclusive with commentId)."),
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
        const artifact = await bridge.run(
          ticketing.createArtifact({
            ...(ticketId ? { ticketId: TicketId.makeUnsafe(ticketId) } : {}),
            ...(commentId ? { commentId: CommentId.makeUnsafe(commentId) } : {}),
            type,
            ...(title ? { title } : {}),
            payload,
          }),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(artifact, null, 2) }] };
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
