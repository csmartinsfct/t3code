import {
  ArtifactId,
  CommentId,
  CommentNotFoundError,
  DependencyCycleError,
  LabelId,
  LabelNotFoundError,
  TicketHistoryId,
  TicketId,
  TicketNotFoundError,
  TicketingOperationError,
  TicketingValidationError,
  type Artifact,
  type Comment,
  type Label,
  type Ticket,
  type TicketDependency,
  type TicketSummary,
  type TicketTreeNode,
  type TicketingError,
  type TicketingStreamEvent,
  type TicketStatus,
} from "@t3tools/contracts";
import { Effect, Layer, Option, PubSub, Stream } from "effect";

import { TicketingRepository } from "../../persistence/Services/Ticketing.ts";
import type { PersistedTicket } from "../../persistence/Services/Ticketing.ts";
import { TicketingService, type TicketingServiceShape } from "../Services/Ticketing.ts";

const nowIso = () => new Date().toISOString();

const toOperationError =
  (operation: string) =>
  (cause: unknown): TicketingError =>
    new TicketingOperationError({
      operation,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });

const deriveEpicStatus = (children: ReadonlyArray<{ status: TicketStatus }>): TicketStatus => {
  if (children.length === 0) return "backlog";
  const statuses = children.map((c) => c.status);
  if (statuses.some((s) => s === "in_progress" || s === "in_review")) return "in_progress";
  if (statuses.every((s) => s === "done")) return "done";
  if (statuses.every((s) => s === "canceled")) return "canceled";
  if (statuses.every((s) => s === "done" || s === "canceled")) return "done";
  return "todo";
};

const makeTicketingService = Effect.gen(function* () {
  const repo = yield* TicketingRepository;
  const eventsPubSub = yield* PubSub.unbounded<TicketingStreamEvent>();

  const publishEvent = (event: TicketingStreamEvent) =>
    PubSub.publish(eventsPubSub, event).pipe(Effect.asVoid);

  const recordHistory = (
    ticketId: TicketId,
    action: string,
    changes: unknown,
    performedBy: string,
  ) =>
    repo.recordHistory({
      id: TicketHistoryId.makeUnsafe(crypto.randomUUID()),
      ticketId,
      action: action as never,
      changes,
      performedBy,
      performedAt: nowIso(),
    });

  const resolveTicketOrFail = (id: TicketId) =>
    repo.getById({ id }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new TicketNotFoundError({ ticketId: id })),
          onSome: Effect.succeed,
        }),
      ),
      Effect.mapError(toOperationError("resolveTicket")),
    );

  const buildTicketSummary = (
    ticket: PersistedTicket,
    labels: ReadonlyArray<Label>,
    subTicketCount: number,
    dependencyCount: number,
  ): TicketSummary => ({
    id: ticket.id,
    projectId: ticket.projectId,
    parentId: ticket.parentId,
    ticketNumber: ticket.ticketNumber,
    identifier: ticket.identifier as never,
    title: ticket.title as never,
    status: ticket.status,
    priority: ticket.priority,
    sortOrder: ticket.sortOrder,
    isArchived: ticket.isArchived,
    labels,
    subTicketCount,
    dependencyCount,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  });

  const buildFullTicket = (ticket: PersistedTicket): Effect.Effect<Ticket, TicketingError> =>
    Effect.gen(function* () {
      const labels = yield* repo.listLabelsForTicket({ ticketId: ticket.id });
      const deps = yield* repo.listDependencies({ ticketId: ticket.id });
      const subTickets = yield* repo.listByParent({ parentId: ticket.id });
      const comments = yield* repo.listCommentsByTicket({ ticketId: ticket.id });
      const artifacts = yield* repo.listArtifactsByTicket({ ticketId: ticket.id });

      const subSummaries: TicketSummary[] = [];
      for (const sub of subTickets) {
        const subLabels = yield* repo.listLabelsForTicket({ ticketId: sub.id });
        const subSubCount = yield* repo.countByParent({ parentId: sub.id });
        const subDepCount = (yield* repo.listDependencies({ ticketId: sub.id })).length;
        subSummaries.push(buildTicketSummary(sub, subLabels as Label[], subSubCount, subDepCount));
      }

      return {
        id: ticket.id,
        projectId: ticket.projectId,
        parentId: ticket.parentId,
        ticketNumber: ticket.ticketNumber,
        identifier: ticket.identifier as never,
        title: ticket.title as never,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        sortOrder: ticket.sortOrder,
        isArchived: ticket.isArchived,
        acceptanceCriteria: ticket.acceptanceCriteria,
        labels: labels as Label[],
        dependencies: deps as TicketDependency[],
        subTickets: subSummaries,
        comments: comments as Comment[],
        artifacts: artifacts.map(
          (a) =>
            ({
              ...a,
              payload: a.payload,
            }) as Artifact,
        ),
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      } satisfies Ticket;
    }).pipe(Effect.mapError(toOperationError("buildFullTicket")));

  const propagateEpicStatus = (
    ticketId: TicketId,
    depth: number,
  ): Effect.Effect<void, TicketingError> =>
    Effect.gen(function* () {
      if (depth > 10) return;
      const ticket = yield* resolveTicketOrFail(ticketId);
      if (!ticket.parentId) return;

      const siblings = yield* repo
        .listByParent({ parentId: ticket.parentId })
        .pipe(Effect.mapError(toOperationError("propagateEpicStatus")));
      const newStatus = deriveEpicStatus(siblings);
      const parent = yield* resolveTicketOrFail(ticket.parentId);

      if (parent.status !== newStatus) {
        const now = nowIso();
        yield* repo
          .updateTicket({ ...parent, status: newStatus, updatedAt: now })
          .pipe(Effect.mapError(toOperationError("propagateEpicStatus")));
        yield* recordHistory(
          parent.id,
          "status_changed",
          {
            status: { old: parent.status, new: newStatus },
          },
          "system",
        ).pipe(Effect.mapError(toOperationError("propagateEpicStatus")));
        yield* propagateEpicStatus(parent.id, depth + 1);
      }
    });

  // ---- Service shape implementation ----

  const list: TicketingServiceShape["list"] = (input) =>
    Effect.gen(function* () {
      const tickets = yield* repo.listByProject(input);
      const summaries: TicketSummary[] = [];
      for (const t of tickets) {
        const labels = yield* repo.listLabelsForTicket({ ticketId: t.id });
        const subCount = yield* repo.countByParent({ parentId: t.id });
        const depCount = (yield* repo.listDependencies({ ticketId: t.id })).length;
        summaries.push(buildTicketSummary(t, labels as Label[], subCount, depCount));
      }
      return summaries;
    }).pipe(Effect.mapError(toOperationError("list")));

  const getById: TicketingServiceShape["getById"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* resolveTicketOrFail(TicketId.makeUnsafe(input.id));
      return yield* buildFullTicket(ticket);
    });

  const getByIdentifier: TicketingServiceShape["getByIdentifier"] = (input) =>
    Effect.gen(function* () {
      const opt = yield* repo
        .getByIdentifier({ identifier: input.identifier })
        .pipe(Effect.mapError(toOperationError("getByIdentifier")));
      const ticket = yield* Option.match(opt, {
        onNone: () =>
          Effect.fail<TicketingError>(
            new TicketNotFoundError({ ticketId: input.identifier as never }),
          ),
        onSome: Effect.succeed,
      });
      return yield* buildFullTicket(ticket);
    });

  const create: TicketingServiceShape["create"] = (input) =>
    Effect.gen(function* () {
      const now = nowIso();
      const id = TicketId.makeUnsafe(crypto.randomUUID());
      const { ticketNumber, identifier } = yield* repo
        .allocateTicketNumber({ projectId: input.projectId })
        .pipe(Effect.mapError(toOperationError("create")));

      const ticket: PersistedTicket = {
        id,
        projectId: input.projectId,
        parentId: input.parentId ?? null,
        ticketNumber,
        identifier,
        title: input.title,
        description: input.description ?? null,
        acceptanceCriteria: input.acceptanceCriteria ?? null,
        status: input.status ?? "backlog",
        priority: input.priority ?? "none",
        sortOrder: input.sortOrder ?? 0,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      };

      yield* repo.createTicket(ticket).pipe(Effect.mapError(toOperationError("create")));
      yield* recordHistory(id, "created", ticket, "user").pipe(
        Effect.mapError(toOperationError("create")),
      );

      // Attach labels
      if (input.labelIds) {
        for (const labelId of input.labelIds) {
          yield* repo
            .addTicketLabel({ ticketId: id, labelId })
            .pipe(Effect.mapError(toOperationError("create")));
        }
      }

      // Attach dependencies
      if (input.dependencyIds) {
        for (const depId of input.dependencyIds) {
          yield* repo
            .addDependency({ ticketId: id, dependsOnTicketId: depId })
            .pipe(Effect.mapError(toOperationError("create")));
        }
      }

      const full = yield* buildFullTicket(ticket);

      const labels = yield* repo
        .listLabelsForTicket({ ticketId: id })
        .pipe(Effect.mapError(toOperationError("create")));
      const subCount = yield* repo
        .countByParent({ parentId: id })
        .pipe(Effect.mapError(toOperationError("create")));
      const depCount = (yield* repo
        .listDependencies({ ticketId: id })
        .pipe(Effect.mapError(toOperationError("create")))).length;
      yield* publishEvent({
        type: "ticket_upserted",
        projectId: input.projectId,
        ticket: buildTicketSummary(ticket, labels as Label[], subCount, depCount),
      });

      return full;
    });

  const update: TicketingServiceShape["update"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* resolveTicketOrFail(input.id);
      const now = nowIso();

      const changes: Record<string, { old: unknown; new: unknown }> = {};
      const patch: Record<string, unknown> = { updatedAt: now };

      if (input.title !== undefined) {
        changes.title = { old: existing.title, new: input.title };
        patch.title = input.title;
      }
      if (input.description !== undefined) {
        changes.description = { old: existing.description, new: input.description };
        patch.description = input.description ?? null;
      }
      if (input.acceptanceCriteria !== undefined) {
        changes.acceptanceCriteria = {
          old: existing.acceptanceCriteria,
          new: input.acceptanceCriteria,
        };
        patch.acceptanceCriteria = input.acceptanceCriteria ?? null;
      }
      if (input.status !== undefined) {
        changes.status = { old: existing.status, new: input.status };
        patch.status = input.status;
      }
      if (input.priority !== undefined) {
        changes.priority = { old: existing.priority, new: input.priority };
        patch.priority = input.priority;
      }
      if (input.parentId !== undefined) {
        changes.parentId = { old: existing.parentId, new: input.parentId };
        patch.parentId = input.parentId ?? null;
      }
      if (input.sortOrder !== undefined) {
        changes.sortOrder = { old: existing.sortOrder, new: input.sortOrder };
        patch.sortOrder = input.sortOrder;
      }

      const updated = { ...existing, ...patch } as PersistedTicket;

      yield* repo.updateTicket(updated).pipe(Effect.mapError(toOperationError("update")));

      const historyAction = changes.status ? "status_changed" : "updated";
      yield* recordHistory(input.id, historyAction, changes, "user").pipe(
        Effect.mapError(toOperationError("update")),
      );

      // Propagate epic status if a child ticket's status changed
      if (changes.status && updated.parentId) {
        yield* propagateEpicStatus(input.id, 0);
      }

      const full = yield* buildFullTicket(updated);

      const labels = yield* repo
        .listLabelsForTicket({ ticketId: input.id })
        .pipe(Effect.mapError(toOperationError("update")));
      const subCount = yield* repo
        .countByParent({ parentId: input.id })
        .pipe(Effect.mapError(toOperationError("update")));
      const depCount = (yield* repo
        .listDependencies({ ticketId: input.id })
        .pipe(Effect.mapError(toOperationError("update")))).length;
      yield* publishEvent({
        type: "ticket_upserted",
        projectId: updated.projectId,
        ticket: buildTicketSummary(updated, labels as Label[], subCount, depCount),
      });

      return full;
    });

  const del: TicketingServiceShape["delete"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* resolveTicketOrFail(input.id);
      yield* repo.deleteTicket({ id: input.id }).pipe(Effect.mapError(toOperationError("delete")));
      yield* publishEvent({
        type: "ticket_deleted",
        projectId: ticket.projectId,
        ticketId: input.id,
      });
    });

  const reorder: TicketingServiceShape["reorder"] = (input) =>
    Effect.gen(function* () {
      for (const item of input.items) {
        const ticket = yield* resolveTicketOrFail(item.id);
        yield* repo
          .updateTicket({ ...ticket, sortOrder: item.sortOrder, updatedAt: nowIso() })
          .pipe(Effect.mapError(toOperationError("reorder")));
      }
    });

  const search: TicketingServiceShape["search"] = (input) =>
    list({
      projectId: input.projectId,
      search: input.query,
      limit: input.limit,
      offset: input.offset,
    });

  const getTree: TicketingServiceShape["getTree"] = (input) =>
    Effect.gen(function* () {
      const allTickets = yield* repo
        .listByProject({
          projectId: input.projectId,
          includeArchived: false,
          ...(input.rootTicketId ? { parentId: input.rootTicketId } : {}),
        })
        .pipe(Effect.mapError(toOperationError("getTree")));

      // Build label map
      const ticketLabelsMap = new Map<string, Label[]>();
      const ticketSubCountMap = new Map<string, number>();
      const ticketDepCountMap = new Map<string, number>();
      const ticketDepsMap = new Map<string, TicketDependency[]>();

      for (const t of allTickets) {
        const labels = yield* repo
          .listLabelsForTicket({ ticketId: t.id })
          .pipe(Effect.mapError(toOperationError("getTree")));
        ticketLabelsMap.set(t.id, labels as Label[]);
        const subCount = yield* repo
          .countByParent({ parentId: t.id })
          .pipe(Effect.mapError(toOperationError("getTree")));
        ticketSubCountMap.set(t.id, subCount);
        const deps = yield* repo
          .listDependencies({ ticketId: t.id })
          .pipe(Effect.mapError(toOperationError("getTree")));
        ticketDepsMap.set(t.id, deps as TicketDependency[]);
        ticketDepCountMap.set(t.id, deps.length);
      }

      // Build tree from flat list
      const summaryMap = new Map<string, TicketSummary>();
      const childrenMap = new Map<string, TicketSummary[]>();

      for (const t of allTickets) {
        const summary = buildTicketSummary(
          t,
          ticketLabelsMap.get(t.id) ?? [],
          ticketSubCountMap.get(t.id) ?? 0,
          ticketDepCountMap.get(t.id) ?? 0,
        );
        summaryMap.set(t.id, summary);
        if (t.parentId) {
          const siblings = childrenMap.get(t.parentId) ?? [];
          siblings.push(summary);
          childrenMap.set(t.parentId, siblings);
        }
      }

      const buildNode = (summary: TicketSummary): TicketTreeNode => ({
        ticket: summary,
        children: (childrenMap.get(summary.id) ?? []).map(buildNode),
        dependencies: ticketDepsMap.get(summary.id) ?? [],
      });

      // Root nodes are those with no parent or with rootTicketId as parent
      const rootParentId = input.rootTicketId ?? null;
      const roots = allTickets
        .filter((t) => t.parentId === rootParentId)
        .map((t) => summaryMap.get(t.id)!)
        .filter(Boolean)
        .map(buildNode);

      return roots;
    });

  // Dependencies
  const setDependencies: TicketingServiceShape["setDependencies"] = (input) =>
    Effect.gen(function* () {
      // Cycle detection for each new dependency
      for (const depId of input.dependsOnTicketIds) {
        const transitive = yield* repo
          .listAllTransitiveDependencies({ ticketId: depId })
          .pipe(Effect.mapError(toOperationError("setDependencies")));
        if (transitive.includes(input.ticketId)) {
          const ticket = yield* resolveTicketOrFail(input.ticketId);
          const depTicket = yield* resolveTicketOrFail(depId);
          return yield* Effect.fail<TicketingError>(
            new DependencyCycleError({
              ticketId: input.ticketId,
              dependsOnTicketId: depId,
              cycle: [ticket.identifier as never, depTicket.identifier as never],
            }),
          );
        }
      }
      yield* repo
        .setDependencies({
          ticketId: input.ticketId,
          dependsOnTicketIds: input.dependsOnTicketIds,
        })
        .pipe(Effect.mapError(toOperationError("setDependencies")));
    });

  const addDependency: TicketingServiceShape["addDependency"] = (input) =>
    Effect.gen(function* () {
      // Cycle detection: check if ticketId is in the transitive dependencies of dependsOnTicketId
      const transitive = yield* repo
        .listAllTransitiveDependencies({ ticketId: input.dependsOnTicketId })
        .pipe(Effect.mapError(toOperationError("addDependency")));
      if (transitive.includes(input.ticketId)) {
        const ticket = yield* resolveTicketOrFail(input.ticketId);
        const depTicket = yield* resolveTicketOrFail(input.dependsOnTicketId);
        return yield* Effect.fail<TicketingError>(
          new DependencyCycleError({
            ticketId: input.ticketId,
            dependsOnTicketId: input.dependsOnTicketId,
            cycle: [ticket.identifier as never, depTicket.identifier as never],
          }),
        );
      }
      yield* repo
        .addDependency({
          ticketId: input.ticketId,
          dependsOnTicketId: input.dependsOnTicketId,
        })
        .pipe(Effect.mapError(toOperationError("addDependency")));
      yield* recordHistory(
        input.ticketId,
        "dependency_added",
        { dependsOnTicketId: input.dependsOnTicketId },
        "user",
      ).pipe(Effect.mapError(toOperationError("addDependency")));
    });

  const removeDependency: TicketingServiceShape["removeDependency"] = (input) =>
    Effect.gen(function* () {
      yield* repo
        .removeDependency({
          ticketId: input.ticketId,
          dependsOnTicketId: input.dependsOnTicketId,
        })
        .pipe(Effect.mapError(toOperationError("removeDependency")));
      yield* recordHistory(
        input.ticketId,
        "dependency_removed",
        { dependsOnTicketId: input.dependsOnTicketId },
        "user",
      ).pipe(Effect.mapError(toOperationError("removeDependency")));
    });

  // Acceptance criteria
  const updateCriterionStatus: TicketingServiceShape["updateCriterionStatus"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* resolveTicketOrFail(input.ticketId);
      if (!ticket.acceptanceCriteria || ticket.acceptanceCriteria.length === 0) {
        return yield* Effect.fail<TicketingError>(
          new TicketingValidationError({
            field: "acceptanceCriteria",
            message: "Ticket has no acceptance criteria",
          }),
        );
      }
      if (input.index < 0 || input.index >= ticket.acceptanceCriteria.length) {
        return yield* Effect.fail<TicketingError>(
          new TicketingValidationError({
            field: "index",
            message: `Index ${input.index} out of range (0-${ticket.acceptanceCriteria.length - 1})`,
          }),
        );
      }

      const now = nowIso();
      const updated = [...ticket.acceptanceCriteria];
      updated[input.index] = {
        ...updated[input.index]!,
        status: input.status,
        reason: input.reason ?? null,
        verifiedBy: "user",
        verifiedAt: now,
      };

      const updatedTicket: PersistedTicket = {
        ...ticket,
        acceptanceCriteria: updated,
        updatedAt: now,
      };
      yield* repo
        .updateTicket(updatedTicket)
        .pipe(Effect.mapError(toOperationError("updateCriterionStatus")));
      yield* recordHistory(
        input.ticketId,
        "updated",
        {
          acceptanceCriteria: {
            index: input.index,
            old: ticket.acceptanceCriteria[input.index],
            new: updated[input.index],
          },
        },
        "user",
      ).pipe(Effect.mapError(toOperationError("updateCriterionStatus")));

      return yield* buildFullTicket(updatedTicket);
    });

  // History
  const getHistory: TicketingServiceShape["getHistory"] = (input) =>
    repo.listHistoryByTicket(input).pipe(
      Effect.map((rows) => rows as ReadonlyArray<import("@t3tools/contracts").TicketHistoryEntry>),
      Effect.mapError(toOperationError("getHistory")),
    );

  // Labels
  const listLabels: TicketingServiceShape["listLabels"] = (input) =>
    repo.listLabels({ projectId: input.projectId }).pipe(
      Effect.map((rows) => rows as ReadonlyArray<Label>),
      Effect.mapError(toOperationError("listLabels")),
    );

  const createLabel: TicketingServiceShape["createLabel"] = (input) =>
    Effect.gen(function* () {
      const now = nowIso();
      const id = LabelId.makeUnsafe(crypto.randomUUID());
      const label = {
        id,
        projectId: input.projectId,
        name: input.name,
        color: input.color,
        createdAt: now,
        updatedAt: now,
      };
      yield* repo.createLabel(label).pipe(Effect.mapError(toOperationError("createLabel")));
      yield* publishEvent({ type: "label_upserted", label: label as Label });
      return label as Label;
    });

  const updateLabel: TicketingServiceShape["updateLabel"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* repo
        .getLabel({ id: input.id })
        .pipe(Effect.mapError(toOperationError("updateLabel")));
      const label = yield* Option.match(existing, {
        onNone: () => Effect.fail<TicketingError>(new LabelNotFoundError({ labelId: input.id })),
        onSome: Effect.succeed,
      });
      const now = nowIso();
      const updated = {
        ...label,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        updatedAt: now,
      };
      yield* repo.updateLabel(updated).pipe(Effect.mapError(toOperationError("updateLabel")));
      yield* publishEvent({ type: "label_upserted", label: updated as Label });
      return updated as Label;
    });

  const deleteLabel: TicketingServiceShape["deleteLabel"] = (input) =>
    Effect.gen(function* () {
      yield* repo
        .deleteLabel({ id: input.id })
        .pipe(Effect.mapError(toOperationError("deleteLabel")));
      yield* publishEvent({ type: "label_deleted", labelId: input.id });
    });

  const addTicketLabel: TicketingServiceShape["addTicketLabel"] = (input) =>
    Effect.gen(function* () {
      yield* repo
        .addTicketLabel({ ticketId: input.ticketId, labelId: input.labelId })
        .pipe(Effect.mapError(toOperationError("addTicketLabel")));
      yield* recordHistory(input.ticketId, "label_added", { labelId: input.labelId }, "user").pipe(
        Effect.mapError(toOperationError("addTicketLabel")),
      );
    });

  const removeTicketLabel: TicketingServiceShape["removeTicketLabel"] = (input) =>
    Effect.gen(function* () {
      yield* repo
        .removeTicketLabel({ ticketId: input.ticketId, labelId: input.labelId })
        .pipe(Effect.mapError(toOperationError("removeTicketLabel")));
      yield* recordHistory(
        input.ticketId,
        "label_removed",
        { labelId: input.labelId },
        "user",
      ).pipe(Effect.mapError(toOperationError("removeTicketLabel")));
    });

  // Comments
  const listComments: TicketingServiceShape["listComments"] = (input) =>
    repo.listCommentsByTicket(input).pipe(
      Effect.map((rows) => rows as ReadonlyArray<Comment>),
      Effect.mapError(toOperationError("listComments")),
    );

  const createComment: TicketingServiceShape["createComment"] = (input) =>
    Effect.gen(function* () {
      // Threading enforcement: parentId must reference a top-level comment
      if (input.parentId) {
        const parent = yield* repo
          .getComment({ id: input.parentId })
          .pipe(Effect.mapError(toOperationError("createComment")));
        const parentComment = yield* Option.match(parent, {
          onNone: () =>
            Effect.fail<TicketingError>(new CommentNotFoundError({ commentId: input.parentId! })),
          onSome: Effect.succeed,
        });
        if (parentComment.parentId !== null) {
          return yield* Effect.fail<TicketingError>(
            new TicketingValidationError({
              field: "parentId",
              message: "Cannot reply to a reply — only top-level comments can have replies",
            }),
          );
        }
      }

      const now = nowIso();
      const id = CommentId.makeUnsafe(crypto.randomUUID());
      const comment = {
        id,
        ticketId: input.ticketId,
        parentId: input.parentId ?? null,
        authorType: input.authorType,
        authorName: input.authorName,
        authorModel: input.authorModel ?? null,
        body: input.body,
        createdAt: now,
        updatedAt: now,
      };
      yield* repo.createComment(comment).pipe(Effect.mapError(toOperationError("createComment")));
      yield* recordHistory(
        input.ticketId,
        "comment_added",
        { commentId: id },
        comment.authorName,
      ).pipe(Effect.mapError(toOperationError("createComment")));
      yield* publishEvent({
        type: "comment_upserted",
        ticketId: input.ticketId,
        comment: comment as Comment,
      });
      return comment as Comment;
    });

  const updateComment: TicketingServiceShape["updateComment"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* repo
        .getComment({ id: input.id })
        .pipe(Effect.mapError(toOperationError("updateComment")));
      const comment = yield* Option.match(existing, {
        onNone: () =>
          Effect.fail<TicketingError>(new CommentNotFoundError({ commentId: input.id })),
        onSome: Effect.succeed,
      });
      const now = nowIso();
      const updated = { ...comment, body: input.body, updatedAt: now };
      yield* repo.updateComment(updated).pipe(Effect.mapError(toOperationError("updateComment")));
      yield* recordHistory(
        comment.ticketId,
        "comment_updated",
        { commentId: input.id, old: comment.body, new: input.body },
        comment.authorName,
      ).pipe(Effect.mapError(toOperationError("updateComment")));
      yield* publishEvent({
        type: "comment_upserted",
        ticketId: comment.ticketId,
        comment: updated as Comment,
      });
      return updated as Comment;
    });

  const deleteComment: TicketingServiceShape["deleteComment"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* repo
        .getComment({ id: input.id })
        .pipe(Effect.mapError(toOperationError("deleteComment")));
      const comment = yield* Option.match(existing, {
        onNone: () =>
          Effect.fail<TicketingError>(new CommentNotFoundError({ commentId: input.id })),
        onSome: Effect.succeed,
      });
      yield* repo
        .deleteComment({ id: input.id })
        .pipe(Effect.mapError(toOperationError("deleteComment")));
      yield* recordHistory(
        comment.ticketId,
        "comment_deleted",
        { commentId: input.id },
        "user",
      ).pipe(Effect.mapError(toOperationError("deleteComment")));
      yield* publishEvent({
        type: "comment_deleted",
        ticketId: comment.ticketId,
        commentId: input.id,
      });
    });

  // Artifacts
  const listArtifacts: TicketingServiceShape["listArtifacts"] = (input) =>
    repo.listArtifactsByTicket(input).pipe(
      Effect.map(
        (rows) =>
          rows.map((a) => ({ ...a, payload: a.payload }) as Artifact) as ReadonlyArray<Artifact>,
      ),
      Effect.mapError(toOperationError("listArtifacts")),
    );

  const createArtifact: TicketingServiceShape["createArtifact"] = (input) =>
    Effect.gen(function* () {
      const ticketId = input.ticketId ?? null;
      const commentId = input.commentId ?? null;
      if (!ticketId && !commentId) {
        return yield* Effect.fail<TicketingError>(
          new TicketingValidationError({
            field: "ticketId/commentId",
            message: "Either ticketId or commentId must be provided",
          }),
        );
      }
      if (ticketId && commentId) {
        return yield* Effect.fail<TicketingError>(
          new TicketingValidationError({
            field: "ticketId/commentId",
            message: "Only one of ticketId or commentId can be provided",
          }),
        );
      }

      const now = nowIso();
      const id = ArtifactId.makeUnsafe(crypto.randomUUID());
      const artifact = {
        id,
        ticketId,
        commentId,
        type: input.type,
        title: input.title ?? null,
        payload: input.payload,
        createdAt: now,
        updatedAt: now,
      };
      yield* repo
        .createArtifact(artifact)
        .pipe(Effect.mapError(toOperationError("createArtifact")));

      if (ticketId) {
        yield* recordHistory(ticketId, "artifact_added", { artifactId: id }, "user").pipe(
          Effect.mapError(toOperationError("createArtifact")),
        );
      }

      return artifact as Artifact;
    });

  const deleteArtifact: TicketingServiceShape["deleteArtifact"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* repo
        .getArtifact({ id: input.id })
        .pipe(Effect.mapError(toOperationError("deleteArtifact")));
      const artifact = yield* Option.match(existing, {
        onNone: () =>
          Effect.fail<TicketingError>(
            new TicketingOperationError({
              operation: "deleteArtifact",
              message: `Artifact not found: ${input.id}`,
            }),
          ),
        onSome: Effect.succeed,
      });
      yield* repo
        .deleteArtifact({ id: input.id })
        .pipe(Effect.mapError(toOperationError("deleteArtifact")));
      if (artifact.ticketId) {
        yield* recordHistory(
          artifact.ticketId,
          "artifact_deleted",
          { artifactId: input.id },
          "user",
        ).pipe(Effect.mapError(toOperationError("deleteArtifact")));
      }
    });

  return {
    list,
    getById,
    getByIdentifier,
    create,
    update,
    delete: del,
    reorder,
    search,
    getTree,
    setDependencies,
    addDependency,
    removeDependency,
    updateCriterionStatus,
    getHistory,
    listLabels,
    createLabel,
    updateLabel,
    deleteLabel,
    addTicketLabel,
    removeTicketLabel,
    listComments,
    createComment,
    updateComment,
    deleteComment,
    listArtifacts,
    createArtifact,
    deleteArtifact,
    streamEvents: Stream.fromPubSub(eventsPubSub),
  } satisfies TicketingServiceShape;
});

export const TicketingServiceLive = Layer.effect(TicketingService, makeTicketingService);
