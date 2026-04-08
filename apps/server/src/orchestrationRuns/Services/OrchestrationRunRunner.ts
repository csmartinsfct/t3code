import type {
  OrchestrationRun,
  OrchestrationRunError,
  OrchestrationStartRunInput,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface OrchestrationRunRunnerShape {
  /**
   * Start executing a pending orchestration run.
   * Transitions pending→running, forks the sequential execution loop
   * in the background, and returns the run immediately.
   */
  readonly startRun: (
    input: OrchestrationStartRunInput,
  ) => Effect.Effect<OrchestrationRun, OrchestrationRunError>;
}

export class OrchestrationRunRunner extends ServiceMap.Service<
  OrchestrationRunRunner,
  OrchestrationRunRunnerShape
>()("t3/orchestrationRuns/Services/OrchestrationRunRunner") {}
