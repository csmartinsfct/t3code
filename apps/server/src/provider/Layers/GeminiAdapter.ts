import { randomUUID } from "node:crypto";
import {
  asProviderInput,
  baseProviderKind,
  EventId,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  type RuntimeContentStreamKind,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Queue, Stream } from "effect";

import { ServerConfig } from "../../config";
import { ManagedRunService } from "../../managedRuns/Services/ManagedRuns";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ServerSettingsService } from "../../serverSettings";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors";
import { GeminiAdapter, type GeminiAdapterShape } from "../Services/GeminiAdapter";
import type { ProviderThreadSnapshot } from "../Services/ProviderAdapter";
import {
  createGeminiAcpConnection,
  type GeminiAcpConnection,
  type GeminiAcpConnectionOptions,
  type GeminiAcpIncomingNotification,
  type GeminiAcpIncomingRequest,
} from "../gemini/GeminiAcpConnection";
import {
  buildProviderSessionContextPrompt,
  hashProviderSessionContextPrompt,
} from "../sessionContextPrompt";

const PROVIDER = "gemini" as const;
const GEMINI_SESSION_CONTEXT_URI = "t3://session/context";

interface GeminiResumeCursor {
  readonly sessionId: string;
  readonly cwd?: string;
  readonly contextPromptHash?: string;
  readonly contextPromptInjected?: boolean;
}

interface GeminiTurnState {
  readonly turnId: TurnId;
  readonly items: Array<unknown>;
  readonly assistantItemId: RuntimeItemId;
  cancelRequested: boolean;
  assistantStarted: boolean;
  completed: boolean;
}

interface GeminiSessionContext {
  session: ProviderSession;
  readonly connection: GeminiAcpConnection;
  readonly providerSessionId: string;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly sessionContextPrompt?: string;
  readonly sessionContextPromptHash?: string;
  sessionContextPromptInjected: boolean;
  activeTurn: GeminiTurnState | undefined;
  stopped: boolean;
}

export interface GeminiAdapterLiveOptions {
  readonly createConnection?: (options: GeminiAcpConnectionOptions) => GeminiAcpConnection;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeEventId(prefix: string): EventId {
  return EventId.makeUnsafe(`${prefix}-${randomUUID()}`);
}

function makeTurnId(): TurnId {
  return TurnId.makeUnsafe(`gemini-turn-${randomUUID()}`);
}

function makeRuntimeItemId(prefix: string): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(`${prefix}-${randomUUID()}`);
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractResumeSessionId(cursor: unknown): string | null {
  if (typeof cursor === "string" && cursor.trim()) {
    return cursor;
  }
  if (!isRecord(cursor)) {
    return null;
  }
  const sessionId = cursor.sessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : null;
}

function makeResumeCursor(
  sessionId: string,
  cwd: string | undefined,
  contextPrompt:
    | {
        readonly hash: string;
        readonly injected: boolean;
      }
    | undefined,
): GeminiResumeCursor {
  return {
    sessionId,
    ...(cwd ? { cwd } : {}),
    ...(contextPrompt
      ? {
          contextPromptHash: contextPrompt.hash,
          contextPromptInjected: contextPrompt.injected,
        }
      : {}),
  };
}

function resumeCursorHasInjectedContext(cursor: unknown, contextPromptHash: string): boolean {
  if (!isRecord(cursor)) {
    return false;
  }
  return cursor.contextPromptInjected === true && cursor.contextPromptHash === contextPromptHash;
}

function makeGeminiPromptInput(
  context: GeminiSessionContext,
  userText: string,
): {
  readonly text: string;
  readonly embeddedContext?: {
    readonly uri: string;
    readonly text: string;
    readonly mimeType: string;
  };
} {
  if (
    !context.sessionContextPrompt ||
    !context.sessionContextPromptHash ||
    context.sessionContextPromptInjected
  ) {
    return { text: userText };
  }

  return {
    text:
      "Use the referenced T3 session context as persistent operating context for this conversation. " +
      "Then answer the user request below.\n\n" +
      `User request:\n${userText}`,
    embeddedContext: {
      uri: GEMINI_SESSION_CONTEXT_URI,
      text: context.sessionContextPrompt,
      mimeType: "text/markdown",
    },
  };
}

function geminiModeFromInteractionMode(
  interactionMode: ProviderSendTurnInput["interactionMode"],
): "default" | "plan" | null {
  switch (interactionMode) {
    case "plan":
    case "plan-accept":
      return "plan";
    case "default":
      return "default";
    case undefined:
      return null;
  }
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(extractTextContent).filter(Boolean).join("");
  }
  if (!isRecord(content)) {
    return null;
  }
  if (typeof content.text === "string") {
    return content.text;
  }
  if (typeof content.content === "string") {
    return content.content;
  }
  return null;
}

function sessionUpdateFromNotification(
  notification: GeminiAcpIncomingNotification,
): Record<string, unknown> | null {
  if (notification.method !== "session/update" && notification.method !== "update") {
    return null;
  }
  const params = notification.params;
  if (!isRecord(params)) {
    return null;
  }
  return isRecord(params.update) ? params.update : params;
}

function textDeltaFromSessionUpdate(update: Record<string, unknown>): {
  readonly streamKind: RuntimeContentStreamKind;
  readonly delta: string;
} | null {
  const updateKind =
    typeof update.sessionUpdate === "string"
      ? update.sessionUpdate
      : typeof update.type === "string"
        ? update.type
        : "";
  const delta = extractTextContent(update.content ?? update.delta ?? update.text);
  if (!delta) {
    return null;
  }
  if (updateKind === "agent_thought_chunk") {
    return { streamKind: "reasoning_text", delta };
  }
  if (updateKind === "agent_message_chunk" || updateKind === "message" || updateKind === "") {
    return { streamKind: "assistant_text", delta };
  }
  return null;
}

function planFromSessionUpdate(update: Record<string, unknown>): {
  readonly explanation?: string | null;
  readonly plan: ReadonlyArray<{ step: string; status: "pending" | "inProgress" | "completed" }>;
} | null {
  const updateKind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : update.type;
  if (updateKind !== "plan") {
    return null;
  }
  const entries = Array.isArray(update.entries) ? update.entries : [];
  const plan = entries
    .map((entry): { step: string; status: "pending" | "inProgress" | "completed" } | null => {
      if (!isRecord(entry)) return null;
      const step =
        typeof entry.content === "string"
          ? entry.content
          : typeof entry.title === "string"
            ? entry.title
            : typeof entry.step === "string"
              ? entry.step
              : null;
      if (!step) return null;
      const statusRaw = typeof entry.status === "string" ? entry.status : "";
      const status =
        statusRaw === "completed" || statusRaw === "done"
          ? "completed"
          : statusRaw === "in_progress" || statusRaw === "inProgress"
            ? "inProgress"
            : "pending";
      return { step, status };
    })
    .filter((entry): entry is { step: string; status: "pending" | "inProgress" | "completed" } =>
      Boolean(entry),
    );
  return plan.length > 0 ? { plan } : null;
}

function sessionTitleFromUpdate(update: Record<string, unknown>): string | null {
  const updateKind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : update.type;
  if (updateKind !== "session_info_update") {
    return null;
  }
  return typeof update.title === "string" && update.title.trim() ? update.title : null;
}

function toolEventFromSessionUpdate(update: Record<string, unknown>): {
  readonly type: "item.started" | "item.updated" | "item.completed";
  readonly itemId: RuntimeItemId;
  readonly payload: ProviderRuntimeEvent["payload"];
} | null {
  const updateKind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : update.type;
  if (updateKind !== "tool_call" && updateKind !== "tool_call_update") {
    return null;
  }
  const toolCallId =
    typeof update.toolCallId === "string" && update.toolCallId.trim()
      ? update.toolCallId
      : `gemini-tool-${randomUUID()}`;
  const statusRaw = typeof update.status === "string" ? update.status : "";
  const eventType =
    statusRaw === "completed" || statusRaw === "failed"
      ? "item.completed"
      : updateKind === "tool_call_update"
        ? "item.updated"
        : "item.started";
  const title =
    typeof update.title === "string" && update.title.trim() ? update.title : "Gemini tool call";
  return {
    type: eventType,
    itemId: RuntimeItemId.makeUnsafe(toolCallId),
    payload: {
      itemType: "dynamic_tool_call",
      status:
        statusRaw === "completed" ? "completed" : statusRaw === "failed" ? "failed" : "inProgress",
      title,
      data: update,
    },
  };
}

export function makeGeminiAdapterLive(options?: GeminiAdapterLiveOptions) {
  return Layer.effect(
    GeminiAdapter,
    Effect.gen(function* () {
      const settingsService = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const managedRunService = yield* ManagedRunService;
      const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const sessions = new Map<ThreadId, GeminiSessionContext>();
      const createConnection = options?.createConnection ?? createGeminiAcpConnection;

      const offerRuntimeEvent = (event: ProviderRuntimeEvent) => {
        Effect.runFork(Queue.offer(runtimeEventQueue, event));
      };

      const eventBase = (
        context: GeminiSessionContext,
        raw?: ProviderRuntimeEvent["raw"],
      ): Omit<ProviderRuntimeEvent, "type" | "payload"> => ({
        eventId: makeEventId("gemini-event"),
        provider: PROVIDER,
        threadId: context.session.threadId,
        createdAt: nowIso(),
        ...(context.activeTurn ? { turnId: context.activeTurn.turnId } : {}),
        ...(raw ? { raw } : {}),
      });

      const updateSession = (context: GeminiSessionContext, patch: Partial<ProviderSession>) => {
        context.session = {
          ...context.session,
          ...patch,
          updatedAt: nowIso(),
        };
      };

      const getContext = (
        threadId: ThreadId,
        operation: string,
      ): Effect.Effect<GeminiSessionContext, ProviderAdapterError> =>
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
          Effect.withSpan(`GeminiAdapter.${operation}`),
        );

      const emitRawWarning = (
        context: GeminiSessionContext,
        message: string,
        raw: ProviderRuntimeEvent["raw"],
      ) => {
        offerRuntimeEvent({
          ...eventBase(context, raw),
          type: "runtime.warning",
          payload: { message },
        });
      };

      const ensureAssistantItemStarted = (context: GeminiSessionContext, turn: GeminiTurnState) => {
        if (turn.assistantStarted) {
          return;
        }
        turn.assistantStarted = true;
        offerRuntimeEvent({
          ...eventBase(context),
          type: "item.started",
          itemId: turn.assistantItemId,
          payload: {
            itemType: "assistant_message",
            status: "inProgress",
            title: "Gemini response",
          },
        });
      };

      const finishTurn = (
        context: GeminiSessionContext,
        state: "completed" | "failed" | "interrupted",
        detail?: { stopReason?: string | null; errorMessage?: string },
      ) => {
        const turn = context.activeTurn;
        if (!turn || turn.completed) {
          return;
        }
        turn.completed = true;
        if (turn.assistantStarted) {
          offerRuntimeEvent({
            ...eventBase(context),
            type: "item.completed",
            itemId: turn.assistantItemId,
            payload: {
              itemType: "assistant_message",
              status: state === "failed" ? "failed" : "completed",
              title: "Gemini response",
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
          lastError: detail?.errorMessage,
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

      const handleNotification = (
        context: GeminiSessionContext,
        notification: GeminiAcpIncomingNotification,
      ) => {
        const raw: ProviderRuntimeEvent["raw"] = {
          source: "gemini.acp.notification",
          method: notification.method,
          payload: notification.params,
        };
        const update = sessionUpdateFromNotification(notification);
        if (!update) {
          return;
        }

        const title = sessionTitleFromUpdate(update);
        if (title) {
          offerRuntimeEvent({
            ...eventBase(context, raw),
            type: "thread.metadata.updated",
            payload: { name: title },
          });
          return;
        }

        const plan = planFromSessionUpdate(update);
        if (plan && context.activeTurn) {
          offerRuntimeEvent({
            ...eventBase(context, raw),
            type: "turn.plan.updated",
            payload: plan,
          });
          return;
        }

        const tool = toolEventFromSessionUpdate(update);
        if (tool && context.activeTurn) {
          offerRuntimeEvent({
            ...eventBase(context, raw),
            type: tool.type,
            itemId: tool.itemId,
            payload: tool.payload,
          } as ProviderRuntimeEvent);
          return;
        }

        const textDelta = textDeltaFromSessionUpdate(update);
        const activeTurn = context.activeTurn;
        if (!textDelta || !activeTurn) {
          return;
        }
        ensureAssistantItemStarted(context, activeTurn);
        activeTurn.items.push({
          type: textDelta.streamKind,
          delta: textDelta.delta,
          createdAt: nowIso(),
        });
        offerRuntimeEvent({
          ...eventBase(context, raw),
          type: "content.delta",
          itemId: activeTurn.assistantItemId,
          payload: textDelta,
        });
      };

      const handleRequest = (context: GeminiSessionContext, request: GeminiAcpIncomingRequest) => {
        emitRawWarning(
          context,
          `Gemini requested ACP client method ${request.method}, which T3 Code does not implement yet.`,
          {
            source: "gemini.acp.request",
            method: request.method,
            payload: request.params,
          },
        );
      };

      const startSession: GeminiAdapterShape["startSession"] = Effect.fn("startGeminiSession")(
        function* (input: ProviderSessionStartInput) {
          const requestedProvider = input.provider ?? PROVIDER;
          if (baseProviderKind(requestedProvider) !== PROVIDER) {
            return yield* Effect.fail(
              new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "startSession",
                issue: `GeminiAdapter cannot start provider ${requestedProvider}.`,
              }),
            );
          }

          const settings = yield* settingsService.getSettings.pipe(Effect.orDie);
          const geminiSettings = settings.providers.gemini;
          const cwd = input.cwd;
          const model =
            input.modelSelection?.provider === PROVIDER ? input.modelSelection.model : undefined;
          const checkpointContext = yield* projectionSnapshotQuery
            .getThreadCheckpointContext(input.threadId)
            .pipe(Effect.catch(() => Effect.succeed(Option.none())));
          const serviceContext =
            Option.isSome(checkpointContext) && serverConfig.port > 0
              ? {
                  port: serverConfig.port,
                  isDev: serverConfig.devUrl !== undefined,
                  token: (yield* managedRunService.issueMcpAccess(
                    checkpointContext.value.projectId,
                    input.threadId,
                  )).token,
                  adminPrompts: settings.prompts.admin,
                }
              : undefined;
          const sessionContextPrompt = Option.isSome(checkpointContext)
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
          const sessionContextPromptHash = sessionContextPrompt
            ? hashProviderSessionContextPrompt(sessionContextPrompt)
            : undefined;
          const sessionContextPromptInjected = sessionContextPromptHash
            ? resumeCursorHasInjectedContext(input.resumeCursor, sessionContextPromptHash)
            : true;
          let context: GeminiSessionContext | undefined;
          const connection = createConnection({
            binaryPath: geminiSettings.binaryPath,
            ...(cwd ? { cwd } : {}),
            ...(geminiSettings.homePath ? { homePath: geminiSettings.homePath } : {}),
            onNotification: (notification) => {
              if (context) {
                handleNotification(context, notification);
              }
            },
            onRequest: (request) => {
              if (context) {
                handleRequest(context, request);
              }
            },
          });

          const startedAt = nowIso();
          const resumeSessionId = extractResumeSessionId(input.resumeCursor);

          try {
            yield* Effect.tryPromise(() => connection.initialize()).pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "initialize",
                    detail: toMessage(cause, "Gemini ACP initialize failed."),
                    cause,
                  }),
              ),
            );

            const sessionInfo = resumeSessionId
              ? { sessionId: resumeSessionId, result: input.resumeCursor }
              : yield* Effect.tryPromise(() =>
                  connection.newSession({ cwd: cwd ?? process.cwd(), mcpServers: [] }),
                ).pipe(
                  Effect.mapError(
                    (cause) =>
                      new ProviderAdapterRequestError({
                        provider: PROVIDER,
                        method: "session/new",
                        detail: toMessage(cause, "Gemini ACP new session failed."),
                        cause,
                      }),
                  ),
                );

            const session: ProviderSession = {
              provider: asProviderInput(PROVIDER),
              status: "ready",
              runtimeMode: input.runtimeMode,
              ...(cwd ? { cwd } : {}),
              ...(model ? { model } : {}),
              threadId: input.threadId,
              resumeCursor: makeResumeCursor(
                sessionInfo.sessionId,
                cwd,
                sessionContextPromptHash
                  ? {
                      hash: sessionContextPromptHash,
                      injected: sessionContextPromptInjected,
                    }
                  : undefined,
              ),
              createdAt: startedAt,
              updatedAt: startedAt,
            };

            context = {
              session,
              connection,
              providerSessionId: sessionInfo.sessionId,
              turns: [],
              ...(sessionContextPrompt ? { sessionContextPrompt } : {}),
              ...(sessionContextPromptHash ? { sessionContextPromptHash } : {}),
              sessionContextPromptInjected,
              activeTurn: undefined,
              stopped: false,
            };
            sessions.set(input.threadId, context);

            if (resumeSessionId) {
              yield* Effect.tryPromise(() =>
                connection.loadSession({
                  sessionId: resumeSessionId,
                  cwd: cwd ?? process.cwd(),
                  mcpServers: [],
                }),
              ).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterRequestError({
                      provider: PROVIDER,
                      method: "session/load",
                      detail: toMessage(cause, "Gemini ACP session load failed."),
                      cause,
                    }),
                ),
              );
            }

            if (model) {
              yield* Effect.tryPromise(() =>
                connection.setModel({ sessionId: sessionInfo.sessionId, modelId: model }),
              ).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterRequestError({
                      provider: PROVIDER,
                      method: "session/set_model",
                      detail: toMessage(cause, "Gemini ACP model switch failed."),
                      cause,
                    }),
                ),
              );
            }

            offerRuntimeEvent({
              ...eventBase(context),
              type: "session.started",
              payload: { resume: session.resumeCursor },
            });
            offerRuntimeEvent({
              ...eventBase(context),
              type: "thread.started",
              payload: { providerThreadId: sessionInfo.sessionId },
            });
            offerRuntimeEvent({
              ...eventBase(context),
              type: "session.state.changed",
              payload: { state: "ready" },
            });

            return session;
          } catch (error) {
            sessions.delete(input.threadId);
            connection.close();
            throw error;
          }
        },
      );

      const sendTurn: GeminiAdapterShape["sendTurn"] = Effect.fn("sendGeminiTurn")(function* (
        input: ProviderSendTurnInput,
      ) {
        const context = yield* getContext(input.threadId, "sendTurn");
        if (context.activeTurn) {
          return yield* Effect.fail(
            new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Gemini session already has an active turn.",
            }),
          );
        }
        if (input.attachments && input.attachments.length > 0) {
          return yield* Effect.fail(
            new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Gemini ACP image attachments are not implemented yet.",
            }),
          );
        }
        const text = input.input?.trim();
        if (!text) {
          return yield* Effect.fail(
            new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Gemini turns require text input.",
            }),
          );
        }

        const selectedModel =
          input.modelSelection?.provider === PROVIDER ? input.modelSelection.model : undefined;
        if (selectedModel && selectedModel !== context.session.model) {
          yield* Effect.tryPromise(() =>
            context.connection.setModel({
              sessionId: context.providerSessionId,
              modelId: selectedModel,
            }),
          ).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/set_model",
                  detail: toMessage(cause, "Gemini ACP model switch failed."),
                  cause,
                }),
            ),
          );
          updateSession(context, { model: selectedModel });
        }

        const mode = geminiModeFromInteractionMode(input.interactionMode);
        if (mode) {
          yield* Effect.tryPromise(() =>
            context.connection.setMode({
              sessionId: context.providerSessionId,
              modeId: mode,
            }),
          ).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/set_mode",
                  detail: toMessage(cause, "Gemini ACP mode switch failed."),
                  cause,
                }),
            ),
          );
        }

        const turnId = makeTurnId();
        const activeTurn: GeminiTurnState = {
          turnId,
          items: [],
          assistantItemId: makeRuntimeItemId("gemini-assistant"),
          assistantStarted: false,
          cancelRequested: false,
          completed: false,
        };
        context.activeTurn = activeTurn;
        updateSession(context, {
          status: "running",
          activeTurnId: turnId,
          ...(selectedModel ? { model: selectedModel } : {}),
        });

        offerRuntimeEvent({
          ...eventBase(context),
          type: "session.state.changed",
          payload: { state: "running" },
        });
        offerRuntimeEvent({
          ...eventBase(context),
          type: "turn.started",
          payload: selectedModel ? { model: selectedModel } : {},
        });

        const promptInput = makeGeminiPromptInput(context, text);
        if (promptInput.embeddedContext && context.sessionContextPromptHash) {
          context.sessionContextPromptInjected = true;
          updateSession(context, {
            resumeCursor: makeResumeCursor(context.providerSessionId, context.session.cwd, {
              hash: context.sessionContextPromptHash,
              injected: true,
            }),
          });
        }

        Effect.runFork(
          Effect.tryPromise(() =>
            context.connection.prompt({
              sessionId: context.providerSessionId,
              text: promptInput.text,
              ...(promptInput.embeddedContext
                ? { embeddedContext: promptInput.embeddedContext }
                : {}),
            }),
          ).pipe(
            Effect.match({
              onFailure: (cause) => {
                const message = toMessage(cause, "Gemini prompt failed.");
                offerRuntimeEvent({
                  ...eventBase(context),
                  type: "runtime.error",
                  payload: {
                    message,
                    class: "provider_error",
                  },
                });
                finishTurn(context, "failed", { errorMessage: message });
              },
              onSuccess: (result) => {
                const stopReason =
                  isRecord(result) && typeof result.stopReason === "string"
                    ? result.stopReason
                    : null;
                const state =
                  stopReason === "cancelled" || activeTurn.cancelRequested
                    ? "interrupted"
                    : "completed";
                finishTurn(context, state, { stopReason });
              },
            }),
          ),
        );

        return {
          threadId: input.threadId,
          turnId,
          resumeCursor: context.session.resumeCursor,
        } satisfies ProviderTurnStartResult;
      });

      const interruptTurn: GeminiAdapterShape["interruptTurn"] = Effect.fn("interruptGeminiTurn")(
        function* (threadId, turnId) {
          const context = yield* getContext(threadId, "interruptTurn");
          const activeTurn = context.activeTurn;
          if (!activeTurn || (turnId && activeTurn.turnId !== turnId)) {
            return;
          }
          activeTurn.cancelRequested = true;
          yield* Effect.tryPromise(() => context.connection.cancel(context.providerSessionId)).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/cancel",
                  detail: toMessage(cause, "Gemini ACP cancel failed."),
                  cause,
                }),
            ),
          );
          offerRuntimeEvent({
            ...eventBase(context),
            type: "turn.aborted",
            payload: { reason: "cancelled" },
          });
        },
      );

      const unsupportedRequest = (method: string) =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method,
            detail: "Gemini ACP interactive approvals are not implemented yet.",
          }),
        );

      const stopSession: GeminiAdapterShape["stopSession"] = Effect.fn("stopGeminiSession")(
        function* (threadId) {
          const context = yield* getContext(threadId, "stopSession");
          context.stopped = true;
          context.connection.close();
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
            payload: { exitKind: "graceful", recoverable: true },
          });
        },
      );

      const readThread: GeminiAdapterShape["readThread"] = (threadId) =>
        getContext(threadId, "readThread").pipe(
          Effect.map(
            (context): ProviderThreadSnapshot => ({
              threadId,
              turns: context.turns,
            }),
          ),
        );

      const stopAll: GeminiAdapterShape["stopAll"] = () =>
        Effect.forEach(Array.from(sessions.keys()), (threadId) => stopSession(threadId), {
          discard: true,
        });

      return {
        provider: PROVIDER,
        capabilities: {
          sessionModelSwitch: "in-session",
        },
        startSession,
        sendTurn,
        interruptTurn,
        respondToRequest: (_threadId: ThreadId, _requestId, _decision: ProviderApprovalDecision) =>
          unsupportedRequest("respondToRequest"),
        respondToUserInput: (_threadId: ThreadId, _requestId, _answers: ProviderUserInputAnswers) =>
          unsupportedRequest("respondToUserInput"),
        stopSession,
        listSessions: () => Effect.succeed(Array.from(sessions.values()).map((ctx) => ctx.session)),
        hasSession: (threadId) => Effect.succeed(sessions.has(threadId)),
        readThread,
        rollbackThread: () =>
          Effect.fail(
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "rollbackThread",
              detail: "Gemini ACP rollback is not implemented yet.",
            }),
          ),
        stopAll,
        streamEvents: Stream.fromQueue(runtimeEventQueue),
      } satisfies GeminiAdapterShape;
    }),
  );
}

export const GeminiAdapterLive = makeGeminiAdapterLive();
