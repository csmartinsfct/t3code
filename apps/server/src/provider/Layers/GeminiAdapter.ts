import { randomUUID } from "node:crypto";
import {
  ApprovalRequestId,
  asProviderInput,
  baseProviderKind,
  type ChatAttachment,
  EventId,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  type ProviderApprovalDecision,
  type ProviderRequestKind,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  type RuntimeMode,
  type RuntimeContentStreamKind,
  type ThreadTokenUsageSnapshot,
  type UserInputQuestion,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Option, Queue, Stream } from "effect";

import { resolveAttachmentPath } from "../../attachmentStore";
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
  type GeminiAcpImageContent,
  type GeminiAcpConnectionOptions,
  type GeminiAcpIncomingNotification,
  type GeminiAcpIncomingRequest,
  type JsonRpcId,
} from "../gemini/GeminiAcpConnection";
import {
  buildProviderSessionContextPrompt,
  hashProviderSessionContextPrompt,
} from "../sessionContextPrompt";

const PROVIDER = "gemini" as const;
const GEMINI_SESSION_CONTEXT_URI = "t3://session/context";
const T3_MCP_SERVER_NAME = "t3-code";
const GEMINI_SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

interface GeminiResumeCursor {
  readonly sessionId: string;
  readonly cwd?: string;
  readonly fork?: boolean;
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
  readonly mcpServers: ReadonlyArray<unknown>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingGeminiApprovalRequest>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingGeminiUserInputRequest>;
  readonly sessionContextPrompt?: string;
  readonly sessionContextPromptHash?: string;
  sessionContextPromptInjected: boolean;
  activeTurn: GeminiTurnState | undefined;
  stopped: boolean;
}

interface GeminiMcpServiceContext {
  readonly port: number;
  readonly token: string;
}

interface PendingGeminiApprovalRequest {
  readonly jsonRpcId: JsonRpcId;
  readonly canonicalRequestType:
    | "command_execution_approval"
    | "file_read_approval"
    | "file_change_approval"
    | "dynamic_tool_call"
    | "unknown";
  readonly providerRequestKind?: ProviderRequestKind;
  readonly options: ReadonlyArray<GeminiPermissionOption>;
}

interface PendingGeminiUserInputRequest {
  readonly jsonRpcId: JsonRpcId;
}

interface GeminiPermissionOption {
  readonly optionId: string;
  readonly kind?: string;
  readonly name?: string;
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

function asRuntimeRequestId(requestId: ApprovalRequestId): RuntimeRequestId {
  return RuntimeRequestId.makeUnsafe(requestId);
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  if (isRecord(cause)) {
    const nestedError = cause.error;
    if (nestedError instanceof Error && nestedError.message.length > 0) {
      return nestedError.message;
    }
    if (isRecord(nestedError) && typeof nestedError.message === "string") {
      return nestedError.message;
    }
    if (typeof cause.message === "string" && cause.message.length > 0) {
      return cause.message;
    }
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

function shouldForkFromResumeCursor(cursor: unknown): boolean {
  return isRecord(cursor) && cursor.fork === true;
}

function buildGeminiMcpServers(serviceContext: GeminiMcpServiceContext | undefined) {
  if (!serviceContext) {
    return [];
  }
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return [];
  }
  return [
    {
      name: T3_MCP_SERVER_NAME,
      command: process.execPath,
      args: [entrypoint, "mcp-stdio"],
      env: [
        { name: "T3_MCP_BASE_URL", value: `http://127.0.0.1:${serviceContext.port}` },
        { name: "T3_MCP_PORT", value: String(serviceContext.port) },
        { name: "T3_MCP_TOKEN", value: serviceContext.token },
      ],
    },
  ];
}

function resumeCursorHasInjectedContext(cursor: unknown, contextPromptHash: string): boolean {
  if (!isRecord(cursor)) {
    return false;
  }
  return cursor.contextPromptInjected === true && cursor.contextPromptHash === contextPromptHash;
}

function makeGeminiPromptInput(
  context: GeminiSessionContext,
  userText: string | undefined,
): {
  readonly text?: string;
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
    return userText ? { text: userText } : {};
  }

  return {
    text:
      "Use the referenced T3 session context as persistent operating context for this conversation. " +
      "Do not cite, quote, link, or mention the internal t3://session/context resource. " +
      (userText
        ? `Then answer the user request below.\n\nUser request:\n${userText}`
        : "Then respond to the attached user content."),
    embeddedContext: {
      uri: GEMINI_SESSION_CONTEXT_URI,
      text: context.sessionContextPrompt,
      mimeType: "text/markdown",
    },
  };
}

function canonicalPermissionRequestType(toolCall: unknown): {
  readonly canonicalRequestType:
    | "command_execution_approval"
    | "file_read_approval"
    | "file_change_approval"
    | "dynamic_tool_call"
    | "unknown";
  readonly providerRequestKind?: ProviderRequestKind;
} {
  const record = isRecord(toolCall) ? toolCall : {};
  const rawKind = [
    record.kind,
    record.type,
    record.name,
    record.toolName,
    record.title,
    record.toolCallId,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (rawKind.includes("execute") || rawKind.includes("shell") || rawKind.includes("command")) {
    return { canonicalRequestType: "command_execution_approval", providerRequestKind: "command" };
  }
  if (
    rawKind.includes("write") ||
    rawKind.includes("edit") ||
    rawKind.includes("patch") ||
    rawKind.includes("delete") ||
    rawKind.includes("move")
  ) {
    return { canonicalRequestType: "file_change_approval", providerRequestKind: "file-change" };
  }
  if (rawKind.includes("read") || rawKind.includes("list") || rawKind.includes("search")) {
    return { canonicalRequestType: "file_read_approval", providerRequestKind: "file-read" };
  }
  if (rawKind.includes("tool") || rawKind.includes("mcp")) {
    return { canonicalRequestType: "dynamic_tool_call" };
  }
  return { canonicalRequestType: "unknown" };
}

function permissionOptionsFromParams(params: unknown): ReadonlyArray<GeminiPermissionOption> {
  const options = isRecord(params) && Array.isArray(params.options) ? params.options : [];
  return options
    .map((option): GeminiPermissionOption | null => {
      if (!isRecord(option) || typeof option.optionId !== "string") {
        return null;
      }
      const mapped: GeminiPermissionOption = {
        optionId: option.optionId,
      };
      if (typeof option.kind === "string") {
        Object.assign(mapped, { kind: option.kind });
      }
      if (typeof option.name === "string") {
        Object.assign(mapped, { name: option.name });
      }
      return mapped;
    })
    .filter((option): option is GeminiPermissionOption => option !== null);
}

function permissionDetailFromParams(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const toolCall = isRecord(params.toolCall) ? params.toolCall : {};
  for (const value of [toolCall.title, toolCall.name, toolCall.kind]) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function optionForDecision(
  options: ReadonlyArray<GeminiPermissionOption>,
  decision: ProviderApprovalDecision,
): GeminiPermissionOption | undefined {
  const byKind = (kinds: ReadonlyArray<string>) => {
    for (const kind of kinds) {
      const option = options.find((candidate) => candidate.kind === kind);
      if (option) {
        return option;
      }
    }
    return undefined;
  };
  switch (decision) {
    case "accept":
      return byKind(["allow_once", "allow_always"]);
    case "acceptForSession":
      return byKind(["allow_always", "allow_once"]);
    case "decline":
      return byKind(["reject_once", "reject_always"]);
    case "cancel":
      return undefined;
  }
}

function userInputQuestionsFromParams(params: unknown): ReadonlyArray<UserInputQuestion> | null {
  const rawQuestions =
    isRecord(params) && Array.isArray(params.questions) ? params.questions : null;
  if (!rawQuestions) {
    return null;
  }
  const questions = rawQuestions
    .map((question, index): UserInputQuestion | null => {
      if (!isRecord(question)) {
        return null;
      }
      const id =
        typeof question.id === "string" && question.id.trim()
          ? question.id
          : `gemini-question-${index + 1}`;
      const text =
        typeof question.question === "string" && question.question.trim()
          ? question.question
          : typeof question.prompt === "string" && question.prompt.trim()
            ? question.prompt
            : null;
      if (!text) {
        return null;
      }
      const options = Array.isArray(question.options)
        ? question.options
            .map((option): { label: string; description: string } | null => {
              if (typeof option === "string" && option.trim()) {
                return { label: option, description: option };
              }
              if (!isRecord(option)) {
                return null;
              }
              const label =
                typeof option.label === "string" && option.label.trim()
                  ? option.label
                  : typeof option.value === "string" && option.value.trim()
                    ? option.value
                    : null;
              if (!label) {
                return null;
              }
              return {
                label,
                description:
                  typeof option.description === "string" && option.description.trim()
                    ? option.description
                    : label,
              };
            })
            .filter((option): option is { label: string; description: string } => option !== null)
        : [];
      const mapped: UserInputQuestion = {
        id,
        header:
          typeof question.header === "string" && question.header.trim()
            ? question.header
            : "Gemini",
        question: text,
        options,
      };
      if (question.multiSelect === true) {
        return Object.assign(mapped, { multiSelect: true });
      }
      return mapped;
    })
    .filter((question): question is UserInputQuestion => question !== null);

  return questions.length > 0 ? questions : null;
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
}

function firstNumberFrom(record: Record<string, unknown>, keys: ReadonlyArray<string>) {
  for (const key of keys) {
    const value = numberFrom(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function tokenUsageFromUpdate(update: Record<string, unknown>): ThreadTokenUsageSnapshot | null {
  const updateKind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : update.type;
  if (updateKind !== "usage_update") {
    return null;
  }
  const used = numberFrom(update.used);
  if (used === undefined) {
    return null;
  }
  const size = numberFrom(update.size);
  return {
    usedTokens: Math.round(used),
    ...(size !== undefined && size > 0 ? { maxTokens: Math.round(size) } : {}),
    compactsAutomatically: true,
  };
}

function promptResultUsageRecord(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) {
    return null;
  }
  if (isRecord(result.usage)) {
    return result.usage;
  }
  if (isRecord(result.usageMetadata)) {
    return result.usageMetadata;
  }
  if (isRecord(result.usage_metadata)) {
    return result.usage_metadata;
  }

  const meta = isRecord(result._meta) ? result._meta : null;
  const quota = isRecord(meta?.quota) ? meta.quota : null;
  if (quota) {
    return quota;
  }

  return null;
}

function tokenUsageFromPromptResult(result: unknown): ThreadTokenUsageSnapshot | null {
  const usage = promptResultUsageRecord(result);
  if (!usage) {
    return null;
  }

  const quotaTokenCount = isRecord(usage.token_count) ? usage.token_count : null;
  const tokenSource = quotaTokenCount ?? usage;
  const inputTokens = firstNumberFrom(tokenSource, [
    "inputTokens",
    "input_tokens",
    "promptTokenCount",
    "prompt_token_count",
  ]);
  const outputTokens = firstNumberFrom(tokenSource, [
    "outputTokens",
    "output_tokens",
    "candidatesTokenCount",
    "candidates_token_count",
  ]);
  const thoughtTokens = firstNumberFrom(tokenSource, [
    "thoughtTokens",
    "thought_tokens",
    "thoughtsTokenCount",
    "thoughts_token_count",
  ]);
  const cachedReadTokens = firstNumberFrom(tokenSource, [
    "cachedReadTokens",
    "cached_read_tokens",
    "cachedContentTokenCount",
    "cached_content_token_count",
    "cache_read_input_tokens",
  ]);
  const totalTokens =
    firstNumberFrom(tokenSource, [
      "totalTokens",
      "total_tokens",
      "totalTokenCount",
      "total_token_count",
    ]) ?? (inputTokens ?? 0) + (outputTokens ?? 0) + (thoughtTokens ?? 0);
  if (totalTokens <= 0) {
    return null;
  }

  return {
    usedTokens: Math.round(totalTokens),
    totalProcessedTokens: Math.round(totalTokens),
    lastUsedTokens: Math.round(totalTokens),
    ...(inputTokens !== undefined
      ? { inputTokens: Math.round(inputTokens), lastInputTokens: Math.round(inputTokens) }
      : {}),
    ...(outputTokens !== undefined
      ? { outputTokens: Math.round(outputTokens), lastOutputTokens: Math.round(outputTokens) }
      : {}),
    ...(thoughtTokens !== undefined
      ? {
          reasoningOutputTokens: Math.round(thoughtTokens),
          lastReasoningOutputTokens: Math.round(thoughtTokens),
        }
      : {}),
    ...(cachedReadTokens !== undefined
      ? {
          cachedInputTokens: Math.round(cachedReadTokens),
          lastCachedInputTokens: Math.round(cachedReadTokens),
        }
      : {}),
    compactsAutomatically: true,
  };
}

function geminiModeFromInteractionMode(
  interactionMode: ProviderSendTurnInput["interactionMode"],
  runtimeMode: RuntimeMode,
): "default" | "yolo" | "plan" | null {
  switch (interactionMode) {
    case "plan":
    case "plan-accept":
      return "plan";
    case "default":
      return runtimeMode === "full-access" ? "yolo" : "default";
    case undefined:
      return null;
  }
}

function geminiLaunchOptionsFromRuntimeMode(
  runtimeMode: RuntimeMode,
): Pick<GeminiAcpConnectionOptions, "approvalMode" | "sandbox"> {
  if (runtimeMode === "full-access") {
    return { approvalMode: "yolo", sandbox: false };
  }
  return { approvalMode: "default" };
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
      const fs = yield* FileSystem.FileSystem;
      const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const sessions = new Map<ThreadId, GeminiSessionContext>();
      const createConnection = options?.createConnection ?? createGeminiAcpConnection;

      const offerRuntimeEvent = (event: ProviderRuntimeEvent) => {
        Queue.offerUnsafe(runtimeEventQueue, event);
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

      const handleStderr = (context: GeminiSessionContext, line: string) => {
        if (!line.toLowerCase().includes("mcp")) {
          return;
        }
        offerRuntimeEvent({
          ...eventBase(context, {
            source: "gemini.acp.notification",
            payload: { line },
          }),
          type: "runtime.warning",
          payload: {
            message: line,
          },
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

        const tokenUsage = tokenUsageFromUpdate(update);
        if (tokenUsage) {
          offerRuntimeEvent({
            ...eventBase(context, raw),
            type: "thread.token-usage.updated",
            payload: { usage: tokenUsage },
          });
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
        const raw = {
          source: "gemini.acp.request",
          method: request.method,
          payload: request.params,
        } satisfies ProviderRuntimeEvent["raw"];

        if (request.method === "session/request_permission") {
          if (!context.activeTurn) {
            context.connection.respond({
              id: request.id,
              result: { outcome: { outcome: "cancelled" } },
            });
            emitRawWarning(
              context,
              `Gemini requested permission ${request.method} after the active turn ended; cancelled it.`,
              raw,
            );
            return;
          }
          const requestId = ApprovalRequestId.makeUnsafe(`gemini-request-${randomUUID()}`);
          const params = isRecord(request.params) ? request.params : {};
          const options = permissionOptionsFromParams(params);
          const classification = canonicalPermissionRequestType(params.toolCall);
          context.pendingApprovals.set(requestId, {
            jsonRpcId: request.id,
            canonicalRequestType: classification.canonicalRequestType,
            ...(classification.providerRequestKind
              ? { providerRequestKind: classification.providerRequestKind }
              : {}),
            options,
          });
          offerRuntimeEvent({
            ...eventBase(context, raw),
            type: "request.opened",
            requestId: asRuntimeRequestId(requestId),
            payload: {
              requestType: classification.canonicalRequestType,
              ...(permissionDetailFromParams(params)
                ? { detail: permissionDetailFromParams(params) }
                : {}),
              args: params,
            },
          });
          return;
        }

        if (request.method.includes("requestUserInput") || request.method.includes("user_input")) {
          if (!context.activeTurn) {
            context.connection.respond({
              id: request.id,
              error: {
                code: -32000,
                message: `Gemini user-input request ${request.method} arrived after the active turn ended.`,
              },
            });
            emitRawWarning(
              context,
              `Gemini requested user input ${request.method} after the active turn ended; rejected it.`,
              raw,
            );
            return;
          }
          const questions = userInputQuestionsFromParams(request.params);
          if (!questions) {
            context.connection.respond({
              id: request.id,
              error: {
                code: -32602,
                message: `Gemini user-input request ${request.method} did not include supported questions.`,
              },
            });
            emitRawWarning(
              context,
              `Gemini user-input request ${request.method} did not include supported questions.`,
              raw,
            );
            return;
          }
          const requestId = ApprovalRequestId.makeUnsafe(`gemini-user-input-${randomUUID()}`);
          context.pendingUserInputs.set(requestId, { jsonRpcId: request.id });
          offerRuntimeEvent({
            ...eventBase(context, raw),
            type: "user-input.requested",
            requestId: asRuntimeRequestId(requestId),
            payload: { questions },
          });
          return;
        }

        context.connection.respond({
          id: request.id,
          error: {
            code: -32601,
            message: `Unsupported Gemini ACP client request: ${request.method}.`,
          },
        });
        emitRawWarning(context, `Unsupported Gemini ACP client request: ${request.method}.`, raw);
      };

      const loadGeminiImages = (attachments: ReadonlyArray<ChatAttachment> | undefined) =>
        Effect.gen(function* () {
          const images: Array<GeminiAcpImageContent> = [];
          for (const attachment of attachments ?? []) {
            const mimeType = attachment.mimeType.toLowerCase();
            if (!GEMINI_SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "sendTurn",
                issue: `Gemini does not support ${attachment.mimeType} attachments yet. Supported image types: PNG, JPEG, WebP, and GIF.`,
              });
            }
            const resolvedPath = resolveAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment,
            });
            if (!resolvedPath) {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "sendTurn",
                issue: `Gemini could not resolve attachment ${attachment.name}.`,
              });
            }
            const exists = yield* fs.exists(resolvedPath).pipe(Effect.orElseSucceed(() => false));
            if (!exists) {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "sendTurn",
                issue: `Gemini attachment file is missing: ${attachment.name}.`,
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
              mimeType,
              uri: `t3://attachment/${attachment.id}`,
            });
          }
          return images;
        });

      const startSession: GeminiAdapterShape["startSession"] = Effect.fn("startGeminiSession")(
        function* (input: ProviderSessionStartInput) {
          const requestedProvider = input.provider ?? PROVIDER;
          if (baseProviderKind(requestedProvider) !== PROVIDER) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `GeminiAdapter cannot start provider ${requestedProvider}.`,
            });
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
          const mcpServers = buildGeminiMcpServers(serviceContext);
          let context: GeminiSessionContext | undefined;
          const pendingStderr: Array<string> = [];
          const connection = createConnection({
            binaryPath: geminiSettings.binaryPath,
            ...(cwd ? { cwd } : {}),
            ...(geminiSettings.homePath ? { homePath: geminiSettings.homePath } : {}),
            ...geminiLaunchOptionsFromRuntimeMode(input.runtimeMode),
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
            onStderr: (line) => {
              if (context) {
                handleStderr(context, line);
              } else {
                pendingStderr.push(line);
              }
            },
          });

          const startedAt = nowIso();
          const resumeSessionId = extractResumeSessionId(input.resumeCursor);

          return yield* Effect.gen(function* () {
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

            const sessionInfo =
              resumeSessionId && shouldForkFromResumeCursor(input.resumeCursor)
                ? yield* Effect.tryPromise(() =>
                    connection.forkSession({
                      sessionId: resumeSessionId,
                      cwd: cwd ?? process.cwd(),
                      mcpServers,
                    }),
                  ).pipe(
                    Effect.mapError(
                      (cause) =>
                        new ProviderAdapterRequestError({
                          provider: PROVIDER,
                          method: "session/fork",
                          detail: toMessage(cause, "Gemini ACP session fork failed."),
                          cause,
                        }),
                    ),
                  )
                : resumeSessionId
                  ? { sessionId: resumeSessionId, result: input.resumeCursor }
                  : yield* Effect.tryPromise(() =>
                      connection.newSession({ cwd: cwd ?? process.cwd(), mcpServers }),
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
              mcpServers,
              turns: [],
              pendingApprovals: new Map(),
              pendingUserInputs: new Map(),
              ...(sessionContextPrompt ? { sessionContextPrompt } : {}),
              ...(sessionContextPromptHash ? { sessionContextPromptHash } : {}),
              sessionContextPromptInjected,
              activeTurn: undefined,
              stopped: false,
            };
            sessions.set(input.threadId, context);
            for (const line of pendingStderr) {
              handleStderr(context, line);
            }

            if (resumeSessionId && !shouldForkFromResumeCursor(input.resumeCursor)) {
              yield* Effect.tryPromise(() =>
                connection.loadSession({
                  sessionId: resumeSessionId,
                  cwd: cwd ?? process.cwd(),
                  mcpServers,
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
            if (mcpServers.length > 0) {
              offerRuntimeEvent({
                ...eventBase(context),
                type: "mcp.status.updated",
                payload: {
                  status: {
                    provider: PROVIDER,
                    servers: mcpServers.map((server) =>
                      isRecord(server)
                        ? { name: server.name, status: "configured" }
                        : { status: "configured" },
                    ),
                  },
                },
              });
            }
            offerRuntimeEvent({
              ...eventBase(context),
              type: "account.rate-limits.updated",
              payload: {
                rateLimits: {
                  provider: PROVIDER,
                  status: "unknown",
                  reason: "Gemini ACP/CLI does not expose account rate-limit state.",
                },
              },
            });

            return session;
          }).pipe(
            Effect.tapError(() =>
              Effect.sync(() => {
                sessions.delete(input.threadId);
                connection.close();
              }),
            ),
          );
        },
      );

      const sendTurn: GeminiAdapterShape["sendTurn"] = Effect.fn("sendGeminiTurn")(function* (
        input: ProviderSendTurnInput,
      ) {
        const context = yield* getContext(input.threadId, "sendTurn");
        if (context.activeTurn) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Gemini session already has an active turn.",
          });
        }
        const text = input.input?.trim();
        if (!text && (!input.attachments || input.attachments.length === 0)) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Gemini turns require text input or at least one supported image attachment.",
          });
        }
        const images = yield* loadGeminiImages(input.attachments);

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

        const mode = geminiModeFromInteractionMode(
          input.interactionMode,
          context.session.runtimeMode,
        );
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

        yield* Effect.forkDetach(
          Effect.tryPromise(() =>
            context.connection.prompt({
              sessionId: context.providerSessionId,
              ...(promptInput.text ? { text: promptInput.text } : {}),
              ...(promptInput.embeddedContext
                ? { embeddedContext: promptInput.embeddedContext }
                : {}),
              ...(images.length > 0 ? { images } : {}),
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
                const usage = tokenUsageFromPromptResult(result);
                if (usage) {
                  offerRuntimeEvent({
                    ...eventBase(context, {
                      source: "gemini.acp.response",
                      payload: result,
                    }),
                    type: "thread.token-usage.updated",
                    payload: { usage },
                  });
                }
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

      const respondToRequest: GeminiAdapterShape["respondToRequest"] = Effect.fn(
        "respondToGeminiRequest",
      )(function* (threadId: ThreadId, requestId, decision: ProviderApprovalDecision) {
        const context = yield* getContext(threadId, "respondToRequest");
        const pending = context.pendingApprovals.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToRequest",
            detail: `Unknown pending Gemini approval request: ${requestId}`,
          });
        }

        if (decision === "cancel") {
          context.connection.respond({
            id: pending.jsonRpcId,
            result: { outcome: { outcome: "cancelled" } },
          });
        } else {
          const option = optionForDecision(pending.options, decision);
          if (!option) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "respondToRequest",
              detail: `Gemini approval request ${requestId} does not support decision ${decision}.`,
            });
          }
          context.connection.respond({
            id: pending.jsonRpcId,
            result: { outcome: { outcome: "selected", optionId: option.optionId } },
          });
        }

        context.pendingApprovals.delete(requestId);
        offerRuntimeEvent({
          ...eventBase(context, {
            source: "gemini.acp.response",
            payload: { requestId, decision },
          }),
          type: "request.resolved",
          requestId: asRuntimeRequestId(requestId),
          payload: {
            requestType: pending.canonicalRequestType,
            decision,
            resolution: { decision },
          },
        });
      });

      const respondToUserInput: GeminiAdapterShape["respondToUserInput"] = Effect.fn(
        "respondToGeminiUserInput",
      )(function* (threadId: ThreadId, requestId, answers: ProviderUserInputAnswers) {
        const context = yield* getContext(threadId, "respondToUserInput");
        const pending = context.pendingUserInputs.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToUserInput",
            detail: `Unknown pending Gemini user-input request: ${requestId}`,
          });
        }
        context.connection.respond({
          id: pending.jsonRpcId,
          result: { answers },
        });
        context.pendingUserInputs.delete(requestId);
        offerRuntimeEvent({
          ...eventBase(context, {
            source: "gemini.acp.response",
            payload: { requestId, answers },
          }),
          type: "user-input.resolved",
          requestId: asRuntimeRequestId(requestId),
          payload: { answers },
        });
      });

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
