import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";

import { Effect, Schema } from "effect";

import type { ClaudeModelSelection, CodexModelSelection } from "@t3tools/contracts";
import { resolveApiModelId } from "@t3tools/shared/model";

import { toJsonSchemaObject } from "../git/Utils.ts";
import { runProcess } from "../processRunner.ts";

const CODEX_TIMEOUT_MS = 180_000;
const CLAUDE_TIMEOUT_MS = 180_000;
const CODEX_AUTH_FILE_NAME = "auth.json";

export class StructuredOutputRunnerError extends Error {
  override readonly cause?: unknown;

  constructor(
    readonly operation: string,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(detail);
    this.name = "StructuredOutputRunnerError";
    this.cause = options?.cause;
  }
}

async function writeTempFile(prefix: string, content: string): Promise<string> {
  const directory = await fs.mkdtemp(nodePath.join(nodeOs.tmpdir(), `t3code-${prefix}-`));
  const filePath = nodePath.join(directory, `${randomUUID()}.json`);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function removeTempFile(filePath: string): Promise<void> {
  await fs.rm(nodePath.dirname(filePath), { recursive: true, force: true });
}

function resolveCodexHomePath(homePath?: string): string {
  return homePath || process.env.CODEX_HOME || nodePath.join(nodeOs.homedir(), ".codex");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createIsolatedCodexHome(homePath?: string): Promise<string> {
  const isolatedHomePath = await fs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "t3code-codex-home-"));
  const authPath = nodePath.join(resolveCodexHomePath(homePath), CODEX_AUTH_FILE_NAME);
  if (await pathExists(authPath)) {
    await fs.copyFile(authPath, nodePath.join(isolatedHomePath, CODEX_AUTH_FILE_NAME));
  }
  return isolatedHomePath;
}

export function runCodexStructuredOutput<S extends Schema.Top>(input: {
  operation: string;
  cwd: string;
  prompt: string;
  outputSchema: S;
  modelSelection: CodexModelSelection;
  binaryPath?: string;
  homePath?: string;
  imagePaths?: ReadonlyArray<string>;
  reasoningEffort: string;
  fastMode?: boolean;
}): Effect.Effect<S["Type"], StructuredOutputRunnerError, S["DecodingServices"]> {
  return Effect.tryPromise({
    try: async () => {
      const schemaPath = await writeTempFile(
        "codex-schema",
        JSON.stringify(toJsonSchemaObject(input.outputSchema)),
      );
      const outputPath = await writeTempFile("codex-output", "");
      const codexHomePath = await createIsolatedCodexHome(input.homePath);

      try {
        const result = await runProcess(
          input.binaryPath || "codex",
          [
            "exec",
            "--ephemeral",
            "--skip-git-repo-check",
            "-s",
            "read-only",
            "--model",
            input.modelSelection.model,
            "--config",
            `model_reasoning_effort="${input.reasoningEffort}"`,
            ...(input.fastMode ? ["--config", `service_tier="fast"`] : []),
            "--output-schema",
            schemaPath,
            "--output-last-message",
            outputPath,
            ...(input.imagePaths ?? []).flatMap((imagePath) => ["--image", imagePath]),
            "-",
          ],
          {
            cwd: input.cwd,
            timeoutMs: CODEX_TIMEOUT_MS,
            stdin: input.prompt,
            env: {
              ...process.env,
              CODEX_HOME: codexHomePath,
            },
            allowNonZeroExit: true,
            outputMode: "truncate",
          },
        );

        if (result.code !== 0) {
          const detail = result.stderr.trim() || result.stdout.trim();
          throw new StructuredOutputRunnerError(
            input.operation,
            detail.length > 0
              ? `Codex CLI command failed: ${detail}`
              : `Codex CLI command failed with code ${result.code}.`,
          );
        }

        const rawOutput = await fs.readFile(outputPath, "utf8");
        try {
          return Schema.decodeUnknownSync(Schema.fromJsonString(input.outputSchema) as never)(
            rawOutput,
          ) as S["Type"];
        } catch (cause) {
          throw new StructuredOutputRunnerError(
            input.operation,
            "Codex returned invalid structured output.",
            { cause },
          );
        }
      } finally {
        await Promise.all([
          removeTempFile(schemaPath),
          removeTempFile(outputPath),
          fs.rm(codexHomePath, { recursive: true, force: true }),
        ]);
      }
    },
    catch: (cause) =>
      cause instanceof StructuredOutputRunnerError
        ? cause
        : new StructuredOutputRunnerError(
            input.operation,
            cause instanceof Error ? cause.message : "Codex structured output failed.",
            { cause },
          ),
  });
}

const ClaudeOutputEnvelope = Schema.Struct({
  structured_output: Schema.Unknown,
});

export function runClaudeStructuredOutput<S extends Schema.Top>(input: {
  operation: string;
  cwd: string;
  prompt: string;
  outputSchema: S;
  modelSelection: ClaudeModelSelection;
  binaryPath?: string;
  effort?: string;
  thinking?: boolean;
  fastMode?: boolean;
}): Effect.Effect<S["Type"], StructuredOutputRunnerError, S["DecodingServices"]> {
  return Effect.tryPromise({
    try: async () => {
      const settings = {
        ...(typeof input.thinking === "boolean" ? { alwaysThinkingEnabled: input.thinking } : {}),
        ...(input.fastMode ? { fastMode: true } : {}),
      };

      const result = await runProcess(
        input.binaryPath || "claude",
        [
          "-p",
          "--output-format",
          "json",
          "--json-schema",
          JSON.stringify(toJsonSchemaObject(input.outputSchema)),
          "--model",
          resolveApiModelId(input.modelSelection),
          ...(input.effort ? ["--effort", input.effort] : []),
          ...(Object.keys(settings).length > 0 ? ["--settings", JSON.stringify(settings)] : []),
          "--dangerously-skip-permissions",
        ],
        {
          cwd: input.cwd,
          timeoutMs: CLAUDE_TIMEOUT_MS,
          stdin: input.prompt,
          allowNonZeroExit: true,
          outputMode: "truncate",
        },
      );

      if (result.code !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim();
        throw new StructuredOutputRunnerError(
          input.operation,
          detail.length > 0
            ? `Claude CLI command failed: ${detail}`
            : `Claude CLI command failed with code ${result.code}.`,
        );
      }

      let envelope: typeof ClaudeOutputEnvelope.Type;
      try {
        envelope = Schema.decodeUnknownSync(Schema.fromJsonString(ClaudeOutputEnvelope))(
          result.stdout,
        );
      } catch (cause) {
        throw new StructuredOutputRunnerError(
          input.operation,
          "Claude CLI returned unexpected output format.",
          { cause },
        );
      }

      try {
        return Schema.decodeUnknownSync(input.outputSchema as never)(
          envelope.structured_output,
        ) as S["Type"];
      } catch (cause) {
        throw new StructuredOutputRunnerError(
          input.operation,
          "Claude returned invalid structured output.",
          { cause },
        );
      }
    },
    catch: (cause) =>
      cause instanceof StructuredOutputRunnerError
        ? cause
        : new StructuredOutputRunnerError(
            input.operation,
            cause instanceof Error ? cause.message : "Claude structured output failed.",
            { cause },
          ),
  });
}
