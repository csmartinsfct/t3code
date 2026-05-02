/**
 * RoutingTextGeneration – Dispatches text generation requests to either the
 * Codex, Claude, or Gemini CLI implementation based on the provider in each
 * request input. Cursor is a chat provider only until a structured secondary
 * inference path is implemented.
 *
 * Requests are routed explicitly by provider so a newly supported chat provider
 * cannot silently fall through to Codex for secondary inference.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer, ServiceMap } from "effect";
import { baseProviderKind, TextGenerationError } from "@t3tools/contracts";

import {
  TextGeneration,
  type TextGenerationProvider,
  type TextGenerationShape,
} from "../Services/TextGeneration.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";
import { GeminiTextGenerationLive } from "./GeminiTextGeneration.ts";

// ---------------------------------------------------------------------------
// Internal service tags so both concrete layers can coexist.
// ---------------------------------------------------------------------------

class CodexTextGen extends ServiceMap.Service<CodexTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/CodexTextGen",
) {}

class ClaudeTextGen extends ServiceMap.Service<ClaudeTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/ClaudeTextGen",
) {}

class GeminiTextGen extends ServiceMap.Service<GeminiTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/GeminiTextGen",
) {}

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const codex = yield* CodexTextGen;
  const claude = yield* ClaudeTextGen;
  const gemini = yield* GeminiTextGen;

  const route = (provider?: TextGenerationProvider): TextGenerationShape | null => {
    switch (provider ? baseProviderKind(provider) : "codex") {
      case "codex":
        return codex;
      case "claudeAgent":
        return claude;
      case "gemini":
        return gemini;
      case "cursor":
        return null;
    }
  };

  return {
    generateCommitMessage: (input) =>
      route(input.modelSelection.provider)?.generateCommitMessage(input) ??
      Effect.fail(
        new TextGenerationError({
          operation: "generateCommitMessage",
          detail: `${input.modelSelection.provider} does not support structured secondary text generation.`,
        }),
      ),
    generatePrContent: (input) =>
      route(input.modelSelection.provider)?.generatePrContent(input) ??
      Effect.fail(
        new TextGenerationError({
          operation: "generatePrContent",
          detail: `${input.modelSelection.provider} does not support structured secondary text generation.`,
        }),
      ),
    generateBranchName: (input) =>
      route(input.modelSelection.provider)?.generateBranchName(input) ??
      Effect.fail(
        new TextGenerationError({
          operation: "generateBranchName",
          detail: `${input.modelSelection.provider} does not support structured secondary text generation.`,
        }),
      ),
    generateThreadTitle: (input) =>
      route(input.modelSelection.provider)?.generateThreadTitle(input) ??
      Effect.fail(
        new TextGenerationError({
          operation: "generateThreadTitle",
          detail: `${input.modelSelection.provider} does not support structured secondary text generation.`,
        }),
      ),
    enhanceSystemPrompt: (input) =>
      route(input.modelSelection.provider)?.enhanceSystemPrompt(input) ??
      Effect.fail(
        new TextGenerationError({
          operation: "enhanceSystemPrompt",
          detail: `${input.modelSelection.provider} does not support structured secondary text generation.`,
        }),
      ),
  } satisfies TextGenerationShape;
});

const InternalCodexLayer = Layer.effect(
  CodexTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CodexTextGenerationLive));

const InternalClaudeLayer = Layer.effect(
  ClaudeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(ClaudeTextGenerationLive));

const InternalGeminiLayer = Layer.effect(
  GeminiTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(GeminiTextGenerationLive));

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(
  Layer.provide(InternalCodexLayer),
  Layer.provide(InternalClaudeLayer),
  Layer.provide(InternalGeminiLayer),
);
