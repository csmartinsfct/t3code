import { randomUUID } from "node:crypto";
import {
  ApprovalRequestId,
  asProviderInput,
  baseProviderKind,
  type ChatAttachment,
  EventId,
  ProviderItemId,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  type CanonicalItemType,
  type CursorSettings,
  type ProviderApprovalDecision,
  type ProviderKind,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  type RuntimeContentStreamKind,
  type UserInputQuestion,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Option, Queue, Stream } from "effect";

import { resolveAttachmentPath } from "../../attachmentStore";
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
import {
  createCursorAcpConnection,
  type CursorAcpConnection,
  type CursorAcpConnectionOptions,
  type CursorAcpImageContent,
  type CursorAcpIncomingNotification,
  type CursorAcpIncomingRequest,
  type JsonRpcId,
} from "../cursor/CursorAcpConnection";
import { resolveCursorSettingsForProvider } from "../cursorProfileDiscovery";
import {
  buildProviderSessionContextPrompt,
  hashProviderSessionContextPrompt,
} from "../sessionContextPrompt";
import { resolveCursorAcpModelId } from "../cursorModelIds";

const PROVIDER = "cursor" as const;

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
  assistantStarted: boolean;
  completed: boolean;
  cancelRequested: boolean;
}

interface PendingCursorApprovalRequest {
  readonly jsonRpcId: JsonRpcId;
  readonly requestType:
    | "command_execution_approval"
    | "file_change_approval"
    | "plan_approval"
    | "unknown";
}

interface PendingCursorUserInputRequest {
  readonly jsonRpcId: JsonRpcId;
  readonly optionIdsByQuestionIdAndLabel: Record<string, Record<string, string>>;
}

interface CursorSessionContext {
  session: ProviderSession;
  readonly providerKind: ProviderKind;
  readonly settings: CursorSettings;
  readonly connection: CursorAcpConnection;
  providerSessionId: string;
  latestSessionInfo: unknown;
  readonly supportsImagePrompt: boolean;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly toolCalls: Map<string, { readonly itemType: CanonicalItemType; readonly title: string }>;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingCursorApprovalRequest>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingCursorUserInputRequest>;
  readonly sessionContextPrompt?: string;
  readonly sessionContextPromptHash?: string;
  sessionContextPromptInjected: boolean;
  activeTurn: CursorTurnState | undefined;
  stopped: boolean;
}

export interface CursorAdapterLiveOptions {
  readonly createConnection?: (options: CursorAcpConnectionOptions) => CursorAcpConnection;
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

function asRuntimeRequestId(requestId: ApprovalRequestId): RuntimeRequestId {
  return RuntimeRequestId.makeUnsafe(requestId);
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) return cause.message;
  if (isRecord(cause) && typeof cause.message === "string" && cause.message.length > 0) {
    return cause.message;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function extractCursorSessionId(cursor: unknown): string | null {
  if (typeof cursor === "string" && cursor.trim()) return cursor;
  if (!isRecord(cursor)) return null;
  const sessionId = cursor.sessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : null;
}

function resumeCursorMatchesProvider(cursor: unknown, provider: ProviderKind): boolean {
  if (!isRecord(cursor)) return true;
  return cursor.provider === undefined || cursor.provider === provider;
}

function resumeCursorHasInjectedContext(cursor: unknown, contextPromptHash: string): boolean {
  if (!isRecord(cursor)) return false;
  return cursor.contextPromptInjected === true && cursor.contextPromptHash === contextPromptHash;
}

function resumeCursorRequestsFork(cursor: unknown): boolean {
  return isRecord(cursor) && cursor.fork === true;
}

function cursorSupportsImagePrompt(initializeResult: unknown): boolean {
  if (!isRecord(initializeResult)) return false;
  const agentCapabilities = initializeResult.agentCapabilities;
  if (!isRecord(agentCapabilities)) return false;
  const promptCapabilities = agentCapabilities.promptCapabilities;
  return isRecord(promptCapabilities) && promptCapabilities.image === true;
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

function eventUpdate(notification: CursorAcpIncomingNotification): Record<string, unknown> | null {
  if (notification.method !== "session/update" || !isRecord(notification.params)) return null;
  const update = notification.params.update;
  return isRecord(update) ? update : null;
}

function extractTextContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  const text = value.text;
  return typeof text === "string" ? text : null;
}

function textDeltaFromSessionUpdate(update: Record<string, unknown>): {
  readonly streamKind: RuntimeContentStreamKind;
  readonly delta: string;
} | null {
  const updateKind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : update.type;
  const delta = extractTextContent(update.content ?? update.delta ?? update.text);
  if (!delta) return null;
  if (updateKind === "agent_thought_chunk") {
    return { streamKind: "reasoning_text", delta };
  }
  if (updateKind === "agent_message_chunk" || updateKind === "message" || updateKind === "") {
    return { streamKind: "assistant_text", delta };
  }
  return null;
}

function planFromSessionUpdate(update: Record<string, unknown>): {
  readonly plan: ReadonlyArray<{ step: string; status: "pending" | "inProgress" | "completed" }>;
} | null {
  const updateKind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : update.type;
  if (updateKind !== "plan") return null;
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
  if (updateKind !== "session_info_update") return null;
  const title = update.title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

function titleCaseToolName(value: string): string {
  const spaced = value
    .replace(/[_-]+/gu, " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .trim();
  return spaced.length > 0
    ? spaced.replace(/\b\w/gu, (char) => char.toUpperCase())
    : "Cursor tool call";
}

function classifyCursorToolItemType(kind: unknown, title: unknown): CanonicalItemType {
  const normalized =
    `${typeof kind === "string" ? kind : ""} ${typeof title === "string" ? title : ""}`.toLowerCase();
  if (normalized.includes("plan") || normalized.includes("todo")) return "plan";
  if (normalized.includes("search") || normalized.includes("read")) return "dynamic_tool_call";
  if (
    normalized.includes("shell") ||
    normalized.includes("bash") ||
    normalized.includes("terminal") ||
    normalized.includes("execute") ||
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

function toolCallRecordFromPermissionParams(params: unknown): Record<string, unknown> {
  if (!isRecord(params)) return {};
  return isRecord(params.toolCall) ? params.toolCall : params;
}

function permissionDetailFromCursorParams(params: Record<string, unknown>): string | undefined {
  const toolCall = toolCallRecordFromPermissionParams(params);
  const title =
    typeof toolCall.title === "string" && toolCall.title.trim() ? toolCall.title.trim() : null;
  const reason = (() => {
    const content = toolCall.content;
    if (!Array.isArray(content)) return null;
    for (const entry of content) {
      if (!isRecord(entry)) continue;
      const nested = entry.content;
      const text = extractTextContent(nested) ?? extractTextContent(entry);
      if (text?.trim()) return text.trim();
    }
    return null;
  })();
  return [title, reason].filter(Boolean).join("\n").trim() || undefined;
}

function toolCallIdFromUpdate(update: Record<string, unknown>): string | null {
  return typeof update.toolCallId === "string" && update.toolCallId.trim()
    ? update.toolCallId.trim()
    : null;
}

function toolEventFromSessionUpdate(update: Record<string, unknown>): {
  readonly providerToolCallId: string;
  readonly type: "item.started" | "item.updated" | "item.completed";
  readonly itemId: RuntimeItemId;
  readonly payload: {
    readonly itemType: CanonicalItemType;
    readonly status: "inProgress" | "completed" | "failed";
    readonly title: string;
    readonly detail?: string;
    readonly data?: unknown;
  };
} | null {
  const updateKind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : update.type;
  if (updateKind !== "tool_call" && updateKind !== "tool_call_update") return null;
  const toolCallId = toolCallIdFromUpdate(update) ?? `tool-${randomUUID()}`;
  const statusRaw = typeof update.status === "string" ? update.status : "";
  const type =
    updateKind === "tool_call"
      ? "item.started"
      : statusRaw === "completed" || statusRaw === "failed"
        ? "item.completed"
        : "item.updated";
  const title =
    typeof update.title === "string" && update.title.trim()
      ? update.title.trim()
      : titleCaseToolName(toolCallId);
  const detail = extractTextContent(update.content);
  return {
    providerToolCallId: toolCallId,
    type,
    itemId: RuntimeItemId.makeUnsafe(`cursor-tool-${toolCallId}`),
    payload: {
      itemType: classifyCursorToolItemType(update.kind, title),
      status:
        statusRaw === "failed" ? "failed" : type === "item.completed" ? "completed" : "inProgress",
      title,
      ...(detail ? { detail } : {}),
      data: update,
    },
  };
}

function availableModelsFromSessionInfo(sessionInfo: unknown): ReadonlyArray<{
  readonly modelId: string;
  readonly name?: string;
}> {
  if (!isRecord(sessionInfo)) return [];
  const modelEntries: unknown[] = [];
  if (isRecord(sessionInfo.models) && Array.isArray(sessionInfo.models.availableModels)) {
    modelEntries.push(...sessionInfo.models.availableModels);
  }
  if (Array.isArray(sessionInfo.configOptions)) {
    for (const option of sessionInfo.configOptions) {
      if (!isRecord(option)) continue;
      const isModelOption =
        option.id === "model" || option.category === "model" || option.name === "Model";
      if (isModelOption && Array.isArray(option.options)) {
        modelEntries.push(...option.options);
      }
    }
  }
  return modelEntries.flatMap((model) => {
    if (!isRecord(model)) return [];
    const modelId =
      typeof model.modelId === "string"
        ? model.modelId
        : typeof model.value === "string"
          ? model.value
          : null;
    if (!modelId) return [];
    return [
      {
        modelId,
        ...(typeof model.name === "string" ? { name: model.name } : {}),
      },
    ];
  });
}

function resolveAcpModelId(model: string, sessionInfo: unknown): string {
  return resolveCursorAcpModelId(model, availableModelsFromSessionInfo(sessionInfo));
}

function cursorModeFromInteractionMode(
  interactionMode: ProviderSendTurnInput["interactionMode"],
): string {
  return interactionMode === "plan" || interactionMode === "plan-accept" ? "plan" : "agent";
}

function userInputQuestionsFromCursorRequest(params: unknown): {
  readonly questions: ReadonlyArray<UserInputQuestion>;
  readonly optionIdsByQuestionIdAndLabel: Record<string, Record<string, string>>;
} | null {
  if (!isRecord(params) || !Array.isArray(params.questions)) return null;
  const header =
    typeof params.title === "string" && params.title.trim() ? params.title.trim() : "Cursor";
  const optionIdsByQuestionIdAndLabel: Record<string, Record<string, string>> = {};
  const questions = params.questions.flatMap((question): UserInputQuestion[] => {
    if (!isRecord(question)) return [];
    const id = typeof question.id === "string" && question.id.trim() ? question.id.trim() : null;
    const prompt =
      typeof question.prompt === "string" && question.prompt.trim() ? question.prompt.trim() : null;
    const options = Array.isArray(question.options)
      ? question.options.flatMap((option) => {
          if (!isRecord(option)) return [];
          const optionId =
            typeof option.id === "string" && option.id.trim() ? option.id.trim() : null;
          const label =
            typeof option.label === "string" && option.label.trim() ? option.label.trim() : null;
          if (!id || !optionId || !label) return [];
          optionIdsByQuestionIdAndLabel[id] = {
            ...optionIdsByQuestionIdAndLabel[id],
            [label]: optionId,
            [optionId]: optionId,
          };
          return [{ label, description: label }];
        })
      : [];
    return id && prompt && options.length > 0
      ? [
          {
            id,
            header,
            question: prompt,
            options,
            multiSelect: question.allowMultiple === true,
          },
        ]
      : [];
  });
  return questions.length > 0 ? { questions, optionIdsByQuestionIdAndLabel } : null;
}

function answersToCursorAskQuestionResponse(
  answers: ProviderUserInputAnswers,
  pending: PendingCursorUserInputRequest,
) {
  return {
    outcome: {
      outcome: "answered",
      answers: Object.entries(answers).map(([questionId, value]) => {
        const optionIdsByAnswer = pending.optionIdsByQuestionIdAndLabel[questionId] ?? {};
        const values = Array.isArray(value) ? value : [value];
        return {
          questionId,
          selectedOptionIds: values.map((answer) => {
            const answerText = String(answer);
            return optionIdsByAnswer[answerText] ?? answerText;
          }),
        };
      }),
    },
  };
}

export function makeCursorAdapterLive(options?: CursorAdapterLiveOptions) {
  return Layer.effect(
    CursorAdapter,
    Effect.gen(function* () {
      const settingsService = yield* ServerSettingsService;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const managedRunService = yield* ManagedRunService;
      const serverConfig = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const sessions = new Map<ThreadId, CursorSessionContext>();
      const createConnection = options?.createConnection ?? createCursorAcpConnection;

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
        context.session = { ...context.session, ...patch, updatedAt: nowIso() };
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
                  new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }),
                ),
          ),
          Effect.flatMap((context) =>
            context.stopped || context.session.status === "closed"
              ? Effect.fail(new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId }))
              : Effect.succeed(context),
          ),
          Effect.withSpan(`CursorAdapter.${operation}`),
        );

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

      const cancelPendingRequests = (context: CursorSessionContext) => {
        for (const [requestId, pending] of context.pendingApprovals) {
          try {
            context.connection.respond({
              id: pending.jsonRpcId,
              result: { outcome: { outcome: "cancelled" } },
            });
          } catch {
            // The ACP process may already be gone during session shutdown.
          }
          offerRuntimeEvent({
            ...eventBase(context, {
              source: "cursor.acp.response",
              payload: { requestId, decision: "cancel" },
            }),
            type: "request.resolved",
            requestId: asRuntimeRequestId(requestId),
            payload: {
              requestType: pending.requestType,
              decision: "cancel",
              resolution: { decision: "cancel" },
            },
          });
        }
        context.pendingApprovals.clear();

        for (const [requestId, pending] of context.pendingUserInputs) {
          try {
            context.connection.respond({
              id: pending.jsonRpcId,
              result: { outcome: { outcome: "cancelled" } },
            });
          } catch {
            // The ACP process may already be gone during session shutdown.
          }
          offerRuntimeEvent({
            ...eventBase(context, {
              source: "cursor.acp.response",
              payload: { requestId, decision: "cancel" },
            }),
            type: "user-input.resolved",
            requestId: asRuntimeRequestId(requestId),
            payload: { answers: {} },
          });
        }
        context.pendingUserInputs.clear();
      };

      const handleNotification = (
        context: CursorSessionContext,
        notification: CursorAcpIncomingNotification,
      ) => {
        const raw = {
          source: "cursor.acp.notification",
          method: notification.method,
          payload: notification.params,
        } satisfies ProviderRuntimeEvent["raw"];
        const update = eventUpdate(notification);
        if (!update) return;

        const title = sessionTitleFromUpdate(update);
        if (title) {
          offerRuntimeEvent({
            ...eventBase(context, raw),
            type: "thread.metadata.updated",
            payload: { name: title },
          });
          return;
        }

        const activeTurn = context.activeTurn;
        const plan = planFromSessionUpdate(update);
        if (plan && activeTurn) {
          offerRuntimeEvent({
            ...eventBase(context, raw),
            type: "turn.plan.updated",
            payload: plan,
          });
          return;
        }

        const tool = toolEventFromSessionUpdate(update);
        if (tool && activeTurn) {
          const previous = context.toolCalls.get(tool.providerToolCallId);
          const payload = previous
            ? {
                ...tool.payload,
                itemType:
                  tool.payload.itemType === "dynamic_tool_call"
                    ? previous.itemType
                    : tool.payload.itemType,
                title: tool.payload.title.startsWith("Tool ") ? previous.title : tool.payload.title,
              }
            : tool.payload;
          context.toolCalls.set(tool.providerToolCallId, {
            itemType: payload.itemType,
            title: payload.title,
          });
          offerRuntimeEvent({
            ...eventBase(context, raw),
            type: tool.type,
            itemId: tool.itemId,
            payload,
          } as ProviderRuntimeEvent);
          return;
        }

        const textDelta = textDeltaFromSessionUpdate(update);
        if (!textDelta || !activeTurn) return;
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
          payload: { streamKind: textDelta.streamKind, delta: textDelta.delta },
        });
      };

      const handleRequest = (context: CursorSessionContext, request: CursorAcpIncomingRequest) => {
        const raw = {
          source: "cursor.acp.request",
          method: request.method,
          payload: request.params,
        } satisfies ProviderRuntimeEvent["raw"];

        if (request.method === "cursor/create_plan") {
          if (!context.activeTurn) {
            context.connection.respond({
              id: request.id,
              result: { outcome: { outcome: "cancelled" } },
            });
            return;
          }
          const params = isRecord(request.params) ? request.params : {};
          const planMarkdown = typeof params.plan === "string" ? params.plan.trim() : "";
          const requestId = ApprovalRequestId.makeUnsafe(`cursor-plan-${randomUUID()}`);
          context.pendingApprovals.set(requestId, {
            jsonRpcId: request.id,
            requestType: "plan_approval",
          });
          offerRuntimeEvent({
            ...eventBase(context, raw),
            type: "turn.proposed.completed",
            turnId: context.activeTurn.turnId,
            ...(typeof params.toolCallId === "string"
              ? { providerRefs: { providerItemId: ProviderItemId.makeUnsafe(params.toolCallId) } }
              : {}),
            payload: { planMarkdown: planMarkdown || "Cursor proposed a plan." },
          });
          offerRuntimeEvent({
            ...eventBase(context, raw),
            type: "request.opened",
            requestId: asRuntimeRequestId(requestId),
            payload: {
              requestType: "plan_approval",
              detail: "Review Cursor's proposed plan to continue this turn.",
              args: params,
            },
          });
          return;
        }

        if (request.method === "session/request_permission") {
          if (!context.activeTurn) {
            context.connection.respond({
              id: request.id,
              result: { outcome: { outcome: "cancelled" } },
            });
            return;
          }
          const requestId = ApprovalRequestId.makeUnsafe(`cursor-request-${randomUUID()}`);
          const params = isRecord(request.params) ? request.params : {};
          const toolCall = toolCallRecordFromPermissionParams(params);
          const requestType = classifyCursorToolItemType(toolCall.kind, toolCall.title);
          const canonicalRequestType =
            requestType === "command_execution"
              ? "command_execution_approval"
              : requestType === "file_change"
                ? "file_change_approval"
                : "unknown";
          context.pendingApprovals.set(requestId, {
            jsonRpcId: request.id,
            requestType: canonicalRequestType,
          });
          offerRuntimeEvent({
            ...eventBase(context, raw),
            type: "request.opened",
            requestId: asRuntimeRequestId(requestId),
            payload: {
              requestType: canonicalRequestType,
              ...(permissionDetailFromCursorParams(params)
                ? { detail: permissionDetailFromCursorParams(params) }
                : {}),
              args: params,
            },
          });
          return;
        }

        if (request.method === "cursor/ask_question") {
          if (!context.activeTurn) {
            context.connection.respond({
              id: request.id,
              result: { outcome: { outcome: "cancelled" } },
            });
            return;
          }
          const userInput = userInputQuestionsFromCursorRequest(request.params);
          if (!userInput) {
            context.connection.respond({
              id: request.id,
              result: { outcome: { outcome: "skipped", reason: "Unsupported question payload." } },
            });
            return;
          }
          const requestId = ApprovalRequestId.makeUnsafe(`cursor-user-input-${randomUUID()}`);
          context.pendingUserInputs.set(requestId, {
            jsonRpcId: request.id,
            optionIdsByQuestionIdAndLabel: userInput.optionIdsByQuestionIdAndLabel,
          });
          offerRuntimeEvent({
            ...eventBase(context, raw),
            type: "user-input.requested",
            requestId: asRuntimeRequestId(requestId),
            payload: { questions: userInput.questions },
          });
          return;
        }

        context.connection.respond({
          id: request.id,
          error: { code: -32601, message: `Unsupported Cursor ACP request: ${request.method}.` },
        });
        offerRuntimeEvent({
          ...eventBase(context, raw),
          type: "runtime.warning",
          payload: { message: `Unsupported Cursor ACP request: ${request.method}.` },
        });
      };

      const loadCursorImages = (
        context: CursorSessionContext,
        attachments: ReadonlyArray<ChatAttachment> | undefined,
      ) =>
        Effect.gen(function* () {
          if (!attachments || attachments.length === 0) return [] as Array<CursorAcpImageContent>;
          if (!context.supportsImagePrompt) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue:
                "Cursor ACP did not advertise image prompt capability, so image attachments cannot be sent.",
            });
          }

          const images: Array<CursorAcpImageContent> = [];
          for (const attachment of attachments) {
            const resolvedPath = resolveAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment,
            });
            if (!resolvedPath) {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "sendTurn",
                issue: `Cursor could not resolve attachment ${attachment.name}.`,
              });
            }
            const exists = yield* fs.exists(resolvedPath).pipe(Effect.orElseSucceed(() => false));
            if (!exists) {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "sendTurn",
                issue: `Cursor attachment file is missing: ${attachment.name}.`,
              });
            }
            const bytes = yield* fs.readFile(resolvedPath).pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "attachment/read",
                    detail: toMessage(cause, `Failed to read attachment ${attachment.name}.`),
                    cause,
                  }),
              ),
            );
            images.push({
              data: Buffer.from(bytes).toString("base64"),
              mimeType: attachment.mimeType.toLowerCase(),
              uri: `t3://attachment/${attachment.id}`,
            });
          }
          return images;
        });

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
              detail: "Cursor ACP does not expose a verified fork method in T3 yet.",
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
          const cwd = input.cwd ?? process.cwd();
          let contextRef: CursorSessionContext | undefined;
          const connection = createConnection({
            settings: cursorSettings,
            cwd,
            onNotification: (notification) => {
              if (contextRef) handleNotification(contextRef, notification);
            },
            onRequest: (request) => {
              if (contextRef) handleRequest(contextRef, request);
            },
          });

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
          const sessionResult = yield* Effect.tryPromise({
            try: async () => {
              const initializeResult = await connection.initialize();
              await connection.authenticate();
              if (existingSessionId) {
                const loaded = await connection.loadSession({ sessionId: existingSessionId, cwd });
                return { sessionId: existingSessionId, result: loaded, initializeResult };
              }
              const created = await connection.newSession({ cwd });
              return { ...created, initializeResult };
            },
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: existingSessionId ? "session/load" : "session/new",
                detail: toMessage(cause, "Cursor ACP session start failed."),
                cause,
              }),
          });
          const providerSessionId = sessionResult.sessionId;
          const startedAt = nowIso();
          const session: ProviderSession = {
            provider: asProviderInput(requestedProvider),
            status: "ready",
            runtimeMode: input.runtimeMode,
            cwd,
            ...(model ? { model } : {}),
            threadId: input.threadId,
            resumeCursor: makeResumeCursor({
              sessionId: providerSessionId,
              provider: requestedProvider,
              cwd,
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
            connection,
            providerSessionId,
            latestSessionInfo: sessionResult.result,
            supportsImagePrompt: cursorSupportsImagePrompt(sessionResult.initializeResult),
            turns: [],
            toolCalls: new Map(),
            pendingApprovals: new Map(),
            pendingUserInputs: new Map(),
            ...(sessionContextPrompt ? { sessionContextPrompt } : {}),
            ...(sessionContextPromptHash ? { sessionContextPromptHash } : {}),
            sessionContextPromptInjected,
            activeTurn: undefined,
            stopped: false,
          };
          contextRef = context;
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
        const images = yield* loadCursorImages(context, input.attachments);
        const text = trimOrUndefined(input.input) ?? "";
        if (!text && images.length === 0) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Cursor turns require text input or at least one supported image attachment.",
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
          assistantStarted: false,
          completed: false,
          cancelRequested: false,
        };
        context.activeTurn = turn;

        yield* Effect.forkDetach(
          Effect.tryPromise({
            try: async () => {
              const mode = cursorModeFromInteractionMode(input.interactionMode);
              context.latestSessionInfo = await context.connection.setConfigOption({
                sessionId: context.providerSessionId,
                configId: "mode",
                value: mode,
              });
              if (selectedModel) {
                context.latestSessionInfo = await context.connection.setConfigOption({
                  sessionId: context.providerSessionId,
                  configId: "model",
                  value: resolveAcpModelId(selectedModel, context.latestSessionInfo),
                });
              }
              return await context.connection.prompt({
                sessionId: context.providerSessionId,
                ...(promptInput.prompt ? { text: promptInput.prompt } : {}),
                ...(images.length > 0 ? { images } : {}),
              });
            },
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/prompt",
                detail: toMessage(cause, "Cursor ACP prompt failed."),
                cause,
              }),
          }).pipe(
            Effect.match({
              onFailure: (error) => {
                const state = turn.cancelRequested ? "interrupted" : "failed";
                offerRuntimeEvent({
                  ...eventBase(context),
                  type: "runtime.error",
                  payload: { message: error.message, class: "provider_error" },
                });
                finishTurn(context, state, { errorMessage: error.message });
              },
              onSuccess: (result) => {
                const stopReason =
                  isRecord(result) && typeof result.stopReason === "string"
                    ? result.stopReason
                    : null;
                finishTurn(context, "completed", { stopReason });
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

      const interruptTurn: CursorAdapterShape["interruptTurn"] = Effect.fn("interruptCursorTurn")(
        function* (threadId, turnId) {
          const context = yield* getContext(threadId, "interruptTurn");
          const activeTurn = context.activeTurn;
          if (!activeTurn || (turnId && activeTurn.turnId !== turnId)) return;
          activeTurn.cancelRequested = true;
          cancelPendingRequests(context);
          yield* Effect.promise(() => context.connection.cancel(context.providerSessionId)).pipe(
            Effect.ignore,
          );
          offerRuntimeEvent({
            ...eventBase(context),
            type: "turn.aborted",
            payload: { reason: "cancelled" },
          });
          finishTurn(context, "interrupted", { errorMessage: "Cursor turn interrupted." });
        },
      );

      const respondToRequest: CursorAdapterShape["respondToRequest"] = Effect.fn(
        "respondToCursorRequest",
      )(function* (threadId, requestId, decision: ProviderApprovalDecision) {
        const context = yield* getContext(threadId, "respondToRequest");
        const pending = context.pendingApprovals.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToRequest",
            detail: `Unknown pending Cursor approval request: ${requestId}`,
          });
        }
        const result =
          pending.requestType === "plan_approval"
            ? decision === "accept" || decision === "acceptForSession"
              ? { outcome: { outcome: "accepted" } }
              : decision === "decline"
                ? { outcome: { outcome: "rejected", reason: "Plan rejected in T3 Code." } }
                : { outcome: { outcome: "cancelled" } }
            : decision === "accept"
              ? { outcome: { outcome: "selected", optionId: "allow-once" } }
              : decision === "acceptForSession"
                ? { outcome: { outcome: "selected", optionId: "allow-always" } }
                : decision === "decline"
                  ? { outcome: { outcome: "selected", optionId: "reject-once" } }
                  : { outcome: { outcome: "cancelled" } };
        context.connection.respond({
          id: pending.jsonRpcId,
          result,
        });
        context.pendingApprovals.delete(requestId);
        offerRuntimeEvent({
          ...eventBase(context, {
            source: "cursor.acp.response",
            payload: { requestId, decision },
          }),
          type: "request.resolved",
          requestId: asRuntimeRequestId(requestId),
          payload: { requestType: pending.requestType, decision, resolution: { decision } },
        });
      });

      const respondToUserInput: CursorAdapterShape["respondToUserInput"] = Effect.fn(
        "respondToCursorUserInput",
      )(function* (threadId, requestId, answers: ProviderUserInputAnswers) {
        const context = yield* getContext(threadId, "respondToUserInput");
        const pending = context.pendingUserInputs.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToUserInput",
            detail: `Unknown pending Cursor user-input request: ${requestId}`,
          });
        }
        context.connection.respond({
          id: pending.jsonRpcId,
          result: answersToCursorAskQuestionResponse(answers, pending),
        });
        context.pendingUserInputs.delete(requestId);
        offerRuntimeEvent({
          ...eventBase(context, { source: "cursor.acp.response", payload: { requestId, answers } }),
          type: "user-input.resolved",
          requestId: asRuntimeRequestId(requestId),
          payload: { answers },
        });
      });

      const stopSession: CursorAdapterShape["stopSession"] = Effect.fn("stopCursorSession")(
        function* (threadId) {
          const context = yield* getContext(threadId, "stopSession");
          context.stopped = true;
          cancelPendingRequests(context);
          context.connection.close();
          if (context.activeTurn) {
            context.activeTurn.cancelRequested = true;
            finishTurn(context, "interrupted", { errorMessage: "Cursor session stopped." });
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
          Effect.map((context): ProviderThreadSnapshot => ({ threadId, turns: context.turns })),
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
        respondToRequest,
        respondToUserInput,
        stopSession,
        listSessions: () => Effect.succeed(Array.from(sessions.values()).map((ctx) => ctx.session)),
        hasSession: (threadId) => Effect.succeed(sessions.has(threadId)),
        readThread,
        rollbackThread: () =>
          Effect.fail(
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "rollbackThread",
              detail: "Cursor ACP rollback is not implemented in T3 yet.",
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
