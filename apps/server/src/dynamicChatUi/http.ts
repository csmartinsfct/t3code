import { createHash, randomUUID } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";

import { Cause, Data, Deferred, Duration, Effect, Fiber, Layer, Option, Ref, Stream } from "effect";
import { Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import {
  CommandId,
  MessageId,
  ThreadId,
  type ModelSelection,
  type OrchestrationMessageMetadata,
  type ProviderRuntimeEvent,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  extractDynamicChatUiPayloadsFromMarkdown,
  toDynamicChatUiArtifactDocument,
  type DynamicChatUiPayload,
} from "@t3tools/shared/dynamicChatUi";
import {
  DYNAMIC_CHAT_UI_BUILDER_HTML_START,
  DYNAMIC_CHAT_UI_BUILDER_META_START,
  DYNAMIC_CHAT_UI_BUILDER_OUTPUT_END,
  DYNAMIC_CHAT_UI_BUILDER_PROMPT_DEFAULT,
  renderDynamicChatUiBuilderPromptTemplate,
  validateDynamicChatUiBuilderPromptTemplate,
} from "@t3tools/shared/dynamicChatUiBuilderPrompt";
import {
  parseToolCallBody,
  resolveAuth,
  respondError,
  respondErrorFromCause,
  respondOk,
  type ServiceAuthContext,
  validateToolInput,
} from "../restResponse";
import { ServerConfig } from "../config";
import { ServerSettingsService } from "../serverSettings";
import { ProjectionThreadMessageRepository } from "../persistence/Services/ProjectionThreadMessages";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProviderService } from "../provider/Services/ProviderService";
import {
  buildDynamicChatUiBlock,
  buildDynamicChatUiStatusBlock,
  clampHeight,
  generatedArtifactId,
  metadataForPayload,
} from "./artifacts";
import { readDynamicChatUiPromptRequest, readTrimmed, TOOL_DEFINITIONS } from "./tool";

export { buildDynamicChatUiBlock } from "./artifacts";
export { readDynamicChatUiPromptRequest } from "./tool";

const API_ROUTE = "/api/dynamic-chat-ui";
const DESIGN_GUIDE_RELATIVE_PATH = "docs/design-language.md";
const MAX_PROMPT_CHARS = 20_000;
const MAX_CONTEXT_CHARS = 50_000;
const MAX_PREVIOUS_HTML_CONTEXT_CHARS = 60_000;
const MAX_BUILDER_SESSION_PROMPT_CHARS = 118_000;
const DYNAMIC_CHAT_UI_BUILDER_TIMEOUT_MS = 600_000;
const MODULE_DIR = nodePath.dirname(fileURLToPath(import.meta.url));

class DynamicChatUiHttpError extends Data.TaggedError("DynamicChatUiHttpError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const DynamicChatUiBuilderOutput = Schema.Struct({
  initialHeight: Schema.Number,
  maxHeight: Schema.Number,
  html: Schema.String,
});

export function resolveDynamicChatUiBuilderModelSelection(input: {
  readonly serverSettings: ServerSettings;
  readonly threadModelSelection?: ModelSelection | null;
}): ModelSelection {
  const modelSelection =
    input.threadModelSelection ?? input.serverSettings.textGenerationModelSelection;
  if (modelSelection.provider === "claudeAgent") {
    const effort = modelSelection.options?.effort;
    return {
      ...modelSelection,
      ...(modelSelection.options
        ? {
            options: {
              ...modelSelection.options,
              ...(effort === "xhigh" || effort === "max" || effort === "ultrathink"
                ? { effort: "high" as const }
                : {}),
            },
          }
        : {}),
    };
  }

  if (modelSelection.provider === "codex") {
    return {
      ...modelSelection,
      ...(modelSelection.options
        ? {
            options: {
              ...modelSelection.options,
              ...(modelSelection.options.reasoningEffort === "xhigh"
                ? { reasoningEffort: "high" as const }
                : {}),
            },
          }
        : {}),
    };
  }

  return modelSelection;
}

function truncateText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n...[truncated]`;
}

function compactSingleLine(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function buildStatusDescription(input: {
  readonly description: string | null;
  readonly userPrompt: string;
  readonly isRevision: boolean;
}): string {
  if (input.description) return input.description;
  const requestSummary = compactSingleLine(input.userPrompt, 140);
  return input.isRevision ? `Revising: ${requestSummary}` : `Building: ${requestSummary}`;
}

function readOptionalContext(input: Record<string, unknown>): string {
  const context = readTrimmed(input, "context");
  const data = input.data === undefined ? null : JSON.stringify(input.data, null, 2);
  return [
    context ? `Additional context:\n${truncateText(context, MAX_CONTEXT_CHARS)}` : "",
    data ? `Structured data:\n${truncateText(data, MAX_CONTEXT_CHARS)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

interface PreviousDynamicChatUiArtifact {
  readonly messageId: string;
  readonly payload: DynamicChatUiPayload;
}

const dispatchDynamicChatUiTimelineMessage = Effect.fn("dispatchDynamicChatUiTimelineMessage")(
  function* (input: {
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
    readonly text: string;
    readonly metadata?: OrchestrationMessageMetadata;
  }) {
    const orchestrationEngine = yield* OrchestrationEngineService;
    yield* orchestrationEngine
      .dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe(`dynamic-chat-ui:${randomUUID()}`),
        threadId: input.threadId,
        messageId: input.messageId,
        text: input.text,
        ...(input.metadata ? { metadata: input.metadata } : {}),
        createdAt: new Date().toISOString(),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new DynamicChatUiHttpError({
              message: "Failed to update the dynamic chat UI timeline message.",
              cause,
            }),
        ),
      );
  },
);

function buildPreviousArtifactContext(previous: PreviousDynamicChatUiArtifact | null): string {
  if (!previous) return "";
  return [
    "Existing artifact to revise:",
    JSON.stringify(
      {
        messageId: previous.messageId,
        metadata: metadataForPayload(previous.payload),
      },
      null,
      2,
    ),
    "",
    "Existing artifact HTML:",
    truncateText(previous.payload.html, MAX_PREVIOUS_HTML_CONTEXT_CHARS),
  ].join("\n");
}

function buildBuilderPrompt(input: {
  readonly template: string;
  readonly userPrompt: string;
  readonly designGuide: string;
  readonly extraContext: string;
  readonly preferences: Record<string, unknown>;
  readonly previousArtifact: PreviousDynamicChatUiArtifact | null;
}): { readonly systemPrompt: string; readonly userMessage: string } {
  const isRevision = input.previousArtifact !== null;
  const preferences = JSON.stringify(input.preferences, null, 2);
  const previousArtifact = buildPreviousArtifactContext(input.previousArtifact);
  const systemPrompt = renderDynamicChatUiBuilderPromptTemplate(input.template, {
    modeInstruction: isRevision
      ? "Revise the existing inline chat timeline artifact and return a complete replacement HTML document."
      : "Generate one highly dynamic, self-contained HTML document for an inline chat timeline artifact.",
    userPrompt: truncateText(input.userPrompt, MAX_PROMPT_CHARS),
    extraContext: input.extraContext,
    preferences,
    previousArtifact,
    designGuide: truncateText(input.designGuide, 60_000),
  });
  const userMessage = [
    isRevision
      ? "Revise the existing Dynamic Chat UI artifact for this request:"
      : "Build a Dynamic Chat UI artifact for this request:",
    "",
    truncateText(input.userPrompt, MAX_PROMPT_CHARS),
    input.extraContext ? `\n${input.extraContext}` : "",
    "Preferences:",
    preferences,
    previousArtifact ? `\n${previousArtifact}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { systemPrompt, userMessage };
}

export function parseDynamicChatUiBuilderTextOutput(output: string): Record<string, unknown> {
  const metaStart = output.indexOf(DYNAMIC_CHAT_UI_BUILDER_META_START);
  const htmlStart = output.indexOf(DYNAMIC_CHAT_UI_BUILDER_HTML_START);
  const outputEnd = output.lastIndexOf(DYNAMIC_CHAT_UI_BUILDER_OUTPUT_END);
  if (
    metaStart < 0 ||
    htmlStart < 0 ||
    outputEnd < 0 ||
    metaStart > htmlStart ||
    htmlStart > outputEnd
  ) {
    throw new DynamicChatUiHttpError({
      message: `Dynamic chat UI builder did not return ${DYNAMIC_CHAT_UI_BUILDER_META_START}/${DYNAMIC_CHAT_UI_BUILDER_HTML_START}/${DYNAMIC_CHAT_UI_BUILDER_OUTPUT_END} delimiters.`,
    });
  }

  const metaText = output
    .slice(metaStart + DYNAMIC_CHAT_UI_BUILDER_META_START.length, htmlStart)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const html = output
    .slice(htmlStart + DYNAMIC_CHAT_UI_BUILDER_HTML_START.length, outputEnd)
    .trim();
  if (!html) {
    throw new DynamicChatUiHttpError({ message: "Dynamic chat UI builder returned empty HTML." });
  }

  let meta: unknown;
  try {
    meta = JSON.parse(metaText);
  } catch (cause) {
    throw new DynamicChatUiHttpError({
      message: "Dynamic chat UI builder returned invalid metadata JSON.",
      cause,
    });
  }

  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    throw new DynamicChatUiHttpError({
      message: "Dynamic chat UI builder metadata must be a JSON object.",
    });
  }

  return {
    ...(meta as Record<string, unknown>),
    html,
  };
}

function dynamicChatUiBuilderThreadId(input: {
  readonly sourceThreadId: string;
  readonly artifactId: string;
}): ThreadId {
  const hash = createHash("sha256")
    .update(`${input.sourceThreadId}:${input.artifactId}`)
    .digest("hex")
    .slice(0, 24);
  return ThreadId.makeUnsafe(`dynamic-chat-ui-builder-${hash}`);
}

function isTerminalBuilderEvent(
  event: ProviderRuntimeEvent,
): event is Extract<
  ProviderRuntimeEvent,
  { type: "turn.completed" | "turn.aborted" | "runtime.error" }
> {
  return (
    event.type === "turn.completed" ||
    event.type === "turn.aborted" ||
    event.type === "runtime.error"
  );
}

const runDynamicChatUiBuilderSession = Effect.fn("runDynamicChatUiBuilderSession")(
  function* (input: {
    readonly builderThreadId: ThreadId;
    readonly cwd: string;
    readonly prompt: {
      readonly systemPrompt: string;
      readonly userMessage: string;
    };
    readonly modelSelection: ModelSelection;
  }) {
    const providerService = yield* ProviderService;
    const outputRef = yield* Ref.make("");
    const fallbackRef = yield* Ref.make("");
    const done = yield* Deferred.make<string, DynamicChatUiHttpError>();

    const rawOutput = yield* Effect.scoped(
      Effect.gen(function* () {
        const consumer = yield* Stream.runForEach(
          providerService.streamEvents.pipe(
            Stream.filter((event) => event.threadId === input.builderThreadId),
          ),
          (event) =>
            Effect.gen(function* () {
              if (event.type === "content.delta" && event.payload.streamKind === "assistant_text") {
                yield* Ref.update(outputRef, (current) => current + event.payload.delta);
                return;
              }

              if (
                event.type === "item.completed" &&
                event.payload.itemType === "assistant_message"
              ) {
                if (event.payload.detail) {
                  yield* Ref.update(fallbackRef, (current) => current || event.payload.detail!);
                }
                return;
              }

              if (!isTerminalBuilderEvent(event)) {
                return;
              }

              if (event.type === "turn.completed" && event.payload.state === "completed") {
                const output = yield* Ref.get(outputRef);
                const fallback = yield* Ref.get(fallbackRef);
                yield* Deferred.succeed(done, output.trim().length > 0 ? output : fallback);
                return;
              }

              const message =
                event.type === "runtime.error"
                  ? event.payload.message
                  : event.type === "turn.aborted"
                    ? event.payload.reason
                    : (event.payload.errorMessage ??
                      event.payload.terminalReason ??
                      event.payload.stopReason ??
                      `Dynamic chat UI builder turn ended with state ${event.payload.state}.`);
              yield* Deferred.fail(
                done,
                new DynamicChatUiHttpError({
                  message,
                }),
              );
            }),
        ).pipe(Effect.forkScoped);

        yield* providerService.startSession(input.builderThreadId, {
          threadId: input.builderThreadId,
          provider: input.modelSelection.provider,
          cwd: input.cwd,
          modelSelection: input.modelSelection,
          systemPrompt: input.prompt.systemPrompt,
          runtimeMode: "full-access",
        });
        yield* providerService.sendTurn({
          threadId: input.builderThreadId,
          input: input.prompt.userMessage,
          modelSelection: input.modelSelection,
          interactionMode: "default",
        });

        const completed = yield* Deferred.await(done).pipe(
          Effect.timeoutOption(Duration.millis(DYNAMIC_CHAT_UI_BUILDER_TIMEOUT_MS)),
        );
        if (Option.isNone(completed)) {
          return yield* new DynamicChatUiHttpError({
            message: "Dynamic chat UI builder timed out.",
          });
        }
        yield* Fiber.interrupt(consumer).pipe(Effect.ignore);
        return completed.value;
      }),
    );
    const parsed = yield* Effect.try({
      try: () => parseDynamicChatUiBuilderTextOutput(rawOutput),
      catch: (cause) =>
        cause instanceof DynamicChatUiHttpError
          ? cause
          : new DynamicChatUiHttpError({
              message:
                cause instanceof Error ? cause.message : "Dynamic chat UI builder parse failed.",
              cause,
            }),
    });
    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(DynamicChatUiBuilderOutput)(parsed),
      catch: (cause) =>
        new DynamicChatUiHttpError({
          message: "Dynamic chat UI builder returned invalid output.",
          cause,
        }),
    });
  },
);

async function findFileInAncestors(startDir: string, relativePath: string): Promise<string | null> {
  let current = nodePath.resolve(startDir);
  while (true) {
    const candidate = nodePath.join(current, relativePath);
    try {
      await nodeFs.access(candidate);
      return candidate;
    } catch {
      const parent = nodePath.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

export async function resolveDynamicChatUiDesignGuidePath(cwd: string): Promise<string> {
  const searchRoots = [cwd, MODULE_DIR];
  for (const root of searchRoots) {
    const found = await findFileInAncestors(root, DESIGN_GUIDE_RELATIVE_PATH);
    if (found) return found;
  }
  return nodePath.join(cwd, DESIGN_GUIDE_RELATIVE_PATH);
}

const readDesignGuide = Effect.fn("readDynamicChatUiDesignGuide")(function* (
  serverSettings: ServerSettings,
) {
  const override = serverSettings.dynamicChatUi.designGuideOverride;
  if (override && override.trim().length > 0) {
    return {
      content: override,
      path: "settings.json:dynamicChatUi.designGuideOverride",
    } as const;
  }

  const config = yield* ServerConfig;
  const designGuidePath = yield* Effect.tryPromise({
    try: () => resolveDynamicChatUiDesignGuidePath(config.cwd),
    catch: (cause) =>
      new DynamicChatUiHttpError({
        message: `Failed to resolve ${DESIGN_GUIDE_RELATIVE_PATH}.`,
        cause,
      }),
  });
  const content = yield* Effect.tryPromise({
    try: () => nodeFs.readFile(designGuidePath, "utf8"),
    catch: (cause) =>
      new DynamicChatUiHttpError({
        message: `Failed to read ${designGuidePath}.`,
        cause,
      }),
  });
  return { content, path: designGuidePath } as const;
});

const findPreviousDynamicChatUiArtifact = Effect.fn("findPreviousDynamicChatUiArtifact")(
  function* (input: {
    readonly threadId: ThreadId;
    readonly sourceArtifactId: string | null;
    readonly sourceMessageId: string | null;
  }) {
    if (!input.sourceArtifactId && !input.sourceMessageId) {
      return null;
    }

    const messageRepository = yield* ProjectionThreadMessageRepository;
    const messages = yield* messageRepository.listByThreadId({ threadId: input.threadId }).pipe(
      Effect.mapError(
        (cause) =>
          new DynamicChatUiHttpError({
            message: "Failed to read thread messages for dynamic chat UI revision.",
            cause,
          }),
      ),
    );
    const candidates = messages.flatMap((message) =>
      extractDynamicChatUiPayloadsFromMarkdown(message.text).map((payload) => ({
        messageId: message.messageId,
        payload,
      })),
    );
    const scopedCandidates = input.sourceMessageId
      ? candidates.filter((candidate) => candidate.messageId === input.sourceMessageId)
      : candidates;
    const selected = input.sourceArtifactId
      ? scopedCandidates.findLast((candidate) => candidate.payload.id === input.sourceArtifactId)
      : scopedCandidates.at(-1);

    if (!selected) {
      return yield* new DynamicChatUiHttpError({
        message: input.sourceArtifactId
          ? `Could not find dynamic chat UI artifact '${input.sourceArtifactId}' in this thread.`
          : `Could not find a dynamic chat UI artifact in message '${input.sourceMessageId}'.`,
      });
    }
    return selected;
  },
);

const buildDynamicChatUiFromPrompt = Effect.fn("buildDynamicChatUiFromPrompt")(function* (
  input: Record<string, unknown>,
  auth: ServiceAuthContext,
) {
  const request = readDynamicChatUiPromptRequest(input);
  if ("error" in request) return request;
  const { userPrompt, title, description } = request;

  const settings = yield* ServerSettingsService;
  const serverSettings = yield* settings.getSettings;
  const builderPromptTemplate =
    serverSettings.dynamicChatUi.builderPromptOverride?.trim() ||
    DYNAMIC_CHAT_UI_BUILDER_PROMPT_DEFAULT;
  const missingBuilderPromptPlaceholders =
    validateDynamicChatUiBuilderPromptTemplate(builderPromptTemplate);
  if (missingBuilderPromptPlaceholders.length > 0) {
    return {
      error: `Dynamic Chat UI builder prompt is missing required placeholder(s): ${missingBuilderPromptPlaceholders.join(", ")}. Reset or edit Settings -> Prompts -> Dynamic UI -> Builder Prompt.`,
    } as const;
  }
  const threadRepository = yield* ProjectionThreadRepository;
  const threadOption = yield* threadRepository.getById({ threadId: auth.threadId });
  const thread = Option.getOrNull(threadOption);
  const config = yield* ServerConfig;
  const designGuide = yield* readDesignGuide(serverSettings);
  const modelSelection = resolveDynamicChatUiBuilderModelSelection({
    serverSettings,
    threadModelSelection: thread?.modelSelection ?? null,
  });
  const sourceArtifactId = readTrimmed(input, "sourceArtifactId");
  const sourceMessageId = readTrimmed(input, "sourceMessageId");
  const previousArtifact = yield* findPreviousDynamicChatUiArtifact({
    threadId: auth.threadId,
    sourceArtifactId,
    sourceMessageId,
  });
  const artifactId =
    readTrimmed(input, "id") ?? previousArtifact?.payload.id ?? generatedArtifactId();
  const preferences = {
    id: artifactId,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    initialHeight: clampHeight(input.initialHeight, 360),
    maxHeight: clampHeight(input.maxHeight, 700),
  };
  const prompt = buildBuilderPrompt({
    template: builderPromptTemplate,
    userPrompt,
    designGuide: designGuide.content,
    extraContext: readOptionalContext(input),
    preferences,
    previousArtifact,
  });
  const truncatedPrompt = {
    systemPrompt: truncateText(prompt.systemPrompt, MAX_BUILDER_SESSION_PROMPT_CHARS),
    userMessage: truncateText(prompt.userMessage, MAX_BUILDER_SESSION_PROMPT_CHARS),
  };
  const builderThreadId = dynamicChatUiBuilderThreadId({
    sourceThreadId: auth.threadId,
    artifactId,
  });
  const artifactMessageId = MessageId.makeUnsafe(`dynamic-chat-ui:${artifactId}:${randomUUID()}`);
  const statusDescription = buildStatusDescription({
    description,
    userPrompt,
    isRevision: previousArtifact !== null,
  });
  yield* dispatchDynamicChatUiTimelineMessage({
    threadId: auth.threadId,
    messageId: artifactMessageId,
    text: buildDynamicChatUiStatusBlock({
      title,
      description: statusDescription,
    }),
  });

  const generated = yield* runDynamicChatUiBuilderSession({
    builderThreadId,
    cwd: config.cwd,
    prompt: truncatedPrompt,
    modelSelection,
  }).pipe(
    Effect.catchCause((cause) =>
      dispatchDynamicChatUiTimelineMessage({
        threadId: auth.threadId,
        messageId: artifactMessageId,
        text: [`Dynamic UI generation failed: **${title}**`, "", Cause.pretty(cause)].join("\n"),
      }).pipe(Effect.ignore, Effect.andThen(Effect.failCause(cause))),
    ),
  );

  const result = buildDynamicChatUiBlock({
    id: artifactId,
    title,
    description,
    initialHeight: input.initialHeight ?? generated.initialHeight,
    maxHeight: input.maxHeight ?? generated.maxHeight,
    html: generated.html,
  });
  if ("error" in result) {
    yield* dispatchDynamicChatUiTimelineMessage({
      threadId: auth.threadId,
      messageId: artifactMessageId,
      text: [`Dynamic UI generation failed: **${title}**`, "", result.error].join("\n"),
    }).pipe(Effect.ignore);
    return result;
  }

  yield* dispatchDynamicChatUiTimelineMessage({
    threadId: auth.threadId,
    messageId: artifactMessageId,
    text: result.block,
    metadata: {
      dynamicChatUiArtifacts: [toDynamicChatUiArtifactDocument(result.payload)],
    },
  });

  const artifact = metadataForPayload(result.payload);
  return {
    artifact,
    artifactId,
    messageId: artifactMessageId,
    delivery: "timeline" as const,
    status: previousArtifact ? ("revised" as const) : ("created" as const),
    model: {
      provider: modelSelection.provider,
      model: modelSelection.model,
    },
    htmlSize: result.payload.html.length,
    designGuidePath: designGuide.path,
    sourceThreadId: auth.threadId,
    builderThreadId,
    ...(previousArtifact
      ? {
          revisionOf: {
            messageId: previousArtifact.messageId,
            artifactId: previousArtifact.payload.id,
          },
        }
      : {}),
  } as const;
});

const handleGet = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const auth = yield* resolveAuth(webRequest);
  if (!auth) return respondError("Unauthorized", 401);
  return respondOk(TOOL_DEFINITIONS, "Available tools");
});

const handlePost = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const auth = yield* resolveAuth(webRequest);
  if (!auth) return respondError("Unauthorized", 401);

  const body = yield* Effect.tryPromise({
    try: () => parseToolCallBody(webRequest),
    catch: (cause) =>
      new DynamicChatUiHttpError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
  if (!body) return respondError("Invalid request body. Expected: { tool: string, input: object }");

  if (body.tool === "create_dynamic_chat_ui_from_prompt") {
    const validationError = validateToolInput(TOOL_DEFINITIONS, body.tool, body.input);
    if (validationError) return respondError(validationError);
    const result = yield* buildDynamicChatUiFromPrompt(body.input, auth);
    if ("error" in result) {
      return respondError(result.error);
    }
    return respondOk(result);
  }

  return respondError(`Unknown tool: ${body.tool}`);
}).pipe(Effect.catchCause((cause) => Effect.succeed(respondErrorFromCause(cause))));

export const dynamicChatUiRouteLayer = Layer.mergeAll(
  HttpRouter.add("GET", API_ROUTE, handleGet),
  HttpRouter.add("POST", API_ROUTE, handlePost),
);
