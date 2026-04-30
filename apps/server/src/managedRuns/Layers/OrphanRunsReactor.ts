import { Effect, Layer, Stream } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ManagedRunService } from "../Services/ManagedRuns.ts";

/**
 * Reactor that listens for `project.meta-updated` events and immediately
 * reconciles managed runs whose script was just removed from the project.
 *
 * Replaces the old polling-based orphan cleanup: as soon as a `project.meta`
 * mutation lands (action edit/delete), the corresponding runs are stopped,
 * their NDJSON logs deleted, and a `removed` stream event is published so the
 * UI drops its tab immediately.
 *
 * Layered as a discard-style scoped service: it has no callers, just runs as
 * a background fiber for the lifetime of the server.
 */
export const OrphanRunsReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const managedRuns = yield* ManagedRunService;

    yield* Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
      if (event.type !== "project.meta-updated") return Effect.void;
      // We only care about edits that change the scripts list; the payload
      // marks the field as optional. If `scripts` is undefined the action
      // list didn't change (it was a different field — title, prompt, etc.).
      if (event.payload.scripts === undefined) return Effect.void;
      const projectId = event.payload.projectId;
      return managedRuns
        .cleanupOrphansForProject(projectId)
        .pipe(
          Effect.tap(() => Effect.logDebug(`[orphan-runs-reactor] swept project ${projectId}`)),
        );
    }).pipe(Effect.forkScoped, Effect.asVoid);
  }),
);
