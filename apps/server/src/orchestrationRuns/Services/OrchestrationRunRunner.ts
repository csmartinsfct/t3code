import type {
  OrchestrationCancelRunInput,
  OrchestrationPauseRunInput,
  OrchestrationResumeRunInput,
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

  /**
   * Pause a running orchestration. Interrupts the active agent turn
   * (if any), transitions to paused, and posts a pause separator.
   */
  readonly pauseRun: (
    input: OrchestrationPauseRunInput,
  ) => Effect.Effect<OrchestrationRun, OrchestrationRunError>;

  /**
   * Resume a paused orchestration. Re-evaluates current ticket state,
   * transitions to running, and forks a new execution loop fiber.
   */
  readonly resumeRun: (
    input: OrchestrationResumeRunInput,
  ) => Effect.Effect<OrchestrationRun, OrchestrationRunError>;

  /**
   * Cancel a running or paused orchestration. Interrupts the active
   * agent turn, stops the session, and transitions to canceled.
   */
  readonly cancelRun: (
    input: OrchestrationCancelRunInput,
  ) => Effect.Effect<OrchestrationRun, OrchestrationRunError>;
}

export class OrchestrationRunRunner extends ServiceMap.Service<
  OrchestrationRunRunner,
  OrchestrationRunRunnerShape
>()("t3/orchestrationRuns/Services/OrchestrationRunRunner") {}
