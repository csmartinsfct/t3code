import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Result } from "effect";
import { expect } from "vitest";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TextGeneration } from "../Services/TextGeneration.ts";
import { GeminiTextGenerationLive } from "./GeminiTextGeneration.ts";

const GeminiTextGenerationTestLayer = GeminiTextGenerationLive.pipe(
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "t3code-gemini-text-generation-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

function makeFakeGeminiBinary(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = path.join(dir, "bin");
    const geminiPath = path.join(binDir, "gemini");
    yield* fs.makeDirectory(binDir, { recursive: true });
    yield* fs.writeFileString(
      geminiPath,
      [
        "#!/bin/sh",
        'args="$*"',
        'printf "%s" "$args" | grep -F -- "--output-format json" >/dev/null || exit 2',
        'printf "%s" "$args" | grep -F -- "--approval-mode plan" >/dev/null || exit 3',
        'printf "%s" "$args" | grep -F -- "--model gemini-2.5-flash" >/dev/null || exit 4',
        'printf "%s" "$args" | grep -F -- "JSON Schema:" >/dev/null || exit 5',
        'printf "%s" "$T3_FAKE_GEMINI_OUTPUT"',
        "",
      ].join("\n"),
    );
    yield* fs.chmod(geminiPath, 0o755);
    return binDir;
  });
}

function withFakeGemini<A, E, R>(output: string, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-gemini-text-" });
      const binDir = yield* makeFakeGeminiBinary(tempDir);
      const previousPath = process.env.PATH;
      const previousOutput = process.env.T3_FAKE_GEMINI_OUTPUT;
      yield* Effect.sync(() => {
        process.env.PATH = `${binDir}:${previousPath ?? ""}`;
        process.env.T3_FAKE_GEMINI_OUTPUT = output;
      });
      return { previousPath, previousOutput };
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        process.env.PATH = previous.previousPath;
        if (previous.previousOutput === undefined) {
          delete process.env.T3_FAKE_GEMINI_OUTPUT;
        } else {
          process.env.T3_FAKE_GEMINI_OUTPUT = previous.previousOutput;
        }
      }),
  );
}

it.layer(GeminiTextGenerationTestLayer)("GeminiTextGenerationLive", (it) => {
  it.effect("generates validated structured thread titles with Gemini CLI JSON output", () =>
    withFakeGemini(
      JSON.stringify({
        response: JSON.stringify({ title: "Gemini Parity Work" }),
        stats: {},
      }),
      Effect.gen(function* () {
        const textGeneration = yield* TextGeneration;

        const generated = yield* textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "finish Gemini parity",
          modelSelection: { provider: "gemini", model: "gemini-2.5-flash" },
        });

        expect(generated.title).toBe("Gemini Parity Work");
      }),
    ),
  );

  it.effect("reports Gemini structured attachment limitations clearly", () =>
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration;

      const result = yield* textGeneration
        .generateThreadTitle({
          cwd: process.cwd(),
          message: "image",
          attachments: [
            {
              type: "image",
              id: "thread-gemini-structured-00000000-0000-4000-8000-000000000001",
              name: "sample.png",
              mimeType: "image/png",
              sizeBytes: 4,
            },
          ],
          modelSelection: { provider: "gemini", model: "gemini-2.5-flash" },
        })
        .pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.message).toContain("image attachment inputs");
      }
    }),
  );
});
