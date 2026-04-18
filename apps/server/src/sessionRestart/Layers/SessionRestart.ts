import {
  type CommandId,
  MessageId,
  type OrchestrationCommand,
  type ThreadId,
} from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../../provider/Services/ProviderSessionDirectory.ts";
import {
  SessionRestartService,
  type SessionRestartServiceShape,
} from "../Services/SessionRestart.ts";

/**
 * Continuation prompt delivered to the resumed session. Kept short so it does
 * not dominate provider context; the model has its full prior history via the
 * resume cursor.
 */
const CONTINUATION_PROMPT =
  "You were just restarted at your own request (via `restart_session`). Continue the work you were doing before. If you restarted to load a newly installed MCP server, verify it is available and proceed. If you restarted because a tool was stuck, avoid that tool path.";

/**
 * Poll interval for waiting on lifecycle transitions (turn finish, session
 * reaching `stopped`). There is intentionally no overall timeout — the
 * restart proceeds once the provider's own state machine says it's safe,
 * and if something hangs we want that to surface loudly rather than silently
 * short-circuit past it.
 */
const POLL_INTERVAL_MS = 200;

export const SessionRestartServiceLive = Layer.effect(
  SessionRestartService,
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const directory = yield* ProviderSessionDirectory;
    const orchestrationEngine = yield* OrchestrationEngineService;

    const sessionHasActiveTurn = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const sessions = yield* providerService.listSessions();
        const session = sessions.find((s) => s.threadId === threadId);
        if (!session) return false;
        if (session.status === "closed") return false;
        return session.activeTurnId != null;
      });

    const isStopped = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const binding = yield* directory.getBinding(threadId);
        if (Option.isNone(binding)) return true;
        return binding.value.status === "stopped";
      }).pipe(
        Effect.ignoreCause({ log: true }),
        Effect.map((stopped) => stopped ?? true),
      );

    const waitUntil = (check: Effect.Effect<boolean>) =>
      Effect.gen(function* () {
        while (!(yield* check)) {
          yield* Effect.sleep(`${POLL_INTERVAL_MS} millis`);
        }
      });

    const performRestart: SessionRestartServiceShape["scheduleRestart"] = (input) =>
      Effect.gen(function* () {
        const { threadId } = input;

        const work = Effect.gen(function* () {
          yield* Effect.logInfo("session-restart: waiting for active turn to finish", {
            threadId,
          });
          yield* waitUntil(sessionHasActiveTurn(threadId).pipe(Effect.map((active) => !active)));

          yield* Effect.logInfo("session-restart: stopping session", { threadId });
          yield* providerService.stopSession({ threadId }).pipe(Effect.ignoreCause({ log: true }));

          yield* waitUntil(isStopped(threadId));

          const now = new Date().toISOString();
          const messageId = MessageId.makeUnsafe(crypto.randomUUID());
          const commandId = `session-restart:${threadId}:${crypto.randomUUID()}` as CommandId;

          const command = {
            type: "thread.turn.start",
            commandId,
            threadId,
            message: {
              messageId,
              role: "user",
              text: CONTINUATION_PROMPT,
              attachments: [],
              metadata: { internal: true },
            },
            createdAt: now,
          } as unknown as OrchestrationCommand;

          yield* Effect.logInfo("session-restart: dispatching continuation turn", { threadId });
          yield* orchestrationEngine.dispatch(command).pipe(Effect.ignoreCause({ log: true }));
        });

        // Fire-and-forget: the REST handler returns immediately; this daemon
        // runs independently until the continuation turn is dispatched.
        yield* Effect.forkDetach(work);
      });

    return { scheduleRestart: performRestart } satisfies SessionRestartServiceShape;
  }),
);
