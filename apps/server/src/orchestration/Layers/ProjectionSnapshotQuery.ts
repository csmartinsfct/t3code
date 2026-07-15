import {
  ChatAttachment,
  IsoDateTime,
  MessageId,
  OrchestrationMessageMetadata,
  NonNegativeInt,
  OrchestrationCheckpointFile,
  OrchestrationProposedPlanId,
  OrchestrationReadModel,
  OrchestrationStartupSnapshot,
  OrchestrationThreadContent,
  ProjectPromptOverrides,
  ProjectScript,
  TurnId,
  type OrchestrationCheckpointSummary,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestrationProject,
  type OrchestrationSession,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  ModelSelection,
  ProjectId,
  ThreadInitialDraft,
  ThreadId,
} from "@t3tools/contracts";
import { normalizeModelSelectionProvider } from "@t3tools/shared/model";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as Transformation from "effect/SchemaTransformation";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import { ProjectionCheckpoint } from "../../persistence/Services/ProjectionCheckpoints.ts";
import { ProjectionProject } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadActivity } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadMessage } from "../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlan } from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSession } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotCounts,
  type ProjectionThreadCheckpointContext,
  type ProjectionThreadSummary,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    nameHidden: Schema.Number.pipe(
      Schema.decodeTo(
        Schema.Boolean,
        Transformation.transform({
          decode: (value) => value !== 0,
          encode: (value) => (value ? 1 : 0),
        }),
      ),
    ),
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
    promptOverrides: Schema.fromJsonString(ProjectPromptOverrides),
  }),
);

function toOrchestrationProject(
  row: typeof ProjectionProjectDbRowSchema.Type,
): OrchestrationProject {
  return {
    id: row.projectId,
    title: row.title,
    nameHidden: row.nameHidden,
    workspaceRoot: row.workspaceRoot,
    defaultModelSelection:
      row.defaultModelSelection === null
        ? null
        : normalizeModelSelectionProvider(row.defaultModelSelection),
    systemPrompt: row.systemPrompt,
    promptOverrides: row.promptOverrides,
    scripts: row.scripts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

const ProjectionThreadMessageDbRowSchema = ProjectionThreadMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
    metadata: Schema.NullOr(Schema.fromJsonString(OrchestrationMessageMetadata)),
  }),
);
const ProjectionThreadProposedPlanDbRowSchema = ProjectionThreadProposedPlan;
const ProjectionThreadDbRowSchema = ProjectionThread.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
    initialDraft: Schema.NullOr(Schema.fromJsonString(ThreadInitialDraft)),
    isOrchestrationThread: Schema.Number.pipe(
      Schema.decodeTo(
        Schema.Boolean,
        Transformation.transform({
          decode: (n) => n !== 0,
          encode: (b) => (b ? 1 : 0),
        }),
      ),
    ),
  }),
);
const ProjectionThreadActivityDbRowSchema = ProjectionThreadActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);
const ProjectionThreadSessionDbRowSchema = ProjectionThreadSession;
const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  }),
);
const ProjectionLatestTurnDbRowSchema = Schema.Struct({
  threadId: ProjectionThread.fields.threadId,
  turnId: TurnId,
  state: Schema.String,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  terminalReason: Schema.NullOr(Schema.String),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
});
const ProjectionStateDbRowSchema = ProjectionState;
const ProjectionCountsRowSchema = Schema.Struct({
  projectCount: Schema.Number,
  threadCount: Schema.Number,
});
const ProjectionLatestUserMessageRowSchema = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  text: Schema.String,
  createdAt: IsoDateTime,
});
const ProjectionLatestActivitySummaryRowSchema = Schema.Struct({
  threadId: ThreadId,
  summary: Schema.String,
  createdAt: IsoDateTime,
});
const ProjectionLatestActionablePlanRowSchema = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
const WorkspaceRootLookupInput = Schema.Struct({
  workspaceRoot: Schema.String,
});
const ProjectIdLookupInput = Schema.Struct({
  projectId: ProjectId,
});
const ThreadIdLookupInput = Schema.Struct({
  threadId: ThreadId,
});
const ProjectionProjectLookupRowSchema = ProjectionProjectDbRowSchema;
const ProjectionThreadIdLookupRowSchema = Schema.Struct({
  threadId: ThreadId,
});
const ProjectionThreadSummaryRowSchema = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  worktreePath: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  deletedAt: Schema.NullOr(IsoDateTime),
});
const ThreadUserMessageExistsRowSchema = Schema.Struct({
  threadExists: Schema.Number,
  hasUserMessages: Schema.Number,
});
const ProjectionThreadCheckpointContextThreadRowSchema = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  projectTitle: Schema.String,
  workspaceRoot: Schema.String,
  worktreePath: Schema.NullOr(Schema.String),
  systemPrompt: Schema.NullOr(Schema.String),
});

const decodeStartupSnapshot = Schema.decodeUnknownEffect(OrchestrationStartupSnapshot);
const decodeThreadContent = Schema.decodeUnknownEffect(OrchestrationThreadContent);

const REQUIRED_SNAPSHOT_PROJECTORS = [
  ORCHESTRATION_PROJECTOR_NAMES.projects,
  ORCHESTRATION_PROJECTOR_NAMES.threads,
  ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
  ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
  ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
  ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
  ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
] as const;

const EMPTY_PROJECT_PROMPT_OVERRIDES = { orchestration: {} } satisfies ProjectPromptOverrides;

function maxIso(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left > right ? left : right;
}

function computeSnapshotSequence(
  stateRows: ReadonlyArray<Schema.Schema.Type<typeof ProjectionStateDbRowSchema>>,
): number {
  if (stateRows.length === 0) {
    return 0;
  }
  const sequenceByProjector = new Map(
    stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
  );

  let minSequence = Number.POSITIVE_INFINITY;
  for (const projector of REQUIRED_SNAPSHOT_PROJECTORS) {
    const sequence = sequenceByProjector.get(projector);
    if (sequence === undefined) {
      return 0;
    }
    if (sequence < minSequence) {
      minSequence = sequence;
    }
  }

  return Number.isFinite(minSequence) ? minSequence : 0;
}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

function toMessage(row: Schema.Schema.Type<typeof ProjectionThreadMessageDbRowSchema>) {
  return {
    id: row.messageId,
    role: row.role,
    text: row.text,
    ...(row.attachments !== null ? { attachments: row.attachments } : {}),
    ...(row.metadata !== null ? { metadata: row.metadata } : {}),
    turnId: row.turnId,
    streaming: row.isStreaming === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } satisfies OrchestrationMessage;
}

function toProposedPlan(row: Schema.Schema.Type<typeof ProjectionThreadProposedPlanDbRowSchema>) {
  return {
    id: row.planId,
    turnId: row.turnId,
    planMarkdown: row.planMarkdown,
    status: row.status,
    implementedAt: row.implementedAt,
    implementationThreadId: row.implementationThreadId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } satisfies OrchestrationProposedPlan;
}

function toActivity(row: Schema.Schema.Type<typeof ProjectionThreadActivityDbRowSchema>) {
  return {
    id: row.activityId,
    tone: row.tone,
    kind: row.kind,
    summary: row.summary,
    payload: row.payload,
    turnId: row.turnId,
    ...(row.sequence !== null ? { sequence: row.sequence } : {}),
    createdAt: row.createdAt,
  } satisfies OrchestrationThreadActivity;
}

function toCheckpoint(row: Schema.Schema.Type<typeof ProjectionCheckpointDbRowSchema>) {
  return {
    turnId: row.turnId,
    checkpointTurnCount: row.checkpointTurnCount,
    checkpointRef: row.checkpointRef,
    status: row.status,
    files: row.files,
    assistantMessageId: row.assistantMessageId,
    completedAt: row.completedAt,
  } satisfies OrchestrationCheckpointSummary;
}

function toSession(row: Schema.Schema.Type<typeof ProjectionThreadSessionDbRowSchema>) {
  return {
    threadId: row.threadId,
    status: row.status,
    providerName: row.providerName,
    runtimeMode: row.runtimeMode,
    activeTurnId: row.activeTurnId,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  } satisfies OrchestrationSession;
}

function toLatestTurn(row: Schema.Schema.Type<typeof ProjectionLatestTurnDbRowSchema>) {
  return {
    turnId: row.turnId,
    state:
      row.state === "error"
        ? "error"
        : row.state === "interrupted"
          ? "interrupted"
          : row.state === "completed"
            ? "completed"
            : "running",
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    assistantMessageId: row.assistantMessageId,
    ...(row.terminalReason ? { terminalReason: row.terminalReason } : {}),
    ...(row.sourceProposedPlanThreadId !== null && row.sourceProposedPlanId !== null
      ? {
          sourceProposedPlan: {
            threadId: row.sourceProposedPlanThreadId,
            planId: row.sourceProposedPlanId,
          },
        }
      : {}),
  } satisfies OrchestrationLatestTurn;
}

function requestIdFromActivityPayload(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") {
    return null;
  }
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? requestId : null;
}

function isStalePendingRequestFailureDetail(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object") {
    return false;
  }
  const detail = (payload as Record<string, unknown>).detail;
  if (typeof detail !== "string") {
    return false;
  }
  const normalized = detail.toLowerCase();
  return (
    normalized.includes("stale pending approval request") ||
    normalized.includes("stale pending user-input request") ||
    normalized.includes("unknown pending approval request") ||
    normalized.includes("unknown pending permission request") ||
    normalized.includes("unknown pending user-input request")
  );
}

function ensurePendingSet(map: Map<string, Set<string>>, threadId: string): Set<string> {
  const existing = map.get(threadId);
  if (existing) return existing;
  const next = new Set<string>();
  map.set(threadId, next);
  return next;
}

const makeProjectionSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRowSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          name_hidden AS "nameHidden",
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          system_prompt AS "systemPrompt",
          COALESCE(
            prompt_overrides_json,
            ${JSON.stringify(EMPTY_PROJECT_PROMPT_OVERRIDES)}
          ) AS "promptOverrides",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const listProjects: ProjectionSnapshotQueryShape["listProjects"] = () =>
    listProjectRows(undefined).pipe(
      Effect.map((rows) => rows.map(toOrchestrationProject)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.listProjects:query",
          "ProjectionSnapshotQuery.listProjects:decodeRows",
        ),
      ),
    );

  const listThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          parent_thread_id AS "parentThreadId",
          is_orchestration_thread AS "isOrchestrationThread",
          ticket_id AS "ticketId",
          initial_draft_json AS "initialDraft",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE archived_at IS NULL
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listAllThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          parent_thread_id AS "parentThreadId",
          is_orchestration_thread AS "isOrchestrationThread",
          ticket_id AS "ticketId",
          initial_draft_json AS "initialDraft",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listThreadMessageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projection_thread_messages.message_id AS "messageId",
          projection_thread_messages.thread_id AS "threadId",
          projection_thread_messages.turn_id AS "turnId",
          projection_thread_messages.role,
          projection_thread_messages.text,
          projection_thread_messages.attachments_json AS "attachments",
          projection_thread_messages.metadata_json AS "metadata",
          projection_thread_messages.is_streaming AS "isStreaming",
          projection_thread_messages.sequence,
          projection_thread_messages.created_at AS "createdAt",
          projection_thread_messages.updated_at AS "updatedAt"
        FROM projection_thread_messages
        INNER JOIN projection_threads
          ON projection_threads.thread_id = projection_thread_messages.thread_id
        WHERE projection_threads.archived_at IS NULL
        ORDER BY
          projection_thread_messages.thread_id ASC,
          projection_thread_messages.created_at ASC,
          CASE WHEN projection_thread_messages.sequence IS NULL THEN 1 ELSE 0 END ASC,
          projection_thread_messages.sequence ASC,
          projection_thread_messages.message_id ASC
      `,
  });

  const listThreadMessageRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          metadata_json AS "metadata",
          is_streaming AS "isStreaming",
          sequence,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
        ORDER BY
          created_at ASC,
          CASE WHEN sequence IS NULL THEN 1 ELSE 0 END ASC,
          sequence ASC,
          message_id ASC
      `,
  });

  const listThreadProposedPlanRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadProposedPlanDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projection_thread_proposed_plans.plan_id AS "planId",
          projection_thread_proposed_plans.thread_id AS "threadId",
          projection_thread_proposed_plans.turn_id AS "turnId",
          projection_thread_proposed_plans.plan_markdown AS "planMarkdown",
          projection_thread_proposed_plans.status,
          projection_thread_proposed_plans.implemented_at AS "implementedAt",
          projection_thread_proposed_plans.implementation_thread_id AS "implementationThreadId",
          projection_thread_proposed_plans.created_at AS "createdAt",
          projection_thread_proposed_plans.updated_at AS "updatedAt"
        FROM projection_thread_proposed_plans
        INNER JOIN projection_threads
          ON projection_threads.thread_id = projection_thread_proposed_plans.thread_id
        WHERE projection_threads.archived_at IS NULL
        ORDER BY
          projection_thread_proposed_plans.thread_id ASC,
          projection_thread_proposed_plans.created_at ASC,
          projection_thread_proposed_plans.plan_id ASC
      `,
  });

  const listThreadProposedPlanRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadProposedPlanDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          plan_id AS "planId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          plan_markdown AS "planMarkdown",
          status,
          implemented_at AS "implementedAt",
          implementation_thread_id AS "implementationThreadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_proposed_plans
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, plan_id ASC
      `,
  });

  const listThreadActivityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projection_thread_activities.activity_id AS "activityId",
          projection_thread_activities.thread_id AS "threadId",
          projection_thread_activities.turn_id AS "turnId",
          projection_thread_activities.tone,
          projection_thread_activities.kind,
          projection_thread_activities.summary,
          projection_thread_activities.payload_json AS "payload",
          projection_thread_activities.sequence,
          projection_thread_activities.created_at AS "createdAt"
        FROM projection_thread_activities
        INNER JOIN projection_threads
          ON projection_threads.thread_id = projection_thread_activities.thread_id
        WHERE projection_threads.archived_at IS NULL
        ORDER BY
          projection_thread_activities.thread_id ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          projection_thread_activities.created_at ASC,
          projection_thread_activities.activity_id ASC
      `,
  });

  const listThreadActivityRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_thread_activities
        WHERE thread_id = ${threadId}
        ORDER BY
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const listPendingRequestActivityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: () =>
      sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_thread_activities
        WHERE kind IN (
          'approval.requested',
          'approval.resolved',
          'provider.approval.respond.failed',
          'user-input.requested',
          'user-input.resolved',
          'provider.user-input.respond.failed'
        )
        ORDER BY
          thread_id ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const listThreadSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projection_thread_sessions.thread_id AS "threadId",
          projection_thread_sessions.status,
          projection_thread_sessions.provider_name AS "providerName",
          projection_thread_sessions.provider_session_id AS "providerSessionId",
          projection_thread_sessions.provider_thread_id AS "providerThreadId",
          projection_thread_sessions.runtime_mode AS "runtimeMode",
          projection_thread_sessions.active_turn_id AS "activeTurnId",
          projection_thread_sessions.last_error AS "lastError",
          projection_thread_sessions.updated_at AS "updatedAt"
        FROM projection_thread_sessions
        INNER JOIN projection_threads
          ON projection_threads.thread_id = projection_thread_sessions.thread_id
        WHERE projection_threads.archived_at IS NULL
        ORDER BY projection_thread_sessions.thread_id ASC
      `,
  });

  const listAllThreadSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          provider_session_id AS "providerSessionId",
          provider_thread_id AS "providerThreadId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        ORDER BY thread_id ASC
      `,
  });

  const listCheckpointRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionCheckpointDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projection_turns.thread_id AS "threadId",
          projection_turns.turn_id AS "turnId",
          projection_turns.checkpoint_turn_count AS "checkpointTurnCount",
          projection_turns.checkpoint_ref AS "checkpointRef",
          projection_turns.checkpoint_status AS "status",
          projection_turns.checkpoint_files_json AS "files",
          projection_turns.assistant_message_id AS "assistantMessageId",
          projection_turns.completed_at AS "completedAt"
        FROM projection_turns
        INNER JOIN projection_threads
          ON projection_threads.thread_id = projection_turns.thread_id
        WHERE checkpoint_turn_count IS NOT NULL
          AND projection_threads.archived_at IS NULL
        ORDER BY projection_turns.thread_id ASC, checkpoint_turn_count ASC
      `,
  });

  // Drive from projection_threads (one row per thread) and resolve the latest
  // per-thread row via a single indexed LIMIT 1 subquery, then join back by
  // primary key. The obvious correlated NOT EXISTS shape degrades to O(N^2) on
  // SQLite once activity counts reach hundreds of thousands.
  const listLatestUserMessageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestUserMessageRowSchema,
    execute: () =>
      sql`
        WITH latest_message AS (
          SELECT
            thread.thread_id AS thread_id,
            (
              SELECT message.message_id
              FROM projection_thread_messages AS message
              WHERE message.thread_id = thread.thread_id
                AND message.role = 'user'
              ORDER BY message.created_at DESC, message.message_id DESC
              LIMIT 1
            ) AS latest_id
          FROM projection_threads AS thread
        )
        SELECT
          latest.thread_id AS "threadId",
          message.message_id AS "messageId",
          message.text,
          message.created_at AS "createdAt"
        FROM latest_message AS latest
        JOIN projection_thread_messages AS message
          ON message.message_id = latest.latest_id
        ORDER BY latest.thread_id ASC
      `,
  });

  const listLatestActivitySummaryRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestActivitySummaryRowSchema,
    execute: () =>
      sql`
        WITH latest_activity AS (
          SELECT
            thread.thread_id AS thread_id,
            (
              SELECT activity.activity_id
              FROM projection_thread_activities AS activity
              WHERE activity.thread_id = thread.thread_id
              ORDER BY activity.created_at DESC, activity.activity_id DESC
              LIMIT 1
            ) AS latest_id
          FROM projection_threads AS thread
        )
        SELECT
          latest.thread_id AS "threadId",
          activity.summary,
          activity.created_at AS "createdAt"
        FROM latest_activity AS latest
        JOIN projection_thread_activities AS activity
          ON activity.activity_id = latest.latest_id
        ORDER BY latest.thread_id ASC
      `,
  });

  const listLatestActionablePlanRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestActionablePlanRowSchema,
    execute: () =>
      sql`
        SELECT
          latest.thread_id AS "threadId",
          latest.plan_id AS "planId",
          latest.turn_id AS "turnId",
          latest.created_at AS "createdAt",
          latest.updated_at AS "updatedAt"
        FROM projection_thread_proposed_plans AS latest
        WHERE latest.implemented_at IS NULL
          AND latest.status = 'ready'
          AND NOT EXISTS (
            SELECT 1
            FROM projection_thread_proposed_plans AS newer
            WHERE newer.thread_id = latest.thread_id
              AND newer.implemented_at IS NULL
              AND newer.status = 'ready'
              AND (
                newer.updated_at > latest.updated_at
                OR (newer.updated_at = latest.updated_at AND newer.plan_id > latest.plan_id)
              )
          )
        ORDER BY latest.thread_id ASC
      `,
  });

  const listLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projection_turns.thread_id AS "threadId",
          projection_turns.turn_id AS "turnId",
          projection_turns.state,
          projection_turns.requested_at AS "requestedAt",
          projection_turns.started_at AS "startedAt",
          projection_turns.completed_at AS "completedAt",
          projection_turns.assistant_message_id AS "assistantMessageId",
          projection_turns.terminal_reason AS "terminalReason",
          projection_turns.source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          projection_turns.source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_turns
        INNER JOIN projection_threads
          ON projection_threads.thread_id = projection_turns.thread_id
        WHERE turn_id IS NOT NULL
          AND projection_threads.archived_at IS NULL
        ORDER BY projection_turns.thread_id ASC, requested_at DESC, turn_id DESC
      `,
  });

  const listAllLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          assistant_message_id AS "assistantMessageId",
          terminal_reason AS "terminalReason",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_turns
        WHERE turn_id IS NOT NULL
        ORDER BY thread_id ASC, requested_at DESC, turn_id DESC
      `,
  });

  const listProjectionStateRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionStateDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
      `,
  });

  const readProjectionCounts = SqlSchema.findOne({
    Request: Schema.Void,
    Result: ProjectionCountsRowSchema,
    execute: () =>
      sql`
        SELECT
          (SELECT COUNT(*) FROM projection_projects) AS "projectCount",
          (SELECT COUNT(*) FROM projection_threads) AS "threadCount"
      `,
  });

  const getActiveProjectRowByWorkspaceRoot = SqlSchema.findOneOption({
    Request: WorkspaceRootLookupInput,
    Result: ProjectionProjectLookupRowSchema,
    execute: ({ workspaceRoot }) =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          name_hidden AS "nameHidden",
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          system_prompt AS "systemPrompt",
          COALESCE(
            prompt_overrides_json,
            ${JSON.stringify(EMPTY_PROJECT_PROMPT_OVERRIDES)}
          ) AS "promptOverrides",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE workspace_root = ${workspaceRoot}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, project_id ASC
        LIMIT 1
      `,
  });

  const getProjectRowById = SqlSchema.findOneOption({
    Request: ProjectIdLookupInput,
    Result: ProjectionProjectLookupRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          name_hidden AS "nameHidden",
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          system_prompt AS "systemPrompt",
          COALESCE(
            prompt_overrides_json,
            ${JSON.stringify(EMPTY_PROJECT_PROMPT_OVERRIDES)}
          ) AS "promptOverrides",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE project_id = ${projectId}
        LIMIT 1
      `,
  });

  const getThreadRowById = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadSummaryRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          worktree_path AS "worktreePath",
          branch,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE thread_id = ${threadId}
        LIMIT 1
      `,
  });

  const checkThreadUserMessages = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ThreadUserMessageExistsRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          1 AS "threadExists",
          CASE WHEN EXISTS (
            SELECT 1 FROM projection_thread_messages
            WHERE thread_id = ${threadId} AND role = 'user'
          ) THEN 1 ELSE 0 END AS "hasUserMessages"
        FROM projection_threads
        WHERE thread_id = ${threadId}
        LIMIT 1
      `,
  });

  const getFirstActiveThreadIdByProject = SqlSchema.findOneOption({
    Request: ProjectIdLookupInput,
    Result: ProjectionThreadIdLookupRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          thread_id AS "threadId"
        FROM projection_threads
        WHERE project_id = ${projectId}
          AND archived_at IS NULL
          AND deleted_at IS NULL
        ORDER BY created_at ASC, thread_id ASC
        LIMIT 1
      `,
  });

  const getThreadCheckpointContextThreadRow = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadCheckpointContextThreadRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          threads.thread_id AS "threadId",
          threads.project_id AS "projectId",
          projects.title AS "projectTitle",
          projects.workspace_root AS "workspaceRoot",
          threads.worktree_path AS "worktreePath",
          projects.system_prompt AS "systemPrompt"
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.thread_id = ${threadId}
          AND threads.deleted_at IS NULL
        LIMIT 1
      `,
  });

  const listCheckpointRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
        ORDER BY checkpoint_turn_count ASC
      `,
  });

  const getSnapshot: ProjectionSnapshotQueryShape["getSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [
            projectRows,
            threadRows,
            messageRows,
            proposedPlanRows,
            activityRows,
            sessionRows,
            checkpointRows,
            latestTurnRows,
            stateRows,
          ] = yield* Effect.all([
            listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:decodeRows",
                ),
              ),
            ),
            listThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:decodeRows",
                ),
              ),
            ),
            listThreadMessageRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:decodeRows",
                ),
              ),
            ),
            listThreadProposedPlanRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:decodeRows",
                ),
              ),
            ),
            listThreadActivityRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:decodeRows",
                ),
              ),
            ),
            listThreadSessionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:decodeRows",
                ),
              ),
            ),
            listCheckpointRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:query",
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:decodeRows",
                ),
              ),
            ),
            listLatestTurnRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:query",
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:decodeRows",
                ),
              ),
            ),
            listProjectionStateRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:decodeRows",
                ),
              ),
            ),
          ]);

          const messagesByThread = new Map<string, Array<OrchestrationMessage>>();
          const proposedPlansByThread = new Map<string, Array<OrchestrationProposedPlan>>();
          const activitiesByThread = new Map<string, Array<OrchestrationThreadActivity>>();
          const checkpointsByThread = new Map<string, Array<OrchestrationCheckpointSummary>>();
          const sessionsByThread = new Map<string, OrchestrationSession>();
          const latestTurnByThread = new Map<string, OrchestrationLatestTurn>();

          let updatedAt: string | null = null;

          for (const row of projectRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of threadRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of stateRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }

          for (const row of messageRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            const threadMessages = messagesByThread.get(row.threadId) ?? [];
            threadMessages.push(toMessage(row));
            messagesByThread.set(row.threadId, threadMessages);
          }

          for (const row of proposedPlanRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            const threadProposedPlans = proposedPlansByThread.get(row.threadId) ?? [];
            threadProposedPlans.push(toProposedPlan(row));
            proposedPlansByThread.set(row.threadId, threadProposedPlans);
          }

          for (const row of activityRows) {
            updatedAt = maxIso(updatedAt, row.createdAt);
            const threadActivities = activitiesByThread.get(row.threadId) ?? [];
            threadActivities.push(toActivity(row));
            activitiesByThread.set(row.threadId, threadActivities);
          }

          for (const row of checkpointRows) {
            updatedAt = maxIso(updatedAt, row.completedAt);
            const threadCheckpoints = checkpointsByThread.get(row.threadId) ?? [];
            threadCheckpoints.push(toCheckpoint(row));
            checkpointsByThread.set(row.threadId, threadCheckpoints);
          }

          for (const row of latestTurnRows) {
            updatedAt = maxIso(updatedAt, row.requestedAt);
            if (row.startedAt !== null) {
              updatedAt = maxIso(updatedAt, row.startedAt);
            }
            if (row.completedAt !== null) {
              updatedAt = maxIso(updatedAt, row.completedAt);
            }
            if (latestTurnByThread.has(row.threadId)) {
              continue;
            }
            latestTurnByThread.set(row.threadId, toLatestTurn(row));
          }

          for (const row of sessionRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            sessionsByThread.set(row.threadId, toSession(row));
          }

          const projects: ReadonlyArray<OrchestrationProject> =
            projectRows.map(toOrchestrationProject);

          const threads: ReadonlyArray<OrchestrationThread> = threadRows.map((row) => ({
            id: row.threadId,
            projectId: row.projectId,
            title: row.title,
            modelSelection: normalizeModelSelectionProvider(row.modelSelection),
            runtimeMode: row.runtimeMode,
            interactionMode: row.interactionMode,
            branch: row.branch,
            worktreePath: row.worktreePath,
            parentThreadId: row.parentThreadId,
            isOrchestrationThread: row.isOrchestrationThread,
            ticketId: row.ticketId,
            latestTurn: latestTurnByThread.get(row.threadId) ?? null,
            ...(row.initialDraft !== null ? { initialDraft: row.initialDraft } : {}),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            archivedAt: row.archivedAt,
            deletedAt: row.deletedAt,
            messages: messagesByThread.get(row.threadId) ?? [],
            proposedPlans: proposedPlansByThread.get(row.threadId) ?? [],
            activities: activitiesByThread.get(row.threadId) ?? [],
            checkpoints: checkpointsByThread.get(row.threadId) ?? [],
            session: sessionsByThread.get(row.threadId) ?? null,
          }));

          const snapshot = {
            snapshotSequence: computeSnapshotSequence(stateRows),
            projects,
            threads,
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          };

          return yield* decodeReadModel(snapshot).pipe(
            Effect.mapError(
              toPersistenceDecodeError("ProjectionSnapshotQuery.getSnapshot:decodeReadModel"),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:query")(error);
        }),
      );

  const getStartupSnapshot: ProjectionSnapshotQueryShape["getStartupSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [
            projectRows,
            threadRows,
            sessionRows,
            latestTurnRows,
            latestUserMessageRows,
            latestActivityRows,
            actionablePlanRows,
            pendingRequestRows,
            stateRows,
          ] = yield* Effect.all([
            listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getStartupSnapshot:listProjects:query",
                  "ProjectionSnapshotQuery.getStartupSnapshot:listProjects:decodeRows",
                ),
              ),
            ),
            listAllThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getStartupSnapshot:listThreads:query",
                  "ProjectionSnapshotQuery.getStartupSnapshot:listThreads:decodeRows",
                ),
              ),
            ),
            listAllThreadSessionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getStartupSnapshot:listSessions:query",
                  "ProjectionSnapshotQuery.getStartupSnapshot:listSessions:decodeRows",
                ),
              ),
            ),
            listAllLatestTurnRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getStartupSnapshot:listLatestTurns:query",
                  "ProjectionSnapshotQuery.getStartupSnapshot:listLatestTurns:decodeRows",
                ),
              ),
            ),
            listLatestUserMessageRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getStartupSnapshot:listLatestUserMessages:query",
                  "ProjectionSnapshotQuery.getStartupSnapshot:listLatestUserMessages:decodeRows",
                ),
              ),
            ),
            listLatestActivitySummaryRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getStartupSnapshot:listLatestActivities:query",
                  "ProjectionSnapshotQuery.getStartupSnapshot:listLatestActivities:decodeRows",
                ),
              ),
            ),
            listLatestActionablePlanRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getStartupSnapshot:listActionablePlans:query",
                  "ProjectionSnapshotQuery.getStartupSnapshot:listActionablePlans:decodeRows",
                ),
              ),
            ),
            listPendingRequestActivityRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getStartupSnapshot:listPendingRequestActivities:query",
                  "ProjectionSnapshotQuery.getStartupSnapshot:listPendingRequestActivities:decodeRows",
                ),
              ),
            ),
            listProjectionStateRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getStartupSnapshot:listProjectionState:query",
                  "ProjectionSnapshotQuery.getStartupSnapshot:listProjectionState:decodeRows",
                ),
              ),
            ),
          ]);

          const sessionsByThread = new Map<string, OrchestrationSession>();
          const latestTurnByThread = new Map<string, OrchestrationLatestTurn>();
          const latestUserMessageByThread = new Map<
            string,
            Schema.Schema.Type<typeof ProjectionLatestUserMessageRowSchema>
          >();
          const latestActivityByThread = new Map<
            string,
            Schema.Schema.Type<typeof ProjectionLatestActivitySummaryRowSchema>
          >();
          const actionablePlanByThread = new Map<
            string,
            Schema.Schema.Type<typeof ProjectionLatestActionablePlanRowSchema>
          >();
          const pendingApprovalRequestIdsByThread = new Map<string, Set<string>>();
          const pendingUserInputRequestIdsByThread = new Map<string, Set<string>>();

          let updatedAt: string | null = null;

          for (const row of projectRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of threadRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            if (row.archivedAt !== null) updatedAt = maxIso(updatedAt, row.archivedAt);
          }
          for (const row of stateRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of sessionRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            sessionsByThread.set(row.threadId, toSession(row));
          }
          for (const row of latestTurnRows) {
            updatedAt = maxIso(updatedAt, row.requestedAt);
            if (row.startedAt !== null) updatedAt = maxIso(updatedAt, row.startedAt);
            if (row.completedAt !== null) updatedAt = maxIso(updatedAt, row.completedAt);
            if (!latestTurnByThread.has(row.threadId)) {
              latestTurnByThread.set(row.threadId, toLatestTurn(row));
            }
          }
          for (const row of latestUserMessageRows) {
            updatedAt = maxIso(updatedAt, row.createdAt);
            latestUserMessageByThread.set(row.threadId, row);
          }
          for (const row of latestActivityRows) {
            updatedAt = maxIso(updatedAt, row.createdAt);
            latestActivityByThread.set(row.threadId, row);
          }
          for (const row of actionablePlanRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            actionablePlanByThread.set(row.threadId, row);
          }

          for (const row of pendingRequestRows) {
            updatedAt = maxIso(updatedAt, row.createdAt);
            const requestId = requestIdFromActivityPayload(row.payload);
            if (requestId === null) {
              continue;
            }
            if (row.kind === "approval.requested") {
              ensurePendingSet(pendingApprovalRequestIdsByThread, row.threadId).add(requestId);
              continue;
            }
            if (row.kind === "approval.resolved") {
              pendingApprovalRequestIdsByThread.get(row.threadId)?.delete(requestId);
              continue;
            }
            if (
              row.kind === "provider.approval.respond.failed" &&
              isStalePendingRequestFailureDetail(row.payload)
            ) {
              pendingApprovalRequestIdsByThread.get(row.threadId)?.delete(requestId);
              continue;
            }
            if (row.kind === "user-input.requested") {
              ensurePendingSet(pendingUserInputRequestIdsByThread, row.threadId).add(requestId);
              continue;
            }
            if (row.kind === "user-input.resolved") {
              pendingUserInputRequestIdsByThread.get(row.threadId)?.delete(requestId);
              continue;
            }
            if (
              row.kind === "provider.user-input.respond.failed" &&
              isStalePendingRequestFailureDetail(row.payload)
            ) {
              pendingUserInputRequestIdsByThread.get(row.threadId)?.delete(requestId);
            }
          }

          const projects: ReadonlyArray<OrchestrationProject> =
            projectRows.map(toOrchestrationProject);

          const threads = threadRows.map((row) => {
            const session = sessionsByThread.get(row.threadId) ?? null;
            const latestTurn = latestTurnByThread.get(row.threadId) ?? null;
            const latestUserMessage = latestUserMessageByThread.get(row.threadId) ?? null;
            const latestActivity = latestActivityByThread.get(row.threadId) ?? null;
            const actionablePlan = actionablePlanByThread.get(row.threadId) ?? null;
            const lastActivitySummary =
              latestUserMessage !== null &&
              (latestActivity === null || latestUserMessage.createdAt >= latestActivity.createdAt)
                ? latestUserMessage.text
                : (latestActivity?.summary ?? null);

            return {
              id: row.threadId,
              projectId: row.projectId,
              title: row.title,
              modelSelection: normalizeModelSelectionProvider(row.modelSelection),
              runtimeMode: row.runtimeMode,
              interactionMode: row.interactionMode,
              branch: row.branch,
              worktreePath: row.worktreePath,
              parentThreadId: row.parentThreadId,
              isOrchestrationThread: row.isOrchestrationThread,
              ticketId: row.ticketId,
              latestTurn,
              ...(row.initialDraft !== null ? { initialDraft: row.initialDraft } : {}),
              latestTurnStatus: latestTurn?.state ?? null,
              latestSessionStatus: session?.status ?? null,
              session,
              latestUserActivity:
                latestUserMessage !== null
                  ? {
                      messageId: latestUserMessage.messageId,
                      createdAt: latestUserMessage.createdAt,
                    }
                  : null,
              pendingApprovalCount: pendingApprovalRequestIdsByThread.get(row.threadId)?.size ?? 0,
              pendingUserInputCount:
                pendingUserInputRequestIdsByThread.get(row.threadId)?.size ?? 0,
              actionablePlanState:
                actionablePlan !== null
                  ? {
                      id: actionablePlan.planId,
                      turnId: actionablePlan.turnId,
                      createdAt: actionablePlan.createdAt,
                      updatedAt: actionablePlan.updatedAt,
                    }
                  : null,
              lastActivitySummary,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              archivedAt: row.archivedAt,
              deletedAt: row.deletedAt,
            };
          });

          return yield* decodeStartupSnapshot({
            snapshotSequence: computeSnapshotSequence(stateRows),
            projects,
            threads,
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          }).pipe(
            Effect.mapError(
              toPersistenceDecodeError(
                "ProjectionSnapshotQuery.getStartupSnapshot:decodeStartupSnapshot",
              ),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getStartupSnapshot:query")(error);
        }),
      );

  const getThreadContent: ProjectionSnapshotQueryShape["getThreadContent"] = (threadId) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [messageRows, proposedPlanRows, activityRows, checkpointRows, stateRows] =
            yield* Effect.all([
              listThreadMessageRowsByThread({ threadId }).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getThreadContent:listMessages:query",
                    "ProjectionSnapshotQuery.getThreadContent:listMessages:decodeRows",
                  ),
                ),
              ),
              listThreadProposedPlanRowsByThread({ threadId }).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getThreadContent:listProposedPlans:query",
                    "ProjectionSnapshotQuery.getThreadContent:listProposedPlans:decodeRows",
                  ),
                ),
              ),
              listThreadActivityRowsByThread({ threadId }).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getThreadContent:listActivities:query",
                    "ProjectionSnapshotQuery.getThreadContent:listActivities:decodeRows",
                  ),
                ),
              ),
              listCheckpointRowsByThread({ threadId }).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getThreadContent:listCheckpoints:query",
                    "ProjectionSnapshotQuery.getThreadContent:listCheckpoints:decodeRows",
                  ),
                ),
              ),
              listProjectionStateRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getThreadContent:listProjectionState:query",
                    "ProjectionSnapshotQuery.getThreadContent:listProjectionState:decodeRows",
                  ),
                ),
              ),
            ]);

          return yield* decodeThreadContent({
            threadId,
            sequence: computeSnapshotSequence(stateRows),
            messages: messageRows.map(toMessage),
            proposedPlans: proposedPlanRows.map(toProposedPlan),
            activities: activityRows.map(toActivity),
            checkpoints: checkpointRows.map(toCheckpoint),
          }).pipe(
            Effect.mapError(
              toPersistenceDecodeError(
                "ProjectionSnapshotQuery.getThreadContent:decodeThreadContent",
              ),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getThreadContent:query")(error);
        }),
      );

  const getCounts: ProjectionSnapshotQueryShape["getCounts"] = () =>
    readProjectionCounts(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getCounts:query",
          "ProjectionSnapshotQuery.getCounts:decodeRow",
        ),
      ),
      Effect.map(
        (row): ProjectionSnapshotCounts => ({
          projectCount: row.projectCount,
          threadCount: row.threadCount,
        }),
      ),
    );

  const getActiveProjectByWorkspaceRoot: ProjectionSnapshotQueryShape["getActiveProjectByWorkspaceRoot"] =
    (workspaceRoot) =>
      getActiveProjectRowByWorkspaceRoot({ workspaceRoot }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:query",
            "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:decodeRow",
          ),
        ),
        Effect.map(
          Option.map(
            (row): OrchestrationProject => ({
              id: row.projectId,
              title: row.title,
              nameHidden: row.nameHidden,
              workspaceRoot: row.workspaceRoot,
              defaultModelSelection: row.defaultModelSelection,
              scripts: row.scripts,
              systemPrompt: row.systemPrompt,
              promptOverrides: row.promptOverrides,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              deletedAt: row.deletedAt,
            }),
          ),
        ),
      );

  const getFirstActiveThreadIdByProjectId: ProjectionSnapshotQueryShape["getFirstActiveThreadIdByProjectId"] =
    (projectId) =>
      getFirstActiveThreadIdByProject({ projectId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:query",
            "ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:decodeRow",
          ),
        ),
        Effect.map(Option.map((row) => row.threadId)),
      );

  const getThreadCheckpointContext: ProjectionSnapshotQueryShape["getThreadCheckpointContext"] = (
    threadId,
  ) =>
    Effect.gen(function* () {
      const threadRow = yield* getThreadCheckpointContextThreadRow({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:query",
            "ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:decodeRow",
          ),
        ),
      );
      if (Option.isNone(threadRow)) {
        return Option.none<ProjectionThreadCheckpointContext>();
      }

      const checkpointRows = yield* listCheckpointRowsByThread({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:query",
            "ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:decodeRows",
          ),
        ),
      );

      return Option.some({
        threadId: threadRow.value.threadId,
        projectId: threadRow.value.projectId,
        projectTitle: threadRow.value.projectTitle,
        workspaceRoot: threadRow.value.workspaceRoot,
        worktreePath: threadRow.value.worktreePath,
        systemPrompt: threadRow.value.systemPrompt,
        checkpoints: checkpointRows.map(
          (row): OrchestrationCheckpointSummary => ({
            turnId: row.turnId,
            checkpointTurnCount: row.checkpointTurnCount,
            checkpointRef: row.checkpointRef,
            status: row.status,
            files: row.files,
            assistantMessageId: row.assistantMessageId,
            completedAt: row.completedAt,
          }),
        ),
      });
    });

  const getProjectById: ProjectionSnapshotQueryShape["getProjectById"] = (projectId) =>
    getProjectRowById({ projectId }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getProjectById:query",
          "ProjectionSnapshotQuery.getProjectById:decodeRow",
        ),
      ),
      Effect.map(
        Option.map(
          (row): OrchestrationProject => ({
            id: row.projectId,
            title: row.title,
            nameHidden: row.nameHidden,
            workspaceRoot: row.workspaceRoot,
            defaultModelSelection: row.defaultModelSelection,
            scripts: row.scripts,
            systemPrompt: row.systemPrompt,
            promptOverrides: row.promptOverrides,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          }),
        ),
      ),
    );

  const getThreadById: ProjectionSnapshotQueryShape["getThreadById"] = (threadId) =>
    getThreadRowById({ threadId }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getThreadById:query",
          "ProjectionSnapshotQuery.getThreadById:decodeRow",
        ),
      ),
      Effect.map(
        Option.map(
          (row): ProjectionThreadSummary => ({
            id: row.threadId,
            projectId: row.projectId,
            title: row.title,
            worktreePath: row.worktreePath,
            branch: row.branch,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            archivedAt: row.archivedAt,
            deletedAt: row.deletedAt,
          }),
        ),
      ),
    );

  const hasThreadUserMessages: ProjectionSnapshotQueryShape["hasThreadUserMessages"] = (threadId) =>
    checkThreadUserMessages({ threadId }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.hasThreadUserMessages:query",
          "ProjectionSnapshotQuery.hasThreadUserMessages:decodeRow",
        ),
      ),
      Effect.map(Option.map((row) => row.hasUserMessages === 1)),
    );

  return {
    getSnapshot,
    getStartupSnapshot,
    listProjects,
    getThreadContent,
    getCounts,
    getActiveProjectByWorkspaceRoot,
    getProjectById,
    getThreadById,
    hasThreadUserMessages,
    getFirstActiveThreadIdByProjectId,
    getThreadCheckpointContext,
  } satisfies ProjectionSnapshotQueryShape;
});

export const OrchestrationProjectionSnapshotQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  makeProjectionSnapshotQuery,
);
