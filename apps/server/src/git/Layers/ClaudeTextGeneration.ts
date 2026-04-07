/**
 * ClaudeTextGeneration – Text generation layer using the Claude CLI.
 *
 * Implements the same TextGenerationShape contract as CodexTextGeneration but
 * delegates to the `claude` CLI (`claude -p`) with structured JSON output
 * instead of the `codex exec` CLI.
 *
 * @module ClaudeTextGeneration
 */
import { Effect, Layer, Schema } from "effect";

import { ClaudeModelSelection } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";

import { TextGenerationError } from "@t3tools/contracts";
import {
  runClaudeStructuredOutput,
  StructuredOutputRunnerError,
} from "../../llm/structuredOutput.ts";
import { type TextGenerationShape, TextGeneration } from "../Services/TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildEnhanceSystemPromptPrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "../Prompts.ts";
import {
  normalizeCliError,
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "../Utils.ts";
import { normalizeClaudeModelOptionsWithCapabilities } from "@t3tools/shared/model";
import { ServerSettingsService } from "../../serverSettings.ts";
import { getClaudeModelCapabilities } from "../../provider/Layers/ClaudeProvider.ts";

const makeClaudeTextGeneration = Effect.gen(function* () {
  const serverSettingsService = yield* Effect.service(ServerSettingsService);
  const runClaudeJson = Effect.fn("runClaudeJson")(function* <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle"
      | "enhanceSystemPrompt";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ClaudeModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const normalizedOptions = normalizeClaudeModelOptionsWithCapabilities(
      getClaudeModelCapabilities(modelSelection.model),
      modelSelection.options,
    );
    const settings = {
      ...(typeof normalizedOptions?.thinking === "boolean"
        ? { alwaysThinkingEnabled: normalizedOptions.thinking }
        : {}),
      ...(normalizedOptions?.fastMode ? { fastMode: true } : {}),
    };

    const claudeSettings = yield* Effect.map(
      serverSettingsService.getSettings,
      (settings) => settings.providers.claudeAgent,
    ).pipe(Effect.catch(() => Effect.undefined));
    return yield* runClaudeStructuredOutput({
      operation,
      cwd,
      prompt,
      outputSchema: outputSchemaJson,
      modelSelection,
      ...(claudeSettings?.binaryPath ? { binaryPath: claudeSettings.binaryPath } : {}),
      ...(normalizedOptions?.effort ? { effort: normalizedOptions.effort } : {}),
      ...(typeof normalizedOptions?.thinking === "boolean"
        ? { thinking: normalizedOptions.thinking }
        : {}),
      ...(typeof normalizedOptions?.fastMode === "boolean"
        ? { fastMode: normalizedOptions.fastMode }
        : {}),
    }).pipe(
      Effect.mapError((cause) =>
        normalizeCliError(
          "claude",
          operation,
          cause,
          cause instanceof StructuredOutputRunnerError ? cause.message : "Claude request failed",
        ),
      ),
    );
  });

  // ---------------------------------------------------------------------------
  // TextGenerationShape methods
  // ---------------------------------------------------------------------------

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "ClaudeTextGeneration.generateCommitMessage",
  )(function* (input) {
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });

    if (input.modelSelection.provider !== "claudeAgent") {
      return yield* new TextGenerationError({
        operation: "generateCommitMessage",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runClaudeJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "ClaudeTextGeneration.generatePrContent",
  )(function* (input) {
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });

    if (input.modelSelection.provider !== "claudeAgent") {
      return yield* new TextGenerationError({
        operation: "generatePrContent",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runClaudeJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "ClaudeTextGeneration.generateBranchName",
  )(function* (input) {
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    if (input.modelSelection.provider !== "claudeAgent") {
      return yield* new TextGenerationError({
        operation: "generateBranchName",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runClaudeJson({
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "ClaudeTextGeneration.generateThreadTitle",
  )(function* (input) {
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    if (input.modelSelection.provider !== "claudeAgent") {
      return yield* new TextGenerationError({
        operation: "generateThreadTitle",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runClaudeJson({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizeThreadTitle(generated.title),
    };
  });

  const enhanceSystemPrompt: TextGenerationShape["enhanceSystemPrompt"] = Effect.fn(
    "ClaudeTextGeneration.enhanceSystemPrompt",
  )(function* (input) {
    const { prompt, outputSchema } = buildEnhanceSystemPromptPrompt({
      currentPrompt: input.currentPrompt,
    });

    if (input.modelSelection.provider !== "claudeAgent") {
      return yield* new TextGenerationError({
        operation: "enhanceSystemPrompt",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runClaudeJson({
      operation: "enhanceSystemPrompt",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return { enhancedPrompt: generated.enhancedPrompt };
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
    enhanceSystemPrompt,
  } satisfies TextGenerationShape;
});

export const ClaudeTextGenerationLive = Layer.effect(TextGeneration, makeClaudeTextGeneration);
