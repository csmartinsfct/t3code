import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import type { ProjectId, TicketingError, ThreadId } from "@t3tools/contracts";
import { LabelId, CommentId, ArtifactId, TemplateId } from "@t3tools/contracts";
import {
  parseToolCallBody,
  resolveAuth,
  respondError,
  respondErrorFromCause,
  respondOk,
  type ToolDefinition,
} from "../restResponse";
import { TicketingService, type TicketingServiceShape } from "./Services/Ticketing";

const API_ROUTE = "/api/ticketing";

// ---------------------------------------------------------------------------
// Business-logic helpers
// ---------------------------------------------------------------------------

export const TICKET_CHAT_LINK_REMINDER =
  "When referencing a ticket in chat, use markdown like `[ZBD-7](t3://ticket/ZBD-7)`.";
export const TICKET_TOOL_NAMES_WITH_CHAT_LINK_REMINDER = [
  "list_tickets",
  "get_ticket",
  "create_ticket",
  "update_ticket",
  "search_tickets",
  "get_ticket_tree",
  "create_comment",
] as const;

export function withTicketChatLinkReminder(description: string): string {
  return `${description} ${TICKET_CHAT_LINK_REMINDER}`;
}

// ---------------------------------------------------------------------------
// Response transformation — strip ticket UUIDs, use identifiers
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

/** Transform a response to replace ticket UUIDs with identifiers for output. */
function transformForResponse(obj: unknown, idMap: IdMap): unknown {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((item) => transformForResponse(item, idMap));

  const o = obj as Record<string, unknown>;

  // TicketTreeNode — has { ticket, children, dependencies }
  if ("ticket" in o && "children" in o && "dependencies" in o) {
    return {
      ticket: transformForResponse(o.ticket, idMap),
      children: transformForResponse(o.children, idMap),
      dependencies: transformForResponse(o.dependencies, idMap),
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
      if (key in result) result[key] = transformForResponse(result[key], idMap);
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

// ---------------------------------------------------------------------------
// Tool definitions (for GET discovery)
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ---- Tickets ----
  {
    name: "list_tickets",
    title: "List Tickets",
    description: withTicketChatLinkReminder(
      "List tickets for the current project with optional filters.",
    ),
    inputSchema: {
      status: {
        type: "array",
        optional: true,
        items: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "blocked", "in_review", "done", "canceled"],
        },
        description: "Filter by status(es).",
      },
      priority: {
        type: "array",
        optional: true,
        items: { type: "string", enum: ["none", "low", "medium", "high", "urgent"] },
        description: "Filter by priority(ies).",
      },
      parentId: {
        type: "string",
        optional: true,
        nullable: true,
        description: "Filter by parent ticket identifier (e.g. 'ZBD-7').",
      },
      labelId: { type: "string", optional: true, description: "Filter by label ID." },
      search: {
        type: "string",
        optional: true,
        description: "Search in title/description/identifier.",
      },
      includeArchived: {
        type: "boolean",
        optional: true,
        description: "Include archived tickets.",
      },
      limit: { type: "number", optional: true, description: "Max results." },
      offset: { type: "number", optional: true, description: "Offset for pagination." },
    },
  },
  {
    name: "get_ticket",
    title: "Get Ticket",
    description: withTicketChatLinkReminder(
      "Get full details of a ticket by ID or identifier (e.g. 'ZBD-7').",
    ),
    inputSchema: {
      ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7')." },
    },
  },
  {
    name: "create_ticket",
    title: "Create Ticket",
    description: withTicketChatLinkReminder(
      "Create a new ticket in the current project. Consider using a description template (list_ticket_templates) to structure the description.",
    ),
    inputSchema: {
      title: { type: "string", description: "Ticket title." },
      description: { type: "string", optional: true, description: "Ticket description." },
      templateId: {
        type: "string",
        optional: true,
        description:
          "Template ID to pre-fill description from a description template. Use list_ticket_templates to see available templates.",
      },
      parentId: {
        type: "string",
        optional: true,
        description: "Parent ticket identifier (e.g. 'ZBD-7') for sub-tickets.",
      },
      status: {
        type: "string",
        optional: true,
        enum: ["backlog", "todo", "in_progress", "blocked", "in_review", "done", "canceled"],
        description: "Initial status (default: backlog).",
      },
      priority: {
        type: "string",
        optional: true,
        enum: ["none", "low", "medium", "high", "urgent"],
        description: "Priority (default: none).",
      },
      labelIds: {
        type: "array",
        optional: true,
        items: { type: "string" },
        description: "Label IDs to attach.",
      },
      dependencyIds: {
        type: "array",
        optional: true,
        items: { type: "string" },
        description: "Ticket IDs or identifiers this depends on.",
      },
      worktree: {
        type: "string",
        optional: true,
        description: "Git worktree/branch name for isolated development.",
      },
      acceptanceCriteria: {
        type: "array",
        optional: true,
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Criterion text." },
            status: {
              type: "string",
              optional: true,
              enum: ["pending", "met", "not_met"],
              description: "Initial status (default: pending).",
            },
          },
        },
        description: "Acceptance criteria for the ticket.",
      },
    },
  },
  {
    name: "update_ticket",
    title: "Update Ticket",
    description: withTicketChatLinkReminder("Update an existing ticket."),
    inputSchema: {
      ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7') to update." },
      title: { type: "string", optional: true, description: "New title." },
      description: {
        type: "string",
        optional: true,
        nullable: true,
        description: "New description.",
      },
      status: {
        type: "string",
        optional: true,
        enum: ["backlog", "todo", "in_progress", "blocked", "in_review", "done", "canceled"],
        description: "New status.",
      },
      priority: {
        type: "string",
        optional: true,
        enum: ["none", "low", "medium", "high", "urgent"],
        description: "New priority.",
      },
      parentId: {
        type: "string",
        optional: true,
        nullable: true,
        description: "New parent ticket identifier (e.g. 'ZBD-7').",
      },
      sortOrder: { type: "number", optional: true, description: "New sort order." },
      worktree: {
        type: "string",
        optional: true,
        nullable: true,
        description: "Git worktree/branch name. Set to null to clear.",
      },
      acceptanceCriteria: {
        type: "array",
        optional: true,
        nullable: true,
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Criterion text." },
            status: {
              type: "string",
              optional: true,
              enum: ["pending", "met", "not_met"],
              description: "Status (default: pending).",
            },
          },
        },
        description: "Replace acceptance criteria. Pass null to clear.",
      },
    },
  },
  {
    name: "delete_ticket",
    title: "Delete Ticket",
    description: "Delete a ticket and all its data.",
    inputSchema: {
      ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7') to delete." },
    },
  },
  {
    name: "archive_ticket",
    title: "Archive Ticket",
    description:
      "Archive a ticket (and all descendants). Archived tickets are hidden from default listings but can be restored.",
    inputSchema: {
      ticketId: {
        type: "string",
        description: "The ticket identifier (e.g. 'ZBD-7') to archive.",
      },
    },
  },
  {
    name: "unarchive_ticket",
    title: "Unarchive Ticket",
    description: "Unarchive a previously archived ticket (and its descendants).",
    inputSchema: {
      ticketId: {
        type: "string",
        description: "The ticket identifier (e.g. 'ZBD-7') to unarchive.",
      },
    },
  },
  {
    name: "search_tickets",
    title: "Search Tickets",
    description: withTicketChatLinkReminder("Search tickets by text query."),
    inputSchema: {
      query: { type: "string", description: "Search query." },
      limit: { type: "number", optional: true, description: "Max results." },
    },
  },
  {
    name: "get_ticket_tree",
    title: "Get Ticket Tree",
    description: withTicketChatLinkReminder(
      "Get hierarchical tree of tickets for the current project.",
    ),
    inputSchema: {
      rootTicketId: {
        type: "string",
        optional: true,
        description: "Optional root ticket identifier (e.g. 'ZBD-7').",
      },
    },
  },
  {
    name: "reorder_tickets",
    title: "Reorder Tickets",
    description: "Reorder tickets by setting sort order values.",
    inputSchema: {
      items: {
        type: "array",
        description: "Array of {ticketId, sortOrder} pairs.",
        items: {
          type: "object",
          properties: {
            ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7')." },
            sortOrder: { type: "number" },
          },
        },
      },
    },
  },
  // ---- Dependencies ----
  {
    name: "set_ticket_dependencies",
    title: "Set Ticket Dependencies",
    description: "Replace all dependencies for a ticket.",
    inputSchema: {
      ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7')." },
      dependsOnTicketIds: {
        type: "array",
        items: { type: "string" },
        description: "Ticket identifiers this depends on (e.g. 'ZBD-7').",
      },
    },
  },
  {
    name: "add_ticket_dependency",
    title: "Add Ticket Dependency",
    description: "Add a dependency between two tickets.",
    inputSchema: {
      ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7')." },
      dependsOnTicketId: {
        type: "string",
        description: "The dependency identifier (e.g. 'ZBD-7').",
      },
    },
  },
  {
    name: "remove_ticket_dependency",
    title: "Remove Ticket Dependency",
    description: "Remove a dependency between two tickets.",
    inputSchema: {
      ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7')." },
      dependsOnTicketId: {
        type: "string",
        description: "The dependency identifier (e.g. 'ZBD-7').",
      },
    },
  },
  // ---- Criteria ----
  {
    name: "update_criterion_status",
    title: "Update Acceptance Criterion Status",
    description: "Update the status of an acceptance criterion on a ticket.",
    inputSchema: {
      ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7')." },
      index: { type: "number", description: "Criterion index (0-based)." },
      status: { type: "string", enum: ["pending", "met", "not_met"], description: "New status." },
      reason: {
        type: "string",
        optional: true,
        description: "Optional reason for the status change.",
      },
    },
  },
  // ---- History ----
  {
    name: "get_ticket_history",
    title: "Get Ticket History",
    description: "Get audit history for a ticket.",
    inputSchema: {
      ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7')." },
      limit: { type: "number", optional: true, description: "Max entries." },
    },
  },
  // ---- Labels ----
  {
    name: "list_labels",
    title: "List Labels",
    description: "List all labels for the current project.",
    inputSchema: {},
  },
  {
    name: "create_label",
    title: "Create Label",
    description: "Create a new label for the current project.",
    inputSchema: {
      name: { type: "string", description: "Label name." },
      color: { type: "string", description: "Label color (hex, e.g. #ff0000)." },
    },
  },
  {
    name: "update_label",
    title: "Update Label",
    description: "Update an existing label.",
    inputSchema: {
      id: { type: "string", description: "The label ID." },
      name: { type: "string", optional: true, description: "New name." },
      color: { type: "string", optional: true, description: "New color." },
    },
  },
  {
    name: "delete_label",
    title: "Delete Label",
    description: "Delete a label.",
    inputSchema: { id: { type: "string", description: "The label ID." } },
  },
  {
    name: "add_ticket_label",
    title: "Add Label to Ticket",
    description: "Add a label to a ticket.",
    inputSchema: {
      ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7')." },
      labelId: { type: "string", description: "The label ID." },
    },
  },
  {
    name: "remove_ticket_label",
    title: "Remove Label from Ticket",
    description: "Remove a label from a ticket.",
    inputSchema: {
      ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7')." },
      labelId: { type: "string", description: "The label ID." },
    },
  },
  // ---- Templates ----
  {
    name: "list_ticket_templates",
    title: "List Ticket Templates",
    description: "List all description templates available for the current project.",
    inputSchema: {},
  },
  {
    name: "get_ticket_template",
    title: "Get Ticket Template",
    description: "Get a description template by ID.",
    inputSchema: {
      id: { type: "string", description: "The template ID." },
    },
  },
  {
    name: "create_ticket_template",
    title: "Create Ticket Template",
    description: "Create a new description template for tickets.",
    inputSchema: {
      name: { type: "string", description: "Template name." },
      description: { type: "string", optional: true, description: "Template description." },
      body: { type: "string", description: "Template body content." },
    },
  },
  {
    name: "update_ticket_template",
    title: "Update Ticket Template",
    description: "Update an existing description template.",
    inputSchema: {
      id: { type: "string", description: "The template ID." },
      name: { type: "string", optional: true, description: "New template name." },
      description: { type: "string", optional: true, description: "New template description." },
      body: { type: "string", optional: true, description: "New template body content." },
    },
  },
  {
    name: "delete_ticket_template",
    title: "Delete Ticket Template",
    description: "Delete a description template.",
    inputSchema: {
      id: { type: "string", description: "The template ID." },
    },
  },
  // ---- Comments ----
  {
    name: "list_ticket_comments",
    title: "List Ticket Comments",
    description: "List comments on a ticket.",
    inputSchema: {
      ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7')." },
      limit: { type: "number", optional: true, description: "Max comments." },
    },
  },
  {
    name: "create_comment",
    title: "Create Comment",
    description: withTicketChatLinkReminder("Add a comment to a ticket."),
    inputSchema: {
      ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7')." },
      parentId: {
        type: "string",
        optional: true,
        description: "Parent comment ID for threaded replies.",
      },
      authorType: { type: "string", enum: ["human", "llm"], description: "Author type." },
      authorName: { type: "string", description: "Author display name." },
      authorModel: {
        type: "string",
        optional: true,
        description: "Model name if authorType is 'llm'.",
      },
      body: { type: "string", description: "Comment body text." },
    },
  },
  {
    name: "update_comment",
    title: "Update Comment",
    description: "Update a comment's body.",
    inputSchema: {
      id: { type: "string", description: "The comment ID." },
      body: { type: "string", description: "New body text." },
    },
  },
  {
    name: "delete_comment",
    title: "Delete Comment",
    description: "Delete a comment.",
    inputSchema: { id: { type: "string", description: "The comment ID." } },
  },
  // ---- Artifacts ----
  {
    name: "list_ticket_artifacts",
    title: "List Ticket Artifacts",
    description: "List artifacts attached to a ticket.",
    inputSchema: {
      ticketId: { type: "string", description: "The ticket identifier (e.g. 'ZBD-7')." },
    },
  },
  {
    name: "create_artifact",
    title: "Create Artifact",
    description: "Attach an artifact to a ticket or comment.",
    inputSchema: {
      ticketId: {
        type: "string",
        optional: true,
        description: "The ticket identifier (e.g. 'ZBD-7'). Mutually exclusive with commentId.",
      },
      commentId: {
        type: "string",
        optional: true,
        description: "The comment ID (mutually exclusive with ticketId).",
      },
      type: {
        type: "string",
        enum: ["figma_url", "mermaid", "image"],
        description: "Artifact type.",
      },
      title: { type: "string", optional: true, description: "Display title." },
      payload: {
        type: "object",
        description:
          "Type-specific payload (e.g. {url} for figma_url, {source} for mermaid, {url, alt} for image).",
      },
    },
  },
  {
    name: "delete_artifact",
    title: "Delete Artifact",
    description: "Delete an artifact.",
    inputSchema: { id: { type: "string", description: "The artifact ID." } },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

type ToolContext = {
  ticketing: TicketingServiceShape;
  projectId: ProjectId;
  threadId: ThreadId;
};

function toolHandlers(ctx: ToolContext) {
  const { ticketing, projectId, threadId } = ctx;

  /** Resolve a ticket UUID or human-readable identifier within the current project. */
  const resolveId = (idOrIdentifier: string) =>
    Effect.gen(function* () {
      if (!idOrIdentifier) {
        return yield* Effect.fail(new Error("Missing required ticket ID or identifier"));
      }
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idOrIdentifier,
      );
      const ticket = isUuid
        ? yield* ticketing.getById({ id: idOrIdentifier as never, projectId })
        : yield* ticketing.getByIdentifier({ identifier: idOrIdentifier, projectId });
      return ticket.id;
    });

  /** Resolve identifiers and transform a response object for output. */
  const resolveJson = (response: unknown) =>
    Effect.gen(function* () {
      const uuids = collectTicketUuids(response);
      const unique = [...new Set(uuids)].filter(Boolean);
      const idMap: IdMap =
        unique.length > 0 ? yield* ticketing.resolveIdentifiers(unique) : new Map<string, string>();
      return transformForResponse(response, idMap);
    });

  return {
    // ---- Tickets ----

    list_tickets: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const status = input.status as string[] | undefined;
        const priority = input.priority as string[] | undefined;
        const parentId = input.parentId as string | null | undefined;
        const labelId = input.labelId as string | undefined;
        const search = input.search as string | undefined;
        const includeArchived = input.includeArchived as boolean | undefined;
        const limit = input.limit as number | undefined;
        const offset = input.offset as number | undefined;

        const resolvedParentId =
          parentId !== undefined
            ? parentId
              ? ((yield* resolveId(parentId)) as never)
              : (null as never)
            : undefined;
        const tickets = yield* ticketing.list({
          projectId,
          ...(status ? { status: status as never } : {}),
          ...(priority ? { priority: priority as never } : {}),
          ...(resolvedParentId !== undefined ? { parentId: resolvedParentId } : {}),
          ...(labelId ? { labelId: LabelId.makeUnsafe(labelId) } : {}),
          ...(search ? { search } : {}),
          ...(includeArchived !== undefined ? { includeArchived } : {}),
          ...(limit ? { limit } : {}),
          ...(offset ? { offset } : {}),
        });
        return respondOk(yield* resolveJson(tickets));
      }),

    get_ticket: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = input.ticketId as string;
        const resolved = yield* resolveId(id);
        const ticket = yield* ticketing.getById({ id: resolved, projectId });
        return respondOk(yield* resolveJson(ticket));
      }),

    create_ticket: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const title = input.title as string;
        const description = input.description as string | undefined;
        const templateId = input.templateId as string | undefined;
        const parentId = input.parentId as string | undefined;
        const status = input.status as string | undefined;
        const priority = input.priority as string | undefined;
        const labelIds = input.labelIds as string[] | undefined;
        const dependencyIds = input.dependencyIds as string[] | undefined;
        const worktree = input.worktree as string | undefined;
        const acceptanceCriteria = input.acceptanceCriteria as
          | Array<{ text: string; status?: string }>
          | undefined;

        const resolvedParentId = parentId ? yield* resolveId(parentId) : undefined;
        const resolvedDepIds = dependencyIds
          ? yield* Effect.all(dependencyIds.map(resolveId))
          : undefined;
        const ticket = yield* ticketing.create({
          projectId,
          title,
          ...(description ? { description } : {}),
          ...(templateId ? { templateId: TemplateId.makeUnsafe(templateId) } : {}),
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
                  status: (c.status as "pending" | "met" | "not_met") ?? ("pending" as const),
                  reason: null,
                  verifiedBy: null,
                  verifiedAt: null,
                })),
              }
            : {}),
          ...(threadId ? { originThreadId: threadId } : {}),
        });
        return respondOk(yield* resolveJson(ticket));
      }),

    update_ticket: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = input.ticketId as string;
        const title = input.title as string | undefined;
        const description = input.description as string | null | undefined;
        const status = input.status as string | undefined;
        const priority = input.priority as string | undefined;
        const parentId = input.parentId as string | null | undefined;
        const sortOrder = input.sortOrder as number | undefined;
        const worktree = input.worktree as string | null | undefined;
        const acceptanceCriteria = input.acceptanceCriteria as
          | Array<{ text: string; status?: string }>
          | null
          | undefined;

        const resolvedId = yield* resolveId(id);
        const resolvedParentId =
          parentId !== undefined
            ? parentId
              ? ((yield* resolveId(parentId)) as never)
              : null
            : undefined;
        const mappedCriteria =
          acceptanceCriteria !== undefined
            ? acceptanceCriteria
              ? acceptanceCriteria.map((c) => ({
                  text: c.text,
                  status: (c.status as "pending" | "met" | "not_met") ?? ("pending" as const),
                  reason: null,
                  verifiedBy: null,
                  verifiedAt: null,
                }))
              : null
            : undefined;
        const ticket = yield* ticketing.update({
          id: resolvedId,
          ...(title ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(status ? { status: status as never } : {}),
          ...(priority ? { priority: priority as never } : {}),
          ...(resolvedParentId !== undefined ? { parentId: resolvedParentId } : {}),
          ...(sortOrder !== undefined ? { sortOrder } : {}),
          ...(worktree !== undefined ? { worktree } : {}),
          ...(mappedCriteria !== undefined ? { acceptanceCriteria: mappedCriteria } : {}),
        });
        return respondOk(yield* resolveJson(ticket));
      }),

    delete_ticket: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = input.ticketId as string;
        const resolvedId = yield* resolveId(id);
        yield* ticketing.delete({ id: resolvedId });
        return respondOk({ deleted: true });
      }),

    archive_ticket: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = input.ticketId as string;
        const resolvedId = yield* resolveId(id);
        const ticket = yield* ticketing.archive({ id: resolvedId });
        return respondOk(yield* resolveJson(ticket));
      }),

    unarchive_ticket: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = input.ticketId as string;
        const resolvedId = yield* resolveId(id);
        const ticket = yield* ticketing.unarchive({ id: resolvedId });
        return respondOk(yield* resolveJson(ticket));
      }),

    search_tickets: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const query = input.query as string;
        const limit = input.limit as number | undefined;
        const tickets = yield* ticketing.search({
          projectId,
          query,
          ...(limit ? { limit } : {}),
        });
        return respondOk(yield* resolveJson(tickets));
      }),

    get_ticket_tree: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const rootTicketId = input.rootTicketId as string | undefined;
        const resolvedRoot = rootTicketId ? yield* resolveId(rootTicketId) : undefined;
        const tree = yield* ticketing.getTree({
          projectId,
          ...(resolvedRoot ? { rootTicketId: resolvedRoot } : {}),
        });
        return respondOk(yield* resolveJson(tree));
      }),

    reorder_tickets: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const items = input.items as Array<{ ticketId: string; sortOrder: number }>;
        const resolved = yield* Effect.all(
          items.map((i) =>
            Effect.gen(function* () {
              return { id: yield* resolveId(i.ticketId), sortOrder: i.sortOrder };
            }),
          ),
        );
        yield* ticketing.reorder({ items: resolved });
        return respondOk({ reordered: true });
      }),

    // ---- Dependencies ----

    set_ticket_dependencies: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const ticketId = input.ticketId as string;
        const dependsOnTicketIds = input.dependsOnTicketIds as string[];
        const resolvedTicketId = yield* resolveId(ticketId);
        const resolvedDepIds = yield* Effect.all(dependsOnTicketIds.map(resolveId));
        yield* ticketing.setDependencies({
          ticketId: resolvedTicketId,
          dependsOnTicketIds: resolvedDepIds,
        });
        return respondOk({ updated: true });
      }),

    add_ticket_dependency: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const ticketId = input.ticketId as string;
        const dependsOnTicketId = input.dependsOnTicketId as string;
        const resolvedTicketId = yield* resolveId(ticketId);
        const resolvedDepId = yield* resolveId(dependsOnTicketId);
        yield* ticketing.addDependency({
          ticketId: resolvedTicketId,
          dependsOnTicketId: resolvedDepId,
        });
        return respondOk({ added: true });
      }),

    remove_ticket_dependency: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const ticketId = input.ticketId as string;
        const dependsOnTicketId = input.dependsOnTicketId as string;
        const resolvedTicketId = yield* resolveId(ticketId);
        const resolvedDepId = yield* resolveId(dependsOnTicketId);
        yield* ticketing.removeDependency({
          ticketId: resolvedTicketId,
          dependsOnTicketId: resolvedDepId,
        });
        return respondOk({ removed: true });
      }),

    // ---- Criteria ----

    update_criterion_status: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const ticketId = input.ticketId as string;
        const index = input.index as number;
        const status = input.status as "pending" | "met" | "not_met";
        const reason = input.reason as string | undefined;
        const resolvedTicketId = yield* resolveId(ticketId);
        const ticket = yield* ticketing.updateCriterionStatus({
          ticketId: resolvedTicketId,
          index,
          status,
          ...(reason ? { reason } : {}),
        });
        return respondOk(yield* resolveJson(ticket));
      }),

    // ---- History ----

    get_ticket_history: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const ticketId = input.ticketId as string;
        const limit = input.limit as number | undefined;
        const resolvedTicketId = yield* resolveId(ticketId);
        const history = yield* ticketing.getHistory({
          ticketId: resolvedTicketId,
          ...(limit ? { limit } : {}),
        });
        return respondOk(yield* resolveJson(history));
      }),

    // ---- Labels ----

    list_labels: (_input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const labels = yield* ticketing.listLabels({ projectId });
        return respondOk(labels);
      }),

    create_label: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const name = input.name as string;
        const color = input.color as string;
        const label = yield* ticketing.createLabel({ projectId, name, color });
        return respondOk(label);
      }),

    update_label: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = input.id as string;
        const name = input.name as string | undefined;
        const color = input.color as string | undefined;
        const label = yield* ticketing.updateLabel({
          id: LabelId.makeUnsafe(id),
          ...(name ? { name } : {}),
          ...(color ? { color } : {}),
        });
        return respondOk(label);
      }),

    delete_label: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = input.id as string;
        yield* ticketing.deleteLabel({ id: LabelId.makeUnsafe(id) });
        return respondOk({ deleted: true });
      }),

    add_ticket_label: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const ticketId = input.ticketId as string;
        const labelId = input.labelId as string;
        const resolvedTicketId = yield* resolveId(ticketId);
        yield* ticketing.addTicketLabel({
          ticketId: resolvedTicketId,
          labelId: LabelId.makeUnsafe(labelId),
        });
        return respondOk({ added: true });
      }),

    remove_ticket_label: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const ticketId = input.ticketId as string;
        const labelId = input.labelId as string;
        const resolvedTicketId = yield* resolveId(ticketId);
        yield* ticketing.removeTicketLabel({
          ticketId: resolvedTicketId,
          labelId: LabelId.makeUnsafe(labelId),
        });
        return respondOk({ removed: true });
      }),

    // ---- Templates ----

    list_ticket_templates: (_input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const templates = yield* ticketing.listTemplates({ projectId });
        return respondOk(templates);
      }),

    get_ticket_template: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = input.id as string;
        const template = yield* ticketing.getTemplate({ id: TemplateId.makeUnsafe(id) });
        return respondOk(template);
      }),

    create_ticket_template: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const name = input.name as string;
        const description = input.description as string | undefined;
        const body = input.body as string;
        const template = yield* ticketing.createTemplate({
          projectId,
          name,
          ...(description ? { description } : {}),
          body,
        });
        return respondOk(template);
      }),

    update_ticket_template: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = input.id as string;
        const name = input.name as string | undefined;
        const description = input.description as string | undefined;
        const body = input.body as string | undefined;
        const template = yield* ticketing.updateTemplate({
          id: TemplateId.makeUnsafe(id),
          ...(name ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(body ? { body } : {}),
        });
        return respondOk(template);
      }),

    delete_ticket_template: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = input.id as string;
        yield* ticketing.deleteTemplate({ id: TemplateId.makeUnsafe(id) });
        return respondOk({ deleted: true });
      }),

    // ---- Comments ----

    list_ticket_comments: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const ticketId = input.ticketId as string;
        const limit = input.limit as number | undefined;
        const resolvedTicketId = yield* resolveId(ticketId);
        const comments = yield* ticketing.listComments({
          ticketId: resolvedTicketId,
          ...(limit ? { limit } : {}),
        });
        return respondOk(yield* resolveJson(comments));
      }),

    create_comment: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const ticketId = input.ticketId as string;
        const parentId = input.parentId as string | undefined;
        const authorType = input.authorType as "human" | "llm";
        const authorName = input.authorName as string;
        const authorModel = input.authorModel as string | undefined;
        const body = input.body as string;
        const resolvedTicketId = yield* resolveId(ticketId);
        const comment = yield* ticketing.createComment({
          ticketId: resolvedTicketId,
          ...(parentId ? { parentId: CommentId.makeUnsafe(parentId) } : {}),
          authorType,
          authorName,
          ...(authorModel ? { authorModel } : {}),
          body,
        });
        return respondOk(yield* resolveJson(comment));
      }),

    update_comment: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = input.id as string;
        const body = input.body as string;
        const comment = yield* ticketing.updateComment({ id: CommentId.makeUnsafe(id), body });
        return respondOk(yield* resolveJson(comment));
      }),

    delete_comment: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = input.id as string;
        yield* ticketing.deleteComment({ id: CommentId.makeUnsafe(id) });
        return respondOk({ deleted: true });
      }),

    // ---- Artifacts ----

    list_ticket_artifacts: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const ticketId = input.ticketId as string;
        const resolvedTicketId = yield* resolveId(ticketId);
        const artifacts = yield* ticketing.listArtifacts({ ticketId: resolvedTicketId });
        return respondOk(yield* resolveJson(artifacts));
      }),

    create_artifact: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const ticketId = input.ticketId as string | undefined;
        const commentId = input.commentId as string | undefined;
        const type = input.type as "figma_url" | "mermaid" | "image";
        const title = input.title as string | undefined;
        const payload = input.payload;
        const resolvedTicketId = ticketId ? yield* resolveId(ticketId) : undefined;
        const artifact = yield* ticketing.createArtifact({
          ...(resolvedTicketId ? { ticketId: resolvedTicketId } : {}),
          ...(commentId ? { commentId: CommentId.makeUnsafe(commentId) } : {}),
          type,
          ...(title ? { title } : {}),
          payload,
        });
        return respondOk(yield* resolveJson(artifact));
      }),

    delete_artifact: (input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = input.id as string;
        yield* ticketing.deleteArtifact({ id: ArtifactId.makeUnsafe(id) });
        return respondOk({ deleted: true });
      }),
  } as Record<
    string,
    (
      input: Record<string, unknown>,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse, TicketingError, never>
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

  const ticketing = yield* TicketingService;
  const handlers = toolHandlers({
    ticketing,
    projectId: auth.projectId,
    threadId: auth.threadId,
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

export const ticketingRouteLayer = Layer.mergeAll(
  HttpRouter.add("GET", API_ROUTE, handleGet),
  HttpRouter.add("POST", API_ROUTE, handlePost),
);
