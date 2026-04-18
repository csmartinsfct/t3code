/**
 * RoutingTextGeneration – Dispatches text generation requests to either the
 * Codex CLI or Claude CLI implementation based on the provider in each
 * request input.
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

// ---------------------------------------------------------------------------
// Internal service tags so both concrete layers can coexist.
// ---------------------------------------------------------------------------

class CodexTextGen extends ServiceMap.Service<CodexTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/CodexTextGen",
) {}

class ClaudeTextGen extends ServiceMap.Service<ClaudeTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/ClaudeTextGen",
) {}

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const codex = yield* CodexTextGen;
  const claude = yield* ClaudeTextGen;

  const route = (provider?: TextGenerationProvider): TextGenerationShape | null => {
    switch (provider ? baseProviderKind(provider) : "codex") {
      case "codex":
        return codex;
      case "claudeAgent":
        return claude;
      case "gemini":
        return null;
    }
  };

  const unsupported = (operation: string, provider: TextGenerationProvider) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: `${provider} does not support structured secondary text generation yet.`,
      }),
    );

  return {
    generateCommitMessage: (input) =>
      route(input.modelSelection.provider)?.generateCommitMessage(input) ??
      unsupported("generateCommitMessage", input.modelSelection.provider),
    generatePrContent: (input) =>
      route(input.modelSelection.provider)?.generatePrContent(input) ??
      unsupported("generatePrContent", input.modelSelection.provider),
    generateBranchName: (input) =>
      route(input.modelSelection.provider)?.generateBranchName(input) ??
      unsupported("generateBranchName", input.modelSelection.provider),
    generateThreadTitle: (input) =>
      route(input.modelSelection.provider)?.generateThreadTitle(input) ??
      unsupported("generateThreadTitle", input.modelSelection.provider),
    enhanceSystemPrompt: (input) =>
      route(input.modelSelection.provider)?.enhanceSystemPrompt(input) ??
      unsupported("enhanceSystemPrompt", input.modelSelection.provider),
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

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(Layer.provide(InternalCodexLayer), Layer.provide(InternalClaudeLayer));
