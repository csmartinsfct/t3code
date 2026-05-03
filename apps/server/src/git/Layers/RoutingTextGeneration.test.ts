import { it, assert } from "@effect/vitest";
import { TextGenerationError, type ModelSelection } from "@t3tools/contracts";
import { Effect, Result } from "effect";

import type { TextGenerationShape } from "../Services/TextGeneration";
import { makeRoutingTextGenerationForProviders } from "./RoutingTextGeneration";

function makeFakeTextGeneration(
  provider: string,
  calls: Array<{ provider: string; method: keyof TextGenerationShape }>,
): TextGenerationShape {
  return {
    generateCommitMessage: () => {
      calls.push({ provider, method: "generateCommitMessage" });
      return Effect.succeed({ subject: `${provider} subject`, body: "" });
    },
    generatePrContent: () => {
      calls.push({ provider, method: "generatePrContent" });
      return Effect.succeed({ title: `${provider} title`, body: "" });
    },
    generateBranchName: () => {
      calls.push({ provider, method: "generateBranchName" });
      return Effect.succeed({ branch: `${provider}-branch` });
    },
    generateThreadTitle: () => {
      calls.push({ provider, method: "generateThreadTitle" });
      return Effect.succeed({ title: `${provider} thread` });
    },
    enhanceSystemPrompt: () => {
      calls.push({ provider, method: "enhanceSystemPrompt" });
      return Effect.succeed({ enhancedPrompt: `${provider} prompt` });
    },
  };
}

const cursorSelection: ModelSelection = {
  provider: "cursor",
  profileId: "metric",
  model: "composer-2",
};

it.effect("RoutingTextGeneration rejects Cursor for every secondary inference method", () =>
  Effect.gen(function* () {
    const calls: Array<{ provider: string; method: keyof TextGenerationShape }> = [];
    const router = makeRoutingTextGenerationForProviders({
      codex: makeFakeTextGeneration("codex", calls),
      claude: makeFakeTextGeneration("claude", calls),
      gemini: makeFakeTextGeneration("gemini", calls),
    });

    const results = yield* Effect.all([
      router
        .generateCommitMessage({
          cwd: "/tmp/project",
          branch: "main",
          stagedSummary: "summary",
          stagedPatch: "patch",
          modelSelection: cursorSelection,
        })
        .pipe(Effect.result),
      router
        .generatePrContent({
          cwd: "/tmp/project",
          baseBranch: "main",
          headBranch: "feature",
          commitSummary: "summary",
          diffSummary: "diff",
          diffPatch: "patch",
          modelSelection: cursorSelection,
        })
        .pipe(Effect.result),
      router
        .generateBranchName({
          cwd: "/tmp/project",
          message: "Do work",
          modelSelection: cursorSelection,
        })
        .pipe(Effect.result),
      router
        .generateThreadTitle({
          cwd: "/tmp/project",
          message: "Do work",
          modelSelection: cursorSelection,
        })
        .pipe(Effect.result),
      router
        .enhanceSystemPrompt({
          cwd: "/tmp/project",
          currentPrompt: "Be useful.",
          modelSelection: cursorSelection,
        })
        .pipe(Effect.result),
    ]);

    assert.deepEqual(calls, []);
    for (const rawResult of results) {
      const result = rawResult as Result.Result<unknown, TextGenerationError>;
      assert.equal(Result.isFailure(result), true);
      if (Result.isFailure(result)) {
        assert.instanceOf(result.failure, TextGenerationError);
        assert.match(
          result.failure.message,
          /cursor does not support structured secondary text generation/,
        );
      }
    }
  }),
);

it.effect("RoutingTextGeneration still delegates supported providers explicitly", () =>
  Effect.gen(function* () {
    const calls: Array<{ provider: string; method: keyof TextGenerationShape }> = [];
    const router = makeRoutingTextGenerationForProviders({
      codex: makeFakeTextGeneration("codex", calls),
      claude: makeFakeTextGeneration("claude", calls),
      gemini: makeFakeTextGeneration("gemini", calls),
    });

    const result = yield* router.generateThreadTitle({
      cwd: "/tmp/project",
      message: "Do work",
      modelSelection: { provider: "gemini", model: "gemini-2.5-pro" },
    });

    assert.deepEqual(result, { title: "gemini thread" });
    assert.deepEqual(calls, [{ provider: "gemini", method: "generateThreadTitle" }]);
  }),
);
