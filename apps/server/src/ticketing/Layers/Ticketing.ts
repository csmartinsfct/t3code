import {
  ArtifactId,
  CommentId,
  CommentNotFoundError,
  DependencyCycleError,
  LabelId,
  LabelNotFoundError,
  TemplateId,
  TemplateNotFoundError,
  TicketHistoryId,
  TicketId,
  TicketNotFoundError,
  TicketingOperationError,
  TicketingValidationError,
  type Artifact,
  type Comment,
  type Label,
  type Template,
  type Ticket,
  type TicketDependency,
  type TicketLinkedThread,
  type TicketSummary,
  type TicketThreadLinks,
  type TicketTreeNode,
  type TicketingError,
  type TicketingStreamEvent,
  type TicketStatus,
  type AcceptanceCriterion,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Option, Path, PubSub, Stream } from "effect";

import {
  AttachmentIngestError,
  copyExistingAttachment,
  deleteAttachmentFile,
  ingestDataUrl,
  type AttachmentOwner,
} from "../../attachments/AttachmentFiles.ts";
import { ServerConfig } from "../../config.ts";
import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { TicketingRepository } from "../../persistence/Services/Ticketing.ts";
import type {
  PersistedAcceptanceCriterion,
  PersistedTicketBody,
  PersistedTicket,
  PersistedTicketingAttachment,
} from "../../persistence/Services/Ticketing.ts";
import { TicketThreadLinkRepository } from "../../persistence/Services/TicketThreadLinks.ts";
import type { TicketThreadLinkLookupRow } from "../../persistence/Services/TicketThreadLinks.ts";
import { TicketingService, type TicketingServiceShape } from "../Services/Ticketing.ts";
import {
  bodySizeBytes,
  countChangedLines,
  createContentHash,
  DEFAULT_TICKET_BODY_READ_LIMIT,
  findSection,
  makeBodyMetadata,
  makePatchExcerpt,
  markdownSections,
  splitLines,
  summarizeBodyOperation,
  TICKET_BODY_PREVIEW_LINE_LIMIT,
  TICKET_BODY_SIZE_CAP_BYTES,
} from "../bodyModel.ts";

const nowIso = () => new Date().toISOString();

/**
 * Maximum number of descendant nodes returned by `getTree({ rootTicketId })`.
 * Beyond this, the result is truncated and the client surfaces a "subtree is large"
 * affordance. Prevents pathological epics from blocking the ticket detail page.
 */
const SUBTREE_NODE_LIMIT = 500;

const toOperationError =
  (operation: string) =>
  (cause: unknown): TicketingError =>
    new TicketingOperationError({
      operation,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });

// ---------------------------------------------------------------------------
// Shipped defaults
// ---------------------------------------------------------------------------

const SHIPPED_DEFAULT_LABELS: ReadonlyArray<{ name: string; color: string }> = [
  { name: "idea", color: "#a855f7" },
  { name: "research", color: "#3b82f6" },
  { name: "bug", color: "#ef4444" },
  { name: "feature", color: "#22c55e" },
];

const SHIPPED_DEFAULT_TEMPLATES: ReadonlyArray<{
  name: string;
  description: string;
  body: string;
}> = [
  {
    name: "Idea",
    description: "Template for early-stage product ideas",
    body: "## Summary\n\n## Problem / Opportunity\n\n## Why Now\n\n## Hypotheses\n\n## Unknowns / Risks\n\n## Research Questions",
  },
  {
    name: "Bug",
    description: "Template for bug reports",
    body: "## Steps to Reproduce\n\n## Expected Behavior\n\n## Actual Behavior\n\n## Additional Context",
  },
  {
    name: "Feature",
    description: "Template for feature requests",
    body: "## Summary\n\n## Motivation\n\n## Acceptance Criteria\n\n## Additional Context",
  },
  {
    name: "Research",
    description: "Template for research tasks",
    body: "## Objective\n\n## Background\n\n## Key Questions\n\n## Findings",
  },
];

const deriveEpicStatus = (children: ReadonlyArray<{ status: TicketStatus }>): TicketStatus => {
  if (children.length === 0) return "backlog";
  const statuses = children.map((c) => c.status);
  if (statuses.some((s) => s === "in_progress" || s === "in_review" || s === "blocked"))
    return "in_progress";
  if (statuses.every((s) => s === "done")) return "done";
  if (statuses.every((s) => s === "canceled")) return "canceled";
  if (statuses.every((s) => s === "done" || s === "canceled")) return "done";
  return "todo";
};

const makeTicketingService = Effect.gen(function* () {
  const repo = yield* TicketingRepository;
  const projectionThreadRepository = yield* ProjectionThreadRepository;
  const ticketThreadLinkRepository = yield* TicketThreadLinkRepository;
  const fileSystem = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const eventsPubSub = yield* PubSub.unbounded<TicketingStreamEvent>();

  // Pre-bind the FileSystem + Path requirement so later helpers are `never`.
  const provideFsPath = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, pathService),
    );
  const provideFs = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
    effect.pipe(Effect.provideService(FileSystem.FileSystem, fileSystem));

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

  const toContractCriterion = (criterion: PersistedAcceptanceCriterion): AcceptanceCriterion => ({
    id: criterion.id as never,
    position: criterion.position,
    text: criterion.text,
    status: criterion.status,
    reason: criterion.reason,
    verifiedBy: criterion.verifiedBy,
    verifiedAt: criterion.verifiedAt as never,
    createdAt: criterion.createdAt,
    updatedAt: criterion.updatedAt,
  });

  const makePersistedCriteria = (
    ticketId: TicketId,
    criteria: ReadonlyArray<AcceptanceCriterion>,
    now: string,
  ): PersistedAcceptanceCriterion[] =>
    criteria.map((criterion, index) => ({
      id: criterion.id ?? crypto.randomUUID(),
      ticketId,
      position: (index + 1) * 100,
      text: criterion.text,
      status: criterion.status ?? "pending",
      reason: criterion.reason ?? null,
      verifiedBy: criterion.verifiedBy ?? null,
      verifiedAt: criterion.verifiedAt ?? null,
      createdAt: criterion.createdAt ?? now,
      updatedAt: now,
    }));

  const hydrateBody = (
    ticket: PersistedTicket,
  ): Effect.Effect<PersistedTicketBody, TicketingError> =>
    Effect.gen(function* () {
      const existing = yield* repo
        .getBody({ ticketId: ticket.id })
        .pipe(Effect.mapError(toOperationError("hydrateBody")));
      return yield* Option.match(existing, {
        onSome: Effect.succeed,
        onNone: () => {
          const body = ticket.description ?? "";
          const now = ticket.updatedAt;
          const persisted: PersistedTicketBody = {
            ticketId: ticket.id,
            format: "markdown",
            body,
            revision: 1,
            contentHash: createContentHash(body),
            sizeBytes: bodySizeBytes(body),
            createdAt: ticket.createdAt,
            updatedAt: now,
          };
          return repo
            .upsertBody(persisted)
            .pipe(Effect.as(persisted), Effect.mapError(toOperationError("hydrateBody")));
        },
      });
    });

  const hydrateCriteria = (
    ticket: PersistedTicket,
  ): Effect.Effect<ReadonlyArray<PersistedAcceptanceCriterion>, TicketingError> =>
    Effect.gen(function* () {
      const existing = yield* repo
        .listCriteria({ ticketId: ticket.id })
        .pipe(Effect.mapError(toOperationError("hydrateCriteria")));
      if (existing.length > 0) return existing;
      const criteria = makePersistedCriteria(
        ticket.id,
        ticket.acceptanceCriteria ?? [],
        ticket.updatedAt,
      );
      if (criteria.length > 0) {
        yield* repo
          .replaceCriteria({
            ticketId: ticket.id,
            criteria,
            criteriaRevision: ticket.criteriaRevision ?? 1,
            updatedAt: ticket.updatedAt,
          })
          .pipe(Effect.mapError(toOperationError("hydrateCriteria")));
      }
      return criteria;
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
    worktree: ticket.worktree,
    labels,
    subTicketCount,
    dependencyCount,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  });

  const batchBuildSummaries = (
    tickets: ReadonlyArray<PersistedTicket>,
  ): Effect.Effect<TicketSummary[], ProjectionRepositoryError> =>
    Effect.gen(function* () {
      if (tickets.length === 0) return [];
      const ids = tickets.map((t) => t.id);
      const [labelsMap, countsMap, depsMap] = yield* Effect.all([
        repo.batchListLabelsForTickets({ ticketIds: ids }),
        repo.batchCountByParents({ parentIds: ids }),
        repo.batchListDependencies({ ticketIds: ids }),
      ]);
      return tickets.map((t) =>
        buildTicketSummary(
          t,
          (labelsMap.get(t.id) ?? []) as Label[],
          countsMap.get(t.id) ?? 0,
          (depsMap.get(t.id) ?? []).length,
        ),
      );
    });

  const buildFullTicket = (
    ticket: PersistedTicket,
    options?: { readonly includeBody?: boolean },
  ): Effect.Effect<Ticket, TicketingError> =>
    Effect.gen(function* () {
      const labels = yield* repo.listLabelsForTicket({ ticketId: ticket.id });
      const deps = yield* repo.listDependencies({ ticketId: ticket.id });
      const subTickets = yield* repo.listByParent({ parentId: ticket.id });
      const comments = yield* repo.listCommentsByTicket({ ticketId: ticket.id });
      const artifacts = yield* repo.listArtifactsByTicket({ ticketId: ticket.id });
      const body = yield* hydrateBody(ticket);
      const criteria = yield* hydrateCriteria(ticket);

      const subSummaries = yield* batchBuildSummaries(subTickets);
      const bodyLines = splitLines(body.body);
      const includeBody = options?.includeBody ?? false;

      return {
        id: ticket.id,
        projectId: ticket.projectId,
        parentId: ticket.parentId,
        ticketNumber: ticket.ticketNumber,
        identifier: ticket.identifier as never,
        title: ticket.title as never,
        description: includeBody ? body.body : null,
        body: makeBodyMetadata(body.body, body.revision),
        bodyPreview: bodyLines.slice(0, TICKET_BODY_PREVIEW_LINE_LIMIT).map((text, index) => ({
          line: index + 1,
          text,
        })),
        status: ticket.status,
        priority: ticket.priority,
        sortOrder: ticket.sortOrder,
        isArchived: ticket.isArchived,
        worktree: ticket.worktree,
        acceptanceCriteria: criteria.map(toContractCriterion),
        criteriaRevision: ticket.criteriaRevision ?? 1,
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

  const publishTicketSummary = (
    ticketId: TicketId,
    operation: string,
    body?: {
      readonly revision: number;
      readonly contentHash: string;
      readonly sizeBytes: number;
      readonly summary?: string;
    },
  ): Effect.Effect<void, TicketingError> =>
    Effect.gen(function* () {
      const ticket = yield* resolveTicketOrFail(ticketId);
      const labels = yield* repo
        .listLabelsForTicket({ ticketId: ticket.id })
        .pipe(Effect.mapError(toOperationError(operation)));
      const subTicketCount = yield* repo
        .countByParent({ parentId: ticket.id })
        .pipe(Effect.mapError(toOperationError(operation)));
      const dependencyCount = (yield* repo
        .listDependencies({ ticketId: ticket.id })
        .pipe(Effect.mapError(toOperationError(operation)))).length;

      yield* publishEvent({
        type: "ticket_upserted",
        projectId: ticket.projectId,
        ticket: buildTicketSummary(ticket, labels as Label[], subTicketCount, dependencyCount),
        ...(body
          ? {
              body: {
                ticketId: ticket.id,
                revision: body.revision,
                contentHash: body.contentHash as never,
                sizeBytes: body.sizeBytes,
                ...(body.summary ? { summary: body.summary } : {}),
              },
            }
          : {}),
      });
    });

  const listAffectedTicketIdsForLabel = (
    labelId: LabelId,
    operation: string,
  ): Effect.Effect<ReadonlyArray<TicketId>, TicketingError> =>
    repo.listTicketIdsByLabelId({ labelId }).pipe(Effect.mapError(toOperationError(operation)));

  const toLinkedThread = (
    rows: ReadonlyArray<TicketThreadLinkLookupRow>,
    options?: {
      readonly preferredLinkTypes?: ReadonlyArray<TicketThreadLinkLookupRow["linkType"]>;
    },
  ): TicketLinkedThread | null => {
    const firstRow = rows[0];
    if (!firstRow || firstRow.threadDeletedAt !== null) {
      return null;
    }
    const preferredLinkTypes = options?.preferredLinkTypes ?? ["origin", "bound", "mention"];
    const relevantRows = rows
      .filter((row) => preferredLinkTypes.includes(row.linkType))
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
    const linkedRow = relevantRows[0];
    if (!linkedRow) {
      return null;
    }

    return {
      threadId: firstRow.threadId,
      title: firstRow.title as TicketLinkedThread["title"],
      createdAt: firstRow.threadCreatedAt,
      updatedAt: firstRow.threadUpdatedAt,
      archivedAt: firstRow.threadArchivedAt,
      isOrchestrationThread: firstRow.isOrchestrationThread,
      parentThreadId: firstRow.parentThreadId,
      linkedAt: linkedRow.createdAt,
    };
  };

  /** Re-publish a parent ticket's summary so clients see updated subTicketCount. */
  const notifyParent = (parentId: TicketId): Effect.Effect<void, TicketingError> =>
    publishTicketSummary(parentId, "notifyParent");

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
        const updatedParent = { ...parent, status: newStatus, updatedAt: now };
        yield* repo
          .updateTicket(updatedParent)
          .pipe(Effect.mapError(toOperationError("propagateEpicStatus")));
        yield* recordHistory(
          parent.id,
          "status_changed",
          {
            status: { old: parent.status, new: newStatus },
          },
          "system",
        ).pipe(Effect.mapError(toOperationError("propagateEpicStatus")));

        yield* publishTicketSummary(parent.id, "propagateEpicStatus");

        yield* propagateEpicStatus(parent.id, depth + 1);
      }
    });

  // ---- ID resolution ----

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const resolveId: TicketingServiceShape["resolveId"] = (idOrIdentifier) => {
    if (UUID_RE.test(idOrIdentifier)) {
      return Effect.succeed(TicketId.makeUnsafe(idOrIdentifier));
    }
    return repo.getByIdentifier({ identifier: idOrIdentifier }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail<TicketingError>(
              new TicketNotFoundError({ ticketId: idOrIdentifier as never }),
            ),
          onSome: (ticket) => Effect.succeed(ticket.id),
        }),
      ),
      Effect.mapError(toOperationError("resolveId")),
    );
  };

  const resolveIdentifiers: TicketingServiceShape["resolveIdentifiers"] = (ids) =>
    repo.getIdentifierMap(ids).pipe(Effect.mapError(toOperationError("resolveIdentifiers")));

  // ---- Service shape implementation ----

  const list: TicketingServiceShape["list"] = (input) =>
    Effect.gen(function* () {
      const tickets = yield* repo.listByProject(input);
      return yield* batchBuildSummaries(tickets);
    }).pipe(Effect.mapError(toOperationError("list")));

  const getById: TicketingServiceShape["getById"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* resolveTicketOrFail(TicketId.makeUnsafe(input.id));
      if (input.projectId && ticket.projectId !== input.projectId) {
        return yield* new TicketNotFoundError({ ticketId: input.id });
      }
      return yield* buildFullTicket(ticket, { includeBody: input.includeBody ?? false });
    });

  const getByIdentifier: TicketingServiceShape["getByIdentifier"] = (input) =>
    Effect.gen(function* () {
      const opt = yield* repo
        .getByIdentifier({
          identifier: input.identifier,
          ...(input.projectId ? { projectId: input.projectId } : {}),
        })
        .pipe(Effect.mapError(toOperationError("getByIdentifier")));
      const ticket = yield* Option.match(opt, {
        onNone: () =>
          Effect.fail<TicketingError>(
            new TicketNotFoundError({ ticketId: input.identifier as never }),
          ),
        onSome: Effect.succeed,
      });
      return yield* buildFullTicket(ticket, { includeBody: input.includeBody ?? false });
    });

  const getThreadLinks: TicketingServiceShape["getThreadLinks"] = (input) =>
    Effect.gen(function* () {
      yield* resolveTicketOrFail(input.ticketId);
      const rows = yield* ticketThreadLinkRepository
        .listByTicketId({ ticketId: input.ticketId, linkTypes: ["origin"] })
        .pipe(Effect.mapError(toOperationError("getThreadLinks")));

      const rowsByThreadId = new Map<string, TicketThreadLinkLookupRow[]>();
      for (const row of rows) {
        if (row.threadDeletedAt !== null) continue;
        const existing = rowsByThreadId.get(row.threadId) ?? [];
        existing.push(row);
        rowsByThreadId.set(row.threadId, existing);
      }

      const originCandidates = [...rowsByThreadId.values()]
        .map((threadRows) => ({
          threadId: threadRows[0]?.threadId ?? null,
          originRow: threadRows
            .filter((row) => row.linkType === "origin")
            .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))[0],
        }))
        .filter((candidate) => candidate.threadId !== null && candidate.originRow !== undefined)
        .toSorted((left, right) =>
          left.originRow!.createdAt.localeCompare(right.originRow!.createdAt),
        );
      if (originCandidates.length > 1) {
        yield* Effect.logWarning(
          "multiple origin-thread links found for ticket; choosing earliest",
          {
            ticketId: input.ticketId,
            threadIds: originCandidates.map((candidate) => candidate.threadId!),
          },
        );
      }
      const selectedOriginThreadId = originCandidates[0]?.threadId ?? null;
      const originThread = selectedOriginThreadId
        ? toLinkedThread(rowsByThreadId.get(selectedOriginThreadId) ?? [], {
            preferredLinkTypes: ["origin"],
          })
        : null;

      return {
        ticketId: input.ticketId,
        originThread,
      } satisfies TicketThreadLinks;
    });

  const getBody: TicketingServiceShape["getBody"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* resolveTicketOrFail(input.ticketId);
      const body = yield* hydrateBody(ticket);
      const allLines = splitLines(body.body);
      let startLine = input.startLine ?? 1;
      let endLine = allLines.length;
      let sectionHash: string | undefined;
      if (input.sectionPath && input.sectionPath.length > 0) {
        const section = findSection(body.body, input.sectionPath);
        if (!section) {
          return yield* new TicketingValidationError({
            field: "sectionPath",
            message: `Unknown section: ${input.sectionPath.join(" > ")}`,
          });
        }
        sectionHash = section.sectionHash;
        startLine = input.startLine ?? section.startLine;
        endLine = section.endLine;
      }
      const limit = input.limit ?? DEFAULT_TICKET_BODY_READ_LIMIT;
      const zeroBased = Math.max(0, startLine - 1);
      const lines = allLines
        .slice(zeroBased, Math.min(endLine, zeroBased + limit))
        .map((text, index) => ({
          line: startLine + index,
          text,
        }));
      return {
        ticketId: ticket.id,
        revision: body.revision,
        contentHash: body.contentHash as never,
        format: "markdown" as const,
        sizeBytes: body.sizeBytes,
        lineCount: allLines.length,
        startLine,
        limit,
        lines,
        truncated: zeroBased + limit < endLine,
        ...(sectionHash ? { sectionHash: sectionHash as never } : {}),
      };
    });

  const searchBody: TicketingServiceShape["searchBody"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* resolveTicketOrFail(input.ticketId);
      const body = yield* hydrateBody(ticket);
      const query = input.query.toLowerCase();
      const contextLines = input.contextLines ?? 2;
      const limit = input.limit ?? 20;
      const lines = splitLines(body.body);
      const matches = [];
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index]!.toLowerCase().includes(query)) continue;
        matches.push({
          line: index + 1,
          text: lines[index]!,
          before: lines
            .slice(Math.max(0, index - contextLines), index)
            .map((text, beforeIndex) => ({
              line: Math.max(1, index - contextLines + 1) + beforeIndex,
              text,
            })),
          after: lines.slice(index + 1, index + 1 + contextLines).map((text, afterIndex) => ({
            line: index + 2 + afterIndex,
            text,
          })),
        });
        if (matches.length >= limit) break;
      }
      return {
        ticketId: ticket.id,
        revision: body.revision,
        contentHash: body.contentHash as never,
        matches,
        truncated: matches.length >= limit,
      };
    });

  const getBodySections: TicketingServiceShape["getBodySections"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* resolveTicketOrFail(input.ticketId);
      const body = yield* hydrateBody(ticket);
      return {
        ticketId: ticket.id,
        revision: body.revision,
        contentHash: body.contentHash as never,
        sections: markdownSections(body.body, input.maxDepth),
      };
    });

  const editBody: TicketingServiceShape["editBody"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* resolveTicketOrFail(input.ticketId);
      const current = yield* hydrateBody(ticket);
      if (input.expectedRevision !== current.revision) {
        return yield* new TicketingValidationError({
          field: "expectedRevision",
          message: `Body revision mismatch: expected ${input.expectedRevision}, current ${current.revision}`,
        });
      }

      let nextBody = current.body;
      if (input.operation === "replace_body") {
        nextBody = input.body ?? "";
      } else if (input.operation === "insert") {
        if (input.insertLine === undefined || input.insertText === undefined) {
          return yield* new TicketingValidationError({
            field: "insertText",
            message: "insert requires insertLine and insertText",
          });
        }
        const lines = splitLines(current.body);
        const requestedLine = input.insertLine === 0 ? 0 : input.insertLine - 1;
        const index = Math.min(Math.max(requestedLine, 0), lines.length);
        lines.splice(index, 0, ...splitLines(input.insertText));
        nextBody = lines.join("\n");
      } else if (input.operation === "str_replace") {
        if (input.oldStr === undefined || input.newStr === undefined) {
          return yield* new TicketingValidationError({
            field: "oldStr",
            message: "str_replace requires oldStr and newStr",
          });
        }
        const first = current.body.indexOf(input.oldStr);
        const last = current.body.lastIndexOf(input.oldStr);
        if (first < 0) {
          return yield* new TicketingValidationError({ field: "oldStr", message: "No match" });
        }
        if ((input.requireUnique ?? true) && first !== last) {
          return yield* new TicketingValidationError({
            field: "oldStr",
            message: "Ambiguous match; set requireUnique false with occurrence",
          });
        }
        if (input.occurrence === "all") {
          nextBody = current.body.split(input.oldStr).join(input.newStr);
        } else {
          const position = input.occurrence === "last" ? last : first;
          nextBody =
            current.body.slice(0, position) +
            input.newStr +
            current.body.slice(position + input.oldStr.length);
        }
      } else if (input.operation === "replace_section") {
        const sectionPath = input.sectionPath ?? [];
        const section = findSection(current.body, sectionPath);
        if (!section) {
          return yield* new TicketingValidationError({
            field: "sectionPath",
            message: `Unknown section: ${sectionPath.join(" > ")}`,
          });
        }
        if (input.expectedSectionHash !== section.sectionHash) {
          return yield* new TicketingValidationError({
            field: "expectedSectionHash",
            message: "Section hash mismatch",
          });
        }
        const lines = splitLines(current.body);
        const headingLine = lines[section.startLine - 1] ?? `# ${section.heading}`;
        const replacement = [headingLine, ...(input.markdown ? splitLines(input.markdown) : [])];
        lines.splice(
          section.startLine - 1,
          section.endLine - section.startLine + 1,
          ...replacement,
        );
        nextBody = lines.join("\n");
      } else if (input.operation === "append_section") {
        if (input.expectedSectionHash !== undefined && input.parentSectionPath) {
          const parent = findSection(current.body, input.parentSectionPath);
          if (!parent || parent.sectionHash !== input.expectedSectionHash) {
            return yield* new TicketingValidationError({
              field: "expectedSectionHash",
              message: "Section hash mismatch",
            });
          }
        }
        const heading = input.heading ?? "Notes";
        const markdown = input.markdown ?? "";
        const prefix = current.body.trimEnd() ? "\n\n" : "";
        nextBody = `${current.body.trimEnd()}${prefix}## ${heading}\n\n${markdown}`.trimEnd();
      }

      if (bodySizeBytes(nextBody) > TICKET_BODY_SIZE_CAP_BYTES) {
        return yield* new TicketingValidationError({ field: "body", message: "body_too_large" });
      }
      const now = nowIso();
      const beforeHash = current.contentHash;
      const afterHash = createContentHash(nextBody);
      const revision = current.revision + 1;
      yield* repo
        .upsertBody({
          ticketId: ticket.id,
          format: "markdown",
          body: nextBody,
          revision,
          contentHash: afterHash,
          sizeBytes: bodySizeBytes(nextBody),
          createdAt: current.createdAt,
          updatedAt: now,
        })
        .pipe(Effect.mapError(toOperationError("editBody")));
      const changedLines = countChangedLines(current.body, nextBody);
      const changedChars = Math.abs(nextBody.length - current.body.length);
      const summary = summarizeBodyOperation(input.operation);
      yield* repo
        .recordBodyChange({
          id: crypto.randomUUID(),
          ticketId: ticket.id,
          baseRevision: current.revision,
          newRevision: revision,
          operation: input.operation,
          patchExcerpt: makePatchExcerpt(current.body, nextBody),
          summary,
          beforeHash,
          afterHash,
          changedLines,
          changedChars,
          performedBy: "user",
          performedAt: now,
        })
        .pipe(Effect.mapError(toOperationError("editBody")));
      yield* recordHistory(
        ticket.id,
        "body_updated",
        {
          operation: input.operation,
          baseRevision: current.revision,
          newRevision: revision,
          beforeHash,
          afterHash,
          changedLines,
          changedChars,
        },
        "user",
      ).pipe(Effect.mapError(toOperationError("editBody")));
      yield* publishTicketSummary(ticket.id, "editBody", {
        revision,
        contentHash: afterHash,
        sizeBytes: bodySizeBytes(nextBody),
        summary,
      });
      return {
        ticketId: ticket.id,
        revision,
        contentHash: afterHash as never,
        sizeBytes: bodySizeBytes(nextBody),
        lineCount: splitLines(nextBody).length,
        changedLines,
        changedChars,
        summary,
      };
    });

  const listCriteria: TicketingServiceShape["listCriteria"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* resolveTicketOrFail(input.ticketId);
      const criteria = yield* hydrateCriteria(ticket);
      return {
        ticketId: ticket.id,
        criteriaRevision: ticket.criteriaRevision ?? 1,
        criteria: criteria.map(toContractCriterion),
      };
    });

  const editCriteria: TicketingServiceShape["editCriteria"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* resolveTicketOrFail(input.ticketId);
      if (input.expectedCriteriaRevision !== (ticket.criteriaRevision ?? 1)) {
        return yield* new TicketingValidationError({
          field: "expectedCriteriaRevision",
          message: `Criteria revision mismatch: expected ${input.expectedCriteriaRevision}, current ${ticket.criteriaRevision ?? 1}`,
        });
      }
      const now = nowIso();
      const current = [...(yield* hydrateCriteria(ticket))];
      let next = current.map((criterion) => ({ ...criterion }));
      if (input.operation === "add") {
        if (!input.text?.trim()) {
          return yield* new TicketingValidationError({
            field: "text",
            message: "Text is required",
          });
        }
        const created: PersistedAcceptanceCriterion = {
          id: crypto.randomUUID(),
          ticketId: ticket.id,
          position: 0,
          text: input.text.trim(),
          status: input.status ?? "pending",
          reason: input.reason ?? null,
          verifiedBy: input.verifiedBy ?? null,
          verifiedAt: input.verifiedAt ?? null,
          createdAt: now,
          updatedAt: now,
        };
        const anchorIndex = input.afterCriterionId
          ? next.findIndex((criterion) => criterion.id === input.afterCriterionId)
          : input.beforeCriterionId
            ? next.findIndex((criterion) => criterion.id === input.beforeCriterionId)
            : -1;
        if (input.beforeCriterionId && anchorIndex >= 0) next.splice(anchorIndex, 0, created);
        else if (anchorIndex >= 0) next.splice(anchorIndex + 1, 0, created);
        else next.push(created);
      } else if (input.operation === "update") {
        if (!input.criterionId || !next.some((criterion) => criterion.id === input.criterionId)) {
          return yield* new TicketingValidationError({
            field: "criterionId",
            message: "Unknown criterion ID",
          });
        }
        next = next.map((criterion) =>
          criterion.id === input.criterionId
            ? {
                ...criterion,
                ...(input.text !== undefined ? { text: input.text } : {}),
                ...(input.status !== undefined ? { status: input.status } : {}),
                ...(input.reason !== undefined ? { reason: input.reason } : {}),
                ...(input.verifiedBy !== undefined ? { verifiedBy: input.verifiedBy } : {}),
                ...(input.verifiedAt !== undefined ? { verifiedAt: input.verifiedAt } : {}),
                updatedAt: now,
              }
            : criterion,
        );
      } else if (input.operation === "remove") {
        if (!input.criterionId || !next.some((criterion) => criterion.id === input.criterionId)) {
          return yield* new TicketingValidationError({
            field: "criterionId",
            message: "Unknown criterion ID",
          });
        }
        next = next.filter((criterion) => criterion.id !== input.criterionId);
      } else if (input.operation === "reorder") {
        const ids = input.criterionIds ?? [];
        const byId = new Map(next.map((criterion) => [criterion.id, criterion]));
        if (ids.length !== next.length || ids.some((id) => !byId.has(id))) {
          return yield* new TicketingValidationError({
            field: "criterionIds",
            message: "Reorder must include every current criterion ID exactly once",
          });
        }
        next = ids.map((id) => byId.get(id)!);
      }
      next = next.map((criterion, index) => ({
        ...criterion,
        position: (index + 1) * 100,
        updatedAt: criterion.updatedAt,
      }));
      const nextRevision = (ticket.criteriaRevision ?? 1) + 1;
      yield* repo
        .replaceCriteria({
          ticketId: ticket.id,
          criteria: next,
          criteriaRevision: nextRevision,
          updatedAt: now,
        })
        .pipe(Effect.mapError(toOperationError("editCriteria")));
      yield* recordHistory(
        ticket.id,
        "criteria_updated",
        {
          operation: input.operation,
          criteriaRevision: { old: ticket.criteriaRevision ?? 1, new: nextRevision },
        },
        "user",
      ).pipe(Effect.mapError(toOperationError("editCriteria")));
      yield* publishTicketSummary(ticket.id, "editCriteria");
      return {
        ticketId: ticket.id,
        criteriaRevision: nextRevision,
        criteria: next.map(toContractCriterion),
      };
    });

  const create: TicketingServiceShape["create"] = (input) =>
    Effect.gen(function* () {
      const now = nowIso();
      const id = TicketId.makeUnsafe(crypto.randomUUID());
      if (input.originThreadId) {
        const originThread = yield* projectionThreadRepository
          .getById({ threadId: input.originThreadId })
          .pipe(Effect.mapError(toOperationError("create")));
        const resolvedOriginThread = yield* Option.match(originThread, {
          onNone: () =>
            Effect.fail<TicketingError>(
              new TicketingValidationError({
                field: "originThreadId",
                message: `Unknown origin thread: ${input.originThreadId}`,
              }),
            ),
          onSome: Effect.succeed,
        });
        if (resolvedOriginThread.projectId !== input.projectId) {
          return yield* new TicketingValidationError({
            field: "originThreadId",
            message: "Origin thread must belong to the same project as the ticket",
          });
        }
        if (resolvedOriginThread.deletedAt !== null) {
          return yield* new TicketingValidationError({
            field: "originThreadId",
            message: "Origin thread has been deleted",
          });
        }
      }
      const { ticketNumber, identifier } = yield* repo
        .allocateTicketNumber({ projectId: input.projectId })
        .pipe(Effect.mapError(toOperationError("create")));

      // If a templateId is provided and no description was given, pre-fill from template
      let description = input.description ?? null;
      if (input.templateId && !input.description) {
        const templateOpt = yield* repo
          .getTemplate({ id: input.templateId })
          .pipe(Effect.mapError(toOperationError("create")));
        const template = yield* Option.match(templateOpt, {
          onNone: () =>
            Effect.fail<TicketingError>(
              new TemplateNotFoundError({ templateId: input.templateId! }),
            ),
          onSome: Effect.succeed,
        });
        description = template.body;
      }

      const ticket: PersistedTicket = {
        id,
        projectId: input.projectId,
        parentId: input.parentId ?? null,
        ticketNumber,
        identifier,
        title: input.title,
        description,
        acceptanceCriteria: input.acceptanceCriteria ?? null,
        status: input.status ?? "backlog",
        priority: input.priority ?? "none",
        sortOrder: input.sortOrder ?? 0,
        isArchived: false,
        worktree: input.worktree ?? null,
        criteriaRevision: 1,
        createdAt: now,
        updatedAt: now,
      };

      yield* repo.createTicket(ticket).pipe(Effect.mapError(toOperationError("create")));
      yield* repo
        .upsertBody({
          ticketId: id,
          format: "markdown",
          body: description ?? "",
          revision: 1,
          contentHash: createContentHash(description ?? ""),
          sizeBytes: bodySizeBytes(description ?? ""),
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.mapError(toOperationError("create")));
      const criteriaRows = makePersistedCriteria(id, input.acceptanceCriteria ?? [], now);
      if (criteriaRows.length > 0) {
        yield* repo
          .replaceCriteria({
            ticketId: id,
            criteria: criteriaRows,
            criteriaRevision: 1,
            updatedAt: now,
          })
          .pipe(Effect.mapError(toOperationError("create")));
      }
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
      if (input.originThreadId) {
        yield* ticketThreadLinkRepository
          .upsertStructuredLink({
            ticketId: id,
            threadId: input.originThreadId,
            linkType: "origin",
            occurredAt: now,
          })
          .pipe(Effect.mapError(toOperationError("create")));
      }

      const full = yield* buildFullTicket(ticket);

      yield* publishTicketSummary(id, "create");

      // Notify the parent so clients see the updated subTicketCount
      if (ticket.parentId) {
        yield* notifyParent(ticket.parentId);
      }

      return full;
    });

  const update: TicketingServiceShape["update"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* resolveTicketOrFail(input.id);
      const now = nowIso();

      const changes: Record<string, { old: unknown; new: unknown }> = {};
      const patch: Record<string, unknown> = { updatedAt: now };
      let bodyEvent:
        | {
            readonly revision: number;
            readonly contentHash: string;
            readonly sizeBytes: number;
            readonly summary?: string;
          }
        | undefined;

      if (input.title !== undefined) {
        changes.title = { old: existing.title, new: input.title };
        patch.title = input.title;
      }
      if (input.description !== undefined) {
        const body = yield* hydrateBody(existing);
        if (input.expectedRevision !== undefined && input.expectedRevision !== body.revision) {
          return yield* new TicketingValidationError({
            field: "expectedRevision",
            message: `Body revision mismatch: expected ${input.expectedRevision}, current ${body.revision}`,
          });
        }
        const nextBody = input.description ?? "";
        if (bodySizeBytes(nextBody) > TICKET_BODY_SIZE_CAP_BYTES) {
          return yield* new TicketingValidationError({
            field: "description",
            message: "body_too_large",
          });
        }
        changes.description = {
          old: { revision: body.revision, contentHash: body.contentHash },
          new: { revision: body.revision + 1, contentHash: createContentHash(nextBody) },
        };
        patch.description = input.description ?? null;
      }
      if (input.acceptanceCriteria !== undefined) {
        if (
          input.expectedCriteriaRevision !== undefined &&
          input.expectedCriteriaRevision !== (existing.criteriaRevision ?? 1)
        ) {
          return yield* new TicketingValidationError({
            field: "expectedCriteriaRevision",
            message: `Criteria revision mismatch: expected ${input.expectedCriteriaRevision}, current ${existing.criteriaRevision ?? 1}`,
          });
        }
        changes.acceptanceCriteria = {
          old: existing.acceptanceCriteria,
          new: input.acceptanceCriteria,
        };
        patch.acceptanceCriteria = input.acceptanceCriteria ?? null;
        patch.criteriaRevision = (existing.criteriaRevision ?? 1) + 1;
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
      if (input.worktree !== undefined) {
        changes.worktree = { old: existing.worktree, new: input.worktree };
        patch.worktree = input.worktree ?? null;
      }

      const updated = { ...existing, ...patch } as PersistedTicket;

      yield* repo.updateTicket(updated).pipe(Effect.mapError(toOperationError("update")));

      if (input.description !== undefined) {
        const before = yield* hydrateBody(existing);
        const afterBody = input.description ?? "";
        const afterHash = createContentHash(afterBody);
        const afterSizeBytes = bodySizeBytes(afterBody);
        yield* repo
          .upsertBody({
            ticketId: input.id,
            format: "markdown",
            body: afterBody,
            revision: before.revision + 1,
            contentHash: afterHash,
            sizeBytes: afterSizeBytes,
            createdAt: before.createdAt,
            updatedAt: now,
          })
          .pipe(Effect.mapError(toOperationError("update")));
        bodyEvent = {
          revision: before.revision + 1,
          contentHash: afterHash,
          sizeBytes: afterSizeBytes,
          summary: "Replaced full ticket body",
        };
      }
      if (input.acceptanceCriteria !== undefined) {
        yield* repo
          .replaceCriteria({
            ticketId: input.id,
            criteria: makePersistedCriteria(input.id, input.acceptanceCriteria ?? [], now),
            criteriaRevision: updated.criteriaRevision ?? 1,
            updatedAt: now,
          })
          .pipe(Effect.mapError(toOperationError("update")));
      }

      const historyAction = changes.status ? "status_changed" : "updated";
      yield* recordHistory(input.id, historyAction, changes, "user").pipe(
        Effect.mapError(toOperationError("update")),
      );

      // Propagate epic status if a child ticket's status changed
      if (changes.status && updated.parentId) {
        yield* propagateEpicStatus(input.id, 0);
      }

      const full = yield* buildFullTicket(updated);

      yield* publishTicketSummary(input.id, "update", bodyEvent);

      // When parentId changes, notify both old and new parents so counts stay fresh
      if (changes.parentId) {
        const oldParentId = changes.parentId.old as TicketId | null;
        const newParentId = changes.parentId.new as TicketId | null;
        if (oldParentId) yield* notifyParent(oldParentId);
        if (newParentId) yield* notifyParent(newParentId);
      }

      return full;
    });

  const cleanupOwnerAttachments = (owner: AttachmentOwner): Effect.Effect<void, TicketingError> =>
    Effect.gen(function* () {
      const rows = yield* repo
        .deleteTicketingAttachmentsByOwner({ ownerKind: owner.kind, ownerId: owner.id })
        .pipe(Effect.mapError(toOperationError("cleanupOwnerAttachments")));
      yield* Effect.forEach(
        rows,
        (row) =>
          provideFs(
            deleteAttachmentFile({
              attachmentsDir: serverConfig.attachmentsDir,
              relativePath: row.relativePath,
            }),
          ).pipe(Effect.catch(() => Effect.void)),
        { concurrency: "unbounded" },
      );
    });

  const del: TicketingServiceShape["delete"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* resolveTicketOrFail(input.id);

      // Collect the subtree so we can clean up attachments for every descendant
      // before the SQL CASCADE drops their rows.
      const subtree: ReadonlyArray<PersistedTicket> = yield* collectSubtree(input.id).pipe(
        Effect.catch(() => Effect.succeed<ReadonlyArray<PersistedTicket>>([])),
      );
      const commentOwnerIds: string[] = [];
      for (const t of subtree) {
        const comments = yield* repo
          .listCommentsByTicket({ ticketId: t.id, limit: 10_000, offset: 0 })
          .pipe(Effect.mapError(toOperationError("delete")));
        for (const c of comments) commentOwnerIds.push(c.id);
        yield* cleanupOwnerAttachments({ kind: "ticket", id: t.id });
      }
      for (const commentId of commentOwnerIds) {
        yield* cleanupOwnerAttachments({ kind: "comment", id: commentId });
      }

      yield* repo.deleteTicket({ id: input.id }).pipe(Effect.mapError(toOperationError("delete")));
      yield* publishEvent({
        type: "ticket_deleted",
        projectId: ticket.projectId,
        ticketId: input.id,
      });

      // Notify the parent so clients see the updated subTicketCount
      if (ticket.parentId) {
        yield* notifyParent(ticket.parentId);
      }
    });

  /**
   * BFS over parentId to collect the root plus all descendants.
   * Used by archive/unarchive to cascade the operation through the subtree.
   */
  const collectSubtree = (
    rootId: TicketId,
  ): Effect.Effect<ReadonlyArray<PersistedTicket>, TicketingError> =>
    Effect.gen(function* () {
      const root = yield* resolveTicketOrFail(rootId);
      const collected: PersistedTicket[] = [root];
      const queue: TicketId[] = [root.id];
      while (queue.length > 0) {
        const currentId = queue.shift() as TicketId;
        const children = yield* repo
          .listByParent({ parentId: currentId })
          .pipe(Effect.mapError(toOperationError("collectSubtree")));
        for (const child of children) {
          collected.push(child);
          queue.push(child.id);
        }
      }
      return collected;
    });

  const archive: TicketingServiceShape["archive"] = (input) =>
    Effect.gen(function* () {
      const subtree = yield* collectSubtree(input.id);
      const now = nowIso();
      for (const node of subtree) {
        if (node.isArchived) continue;
        yield* repo
          .archiveTicket({ id: node.id })
          .pipe(Effect.mapError(toOperationError("archive")));
        yield* recordHistory(
          node.id,
          "updated",
          { isArchived: { old: false, new: true } },
          "user",
        ).pipe(Effect.mapError(toOperationError("archive")));
        const updated = { ...node, isArchived: true, updatedAt: now } as PersistedTicket;
        yield* publishEvent({
          type: "ticket_upserted",
          projectId: updated.projectId,
          ticket: yield* Effect.gen(function* () {
            const labels = yield* repo
              .listLabelsForTicket({ ticketId: updated.id })
              .pipe(Effect.mapError(toOperationError("archive")));
            const subTicketCount = yield* repo
              .countByParent({ parentId: updated.id })
              .pipe(Effect.mapError(toOperationError("archive")));
            const deps = yield* repo
              .listDependencies({ ticketId: updated.id })
              .pipe(Effect.mapError(toOperationError("archive")));
            return buildTicketSummary(updated, labels as Label[], subTicketCount, deps.length);
          }),
        });
      }
      const rootAfter = yield* resolveTicketOrFail(input.id);
      // Notify the parent so boards drop the archived card (subTicketCount unchanged
      // but the archived card should no longer appear in the default filtered list).
      if (rootAfter.parentId) {
        yield* notifyParent(rootAfter.parentId);
      }
      return yield* buildFullTicket(rootAfter);
    });

  const unarchive: TicketingServiceShape["unarchive"] = (input) =>
    Effect.gen(function* () {
      const subtree = yield* collectSubtree(input.id);
      const now = nowIso();
      for (const node of subtree) {
        if (!node.isArchived) continue;
        yield* repo
          .unarchiveTicket({ id: node.id })
          .pipe(Effect.mapError(toOperationError("unarchive")));
        yield* recordHistory(
          node.id,
          "updated",
          { isArchived: { old: true, new: false } },
          "user",
        ).pipe(Effect.mapError(toOperationError("unarchive")));
        const updated = { ...node, isArchived: false, updatedAt: now } as PersistedTicket;
        yield* publishEvent({
          type: "ticket_upserted",
          projectId: updated.projectId,
          ticket: yield* Effect.gen(function* () {
            const labels = yield* repo
              .listLabelsForTicket({ ticketId: updated.id })
              .pipe(Effect.mapError(toOperationError("unarchive")));
            const subTicketCount = yield* repo
              .countByParent({ parentId: updated.id })
              .pipe(Effect.mapError(toOperationError("unarchive")));
            const deps = yield* repo
              .listDependencies({ ticketId: updated.id })
              .pipe(Effect.mapError(toOperationError("unarchive")));
            return buildTicketSummary(updated, labels as Label[], subTicketCount, deps.length);
          }),
        });
      }
      const rootAfter = yield* resolveTicketOrFail(input.id);
      if (rootAfter.parentId) {
        yield* notifyParent(rootAfter.parentId);
      }
      return yield* buildFullTicket(rootAfter);
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
      // When rootTicketId is set, use a recursive CTE bounded to the subtree of that
      // ticket — avoids loading the entire project. Without rootTicketId, fall back
      // to listing the whole project (used by orchestration views).
      const rawTickets = input.rootTicketId
        ? yield* repo
            .listSubtree({
              projectId: input.projectId,
              rootTicketId: input.rootTicketId,
              limit: SUBTREE_NODE_LIMIT,
            })
            .pipe(Effect.mapError(toOperationError("getTree")))
        : yield* repo
            .listByProject({
              projectId: input.projectId,
              includeArchived: false,
            })
            .pipe(Effect.mapError(toOperationError("getTree")));

      // Detect truncation: listSubtree fetches limit + 1 to signal overflow.
      const truncated = input.rootTicketId ? rawTickets.length > SUBTREE_NODE_LIMIT : false;
      const allTickets = truncated ? rawTickets.slice(0, SUBTREE_NODE_LIMIT) : rawTickets;

      if (allTickets.length === 0) {
        return { roots: [], truncated, totalCount: 0 };
      }

      const ids = allTickets.map((t) => t.id);
      const [labelsMap, countsMap, depsMap] = yield* Effect.all([
        repo.batchListLabelsForTickets({ ticketIds: ids }),
        repo.batchCountByParents({ parentIds: ids }),
        repo.batchListDependencies({ ticketIds: ids }),
      ]).pipe(Effect.mapError(toOperationError("getTree")));

      // Build tree from flat list
      const summaryMap = new Map<string, TicketSummary>();
      const childrenMap = new Map<string, TicketSummary[]>();

      for (const t of allTickets) {
        const summary = buildTicketSummary(
          t,
          (labelsMap.get(t.id) ?? []) as Label[],
          countsMap.get(t.id) ?? 0,
          (depsMap.get(t.id) ?? []).length,
        );
        summaryMap.set(t.id, summary);
        if (t.parentId) {
          const siblings = childrenMap.get(t.parentId) ?? [];
          siblings.push(summary);
          childrenMap.set(t.parentId, siblings);
        }
      }

      const ticketDepsMap = new Map<string, TicketDependency[]>();
      for (const t of allTickets) {
        ticketDepsMap.set(t.id, (depsMap.get(t.id) ?? []) as TicketDependency[]);
      }

      const buildNode = (summary: TicketSummary): TicketTreeNode => ({
        ticket: summary,
        children: (childrenMap.get(summary.id) ?? []).map(buildNode),
        dependencies: ticketDepsMap.get(summary.id) ?? [],
      });

      // Root nodes are those with no parent or with rootTicketId as parent.
      const rootParentId = input.rootTicketId ?? null;
      const roots = allTickets
        .filter((t) => t.parentId === rootParentId)
        .map((t) => summaryMap.get(t.id)!)
        .filter(Boolean)
        .map(buildNode);

      return { roots, truncated, totalCount: allTickets.length };
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
          return yield* new DependencyCycleError({
            ticketId: input.ticketId,
            dependsOnTicketId: depId,
            cycle: [ticket.identifier as never, depTicket.identifier as never],
          });
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
        return yield* new DependencyCycleError({
          ticketId: input.ticketId,
          dependsOnTicketId: input.dependsOnTicketId,
          cycle: [ticket.identifier as never, depTicket.identifier as never],
        });
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
      const criteria = yield* hydrateCriteria(ticket);
      if (criteria.length === 0) {
        return yield* new TicketingValidationError({
          field: "acceptanceCriteria",
          message: "Ticket has no acceptance criteria",
        });
      }
      if (input.index < 0 || input.index >= criteria.length) {
        return yield* new TicketingValidationError({
          field: "index",
          message: `Index ${input.index} out of range (0-${criteria.length - 1})`,
        });
      }
      yield* editCriteria({
        ticketId: input.ticketId,
        expectedCriteriaRevision: ticket.criteriaRevision ?? 1,
        operation: "update",
        criterionId: criteria[input.index]!.id,
        status: input.status,
        reason: input.reason ?? null,
        verifiedBy: "user",
        verifiedAt: nowIso() as never,
      });
      const updated = yield* resolveTicketOrFail(input.ticketId);
      return yield* buildFullTicket(updated);
    });

  // History
  const getHistory: TicketingServiceShape["getHistory"] = (input) =>
    repo.listHistoryByTicket(input).pipe(
      Effect.map((rows) => rows as ReadonlyArray<import("@t3tools/contracts").TicketHistoryEntry>),
      Effect.mapError(toOperationError("getHistory")),
    );

  // Labels
  const listLabels: TicketingServiceShape["listLabels"] = (input) =>
    repo.listLabels({ projectId: input.projectId ?? null }).pipe(
      Effect.map((rows) => rows as ReadonlyArray<Label>),
      Effect.mapError(toOperationError("listLabels")),
    );

  const createLabel: TicketingServiceShape["createLabel"] = (input) =>
    Effect.gen(function* () {
      const now = nowIso();
      const id = LabelId.makeUnsafe(crypto.randomUUID());
      const label = {
        id,
        projectId: input.projectId ?? null,
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
      const affectedTicketIds = yield* listAffectedTicketIdsForLabel(label.id, "updateLabel");
      const now = nowIso();
      const updated = {
        ...label,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        updatedAt: now,
      };
      yield* repo.updateLabel(updated).pipe(Effect.mapError(toOperationError("updateLabel")));
      yield* publishEvent({ type: "label_upserted", label: updated as Label });
      for (const ticketId of affectedTicketIds) {
        yield* publishTicketSummary(ticketId, "updateLabel");
      }
      return updated as Label;
    });

  const deleteLabel: TicketingServiceShape["deleteLabel"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* repo
        .getLabel({ id: input.id })
        .pipe(Effect.mapError(toOperationError("deleteLabel")));
      const affectedTicketIds = yield* Option.match(existing, {
        onNone: () => Effect.succeed([] as ReadonlyArray<TicketId>),
        onSome: (label) => listAffectedTicketIdsForLabel(label.id, "deleteLabel"),
      });
      yield* repo
        .deleteLabel({ id: input.id })
        .pipe(Effect.mapError(toOperationError("deleteLabel")));
      yield* publishEvent({ type: "label_deleted", labelId: input.id });
      for (const ticketId of affectedTicketIds) {
        yield* publishTicketSummary(ticketId, "deleteLabel");
      }
    });

  const addTicketLabel: TicketingServiceShape["addTicketLabel"] = (input) =>
    Effect.gen(function* () {
      yield* repo
        .addTicketLabel({ ticketId: input.ticketId, labelId: input.labelId })
        .pipe(Effect.mapError(toOperationError("addTicketLabel")));
      yield* recordHistory(input.ticketId, "label_added", { labelId: input.labelId }, "user").pipe(
        Effect.mapError(toOperationError("addTicketLabel")),
      );
      yield* publishTicketSummary(input.ticketId, "addTicketLabel");
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
      yield* publishTicketSummary(input.ticketId, "removeTicketLabel");
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
          return yield* new TicketingValidationError({
            field: "parentId",
            message: "Cannot reply to a reply — only top-level comments can have replies",
          });
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
      yield* cleanupOwnerAttachments({ kind: "comment", id: input.id });
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

  const ingestIfImagePayload = (
    type: string,
    payload: unknown,
    owner: AttachmentOwner,
  ): Effect.Effect<
    { payload: unknown; storedAttachment: PersistedTicketingAttachment | null },
    TicketingError
  > =>
    Effect.gen(function* () {
      if (type !== "image" || typeof payload !== "object" || payload === null) {
        return { payload, storedAttachment: null } as const;
      }
      const obj = payload as Record<string, unknown>;

      const rawDataUrl = typeof obj.dataUrl === "string" ? obj.dataUrl : null;
      const rawFromAttachmentId =
        typeof obj.fromAttachmentId === "string" ? obj.fromAttachmentId : null;
      const rawName = typeof obj.name === "string" ? obj.name : null;
      const rawMime = typeof obj.mimeType === "string" ? obj.mimeType : null;
      const alt = typeof obj.alt === "string" ? obj.alt : null;
      const width = typeof obj.width === "number" ? obj.width : null;
      const height = typeof obj.height === "number" ? obj.height : null;

      if (!rawDataUrl && !rawFromAttachmentId) {
        return { payload, storedAttachment: null } as const;
      }

      const ingested = yield* (
        rawDataUrl
          ? provideFsPath(
              ingestDataUrl({
                attachmentsDir: serverConfig.attachmentsDir,
                owner,
                dataUrl: rawDataUrl,
                name: rawName ?? "attachment",
              }),
            )
          : provideFsPath(
              copyExistingAttachment({
                attachmentsDir: serverConfig.attachmentsDir,
                owner,
                sourceAttachmentId: rawFromAttachmentId!,
                name: rawName ?? rawFromAttachmentId!,
                mimeType: rawMime ?? "image/png",
              }),
            )
      ).pipe(
        Effect.mapError((cause: AttachmentIngestError) =>
          toOperationError("createArtifact")(cause),
        ),
      );

      const storedAttachment: PersistedTicketingAttachment = {
        id: ingested.id,
        ownerKind: owner.kind,
        ownerId: owner.id,
        relativePath: ingested.relativePath,
        name: ingested.name,
        mimeType: ingested.mimeType,
        sizeBytes: ingested.sizeBytes,
        width,
        height,
        alt,
        createdAt: nowIso(),
      };
      yield* repo
        .createTicketingAttachment(storedAttachment)
        .pipe(Effect.mapError(toOperationError("createArtifact")));

      const resolvedPayload = {
        storage: "local",
        attachmentId: ingested.id,
        name: ingested.name,
        mimeType: ingested.mimeType,
        sizeBytes: ingested.sizeBytes,
        ...(width !== null ? { width } : {}),
        ...(height !== null ? { height } : {}),
        ...(alt !== null ? { alt } : {}),
      };

      return { payload: resolvedPayload, storedAttachment } as const;
    });

  const createArtifact: TicketingServiceShape["createArtifact"] = (input) =>
    Effect.gen(function* () {
      const ticketId = input.ticketId ?? null;
      const commentId = input.commentId ?? null;
      if (!ticketId && !commentId) {
        return yield* new TicketingValidationError({
          field: "ticketId/commentId",
          message: "Either ticketId or commentId must be provided",
        });
      }
      if (ticketId && commentId) {
        return yield* new TicketingValidationError({
          field: "ticketId/commentId",
          message: "Only one of ticketId or commentId can be provided",
        });
      }

      const owner: AttachmentOwner = ticketId
        ? { kind: "ticket", id: ticketId }
        : { kind: "comment", id: commentId! };

      const { payload } = yield* ingestIfImagePayload(input.type, input.payload, owner);

      const now = nowIso();
      const id = ArtifactId.makeUnsafe(crypto.randomUUID());
      const artifact = {
        id,
        ticketId,
        commentId,
        type: input.type,
        title: input.title ?? null,
        payload,
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

      yield* publishEvent({
        type: "artifact_upserted",
        ticketId,
        commentId,
        artifact: artifact as Artifact,
      });

      return artifact as Artifact;
    });

  const updateArtifact: TicketingServiceShape["updateArtifact"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* repo
        .getArtifact({ id: input.id })
        .pipe(Effect.mapError(toOperationError("updateArtifact")));
      const current = yield* Option.match(existing, {
        onNone: () =>
          Effect.fail<TicketingError>(
            new TicketingOperationError({
              operation: "updateArtifact",
              message: `Artifact not found: ${input.id}`,
            }),
          ),
        onSome: Effect.succeed,
      });

      const now = nowIso();
      const nextTitle = input.title === undefined ? current.title : input.title;
      yield* repo
        .updateArtifactTitle({ id: input.id, title: nextTitle, updatedAt: now })
        .pipe(Effect.mapError(toOperationError("updateArtifact")));

      const updated: Artifact = {
        ...(current as Artifact),
        title: nextTitle,
        updatedAt: now,
      };

      if (current.ticketId) {
        yield* recordHistory(
          current.ticketId,
          "artifact_updated",
          { artifactId: input.id, title: nextTitle },
          "user",
        ).pipe(Effect.mapError(toOperationError("updateArtifact")));
      }

      yield* publishEvent({
        type: "artifact_upserted",
        ticketId: current.ticketId,
        commentId: current.commentId,
        artifact: updated,
      });

      return updated;
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
      // Best-effort clean up any local attachment file referenced by the
      // artifact payload before removing the artifact row.
      const payloadObj =
        artifact.payload && typeof artifact.payload === "object"
          ? (artifact.payload as Record<string, unknown>)
          : null;
      const maybeAttachmentId =
        payloadObj && payloadObj.storage === "local" && typeof payloadObj.attachmentId === "string"
          ? payloadObj.attachmentId
          : null;
      if (maybeAttachmentId) {
        const attachment = yield* repo
          .getTicketingAttachment({ id: maybeAttachmentId })
          .pipe(Effect.mapError(toOperationError("deleteArtifact")));
        yield* Option.match(attachment, {
          onNone: () => Effect.void,
          onSome: (row) =>
            Effect.gen(function* () {
              yield* repo
                .deleteTicketingAttachment({ id: row.id })
                .pipe(Effect.mapError(toOperationError("deleteArtifact")));
              yield* provideFs(
                deleteAttachmentFile({
                  attachmentsDir: serverConfig.attachmentsDir,
                  relativePath: row.relativePath,
                }),
              ).pipe(Effect.catch(() => Effect.void));
            }),
        });
      }

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

      yield* publishEvent({
        type: "artifact_deleted",
        ticketId: artifact.ticketId,
        commentId: artifact.commentId,
        artifactId: input.id,
      });
    });

  // Templates
  const listTemplates: TicketingServiceShape["listTemplates"] = (input) =>
    repo.listTemplates({ projectId: input.projectId ?? null }).pipe(
      Effect.map((rows) => rows as ReadonlyArray<Template>),
      Effect.mapError(toOperationError("listTemplates")),
    );

  const getTemplate: TicketingServiceShape["getTemplate"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* repo
        .getTemplate({ id: input.id })
        .pipe(Effect.mapError(toOperationError("getTemplate")));
      return yield* Option.match(existing, {
        onNone: () =>
          Effect.fail<TicketingError>(new TemplateNotFoundError({ templateId: input.id })),
        onSome: (t) => Effect.succeed(t as Template),
      });
    });

  const createTemplate: TicketingServiceShape["createTemplate"] = (input) =>
    Effect.gen(function* () {
      const now = nowIso();
      const id = TemplateId.makeUnsafe(crypto.randomUUID());
      const template = {
        id,
        projectId: input.projectId ?? null,
        name: input.name,
        description: input.description ?? null,
        body: input.body,
        createdAt: now,
        updatedAt: now,
      };
      yield* repo
        .createTemplate(template)
        .pipe(Effect.mapError(toOperationError("createTemplate")));
      yield* publishEvent({ type: "template_upserted", template: template as Template });
      return template as Template;
    });

  const updateTemplate: TicketingServiceShape["updateTemplate"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* repo
        .getTemplate({ id: input.id })
        .pipe(Effect.mapError(toOperationError("updateTemplate")));
      const template = yield* Option.match(existing, {
        onNone: () =>
          Effect.fail<TicketingError>(new TemplateNotFoundError({ templateId: input.id })),
        onSome: Effect.succeed,
      });
      const now = nowIso();
      const updated = {
        ...template,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        updatedAt: now,
      };
      yield* repo.updateTemplate(updated).pipe(Effect.mapError(toOperationError("updateTemplate")));
      yield* publishEvent({ type: "template_upserted", template: updated as Template });
      return updated as Template;
    });

  const deleteTemplate: TicketingServiceShape["deleteTemplate"] = (input) =>
    Effect.gen(function* () {
      yield* repo
        .deleteTemplate({ id: input.id })
        .pipe(Effect.mapError(toOperationError("deleteTemplate")));
      yield* publishEvent({ type: "template_deleted", templateId: input.id });
    });

  const ensureShippedDefaults: TicketingServiceShape["ensureShippedDefaults"] = () =>
    Effect.gen(function* () {
      const existingLabels = yield* repo
        .listGlobalLabels()
        .pipe(Effect.mapError(toOperationError("ensureShippedDefaults")));
      const existingLabelNames = new Set(existingLabels.map((l) => l.name.toLowerCase()));
      for (const def of SHIPPED_DEFAULT_LABELS) {
        if (!existingLabelNames.has(def.name.toLowerCase())) {
          const now = nowIso();
          yield* repo
            .createLabel({
              id: LabelId.makeUnsafe(crypto.randomUUID()),
              projectId: null,
              name: def.name,
              color: def.color,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.mapError(toOperationError("ensureShippedDefaults")));
        }
      }

      const existingTemplates = yield* repo
        .listGlobalTemplates()
        .pipe(Effect.mapError(toOperationError("ensureShippedDefaults")));
      const existingTemplateNames = new Set(existingTemplates.map((t) => t.name.toLowerCase()));
      for (const def of SHIPPED_DEFAULT_TEMPLATES) {
        if (!existingTemplateNames.has(def.name.toLowerCase())) {
          const now = nowIso();
          yield* repo
            .createTemplate({
              id: TemplateId.makeUnsafe(crypto.randomUUID()),
              projectId: null,
              name: def.name,
              description: def.description,
              body: def.body,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.mapError(toOperationError("ensureShippedDefaults")));
        }
      }
    });

  // Seed shipped defaults on service init (silently ignore errors)
  yield* ensureShippedDefaults().pipe(Effect.ignore({ log: true }));

  return {
    resolveId,
    resolveIdentifiers,
    list,
    getById,
    getByIdentifier,
    getThreadLinks,
    getBody,
    searchBody,
    getBodySections,
    editBody,
    listCriteria,
    editCriteria,
    create,
    update,
    delete: del,
    archive,
    unarchive,
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
    listTemplates,
    getTemplate,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    ensureShippedDefaults,
    listComments,
    createComment,
    updateComment,
    deleteComment,
    listArtifacts,
    createArtifact,
    updateArtifact,
    deleteArtifact,
    streamEvents: Stream.fromPubSub(eventsPubSub),
  } satisfies TicketingServiceShape;
});

export const TicketingServiceLive = Layer.effect(TicketingService, makeTicketingService);
