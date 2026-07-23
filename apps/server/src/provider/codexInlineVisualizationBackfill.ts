import {
  CommandId,
  type OrchestrationCommand,
  type OrchestrationThreadContent,
  type ProviderKind,
  type ThreadId,
  baseProviderKind,
} from "@t3tools/contracts";
import { formatTimelineLog } from "@t3tools/shared/timeline";
import { Duration, Effect, Option } from "effect";

import { materializeCodexInlineVisualizations } from "./codexInlineVisualizations";

interface PersistedProviderSession {
  readonly provider: ProviderKind;
  readonly resumeCursor: unknown | null | undefined;
}

export interface CodexInlineVisualizationBackfillInput<
  ContentError,
  SessionError,
  HomeError,
  DispatchError,
> {
  readonly threadId: ThreadId;
  readonly getThreadContent: () => Effect.Effect<OrchestrationThreadContent, ContentError>;
  readonly getPersistedSession?: () => Effect.Effect<
    PersistedProviderSession | undefined,
    SessionError
  >;
  readonly resolveCodexHomeForProvider: (
    provider: ProviderKind,
  ) => Effect.Effect<string, HomeError>;
  readonly dispatch: (
    command: OrchestrationCommand,
  ) => Effect.Effect<{ readonly sequence: number }, DispatchError>;
  readonly makeCommandId?: () => CommandId;
}

const MAX_BACKFILL_MESSAGES = 8;
const BACKFILL_BUDGET = Duration.seconds(2);

export function backfillCodexInlineVisualizations<
  ContentError,
  SessionError,
  HomeError,
  DispatchError,
>(
  input: CodexInlineVisualizationBackfillInput<
    ContentError,
    SessionError,
    HomeError,
    DispatchError
  >,
): Effect.Effect<OrchestrationThreadContent, ContentError> {
  return Effect.gen(function* () {
    const content = yield* input.getThreadContent();
    const candidates = content.messages
      .filter(
        (message) => message.role === "assistant" && message.text.includes("::codex-inline-vis{"),
      )
      .slice(0, MAX_BACKFILL_MESSAGES);
    if (candidates.length === 0) return content;

    const enrichment = Effect.gen(function* () {
      const binding = input.getPersistedSession ? yield* input.getPersistedSession() : undefined;
      const resumeCursor =
        binding?.resumeCursor &&
        typeof binding.resumeCursor === "object" &&
        !Array.isArray(binding.resumeCursor)
          ? (binding.resumeCursor as Record<string, unknown>)
          : undefined;
      const nativeThreadId = resumeCursor?.threadId;
      if (
        !binding ||
        baseProviderKind(binding.provider) !== "codex" ||
        typeof nativeThreadId !== "string"
      ) {
        yield* Effect.logInfo(
          formatTimelineLog("server.ws", "codex-inline-vis.backfill.skipped", {
            threadId: input.threadId,
            candidateCount: candidates.length,
            reason: "missing-codex-resume-cursor",
          }),
        );
        return content;
      }

      const codexHomePath = yield* input.resolveCodexHomeForProvider(binding.provider);
      let importedCount = 0;
      let unavailableCount = 0;
      for (const message of candidates) {
        const materialized = yield* materializeCodexInlineVisualizations({
          text: message.text,
          codexHomePath,
          nativeThreadId,
        }).pipe(Effect.catchCause(() => Effect.void));
        if (!materialized || materialized.text === message.text) continue;

        importedCount += materialized.artifacts.length;
        if (materialized.artifacts.length === 0) unavailableCount += 1;
        yield* input.dispatch({
          type: "thread.message.assistant.complete",
          commandId:
            input.makeCommandId?.() ??
            CommandId.makeUnsafe(`codex-inline-vis-backfill:${message.id}:${crypto.randomUUID()}`),
          threadId: input.threadId,
          messageId: message.id,
          text: materialized.text,
          metadata: {
            ...message.metadata,
            ...(materialized.artifacts.length > 0
              ? {
                  dynamicChatUiArtifacts: [
                    ...(message.metadata?.dynamicChatUiArtifacts ?? []),
                    ...materialized.artifacts,
                  ],
                }
              : {}),
          },
          ...(message.turnId !== null ? { turnId: message.turnId } : {}),
          createdAt: message.createdAt,
        });
      }

      yield* Effect.logInfo(
        formatTimelineLog("server.ws", "codex-inline-vis.backfill.completed", {
          threadId: input.threadId,
          candidateCount: candidates.length,
          importedCount,
          unavailableCount,
        }),
      );
      return importedCount > 0 || unavailableCount > 0 ? yield* input.getThreadContent() : content;
    });

    return yield* enrichment.pipe(
      Effect.timeoutOption(BACKFILL_BUDGET),
      Effect.map(Option.getOrElse(() => content)),
      Effect.catchCause((cause) =>
        Effect.logWarning(
          formatTimelineLog("server.ws", "codex-inline-vis.backfill.failed", {
            threadId: input.threadId,
            candidateCount: candidates.length,
            cause: String(cause),
          }),
        ).pipe(Effect.as(content)),
      ),
    );
  });
}
