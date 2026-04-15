/**
 * Per-thread lifecycle logger for session decision-point observability.
 *
 * Writes structured LFCYL (lifecycle) entries to per-thread `.lifecycle.log`
 * files alongside the existing `.log` event files. Best-effort — failures
 * are downgraded to warnings so runtime behavior is unaffected.
 */
import fs from "node:fs";
import path from "node:path";

import type { ThreadId } from "@t3tools/contracts";
import { RotatingFileSink } from "@t3tools/shared/logging";
import { Effect, Exit, Layer, Logger, Scope } from "effect";

import { toSafeThreadAttachmentSegment } from "../../attachmentStore.ts";
import type {
  LifecycleEntry,
  ProviderLifecycleLoggerShape,
} from "../Services/ProviderLifecycleLogger.ts";
import { ProviderLifecycleLogger } from "../Services/ProviderLifecycleLogger.ts";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_BATCH_WINDOW_MS = 200;
const GLOBAL_THREAD_SEGMENT = "_global";
const STREAM_LABEL = "LFCYL";
const LOG_SCOPE = "provider-lifecycle";

interface ThreadWriter {
  writeMessage: (message: string) => Effect.Effect<void>;
  close: () => Effect.Effect<void>;
}

function logWarning(message: string, context: Record<string, unknown>): Effect.Effect<void> {
  return Effect.logWarning(message, context).pipe(Effect.annotateLogs({ scope: LOG_SCOPE }));
}

function resolveThreadSegment(raw: string | null | undefined): string {
  const normalized = typeof raw === "string" ? toSafeThreadAttachmentSegment(raw) : null;
  return normalized ?? GLOBAL_THREAD_SEGMENT;
}

function formatLoggerMessage(message: unknown): string {
  if (Array.isArray(message)) {
    return message.map((part) => (typeof part === "string" ? part : String(part))).join(" ");
  }
  return typeof message === "string" ? message : String(message);
}

const lineLogger: Logger.Logger<unknown, string> = Logger.make(
  ({ date, message }) =>
    `[${date.toISOString()}] ${STREAM_LABEL}: ${formatLoggerMessage(message)}\n`,
);

const makeThreadWriter = Effect.fn("makeThreadWriter")(function* (input: {
  readonly filePath: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
  readonly batchWindowMs: number;
}): Effect.fn.Return<ThreadWriter | undefined> {
  const sinkResult = yield* Effect.sync(() => {
    try {
      return {
        ok: true as const,
        sink: new RotatingFileSink({
          filePath: input.filePath,
          maxBytes: input.maxBytes,
          maxFiles: input.maxFiles,
          throwOnError: true,
        }),
      };
    } catch (error) {
      return { ok: false as const, error };
    }
  });

  if (!sinkResult.ok) {
    yield* logWarning("failed to initialize lifecycle log file", {
      filePath: input.filePath,
      error: sinkResult.error,
    });
    return undefined;
  }

  const sink = sinkResult.sink;
  const scope = yield* Scope.make();
  const batchedLogger = yield* Logger.batched(lineLogger, {
    window: input.batchWindowMs,
    flush: Effect.fn("makeThreadWriter.flush")(function* (messages) {
      const flushResult = yield* Effect.sync(() => {
        try {
          for (const message of messages) {
            sink.write(message);
          }
          return { ok: true as const };
        } catch (error) {
          return { ok: false as const, error };
        }
      });

      if (!flushResult.ok) {
        yield* logWarning("lifecycle log batch flush failed", {
          filePath: input.filePath,
          error: flushResult.error,
        });
      }
    }),
  }).pipe(Effect.provideService(Scope.Scope, scope));

  const loggerLayer = Logger.layer([batchedLogger], { mergeWithExisting: false });

  return {
    writeMessage(message: string) {
      return Effect.log(message).pipe(Effect.provide(loggerLayer));
    },
    close() {
      return Scope.close(scope, Exit.void);
    },
  } satisfies ThreadWriter;
});

export const makeProviderLifecycleLogger = Effect.fn("makeProviderLifecycleLogger")(function* (
  providerLogsDir: string,
): Effect.fn.Return<ProviderLifecycleLoggerShape | undefined> {
  const maxBytes = DEFAULT_MAX_BYTES;
  const maxFiles = DEFAULT_MAX_FILES;
  const batchWindowMs = DEFAULT_BATCH_WINDOW_MS;

  const directoryReady = yield* Effect.sync(() => {
    try {
      fs.mkdirSync(providerLogsDir, { recursive: true });
      return true;
    } catch (error) {
      return { ok: false as const, error };
    }
  });
  if (directoryReady !== true) {
    yield* logWarning("failed to create lifecycle log directory", {
      dir: providerLogsDir,
      error: directoryReady.error,
    });
    return undefined;
  }

  const threadWriters = new Map<string, ThreadWriter>();
  const failedSegments = new Set<string>();

  const resolveThreadWriter = Effect.fn("resolveThreadWriter")(function* (
    threadSegment: string,
  ): Effect.fn.Return<ThreadWriter | undefined> {
    if (failedSegments.has(threadSegment)) {
      return undefined;
    }
    const existing = threadWriters.get(threadSegment);
    if (existing) {
      return existing;
    }

    const writer = yield* makeThreadWriter({
      filePath: path.join(providerLogsDir, `${threadSegment}.lifecycle.log`),
      maxBytes,
      maxFiles,
      batchWindowMs,
    });
    if (!writer) {
      failedSegments.add(threadSegment);
      return undefined;
    }

    threadWriters.set(threadSegment, writer);
    return writer;
  });

  const log = Effect.fn("log")(function* (threadId: ThreadId | null, entry: LifecycleEntry) {
    const threadSegment = resolveThreadSegment(threadId);

    const serialized = yield* Effect.sync(() => {
      try {
        return {
          ok: true as const,
          value: JSON.stringify({
            ts: new Date().toISOString(),
            scope: entry.scope,
            event: entry.event,
            ...(threadId ? { threadId } : {}),
            ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
            ...(entry.turnId ? { turnId: entry.turnId } : {}),
            ...entry.details,
          }),
        };
      } catch (error) {
        return { ok: false as const, error };
      }
    });

    if (!serialized.ok) {
      yield* logWarning("failed to serialize lifecycle log entry", {
        error: serialized.error,
      });
      return;
    }

    const writer = yield* resolveThreadWriter(threadSegment);
    if (!writer) {
      return;
    }

    yield* writer.writeMessage(serialized.value);
  });

  const close = Effect.fn("close")(function* () {
    for (const writer of threadWriters.values()) {
      yield* writer.close();
    }
    threadWriters.clear();
  });

  return { log, close } satisfies ProviderLifecycleLoggerShape;
});

export function makeProviderLifecycleLoggerLive(providerLogsDir: string) {
  return Layer.effect(
    ProviderLifecycleLogger,
    makeProviderLifecycleLogger(providerLogsDir).pipe(
      Effect.map((logger) => logger ?? { log: () => Effect.void, close: () => Effect.void }),
    ),
  );
}
