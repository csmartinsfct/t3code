/**
 * GeminiTextGeneration – Text generation layer using the Gemini CLI.
 *
 * Gemini CLI 0.38 exposes headless JSON output but not JSON-schema constrained
 * generation. We prompt for strict JSON, parse the CLI JSON envelope, and still
 * validate the model payload with the same Effect schemas used by Codex/Claude.
 *
 * @module GeminiTextGeneration
 */
import { Effect, Layer, Schema } from "effect";

import { GeminiModelSelection, TextGenerationError } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";

import {
  runGeminiStructuredOutput,
  StructuredOutputRunnerError,
} from "../../llm/structuredOutput.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
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

const makeGeminiTextGeneration = Effect.gen(function* () {
  const serverSettingsService = yield* Effect.service(ServerSettingsService);

  const rejectAttachmentStructuredGeneration = (
    operation: string,
    attachments: ReadonlyArray<unknown> | undefined,
  ) =>
    attachments && attachments.length > 0
      ? Effect.fail(
          new TextGenerationError({
            operation,
            detail:
              "Gemini CLI headless structured generation does not expose image attachment inputs yet.",
          }),
        )
      : Effect.void;

  const runGeminiJson = Effect.fn("runGeminiJson")(function* <S extends Schema.Top>({
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
    modelSelection: GeminiModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const geminiSettings = yield* Effect.map(
      serverSettingsService.getSettings,
      (settings) => settings.providers.gemini,
    ).pipe(Effect.catch(() => Effect.undefined));

    return yield* runGeminiStructuredOutput({
      operation,
      cwd,
      prompt,
      outputSchema: outputSchemaJson,
      modelSelection,
      ...(geminiSettings?.binaryPath ? { binaryPath: geminiSettings.binaryPath } : {}),
      ...(geminiSettings?.homePath ? { homePath: geminiSettings.homePath } : {}),
    }).pipe(
      Effect.mapError((cause) =>
        normalizeCliError(
          "gemini",
          operation,
          cause,
          cause instanceof StructuredOutputRunnerError ? cause.message : "Gemini request failed",
        ),
      ),
    );
  });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "GeminiTextGeneration.generateCommitMessage",
  )(function* (input) {
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });

    if (input.modelSelection.provider !== "gemini") {
      return yield* new TextGenerationError({
        operation: "generateCommitMessage",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runGeminiJson({
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
    "GeminiTextGeneration.generatePrContent",
  )(function* (input) {
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });

    if (input.modelSelection.provider !== "gemini") {
      return yield* new TextGenerationError({
        operation: "generatePrContent",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runGeminiJson({
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
    "GeminiTextGeneration.generateBranchName",
  )(function* (input) {
    yield* rejectAttachmentStructuredGeneration("generateBranchName", input.attachments);
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    if (input.modelSelection.provider !== "gemini") {
      return yield* new TextGenerationError({
        operation: "generateBranchName",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runGeminiJson({
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
    "GeminiTextGeneration.generateThreadTitle",
  )(function* (input) {
    yield* rejectAttachmentStructuredGeneration("generateThreadTitle", input.attachments);
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    if (input.modelSelection.provider !== "gemini") {
      return yield* new TextGenerationError({
        operation: "generateThreadTitle",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runGeminiJson({
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
    "GeminiTextGeneration.enhanceSystemPrompt",
  )(function* (input) {
    const { prompt, outputSchema } = buildEnhanceSystemPromptPrompt({
      currentPrompt: input.currentPrompt,
    });

    if (input.modelSelection.provider !== "gemini") {
      return yield* new TextGenerationError({
        operation: "enhanceSystemPrompt",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runGeminiJson({
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

export const GeminiTextGenerationLive = Layer.effect(TextGeneration, makeGeminiTextGeneration);
