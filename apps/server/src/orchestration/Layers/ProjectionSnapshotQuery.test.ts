import { CheckpointRef, EventId, MessageId, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);
const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.makeUnsafe(value);

const projectionSnapshotLayer = it.layer(
  OrchestrationProjectionSnapshotQueryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

projectionSnapshotLayer("ProjectionSnapshotQuery", (it) => {
  it.effect("normalizes provider/model mismatches from persisted projection rows", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_sessions`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_thread_proposed_plans`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-gemini',
          'Gemini Project',
          '/tmp/project-gemini',
          '{"provider":"claudeAgent","model":"gemini-2.5-pro"}',
          '[]',
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'thread-gemini',
          'project-gemini',
          'Gemini Thread',
          '{"provider":"claudeAgent","model":"gemini-2.5-pro"}',
          NULL,
          NULL,
          NULL,
          '2026-02-24T00:00:02.000Z',
          '2026-02-24T00:00:03.000Z',
          NULL
        )
      `;

      const snapshot = yield* snapshotQuery.getSnapshot();
      const startupSnapshot = yield* snapshotQuery.getStartupSnapshot();

      assert.deepEqual(snapshot.projects[0]?.defaultModelSelection, {
        provider: "gemini",
        model: "gemini-2.5-pro",
      });
      assert.deepEqual(snapshot.threads[0]?.modelSelection, {
        provider: "gemini",
        model: "gemini-2.5-pro",
      });
      assert.deepEqual(startupSnapshot.projects[0]?.defaultModelSelection, {
        provider: "gemini",
        model: "gemini-2.5-pro",
      });
      assert.deepEqual(startupSnapshot.threads[0]?.modelSelection, {
        provider: "gemini",
        model: "gemini-2.5-pro",
      });

      yield* sql`DELETE FROM projection_threads WHERE thread_id = 'thread-gemini'`;
      yield* sql`DELETE FROM projection_projects WHERE project_id = 'project-gemini'`;
    }),
  );

  it.effect("hydrates read model from projection tables and computes snapshot sequence", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`DELETE FROM projection_thread_proposed_plans`;
      yield* sql`DELETE FROM projection_turns`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'Project 1',
          '/tmp/project-1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[{"id":"script-1","name":"Build","command":"bun run build","icon":"build","runOnWorktreeCreate":false}]',
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          NULL,
          NULL,
          'turn-1',
          '2026-02-24T00:00:02.000Z',
          '2026-02-24T00:00:03.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES (
          'message-1',
          'thread-1',
          'turn-1',
          'assistant',
          'hello from projection',
          0,
          '2026-02-24T00:00:04.000Z',
          '2026-02-24T00:00:05.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_proposed_plans (
          plan_id,
          thread_id,
          turn_id,
          plan_markdown,
          implemented_at,
          implementation_thread_id,
          created_at,
          updated_at
        )
        VALUES (
          'plan-1',
          'thread-1',
          'turn-1',
          '# Ship it',
          '2026-02-24T00:00:05.500Z',
          'thread-2',
          '2026-02-24T00:00:05.000Z',
          '2026-02-24T00:00:05.500Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          created_at
        )
        VALUES (
          'activity-1',
          'thread-1',
          'turn-1',
          'info',
          'runtime.note',
          'provider started',
          '{"stage":"start"}',
          '2026-02-24T00:00:06.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          provider_name,
          provider_session_id,
          provider_thread_id,
          runtime_mode,
          active_turn_id,
          last_error,
          updated_at
        )
        VALUES (
          'thread-1',
          'running',
          'codex',
          'provider-session-1',
          'provider-thread-1',
          'approval-required',
          'turn-1',
          NULL,
          '2026-02-24T00:00:07.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES (
          'thread-1',
          'turn-1',
          NULL,
          'thread-1',
          'plan-1',
          'message-1',
          'completed',
          '2026-02-24T00:00:08.000Z',
          '2026-02-24T00:00:08.000Z',
          '2026-02-24T00:00:08.000Z',
          1,
          'checkpoint-1',
          'ready',
          '[{"path":"README.md","kind":"modified","additions":2,"deletions":1}]'
        )
      `;

      let sequence = 5;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        yield* sql`
          INSERT INTO projection_state (
            projector,
            last_applied_sequence,
            updated_at
          )
          VALUES (
            ${projector},
            ${sequence},
            '2026-02-24T00:00:09.000Z'
          )
        `;
        sequence += 1;
      }

      const snapshot = yield* snapshotQuery.getSnapshot();

      assert.equal(snapshot.snapshotSequence, 5);
      assert.equal(snapshot.updatedAt, "2026-02-24T00:00:09.000Z");
      assert.deepEqual(snapshot.projects, [
        {
          id: asProjectId("project-1"),
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          scripts: [
            {
              id: "script-1",
              name: "Build",
              command: "bun run build",
              icon: "build",
              runOnWorktreeCreate: false,
            },
          ],
          systemPrompt: null,
          promptOverrides: { orchestration: {} },
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:01.000Z",
          deletedAt: null,
        },
      ]);
      assert.deepEqual(snapshot.threads, [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread 1",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: "default",
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          parentThreadId: null,
          isOrchestrationThread: false,
          ticketId: null,
          latestTurn: {
            turnId: asTurnId("turn-1"),
            state: "completed",
            requestedAt: "2026-02-24T00:00:08.000Z",
            startedAt: "2026-02-24T00:00:08.000Z",
            completedAt: "2026-02-24T00:00:08.000Z",
            assistantMessageId: asMessageId("message-1"),
            sourceProposedPlan: {
              threadId: ThreadId.makeUnsafe("thread-1"),
              planId: "plan-1",
            },
          },
          createdAt: "2026-02-24T00:00:02.000Z",
          updatedAt: "2026-02-24T00:00:03.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [
            {
              id: asMessageId("message-1"),
              role: "assistant",
              text: "hello from projection",
              turnId: asTurnId("turn-1"),
              streaming: false,
              createdAt: "2026-02-24T00:00:04.000Z",
              updatedAt: "2026-02-24T00:00:05.000Z",
            },
          ],
          proposedPlans: [
            {
              id: "plan-1",
              turnId: asTurnId("turn-1"),
              planMarkdown: "# Ship it",
              implementedAt: "2026-02-24T00:00:05.500Z",
              implementationThreadId: ThreadId.makeUnsafe("thread-2"),
              createdAt: "2026-02-24T00:00:05.000Z",
              updatedAt: "2026-02-24T00:00:05.500Z",
            },
          ],
          activities: [
            {
              id: asEventId("activity-1"),
              tone: "info",
              kind: "runtime.note",
              summary: "provider started",
              payload: { stage: "start" },
              turnId: asTurnId("turn-1"),
              createdAt: "2026-02-24T00:00:06.000Z",
            },
          ],
          checkpoints: [
            {
              turnId: asTurnId("turn-1"),
              checkpointTurnCount: 1,
              checkpointRef: asCheckpointRef("checkpoint-1"),
              status: "ready",
              files: [{ path: "README.md", kind: "modified", additions: 2, deletions: 1 }],
              assistantMessageId: asMessageId("message-1"),
              completedAt: "2026-02-24T00:00:08.000Z",
            },
          ],
          session: {
            threadId: ThreadId.makeUnsafe("thread-1"),
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: asTurnId("turn-1"),
            lastError: null,
            updatedAt: "2026-02-24T00:00:07.000Z",
          },
        },
      ]);
    }),
  );

  it.effect("excludes archived threads and their linked rows from the startup snapshot", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_thread_proposed_plans`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_thread_sessions`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-archived-filter',
          'Archived Filter Project',
          '/tmp/project-archived-filter',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-03-03T00:00:00.000Z',
          '2026-03-03T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES
          (
            'thread-active',
            'project-archived-filter',
            'Active Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            'turn-active',
            '2026-03-03T00:00:02.000Z',
            '2026-03-03T00:00:03.000Z',
            NULL,
            NULL
          ),
          (
            'thread-archived',
            'project-archived-filter',
            'Archived Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            'turn-archived',
            '2026-03-03T00:00:04.000Z',
            '2026-03-03T00:00:05.000Z',
            '2026-03-03T00:00:06.000Z',
            NULL
          )
      `;

      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES
          (
            'message-active',
            'thread-active',
            'turn-active',
            'assistant',
            'active message',
            0,
            '2026-03-03T00:00:07.000Z',
            '2026-03-03T00:00:07.000Z'
          ),
          (
            'message-archived',
            'thread-archived',
            'turn-archived',
            'assistant',
            'archived message',
            0,
            '2026-03-03T00:00:08.000Z',
            '2026-03-03T00:00:08.000Z'
          )
      `;

      yield* sql`
        INSERT INTO projection_thread_proposed_plans (
          plan_id,
          thread_id,
          turn_id,
          plan_markdown,
          implemented_at,
          implementation_thread_id,
          created_at,
          updated_at
        )
        VALUES
          (
            'plan-active',
            'thread-active',
            'turn-active',
            '# Active plan',
            NULL,
            NULL,
            '2026-03-03T00:00:09.000Z',
            '2026-03-03T00:00:09.000Z'
          ),
          (
            'plan-archived',
            'thread-archived',
            'turn-archived',
            '# Archived plan',
            NULL,
            NULL,
            '2026-03-03T00:00:10.000Z',
            '2026-03-03T00:00:10.000Z'
          )
      `;

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          created_at
        )
        VALUES
          (
            'activity-active',
            'thread-active',
            'turn-active',
            'info',
            'runtime.note',
            'active activity',
            '{"kind":"active"}',
            '2026-03-03T00:00:11.000Z'
          ),
          (
            'activity-archived',
            'thread-archived',
            'turn-archived',
            'info',
            'runtime.note',
            'archived activity',
            '{"kind":"archived"}',
            '2026-03-03T00:00:12.000Z'
          )
      `;

      yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          provider_name,
          provider_session_id,
          provider_thread_id,
          runtime_mode,
          active_turn_id,
          last_error,
          updated_at
        )
        VALUES
          (
            'thread-active',
            'idle',
            'codex',
            'provider-session-active',
            'provider-thread-active',
            'full-access',
            NULL,
            NULL,
            '2026-03-03T00:00:13.000Z'
          ),
          (
            'thread-archived',
            'idle',
            'codex',
            'provider-session-archived',
            'provider-thread-archived',
            'full-access',
            NULL,
            NULL,
            '2026-03-03T00:00:14.000Z'
          )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES
          (
            'thread-active',
            'turn-active',
            NULL,
            NULL,
            NULL,
            'message-active',
            'completed',
            '2026-03-03T00:00:15.000Z',
            '2026-03-03T00:00:15.000Z',
            '2026-03-03T00:00:15.000Z',
            1,
            'checkpoint-active',
            'ready',
            '[]'
          ),
          (
            'thread-archived',
            'turn-archived',
            NULL,
            NULL,
            NULL,
            'message-archived',
            'completed',
            '2026-03-03T00:00:16.000Z',
            '2026-03-03T00:00:16.000Z',
            '2026-03-03T00:00:16.000Z',
            1,
            'checkpoint-archived',
            'ready',
            '[]'
          )
      `;

      let sequence = 20;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        yield* sql`
          INSERT INTO projection_state (
            projector,
            last_applied_sequence,
            updated_at
          )
          VALUES (
            ${projector},
            ${sequence},
            '2026-03-03T00:00:17.000Z'
          )
        `;
        sequence += 1;
      }

      const snapshot = yield* snapshotQuery.getSnapshot();

      assert.deepEqual(
        snapshot.threads.map((thread) => thread.id),
        [ThreadId.makeUnsafe("thread-active")],
      );
      assert.deepEqual(
        snapshot.threads[0]?.messages.map((message) => message.id),
        [asMessageId("message-active")],
      );
      assert.deepEqual(
        snapshot.threads[0]?.proposedPlans.map((plan) => plan.id),
        ["plan-active"],
      );
      assert.deepEqual(
        snapshot.threads[0]?.activities.map((activity) => activity.id),
        [asEventId("activity-active")],
      );
      assert.deepEqual(
        snapshot.threads[0]?.checkpoints.map((checkpoint) => checkpoint.checkpointRef),
        [asCheckpointRef("checkpoint-active")],
      );
      assert.equal(snapshot.threads[0]?.session?.threadId, ThreadId.makeUnsafe("thread-active"));
      assert.equal(
        snapshot.threads.some((thread) => thread.id === ThreadId.makeUnsafe("thread-archived")),
        false,
      );
    }),
  );

  it.effect(
    "reads targeted project, thread, and count queries without hydrating the full snapshot",
    () =>
      Effect.gen(function* () {
        const snapshotQuery = yield* ProjectionSnapshotQuery;
        const sql = yield* SqlClient.SqlClient;

        yield* sql`DELETE FROM projection_projects`;
        yield* sql`DELETE FROM projection_threads`;
        yield* sql`DELETE FROM projection_turns`;

        yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES
          (
            'project-active',
            'Active Project',
            '/tmp/workspace',
            '{"provider":"codex","model":"gpt-5-codex"}',
            '[]',
            '2026-03-01T00:00:00.000Z',
            '2026-03-01T00:00:01.000Z',
            NULL
          ),
          (
            'project-deleted',
            'Deleted Project',
            '/tmp/deleted',
            NULL,
            '[]',
            '2026-03-01T00:00:02.000Z',
            '2026-03-01T00:00:03.000Z',
            '2026-03-01T00:00:04.000Z'
          )
      `;

        yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES
          (
            'thread-first',
            'project-active',
            'First Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-03-01T00:00:05.000Z',
            '2026-03-01T00:00:06.000Z',
            NULL,
            NULL
          ),
          (
            'thread-second',
            'project-active',
            'Second Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-03-01T00:00:07.000Z',
            '2026-03-01T00:00:08.000Z',
            NULL,
            NULL
          ),
          (
            'thread-archived',
            'project-active',
            'Archived Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-03-01T00:00:08.500Z',
            '2026-03-01T00:00:08.600Z',
            '2026-03-01T00:00:08.700Z',
            NULL
          ),
          (
            'thread-deleted',
            'project-active',
            'Deleted Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-03-01T00:00:09.000Z',
            '2026-03-01T00:00:10.000Z',
            NULL,
            '2026-03-01T00:00:11.000Z'
          )
      `;

        const counts = yield* snapshotQuery.getCounts();
        assert.deepEqual(counts, {
          projectCount: 2,
          threadCount: 4,
        });

        const project = yield* snapshotQuery.getActiveProjectByWorkspaceRoot("/tmp/workspace");
        assert.equal(project._tag, "Some");
        if (project._tag === "Some") {
          assert.equal(project.value.id, asProjectId("project-active"));
        }

        const missingProject = yield* snapshotQuery.getActiveProjectByWorkspaceRoot("/tmp/missing");
        assert.equal(missingProject._tag, "None");

        const firstThreadId = yield* snapshotQuery.getFirstActiveThreadIdByProjectId(
          asProjectId("project-active"),
        );
        assert.equal(firstThreadId._tag, "Some");
        if (firstThreadId._tag === "Some") {
          assert.equal(firstThreadId.value, ThreadId.makeUnsafe("thread-first"));
        }
      }),
  );

  it.effect("reads single-thread checkpoint context without hydrating unrelated threads", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-context',
          'Context Project',
          '/tmp/context-workspace',
          NULL,
          '[]',
          '2026-03-02T00:00:00.000Z',
          '2026-03-02T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-context',
          'project-context',
          'Context Thread',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          'feature/perf',
          '/tmp/context-worktree',
          NULL,
          '2026-03-02T00:00:02.000Z',
          '2026-03-02T00:00:03.000Z',
          NULL,
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES
          (
            'thread-context',
            'turn-1',
            NULL,
            NULL,
            NULL,
            NULL,
            'completed',
            '2026-03-02T00:00:04.000Z',
            '2026-03-02T00:00:04.000Z',
            '2026-03-02T00:00:04.000Z',
            1,
            'checkpoint-a',
            'ready',
            '[]'
          ),
          (
            'thread-context',
            'turn-2',
            NULL,
            NULL,
            NULL,
            NULL,
            'completed',
            '2026-03-02T00:00:05.000Z',
            '2026-03-02T00:00:05.000Z',
            '2026-03-02T00:00:05.000Z',
            2,
            'checkpoint-b',
            'ready',
            '[]'
          )
      `;

      const context = yield* snapshotQuery.getThreadCheckpointContext(
        ThreadId.makeUnsafe("thread-context"),
      );
      assert.equal(context._tag, "Some");
      if (context._tag === "Some") {
        assert.deepEqual(context.value, {
          threadId: ThreadId.makeUnsafe("thread-context"),
          projectId: asProjectId("project-context"),
          projectTitle: "Context Project",
          workspaceRoot: "/tmp/context-workspace",
          worktreePath: "/tmp/context-worktree",
          systemPrompt: null,
          checkpoints: [
            {
              turnId: asTurnId("turn-1"),
              checkpointTurnCount: 1,
              checkpointRef: asCheckpointRef("checkpoint-a"),
              status: "ready",
              files: [],
              assistantMessageId: null,
              completedAt: "2026-03-02T00:00:04.000Z",
            },
            {
              turnId: asTurnId("turn-2"),
              checkpointTurnCount: 2,
              checkpointRef: asCheckpointRef("checkpoint-b"),
              status: "ready",
              files: [],
              assistantMessageId: null,
              completedAt: "2026-03-02T00:00:05.000Z",
            },
          ],
        });
      }
    }),
  );

  it.effect(
    "returns shallow startup metadata with summaries and keeps thread content separate",
    () =>
      Effect.gen(function* () {
        const snapshotQuery = yield* ProjectionSnapshotQuery;
        const sql = yield* SqlClient.SqlClient;

        yield* sql`DELETE FROM projection_projects`;
        yield* sql`DELETE FROM projection_threads`;
        yield* sql`DELETE FROM projection_thread_messages`;
        yield* sql`DELETE FROM projection_thread_proposed_plans`;
        yield* sql`DELETE FROM projection_thread_activities`;
        yield* sql`DELETE FROM projection_thread_sessions`;
        yield* sql`DELETE FROM projection_turns`;
        yield* sql`DELETE FROM projection_state`;

        yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-shallow',
          'Shallow Project',
          '/tmp/project-shallow',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-04-01T00:00:00.000Z',
          '2026-04-01T00:00:01.000Z',
          NULL
        )
      `;

        yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES
          (
            'thread-shallow-active',
            'project-shallow',
            'Active Metadata',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'approval-required',
            'plan',
            'feature/shallow',
            '/tmp/project-shallow/worktree',
            'turn-shallow',
            '2026-04-01T00:00:02.000Z',
            '2026-04-01T00:00:03.000Z',
            NULL,
            NULL
          ),
          (
            'thread-shallow-archived',
            'project-shallow',
            'Archived Metadata',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-04-01T00:00:04.000Z',
            '2026-04-01T00:00:05.000Z',
            '2026-04-01T00:00:06.000Z',
            NULL
          )
      `;

        yield* sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES (
          'message-user-latest',
          'thread-shallow-active',
          'turn-shallow',
          'user',
          'Latest user request',
          0,
          '2026-04-01T00:00:07.000Z',
          '2026-04-01T00:00:07.000Z'
        )
      `;

        yield* sql`
        INSERT INTO projection_thread_proposed_plans (
          plan_id,
          thread_id,
          turn_id,
          plan_markdown,
          implemented_at,
          implementation_thread_id,
          created_at,
          updated_at
        )
        VALUES (
          'plan-actionable',
          'thread-shallow-active',
          'turn-shallow',
          '# Actionable',
          NULL,
          NULL,
          '2026-04-01T00:00:08.000Z',
          '2026-04-01T00:00:09.000Z'
        )
      `;

        yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          sequence,
          created_at
        )
        VALUES
          (
            'activity-approval-open',
            'thread-shallow-active',
            'turn-shallow',
            'approval',
            'approval.requested',
            'Command approval requested',
            '{"requestId":"approval-1","requestKind":"command"}',
            41,
            '2026-04-01T00:00:10.000Z'
          ),
          (
            'activity-user-input-open',
            'thread-shallow-active',
            'turn-shallow',
            'info',
            'user-input.requested',
            'User input requested',
            '{"requestId":"input-1","questions":[{"id":"choice","header":"Choice","question":"Pick","options":[{"label":"A","description":"A"}]}]}',
            42,
            '2026-04-01T00:00:11.000Z'
          )
      `;

        yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          provider_name,
          provider_session_id,
          provider_thread_id,
          runtime_mode,
          active_turn_id,
          last_error,
          updated_at
        )
        VALUES (
          'thread-shallow-active',
          'running',
          'codex',
          'provider-session-shallow',
          'provider-thread-shallow',
          'approval-required',
          'turn-shallow',
          NULL,
          '2026-04-01T00:00:12.000Z'
        )
      `;

        yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES (
          'thread-shallow-active',
          'turn-shallow',
          NULL,
          NULL,
          NULL,
          NULL,
          'running',
          '2026-04-01T00:00:13.000Z',
          '2026-04-01T00:00:14.000Z',
          '2026-04-01T00:00:14.500Z',
          1,
          'checkpoint-shallow',
          'ready',
          '[]'
        )
      `;

        for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
          yield* sql`
          INSERT INTO projection_state (
            projector,
            last_applied_sequence,
            updated_at
          )
          VALUES (
            ${projector},
            40,
            '2026-04-01T00:00:15.000Z'
          )
        `;
        }

        const startupSnapshot = yield* snapshotQuery.getStartupSnapshot();

        assert.equal(startupSnapshot.snapshotSequence, 40);
        assert.deepEqual(
          startupSnapshot.threads.map((thread) => thread.id),
          [
            ThreadId.makeUnsafe("thread-shallow-active"),
            ThreadId.makeUnsafe("thread-shallow-archived"),
          ],
        );
        const active = startupSnapshot.threads[0]!;
        assert.equal(Object.hasOwn(active, "messages"), false);
        assert.equal(Object.hasOwn(active, "activities"), false);
        assert.equal(Object.hasOwn(active, "checkpoints"), false);
        assert.equal(Object.hasOwn(active, "proposedPlans"), false);
        assert.deepEqual(active.latestUserActivity, {
          messageId: asMessageId("message-user-latest"),
          createdAt: "2026-04-01T00:00:07.000Z",
        });
        assert.equal(active.pendingApprovalCount, 1);
        assert.equal(active.pendingUserInputCount, 1);
        assert.equal(active.actionablePlanState?.id, "plan-actionable");
        assert.equal(active.latestTurnStatus, "running");
        assert.equal(active.latestSessionStatus, "running");
        assert.equal(active.lastActivitySummary, "User input requested");

        const threadContent = yield* snapshotQuery.getThreadContent(
          ThreadId.makeUnsafe("thread-shallow-active"),
        );
        assert.equal(threadContent.sequence, 40);
        assert.deepEqual(
          threadContent.messages.map((message) => message.id),
          [asMessageId("message-user-latest")],
        );
        assert.deepEqual(
          threadContent.activities.map((activity) => activity.id),
          [asEventId("activity-approval-open"), asEventId("activity-user-input-open")],
        );
        assert.deepEqual(
          threadContent.proposedPlans.map((plan) => plan.id),
          ["plan-actionable"],
        );
        assert.deepEqual(
          threadContent.checkpoints.map((checkpoint) => checkpoint.checkpointRef),
          [asCheckpointRef("checkpoint-shallow")],
        );
      }),
  );
});
