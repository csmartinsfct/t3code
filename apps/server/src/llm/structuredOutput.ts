import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";

import { Effect, Schema } from "effect";

import type {
  ClaudeModelSelection,
  CodexModelSelection,
  GeminiModelSelection,
} from "@t3tools/contracts";
import { resolveApiModelId } from "@t3tools/shared/model";

import { toJsonSchemaObject } from "../git/Utils.ts";
import { runProcess } from "../processRunner.ts";

const CODEX_TIMEOUT_MS = 180_000;
const CLAUDE_TIMEOUT_MS = 180_000;
const GEMINI_TIMEOUT_MS = 180_000;
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

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to balanced-object extraction below.
  }

  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const start =
    objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart);
  if (start < 0) {
    throw new Error("No JSON object or array found.");
  }
  const opening = trimmed[start]!;
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === opening) {
      depth++;
    } else if (char === closing) {
      depth--;
      if (depth === 0) {
        return JSON.parse(trimmed.slice(start, i + 1));
      }
    }
  }
  throw new Error("Unterminated JSON object or array.");
}

function responseTextFromGeminiOutput(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (isRecord(parsed)) {
      for (const key of ["response", "text", "content", "message"]) {
        const value = parsed[key];
        if (typeof value === "string") {
          return value;
        }
      }
    }
  } catch {
    // Text output or raw JSON from the model; return as-is.
  }
  return stdout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function runGeminiStructuredOutput<S extends Schema.Top>(input: {
  operation: string;
  cwd: string;
  prompt: string;
  outputSchema: S;
  modelSelection: GeminiModelSelection;
  binaryPath?: string;
  homePath?: string;
}): Effect.Effect<S["Type"], StructuredOutputRunnerError, S["DecodingServices"]> {
  return Effect.tryPromise({
    try: async () => {
      const schemaJson = JSON.stringify(toJsonSchemaObject(input.outputSchema), null, 2);
      const prompt = `${input.prompt}

Return only a single JSON object that validates this JSON Schema. Do not include markdown, commentary, or code fences.

JSON Schema:
${schemaJson}`;

      const result = await runProcess(
        input.binaryPath || "gemini",
        [
          "--prompt",
          prompt,
          "--output-format",
          "json",
          "--model",
          input.modelSelection.model,
          "--approval-mode",
          "plan",
        ],
        {
          cwd: input.cwd,
          timeoutMs: GEMINI_TIMEOUT_MS,
          env: {
            ...process.env,
            ...(input.homePath ? { GEMINI_CLI_HOME: input.homePath } : {}),
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
            ? `Gemini CLI command failed: ${detail}`
            : `Gemini CLI command failed with code ${result.code}.`,
        );
      }

      const responseText = responseTextFromGeminiOutput(result.stdout);
      let rawStructuredOutput: unknown;
      try {
        rawStructuredOutput = parseJsonFromText(responseText);
      } catch (cause) {
        throw new StructuredOutputRunnerError(
          input.operation,
          "Gemini CLI returned output that did not contain valid JSON.",
          { cause },
        );
      }

      try {
        return Schema.decodeUnknownSync(input.outputSchema as never)(
          rawStructuredOutput,
        ) as S["Type"];
      } catch (cause) {
        throw new StructuredOutputRunnerError(
          input.operation,
          "Gemini returned invalid structured output.",
          { cause },
        );
      }
    },
    catch: (cause) =>
      cause instanceof StructuredOutputRunnerError
        ? cause
        : new StructuredOutputRunnerError(
            input.operation,
            cause instanceof Error ? cause.message : "Gemini structured output failed.",
            { cause },
          ),
  });
}
