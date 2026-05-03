import { randomUUID } from "node:crypto";
import {
  asProviderInput,
  baseProviderKind,
  type CanonicalItemType,
  EventId,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type CursorSettings,
  type ProviderKind,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderTurnStartResult,
} from "@t3tools/contracts";
import { Effect, Fiber, Layer, Option, Queue, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ManagedRunService } from "../../managedRuns/Services/ManagedRuns";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ServerConfig } from "../../config";
import { ServerSettingsService } from "../../serverSettings";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors";
import { CursorAdapter, type CursorAdapterShape } from "../Services/CursorAdapter";
import type { ProviderThreadSnapshot } from "../Services/ProviderAdapter";
import { resolveCursorSettingsForProvider } from "../cursorProfileDiscovery";
import { collectStreamAsString } from "../providerSnapshot";
import {
  buildProviderSessionContextPrompt,
  hashProviderSessionContextPrompt,
} from "../sessionContextPrompt";
import {
  buildCursorTurnEnv,
  type CursorHeadlessMode,
  type CursorTurnCommandInput,
  type CursorTurnRunnerOptions,
  type CursorTurnRunResult,
  runCursorTurn,
} from "../cursor/CursorTurnRunner";
import type { CursorStreamJsonEvent, CursorToolCallEvent } from "../cursor/CursorStreamJson";
import type {
  LifecycleEntry,
  ProviderLifecycleLoggerShape,
} from "../Services/ProviderLifecycleLogger";
import type { CursorProcessCleanupEvent } from "../cursor/CursorProcessTree";

const PROVIDER = "cursor" as const;
const CURSOR_ADAPTER_INTERRUPT_WAIT_MS = 5_000;
const CURSOR_RUNNER_CLEANUP_GRACE_MS = 2_000;

interface CursorResumeCursor {
  readonly version: 1;
  readonly sessionId: string;
  readonly cwd?: string;
  readonly provider: ProviderKind;
  readonly model?: string;
  readonly contextPromptHash?: string;
  readonly contextPromptInjected?: boolean;
}

interface CursorTurnState {
  readonly turnId: TurnId;
  readonly assistantItemId: RuntimeItemId;
  readonly items: Array<unknown>;
  fiber: Fiber.Fiber<void, never> | undefined;
  assistantStarted: boolean;
  assistantText: string;
  assistantSegmentText: string;
  reasoningText: string;
  reasoningSegmentText: string;
  completed: boolean;
  cancelRequested: boolean;
}

interface CursorSessionContext {
  session: ProviderSession;
  readonly providerKind: ProviderKind;
  readonly settings: CursorSettings;
  providerSessionId: string;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly sessionContextPrompt?: string;
  readonly sessionContextPromptHash?: string;
  sessionContextPromptInjected: boolean;
  activeTurn: CursorTurnState | undefined;
  stopped: boolean;
}

export interface CursorAdapterLiveOptions {
  readonly createChat?: (input: {
    readonly settings: CursorSettings;
    readonly cwd?: string;
  }) => Effect.Effect<string, ProviderAdapterError>;
  readonly runTurn?: (
    input: CursorTurnCommandInput,
    options?: CursorTurnRunnerOptions,
  ) => Effect.Effect<CursorTurnRunResult, ProviderAdapterError>;
  readonly lifecycleLogger?: ProviderLifecycleLoggerShape;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeEventId(prefix: string): EventId {
  return EventId.makeUnsafe(`${prefix}-${randomUUID()}`);
}

function makeTurnId(): TurnId {
  return TurnId.makeUnsafe(`cursor-turn-${randomUUID()}`);
}

function makeRuntimeItemId(prefix: string): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(`${prefix}-${randomUUID()}`);
}

function toMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cursorCleanupPolicyDetails(): Record<string, unknown> {
  return {
    cleanupRunner: "CursorTurnRunner",
    signalSequence: ["SIGINT", "SIGTERM", "SIGKILL"],
    graceMs: CURSOR_RUNNER_CLEANUP_GRACE_MS,
    adapterWaitMs: CURSOR_ADAPTER_INTERRUPT_WAIT_MS,
    posixTarget: "detached process group plus descendants",
    windowsTarget: "taskkill /T; force kill uses /F",
  };
}

function extractCursorSessionId(cursor: unknown): string | null {
  if (typeof cursor === "string" && cursor.trim()) {
    return cursor;
  }
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
    return null;
  }
  const sessionId = (cursor as { readonly sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : null;
}

function resumeCursorMatchesProvider(cursor: unknown, provider: ProviderKind): boolean {
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
    return true;
  }
  const cursorProvider = (cursor as { readonly provider?: unknown }).provider;
  return cursorProvider === undefined || cursorProvider === provider;
}

function resumeCursorHasInjectedContext(cursor: unknown, contextPromptHash: string): boolean {
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
    return false;
  }
  const resume = cursor as {
    readonly contextPromptHash?: unknown;
    readonly contextPromptInjected?: unknown;
  };
  return resume.contextPromptInjected === true && resume.contextPromptHash === contextPromptHash;
}

function resumeCursorRequestsFork(cursor: unknown): boolean {
  return (
    !!cursor &&
    typeof cursor === "object" &&
    !Array.isArray(cursor) &&
    (cursor as { readonly fork?: unknown }).fork === true
  );
}

function makeResumeCursor(input: {
  readonly sessionId: string;
  readonly provider: ProviderKind;
  readonly cwd?: string;
  readonly model?: string;
  readonly contextPromptHash?: string;
  readonly contextPromptInjected?: boolean;
}): CursorResumeCursor {
  return {
    version: 1,
    sessionId: input.sessionId,
    provider: input.provider,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.contextPromptHash ? { contextPromptHash: input.contextPromptHash } : {}),
    ...(input.contextPromptInjected !== undefined
      ? { contextPromptInjected: input.contextPromptInjected }
      : {}),
  };
}

function commandFromCursorLaunch(
  settings: CursorSettings,
  args: ReadonlyArray<string>,
  cwd?: string,
): ChildProcess.Command {
  const launchCommand = settings.launchCommand.filter((part) => part.trim().length > 0);
  const command = launchCommand.at(0) ?? settings.binaryPath;
  const commandArgs = launchCommand.length > 0 ? [...launchCommand.slice(1), ...args] : [...args];
  return ChildProcess.make(command, commandArgs, {
    ...(cwd ? { cwd } : {}),
    env: buildCursorTurnEnv(settings),
    shell: process.platform === "win32",
  });
}

const createCursorChat = (input: { readonly settings: CursorSettings; readonly cwd?: string }) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      commandFromCursorLaunch(input.settings, ["create-chat"], input.cwd),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );
    if (exitCode !== 0) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "create-chat",
        detail: stderr.trim() || stdout.trim() || `Cursor exited with code ${exitCode}.`,
      });
    }
    const sessionId = stdout.trim().split(/\s+/)[0];
    if (!sessionId) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "create-chat",
        detail: "Cursor create-chat did not return a session id.",
      });
    }
    return sessionId;
  }).pipe(Effect.scoped);

function headlessModeFromInteractionMode(
  interactionMode: ProviderSendTurnInput["interactionMode"],
): CursorHeadlessMode | undefined {
  return interactionMode === "plan" ? "plan" : undefined;
}

function appendSessionContextPrompt(
  text: string,
  context: CursorSessionContext,
): { readonly prompt: string; readonly injected: boolean } {
  if (!context.sessionContextPrompt || context.sessionContextPromptInjected) {
    return { prompt: text, injected: false };
  }
  return {
    prompt: `${context.sessionContextPrompt}\n\n---\n\n${text}`,
    injected: true,
  };
}

function resolveCursorTextDelta(
  segmentText: string,
  incomingText: string,
): { readonly delta: string; readonly nextText: string } | null {
  if (!incomingText) return null;

  if (incomingText === segmentText || segmentText.startsWith(incomingText)) {
    return { delta: "", nextText: segmentText };
  }

  if (incomingText.startsWith(segmentText)) {
    return {
      delta: incomingText.slice(segmentText.length),
      nextText: incomingText,
    };
  }

  return {
    delta: incomingText,
    nextText: `${segmentText}${incomingText}`,
  };
}

function titleCaseToolName(value: string): string {
  const withoutSuffix = value.replace(/ToolCall$/u, "");
  const spaced = withoutSuffix
    .replace(/[_-]+/gu, " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .trim();
  return spaced.length > 0
    ? spaced.replace(/\b\w/gu, (char) => char.toUpperCase())
    : "Cursor tool call";
}

function extractCursorToolName(toolCall: unknown, fallback: string | undefined): string {
  if (isRecord(toolCall)) {
    const key = Object.keys(toolCall).find((candidate) => candidate.trim().length > 0);
    if (key) return key;
  }
  return fallback && fallback.trim() ? fallback : "cursorToolCall";
}

function isCursorToolCallEvent(event: CursorStreamJsonEvent): event is CursorToolCallEvent {
  return event.type === "tool_call";
}

function cursorToolItemId(toolName: string, callId: string | undefined): RuntimeItemId {
  const raw = callId && callId.trim() ? callId : toolName;
  const safe = raw.replace(/[^a-zA-Z0-9._:-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return RuntimeItemId.makeUnsafe(`cursor-tool-${safe || "tool"}`);
}

function extractCursorToolArgs(toolCall: unknown): unknown {
  if (!isRecord(toolCall)) return undefined;
  const key = Object.keys(toolCall).find((candidate) => candidate.trim().length > 0);
  if (!key) return undefined;
  const body = toolCall[key];
  return isRecord(body) && "args" in body ? body.args : body;
}

function summarizeCursorToolDetail(toolName: string, args: unknown): string | undefined {
  if (args === undefined) return undefined;
  const normalizedName = titleCaseToolName(toolName);
  const command = isRecord(args)
    ? typeof args.command === "string"
      ? args.command
      : typeof args.cmd === "string"
        ? args.cmd
        : undefined
    : undefined;
  if (command && command.trim()) {
    return `${normalizedName}: ${command.trim().slice(0, 400)}`;
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(args);
  } catch {
    return normalizedName;
  }
  if (!serialized) return normalizedName;
  return `${normalizedName}: ${serialized.length <= 400 ? serialized : `${serialized.slice(0, 397)}...`}`;
}

function classifyCursorToolItemType(toolName: string): CanonicalItemType {
  const normalized = toolName.toLowerCase();
  if (
    normalized.includes("shell") ||
    normalized.includes("bash") ||
    normalized.includes("terminal") ||
    normalized.includes("command")
  ) {
    return "command_execution";
  }
  if (
    normalized.includes("edit") ||
    normalized.includes("write") ||
    normalized.includes("patch") ||
    normalized.includes("create") ||
    normalized.includes("delete") ||
    normalized.includes("file")
  ) {
    return "file_change";
  }
  return "dynamic_tool_call";
}

export function makeCursorAdapterLive(options?: CursorAdapterLiveOptions) {
  return Layer.effect(
    CursorAdapter,
    Effect.gen(function* () {
      const settingsService = yield* ServerSettingsService;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const managedRunService = yield* ManagedRunService;
      const serverConfig = yield* ServerConfig;
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const sessions = new Map<ThreadId, CursorSessionContext>();
      const createChat =
        options?.createChat ??
        ((input: { readonly settings: CursorSettings; readonly cwd?: string }) =>
          createCursorChat(input).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
            Effect.mapError((cause) =>
              cause._tag === "ProviderAdapterRequestError"
                ? cause
                : new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "create-chat",
                    detail: toMessage(cause, "Cursor create-chat failed."),
                    cause,
                  }),
            ),
          ));
      const runTurn =
        options?.runTurn ??
        ((input: CursorTurnCommandInput, runnerOptions?: CursorTurnRunnerOptions) =>
          runCursorTurn(input, runnerOptions).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "sendTurn",
                  detail: toMessage(cause, "Cursor turn failed."),
                  cause,
                }),
            ),
          ));
      const lifecycle = options?.lifecycleLogger;
      const lfcyl = (
        threadId: ThreadId | null,
        entry: Omit<LifecycleEntry, "sessionId" | "turnId"> & {
          readonly sessionId?: string | undefined;
          readonly turnId?: string | undefined;
        },
      ) => {
        const clean = {
          scope: entry.scope,
          event: entry.event,
          ...(entry.details !== undefined ? { details: entry.details } : {}),
          ...(entry.sessionId !== undefined ? { sessionId: entry.sessionId } : {}),
          ...(entry.turnId !== undefined ? { turnId: entry.turnId } : {}),
        } satisfies LifecycleEntry;
        return lifecycle
          ? lifecycle.log(threadId, clean).pipe(Effect.ignoreCause({ log: true }))
          : Effect.void;
      };

      const offerRuntimeEvent = (event: ProviderRuntimeEvent) => {
        Queue.offerUnsafe(runtimeEventQueue, event);
      };

      const eventBase = (
        context: CursorSessionContext,
        raw?: ProviderRuntimeEvent["raw"],
      ): Omit<ProviderRuntimeEvent, "type" | "payload"> => ({
        eventId: makeEventId("cursor-event"),
        provider: asProviderInput(context.providerKind),
        threadId: context.session.threadId,
        createdAt: nowIso(),
        ...(context.activeTurn ? { turnId: context.activeTurn.turnId } : {}),
        ...(raw ? { raw } : {}),
      });

      const updateSession = (context: CursorSessionContext, patch: Partial<ProviderSession>) => {
        context.session = {
          ...context.session,
          ...patch,
          updatedAt: nowIso(),
        };
      };

      const updateResumeCursor = (context: CursorSessionContext) => {
        updateSession(context, {
          resumeCursor: makeResumeCursor({
            sessionId: context.providerSessionId,
            provider: context.providerKind,
            ...(context.session.cwd ? { cwd: context.session.cwd } : {}),
            ...(context.session.model ? { model: context.session.model } : {}),
            ...(context.sessionContextPromptHash
              ? { contextPromptHash: context.sessionContextPromptHash }
              : {}),
            contextPromptInjected: context.sessionContextPromptInjected,
          }),
        });
      };

      const getContext = (
        threadId: ThreadId,
        operation: string,
      ): Effect.Effect<CursorSessionContext, ProviderAdapterError> =>
        Effect.sync(() => sessions.get(threadId)).pipe(
          Effect.flatMap((context) =>
            context
              ? Effect.succeed(context)
              : Effect.fail(
                  new ProviderAdapterSessionNotFoundError({
                    provider: PROVIDER,
                    threadId,
                  }),
                ),
          ),
          Effect.flatMap((context) =>
            context.stopped || context.session.status === "closed"
              ? Effect.fail(
                  new ProviderAdapterSessionClosedError({
                    provider: PROVIDER,
                    threadId,
                  }),
                )
              : Effect.succeed(context),
          ),
          Effect.withSpan(`CursorAdapter.${operation}`),
        );

      const logCursorProcessCleanupEvent = (
        context: CursorSessionContext,
        turn: CursorTurnState,
        event: CursorProcessCleanupEvent,
      ) =>
        lfcyl(context.session.threadId, {
          scope: "cursor.process_tree",
          event: `cursor.process_tree.${event.stage}`,
          sessionId: context.providerSessionId,
          turnId: turn.turnId,
          details: {
            ...cursorCleanupPolicyDetails(),
            stage: event.stage,
            pid: event.pid,
            ...(event.signal ? { signal: event.signal } : {}),
            ...(event.graceMs !== undefined ? { graceMs: event.graceMs } : {}),
            ...(event.message ? { message: event.message } : {}),
          },
        });

      const interruptActiveTurnFiber = (
        context: CursorSessionContext,
        activeTurn: CursorTurnState,
        operation: "interruptTurn" | "stopSession",
      ) =>
        Effect.gen(function* () {
          if (!activeTurn.fiber) {
            yield* lfcyl(context.session.threadId, {
              scope: "cursor.adapter",
              event: "cursor.turn.interrupt.skipped",
              sessionId: context.providerSessionId,
              turnId: activeTurn.turnId,
              details: {
                operation,
                reason: "missing_fiber",
                ...cursorCleanupPolicyDetails(),
              },
            });
            return;
          }

          yield* lfcyl(context.session.threadId, {
            scope: "cursor.adapter",
            event: "cursor.turn.interrupt.requested",
            sessionId: context.providerSessionId,
            turnId: activeTurn.turnId,
            details: {
              operation,
              ...cursorCleanupPolicyDetails(),
            },
          });

          const outcome = yield* Fiber.interrupt(activeTurn.fiber).pipe(
            Effect.as("completed" as const),
            Effect.raceFirst(
              Effect.sleep(`${CURSOR_ADAPTER_INTERRUPT_WAIT_MS} millis`).pipe(
                Effect.as("timeout" as const),
              ),
            ),
          );

          yield* lfcyl(context.session.threadId, {
            scope: "cursor.adapter",
            event: "cursor.turn.interrupt.finished",
            sessionId: context.providerSessionId,
            turnId: activeTurn.turnId,
            details: {
              operation,
              outcome,
              ...cursorCleanupPolicyDetails(),
            },
          });
        });

      const ensureAssistantItemStarted = (context: CursorSessionContext, turn: CursorTurnState) => {
        if (turn.assistantStarted) return;
        turn.assistantStarted = true;
        offerRuntimeEvent({
          ...eventBase(context),
          type: "item.started",
          itemId: turn.assistantItemId,
          payload: {
            itemType: "assistant_message",
            status: "inProgress",
            title: "Cursor response",
          },
        });
      };

      const finishTurn = (
        context: CursorSessionContext,
        state: "completed" | "failed" | "interrupted",
        detail?: { readonly stopReason?: string | null; readonly errorMessage?: string },
      ) => {
        const turn = context.activeTurn;
        if (!turn || turn.completed) return;
        turn.completed = true;
        if (turn.assistantStarted) {
          offerRuntimeEvent({
            ...eventBase(context),
            type: "item.completed",
            itemId: turn.assistantItemId,
            payload: {
              itemType: "assistant_message",
              status: state === "failed" ? "failed" : "completed",
              title: "Cursor response",
            },
          });
        }
        context.turns.push({ id: turn.turnId, items: turn.items });
        offerRuntimeEvent({
          ...eventBase(context),
          type: "turn.completed",
          payload: {
            state,
            ...(detail?.stopReason !== undefined ? { stopReason: detail.stopReason } : {}),
            ...(detail?.errorMessage ? { errorMessage: detail.errorMessage } : {}),
          },
        });
        context.activeTurn = undefined;
        updateSession(context, {
          status: state === "failed" ? "error" : "ready",
          activeTurnId: undefined,
          ...(detail?.errorMessage ? { lastError: detail.errorMessage } : {}),
        });
        offerRuntimeEvent({
          ...eventBase(context),
          type: "session.state.changed",
          payload: {
            state: state === "failed" ? "error" : "ready",
            ...(detail?.errorMessage ? { reason: detail.errorMessage } : {}),
          },
        });
      };

      const emitCursorRunResult = (context: CursorSessionContext, result: CursorTurnRunResult) => {
        context.providerSessionId = result.sessionId;
        updateResumeCursor(context);

        const turn = context.activeTurn;
        if (!turn) return;
        for (const event of result.events) {
          if (event.type === "assistant" && "text" in event && event.text) {
            const resolved = resolveCursorTextDelta(turn.assistantSegmentText, event.text);
            if (!resolved) continue;
            turn.assistantSegmentText = resolved.nextText;
            if (!resolved.delta) continue;
            turn.assistantText += resolved.delta;
            ensureAssistantItemStarted(context, turn);
            turn.items.push({
              type: "assistant_text",
              delta: resolved.delta,
              createdAt: nowIso(),
            });
            offerRuntimeEvent({
              ...eventBase(context, { source: "cursor.stream-json", payload: event.raw }),
              type: "content.delta",
              itemId: turn.assistantItemId,
              payload: { streamKind: "assistant_text", delta: resolved.delta },
            });
          } else if (event.type === "thinking" && "text" in event && event.text) {
            const resolved = resolveCursorTextDelta(turn.reasoningSegmentText, event.text);
            if (!resolved) continue;
            turn.reasoningSegmentText = resolved.nextText;
            if (!resolved.delta) continue;
            turn.reasoningText += resolved.delta;
            ensureAssistantItemStarted(context, turn);
            turn.items.push({
              type: "reasoning_text",
              delta: resolved.delta,
              createdAt: nowIso(),
            });
            offerRuntimeEvent({
              ...eventBase(context, { source: "cursor.stream-json", payload: event.raw }),
              type: "content.delta",
              itemId: turn.assistantItemId,
              payload: { streamKind: "reasoning_text", delta: resolved.delta },
            });
          } else if (event.type === "interaction_query") {
            offerRuntimeEvent({
              ...eventBase(context, { source: "cursor.stream-json", payload: event.raw }),
              type: "runtime.warning",
              payload: {
                message:
                  "Cursor emitted an interaction query. T3 logs it, but provider-native interaction responses are not supported yet.",
              },
            });
          } else if (isCursorToolCallEvent(event)) {
            turn.assistantSegmentText = "";
            turn.reasoningSegmentText = "";
            const toolName = extractCursorToolName(event.toolCall, event.callId);
            const itemType = classifyCursorToolItemType(toolName);
            const args = extractCursorToolArgs(event.toolCall);
            const itemId = cursorToolItemId(toolName, event.callId);
            const detail = summarizeCursorToolDetail(toolName, args);
            const eventType =
              event.subtype === "completed"
                ? "item.completed"
                : event.subtype === "started"
                  ? "item.started"
                  : "item.updated";
            offerRuntimeEvent({
              ...eventBase(context, { source: "cursor.stream-json", payload: event.raw }),
              type: eventType,
              itemId,
              payload: {
                itemType,
                status: eventType === "item.completed" ? "completed" : "inProgress",
                title: titleCaseToolName(toolName),
                ...(detail ? { detail } : {}),
                data: {
                  toolName,
                  args,
                  toolCall: event.toolCall,
                  subtype: event.subtype,
                },
              },
            });
          }
        }

        if (result.usage) {
          const inputTokens = result.usage.inputTokens ?? 0;
          const cachedInputTokens = result.usage.cacheReadTokens ?? 0;
          const outputTokens = result.usage.outputTokens ?? 0;
          offerRuntimeEvent({
            ...eventBase(context),
            type: "thread.token-usage.updated",
            payload: {
              usage: {
                usedTokens: inputTokens + outputTokens,
                totalProcessedTokens: inputTokens + outputTokens,
                inputTokens,
                cachedInputTokens,
                outputTokens,
                lastInputTokens: inputTokens,
                lastCachedInputTokens: cachedInputTokens,
                lastOutputTokens: outputTokens,
              },
            },
          });
        }
      };

      const startSession: CursorAdapterShape["startSession"] = Effect.fn("startCursorSession")(
        function* (input: ProviderSessionStartInput) {
          const requestedProvider = input.provider ?? PROVIDER;
          if (baseProviderKind(requestedProvider) !== PROVIDER) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `CursorAdapter cannot start provider ${requestedProvider}.`,
            });
          }
          if (!resumeCursorMatchesProvider(input.resumeCursor, requestedProvider)) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Cursor resume cursor belongs to a different provider profile than ${requestedProvider}.`,
            });
          }
          if (resumeCursorRequestsFork(input.resumeCursor)) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "startSession",
              detail:
                "Cursor Agent CLI does not expose a non-interactive fork or conversation copy method. Start a fresh Cursor session instead.",
            });
          }

          const allSettings = yield* settingsService.getSettings.pipe(Effect.orDie);
          const cursorSettings = resolveCursorSettingsForProvider(allSettings, requestedProvider);
          if (!cursorSettings.enabled) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Cursor provider '${requestedProvider}' is disabled in T3 Code settings.`,
            });
          }
          const model =
            input.modelSelection && baseProviderKind(input.modelSelection.provider) === PROVIDER
              ? input.modelSelection.model
              : undefined;
          const cwd = input.cwd;
          const checkpointContext = yield* projectionSnapshotQuery
            .getThreadCheckpointContext(input.threadId)
            .pipe(Effect.catch(() => Effect.succeed(Option.none())));
          const serviceContext =
            Option.isSome(checkpointContext) && serverConfig.port > 0
              ? {
                  port: serverConfig.port,
                  isDev: serverConfig.devUrl !== undefined,
                  isElectron: serverConfig.mode === "desktop",
                  token: (yield* managedRunService.issueMcpAccess(
                    checkpointContext.value.projectId,
                    input.threadId,
                  )).token,
                  adminPrompts: allSettings.prompts.admin,
                }
              : undefined;
          const baseSessionContextPrompt = Option.isSome(checkpointContext)
            ? buildProviderSessionContextPrompt({
                threadId: input.threadId,
                projectTitle: checkpointContext.value.projectTitle,
                workspaceRoot: checkpointContext.value.workspaceRoot,
                worktreePath: checkpointContext.value.worktreePath,
                systemPrompt: checkpointContext.value.systemPrompt,
                includeProjectContext: true,
                ...(serviceContext ? { serviceContext } : {}),
              })
            : undefined;
          const sessionContextPrompt = input.systemPrompt
            ? [
                ...(baseSessionContextPrompt ? [baseSessionContextPrompt] : []),
                input.systemPrompt,
              ].join("\n\n")
            : baseSessionContextPrompt;
          const sessionContextPromptHash = sessionContextPrompt
            ? hashProviderSessionContextPrompt(sessionContextPrompt)
            : undefined;
          const sessionContextPromptInjected = sessionContextPromptHash
            ? resumeCursorHasInjectedContext(input.resumeCursor, sessionContextPromptHash)
            : true;
          const existingSessionId = extractCursorSessionId(input.resumeCursor);
          const providerSessionId =
            existingSessionId ??
            (yield* createChat({ settings: cursorSettings, ...(cwd ? { cwd } : {}) }));
          const startedAt = nowIso();
          const session: ProviderSession = {
            provider: asProviderInput(requestedProvider),
            status: "ready",
            runtimeMode: input.runtimeMode,
            ...(cwd ? { cwd } : {}),
            ...(model ? { model } : {}),
            threadId: input.threadId,
            resumeCursor: makeResumeCursor({
              sessionId: providerSessionId,
              provider: requestedProvider,
              ...(cwd ? { cwd } : {}),
              ...(model ? { model } : {}),
              ...(sessionContextPromptHash ? { contextPromptHash: sessionContextPromptHash } : {}),
              contextPromptInjected: sessionContextPromptInjected,
            }),
            createdAt: startedAt,
            updatedAt: startedAt,
          };
          const context: CursorSessionContext = {
            session,
            providerKind: requestedProvider,
            settings: cursorSettings,
            providerSessionId,
            turns: [],
            ...(sessionContextPrompt ? { sessionContextPrompt } : {}),
            ...(sessionContextPromptHash ? { sessionContextPromptHash } : {}),
            sessionContextPromptInjected,
            activeTurn: undefined,
            stopped: false,
          };
          sessions.set(input.threadId, context);

          offerRuntimeEvent({
            ...eventBase(context),
            type: "session.started",
            payload: { resume: session.resumeCursor },
          });
          offerRuntimeEvent({
            ...eventBase(context),
            type: "thread.started",
            payload: { providerThreadId: providerSessionId },
          });
          offerRuntimeEvent({
            ...eventBase(context),
            type: "session.state.changed",
            payload: { state: "ready" },
          });

          return session;
        },
      );

      const sendTurn: CursorAdapterShape["sendTurn"] = Effect.fn("sendCursorTurn")(function* (
        input: ProviderSendTurnInput,
      ) {
        const context = yield* getContext(input.threadId, "sendTurn");
        if (context.activeTurn) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Cursor session already has an active turn.",
          });
        }
        if (input.attachments && input.attachments.length > 0) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Cursor adapter does not support T3 attachments yet.",
          });
        }
        const text = trimOrUndefined(input.input);
        if (!text) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Cursor turns require text input.",
          });
        }

        const selectedModel =
          input.modelSelection && baseProviderKind(input.modelSelection.provider) === PROVIDER
            ? input.modelSelection.model
            : context.session.model;
        const promptInput = appendSessionContextPrompt(text, context);
        if (promptInput.injected) {
          context.sessionContextPromptInjected = true;
          updateResumeCursor(context);
        }
        const headlessMode = headlessModeFromInteractionMode(input.interactionMode);

        const turnId = makeTurnId();
        updateSession(context, {
          status: "running",
          activeTurnId: turnId,
          ...(selectedModel ? { model: selectedModel } : {}),
        });
        updateResumeCursor(context);
        offerRuntimeEvent({
          ...eventBase(context),
          type: "session.state.changed",
          payload: { state: "running" },
        });
        offerRuntimeEvent({
          ...eventBase(context),
          type: "turn.started",
          turnId,
          payload: selectedModel ? { model: selectedModel } : {},
        });

        const turn: CursorTurnState = {
          turnId,
          assistantItemId: makeRuntimeItemId("cursor-assistant"),
          items: [],
          fiber: undefined,
          assistantStarted: false,
          assistantText: "",
          assistantSegmentText: "",
          reasoningText: "",
          reasoningSegmentText: "",
          completed: false,
          cancelRequested: false,
        };
        context.activeTurn = turn;

        const turnEffect = runTurn(
          {
            settings: context.settings,
            cwd: context.session.cwd ?? process.cwd(),
            prompt: promptInput.prompt,
            runtimeMode: context.session.runtimeMode,
            resumeSessionId: context.providerSessionId,
            ...(selectedModel ? { model: selectedModel } : {}),
            ...(headlessMode ? { headlessMode } : {}),
            streamPartialOutput: true,
          },
          {
            onCleanupEvent: (event) => logCursorProcessCleanupEvent(context, turn, event),
          },
        );
        const fiber = yield* Effect.forkDetach(
          turnEffect.pipe(
            Effect.match({
              onFailure: (error) => {
                const activeTurn = context.activeTurn;
                const state = activeTurn?.cancelRequested ? "interrupted" : "failed";
                offerRuntimeEvent({
                  ...eventBase(context),
                  type: "runtime.error",
                  payload: {
                    message: error.message,
                    class: "provider_error",
                  },
                });
                finishTurn(context, state, { errorMessage: error.message });
              },
              onSuccess: (result) => {
                emitCursorRunResult(context, result);
                finishTurn(context, "completed", { stopReason: result.result.subtype ?? null });
              },
            }),
          ),
          { startImmediately: true },
        );
        turn.fiber = fiber;

        return {
          threadId: input.threadId,
          turnId,
          resumeCursor: context.session.resumeCursor,
        } satisfies ProviderTurnStartResult;
      });

      const interruptTurn: CursorAdapterShape["interruptTurn"] = Effect.fn("interruptCursorTurn")(
        function* (threadId, turnId) {
          const context = yield* getContext(threadId, "interruptTurn");
          const activeTurn = context.activeTurn;
          if (!activeTurn || (turnId && activeTurn.turnId !== turnId)) return;
          activeTurn.cancelRequested = true;
          if (activeTurn.fiber) {
            yield* interruptActiveTurnFiber(context, activeTurn, "interruptTurn");
          }
          offerRuntimeEvent({
            ...eventBase(context),
            type: "turn.aborted",
            payload: { reason: "cancelled" },
          });
          finishTurn(context, "interrupted", { errorMessage: "Cursor turn interrupted." });
        },
      );

      const respondUnsupported = (method: string) =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method,
            detail:
              "Cursor Agent CLI interaction round trips are not supported by T3 yet. Continue in a new turn or use a provider with native approval support.",
          }),
        );

      const stopSession: CursorAdapterShape["stopSession"] = Effect.fn("stopCursorSession")(
        function* (threadId) {
          const context = yield* getContext(threadId, "stopSession");
          context.stopped = true;
          if (context.activeTurn) {
            context.activeTurn.cancelRequested = true;
            if (context.activeTurn.fiber) {
              yield* interruptActiveTurnFiber(context, context.activeTurn, "stopSession");
            }
            finishTurn(context, "interrupted", { errorMessage: "Cursor session stopped." });
            context.activeTurn = undefined;
          }
          updateSession(context, { status: "closed", activeTurnId: undefined });
          sessions.delete(threadId);
          offerRuntimeEvent({
            ...eventBase(context),
            type: "session.state.changed",
            payload: { state: "stopped" },
          });
          offerRuntimeEvent({
            ...eventBase(context),
            type: "session.exited",
            payload: { exitKind: "graceful" },
          });
        },
      );

      const readThread: CursorAdapterShape["readThread"] = (threadId) =>
        getContext(threadId, "readThread").pipe(
          Effect.map(
            (context): ProviderThreadSnapshot => ({
              threadId,
              turns: context.turns,
            }),
          ),
        );

      const stopAll: CursorAdapterShape["stopAll"] = () =>
        Effect.forEach(Array.from(sessions.keys()), (threadId) => stopSession(threadId), {
          discard: true,
        });

      return {
        provider: PROVIDER,
        capabilities: {
          sessionModelSwitch: "in-session",
          conversationRollback: "unsupported",
        },
        startSession,
        sendTurn,
        interruptTurn,
        respondToRequest: () => respondUnsupported("respondToRequest"),
        respondToUserInput: () => respondUnsupported("respondToUserInput"),
        stopSession,
        listSessions: () => Effect.succeed(Array.from(sessions.values()).map((ctx) => ctx.session)),
        hasSession: (threadId) => Effect.succeed(sessions.has(threadId)),
        readThread,
        rollbackThread: () =>
          Effect.fail(
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "rollbackThread",
              detail:
                "Cursor Agent CLI does not expose a non-interactive rollback or rewind method.",
            }),
          ),
        stopAll,
        streamEvents: Stream.fromQueue(runtimeEventQueue),
        probeRateLimits: () => Effect.succeed(null),
      } satisfies CursorAdapterShape;
    }),
  );
}

export const CursorAdapterLive = makeCursorAdapterLive();
