/**
 * SessionRestartService - Restart a provider agent session on behalf of the
 * model running in that session. Used when the model installs a new MCP
 * server, detects that a tool call has deadlocked, or otherwise needs the
 * underlying Codex / Claude SDK process cycled.
 *
 * The restart is scheduled asynchronously: the caller (a REST tool handler)
 * returns immediately, and a background daemon stops the session, waits for
 * it to reach the `stopped` state, and dispatches a continuation turn marked
 * `metadata.internal = true` so the UI does not render it.
 */
import type { ThreadId } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface SessionRestartServiceShape {
  readonly scheduleRestart: (input: { threadId: ThreadId }) => Effect.Effect<void>;
}

export class SessionRestartService extends ServiceMap.Service<
  SessionRestartService,
  SessionRestartServiceShape
>()("t3/sessionRestart/Services/SessionRestart") {}
