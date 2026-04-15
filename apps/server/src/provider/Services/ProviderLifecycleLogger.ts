import type { ThreadId } from "@t3tools/contracts";
import { Effect, ServiceMap } from "effect";

export interface LifecycleEntry {
  readonly scope: string;
  readonly event: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly details?: Record<string, unknown>;
}

export interface ProviderLifecycleLoggerShape {
  readonly log: (threadId: ThreadId | null, entry: LifecycleEntry) => Effect.Effect<void>;
  readonly close: () => Effect.Effect<void>;
}

export class ProviderLifecycleLogger extends ServiceMap.Service<
  ProviderLifecycleLogger,
  ProviderLifecycleLoggerShape
>()("t3/provider/Services/ProviderLifecycleLogger") {}

export const noopProviderLifecycleLogger: ProviderLifecycleLoggerShape = {
  log: () => Effect.void,
  close: () => Effect.void,
};
