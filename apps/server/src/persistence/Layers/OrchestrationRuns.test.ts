import { ProjectId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import { runMigrations } from "../Migrations.ts";
import { OrchestrationRunRepositoryLive } from "./OrchestrationRuns.ts";
import { OrchestrationRunRepository } from "../Services/OrchestrationRuns.ts";

const sqliteLayer = NodeSqliteClient.layerMemory();
const layer = it.layer(
  Layer.mergeAll(OrchestrationRunRepositoryLive.pipe(Layer.provideMerge(sqliteLayer)), sqliteLayer),
);

layer("OrchestrationRunRepository", (it) => {
  it.effect("looks up rows by orchestration thread id and deletes them by run id", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const repo = yield* OrchestrationRunRepository;

      const runId = "run-repository-test" as never;
      const orchestrationThreadId = ThreadId.makeUnsafe("thread-repository-parent");

      yield* repo.create({
        id: runId,
        orchestrationThreadId,
        projectId: ProjectId.makeUnsafe("project-repository"),
        status: "pending",
        ticketOrderJson: JSON.stringify([]),
        currentTicketIndex: -1,
        currentPhase: "working",
        reviewIteration: 0,
        maxReviewIterations: 1,
        promptOverridesJson: null,
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-09T10:00:00.000Z",
      });

      const byThread = yield* repo.getByOrchestrationThreadId({ orchestrationThreadId });
      assert.equal(Option.getOrNull(byThread)?.id, runId);

      yield* repo.deleteById({ runId });

      const afterDelete = yield* repo.getById({ runId });
      assert.equal(Option.isNone(afterDelete), true);
    }),
  );
});
