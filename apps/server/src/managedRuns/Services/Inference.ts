import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type {
  ManagedRunDeclaredServiceSnapshot,
  ManagedRunInferenceStatus,
  ManagedRunLogLine,
  ManagedRunRuntimeService,
} from "@t3tools/contracts";

export interface ManagedRunInferenceBuildInput {
  readonly runId: string;
  readonly cwd: string;
  readonly command: string;
  readonly declaredServices: ReadonlyArray<ManagedRunDeclaredServiceSnapshot>;
  readonly detectedUrl: string | null;
  readonly detectedPort: number | null;
  readonly logs: ReadonlyArray<ManagedRunLogLine>;
}

export interface ManagedRunInferenceInput extends ManagedRunInferenceBuildInput {
  readonly candidateUrls: ReadonlyArray<string>;
  readonly candidatePorts: ReadonlyArray<number>;
  readonly evidenceExcerpt: ReadonlyArray<string>;
}

export interface ManagedRunInferenceNormalizedPayload {
  readonly summary: string;
  readonly notes: ReadonlyArray<string>;
  readonly runtimeServices: ReadonlyArray<ManagedRunRuntimeService>;
}

export interface ManagedRunInferenceResult {
  readonly provider: string;
  readonly model: string;
  readonly status: Extract<ManagedRunInferenceStatus, "ready" | "failed" | "ungrounded">;
  readonly rawPayload: unknown;
  readonly normalizedPayload: ManagedRunInferenceNormalizedPayload;
  readonly runtimeServices: ReadonlyArray<ManagedRunRuntimeService>;
  readonly inferenceError: string | null;
  readonly groundingFailures: ReadonlyArray<string>;
  readonly evidenceExcerpt: ReadonlyArray<string>;
}

export interface ManagedRunInferenceShape {
  readonly buildInferenceInput: (
    input: ManagedRunInferenceBuildInput,
  ) => Effect.Effect<ManagedRunInferenceInput>;
  readonly inferRunServices: (
    input: ManagedRunInferenceInput,
  ) => Effect.Effect<ManagedRunInferenceResult>;
}

export class ManagedRunInference extends ServiceMap.Service<
  ManagedRunInference,
  ManagedRunInferenceShape
>()("t3/managedRuns/Services/Inference/ManagedRunInference") {}
