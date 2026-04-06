import { Effect, Layer, Schema } from "effect";

import { baseProviderKind, ServiceHealthCheck } from "@t3tools/contracts";

import { runClaudeStructuredOutput, runCodexStructuredOutput } from "../../llm/structuredOutput.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  ManagedRunInference,
  type ManagedRunInferenceBuildInput,
  type ManagedRunInferenceInput,
  type ManagedRunInferenceResult,
} from "../Services/Inference.ts";

const RUN_INFERENCE_OPERATION = "inferManagedRunServices";
const MAX_EVIDENCE_LINES = 40;

const LlmServiceHealthCheck = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("url"),
    url: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("docker"),
    container: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("port"),
    port: Schema.Number,
    host: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("command"),
    command: Schema.String,
    cwd: Schema.NullOr(Schema.String),
  }),
]);

const ManagedRunInferenceOutput = Schema.Struct({
  summary: Schema.String,
  services: Schema.Array(
    Schema.Struct({
      declaredServiceName: Schema.NullOr(Schema.String),
      resolvedName: Schema.String,
      role: Schema.Literals([
        "frontend",
        "backend",
        "proxy",
        "worker",
        "database",
        "devtool",
        "unknown",
      ]),
      canonicalHealthCheck: Schema.NullOr(LlmServiceHealthCheck),
      alternatives: Schema.Array(Schema.String),
      confidence: Schema.Literals(["high", "medium", "low"]),
      evidenceLines: Schema.Array(Schema.String),
      rationale: Schema.String,
    }),
  ),
  notes: Schema.Array(Schema.String),
});

function unique<T>(values: ReadonlyArray<T>): ReadonlyArray<T> {
  return Array.from(new Set(values));
}

function extractUrls(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  const matches = lines.flatMap((line) => line.match(/https?:\/\/[^\s"'`)>]+/g) ?? []);
  return unique(matches);
}

function extractPorts(lines: ReadonlyArray<string>): ReadonlyArray<number> {
  const matches = lines.flatMap((line) =>
    Array.from(
      line.matchAll(
        /(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0):|port(?:\s+is|\s*=|\s+)?)(\d{2,5})/gi,
      ),
      (match) => Number(match[1]),
    ),
  );
  return unique(matches.filter((port) => Number.isInteger(port) && port > 0 && port <= 65_535));
}

function buildPrompt(input: ManagedRunInferenceInput): string {
  return [
    "You inspect managed run evidence and identify the actual runtime services for that run.",
    "Return strict JSON only.",
    "Infer runtime services from the evidence, but do not invent endpoints that are absent from the evidence.",
    "Prefer exact URLs and ports from the logs and declared services.",
    "Map likely service roles when possible.",
    "",
    "Run context:",
    JSON.stringify(
      {
        runId: input.runId,
        cwd: input.cwd,
        command: input.command,
        detectedUrl: input.detectedUrl,
        detectedPort: input.detectedPort,
        declaredServices: input.declaredServices,
        candidateUrls: input.candidateUrls,
        candidatePorts: input.candidatePorts,
      },
      null,
      2,
    ),
    "",
    "Evidence excerpt:",
    input.evidenceExcerpt.length > 0 ? input.evidenceExcerpt.join("\n") : "(no logs captured)",
  ].join("\n");
}

function normalizeHealthCheck(
  healthCheck: typeof LlmServiceHealthCheck.Type | null,
): typeof ServiceHealthCheck.Type | null {
  if (healthCheck === null) {
    return null;
  }

  try {
    return Schema.decodeUnknownSync(ServiceHealthCheck)(healthCheck);
  } catch {
    return null;
  }
}

function detectGroundingSources(
  healthCheck: typeof ServiceHealthCheck.Type,
  input: ManagedRunInferenceInput,
  declaredServiceName: string | null,
): ReadonlyArray<"log" | "declared" | "evidence"> {
  const sources = new Set<"log" | "declared" | "evidence">();

  const declaredService =
    declaredServiceName === null
      ? null
      : (input.declaredServices.find((service) => service.name === declaredServiceName) ?? null);

  switch (healthCheck.type) {
    case "url": {
      if (input.candidateUrls.includes(healthCheck.url)) {
        sources.add("log");
      }
      if (input.detectedUrl === healthCheck.url) {
        sources.add("evidence");
      }
      if (
        declaredService?.healthCheck.type === "url" &&
        declaredService.healthCheck.url === healthCheck.url
      ) {
        sources.add("declared");
      }
      if (input.evidenceExcerpt.some((line) => line.includes(healthCheck.url))) {
        sources.add("log");
      }
      break;
    }
    case "port": {
      if (input.candidatePorts.includes(healthCheck.port)) {
        sources.add("log");
      }
      if (input.detectedPort === healthCheck.port) {
        sources.add("evidence");
      }
      if (
        declaredService?.healthCheck.type === "port" &&
        declaredService.healthCheck.port === healthCheck.port
      ) {
        sources.add("declared");
      }
      if (
        input.evidenceExcerpt.some(
          (line) =>
            line.includes(`:${healthCheck.port}`) ||
            line.includes(` ${healthCheck.port}`) ||
            line.includes(`port ${healthCheck.port}`),
        )
      ) {
        sources.add("log");
      }
      break;
    }
    case "docker": {
      if (
        declaredService?.healthCheck.type === "docker" &&
        declaredService.healthCheck.container === healthCheck.container
      ) {
        sources.add("declared");
      }
      if (input.evidenceExcerpt.some((line) => line.includes(healthCheck.container))) {
        sources.add("log");
      }
      break;
    }
    case "command": {
      if (
        declaredService?.healthCheck.type === "command" &&
        declaredService.healthCheck.command === healthCheck.command
      ) {
        sources.add("declared");
      }
      if (input.evidenceExcerpt.some((line) => line.includes(healthCheck.command))) {
        sources.add("log");
      }
      break;
    }
  }

  return Array.from(sources);
}

const makeManagedRunInference = Effect.gen(function* () {
  const serverSettingsService = yield* ServerSettingsService;

  const buildInferenceInput = (input: ManagedRunInferenceBuildInput) =>
    Effect.sync(() => {
      const evidenceExcerpt = input.logs
        .map((entry) => entry.line.trimEnd())
        .filter((line) => line.length > 0)
        .slice(-MAX_EVIDENCE_LINES);

      return {
        ...input,
        candidateUrls: extractUrls(evidenceExcerpt),
        candidatePorts: extractPorts(evidenceExcerpt),
        evidenceExcerpt,
      } satisfies ManagedRunInferenceInput;
    });

  const inferRunServices = (input: ManagedRunInferenceInput) =>
    Effect.gen(function* () {
      const settings = yield* serverSettingsService.getSettings;
      const modelSelection = settings.managedRunInferenceModelSelection;
      const provider = baseProviderKind(modelSelection.provider);
      const prompt = buildPrompt(input);

      const rawPayload =
        provider === "claudeAgent"
          ? yield* runClaudeStructuredOutput({
              operation: RUN_INFERENCE_OPERATION,
              cwd: input.cwd,
              prompt,
              outputSchema: ManagedRunInferenceOutput,
              modelSelection: {
                provider: "claudeAgent",
                model: modelSelection.model,
                ...(modelSelection.options ? { options: modelSelection.options } : {}),
              },
              ...(settings.providers.claudeAgent.binaryPath
                ? { binaryPath: settings.providers.claudeAgent.binaryPath }
                : {}),
              ...(modelSelection.options &&
              "effort" in modelSelection.options &&
              typeof modelSelection.options.effort === "string"
                ? { effort: modelSelection.options.effort }
                : {}),
              ...(modelSelection.options &&
              "thinking" in modelSelection.options &&
              typeof modelSelection.options.thinking === "boolean"
                ? { thinking: modelSelection.options.thinking }
                : {}),
              ...(modelSelection.options && typeof modelSelection.options.fastMode === "boolean"
                ? { fastMode: modelSelection.options.fastMode }
                : {}),
            })
          : yield* runCodexStructuredOutput({
              operation: RUN_INFERENCE_OPERATION,
              cwd: input.cwd,
              prompt,
              outputSchema: ManagedRunInferenceOutput,
              modelSelection: {
                provider: "codex",
                model: modelSelection.model,
                ...(modelSelection.options ? { options: modelSelection.options } : {}),
              },
              ...(settings.providers.codex.binaryPath
                ? { binaryPath: settings.providers.codex.binaryPath }
                : {}),
              ...(settings.providers.codex.homePath
                ? { homePath: settings.providers.codex.homePath }
                : {}),
              reasoningEffort:
                modelSelection.options &&
                "reasoningEffort" in modelSelection.options &&
                typeof modelSelection.options.reasoningEffort === "string"
                  ? modelSelection.options.reasoningEffort
                  : "low",
              ...(modelSelection.options && typeof modelSelection.options.fastMode === "boolean"
                ? { fastMode: modelSelection.options.fastMode }
                : {}),
            });

      const groundingFailures: string[] = [];
      const runtimeServices = rawPayload.services.flatMap((service) => {
        const canonicalHealthCheck = normalizeHealthCheck(service.canonicalHealthCheck);

        if (canonicalHealthCheck === null) {
          if (service.canonicalHealthCheck !== null) {
            groundingFailures.push(
              `${service.resolvedName || service.declaredServiceName || "service"} proposed an invalid health check.`,
            );
          }
          return [];
        }

        const groundedBy = detectGroundingSources(
          canonicalHealthCheck,
          input,
          service.declaredServiceName?.trim() || null,
        );

        if (groundedBy.length === 0) {
          groundingFailures.push(
            `${service.resolvedName || service.declaredServiceName || "service"} proposed an ungrounded target.`,
          );
          return [];
        }

        const evidenceLines = service.evidenceLines.filter((line) =>
          input.evidenceExcerpt.includes(line),
        );

        return [
          {
            declaredServiceName: service.declaredServiceName?.trim() || null,
            resolvedName:
              service.resolvedName.trim() ||
              service.declaredServiceName?.trim() ||
              "Unknown service",
            role: service.role,
            canonicalHealthCheck,
            validationStatus: "unknown",
            inferenceConfidence: service.confidence,
            inferenceSource: "llm",
            groundedBy,
            evidenceLines,
            lastCheckedAt: null,
          } as const,
        ];
      });

      const status: ManagedRunInferenceResult["status"] =
        runtimeServices.length > 0
          ? "ready"
          : rawPayload.services.length > 0
            ? "ungrounded"
            : "failed";

      return {
        provider,
        model: modelSelection.model,
        status,
        rawPayload,
        normalizedPayload: {
          summary: rawPayload.summary,
          notes: rawPayload.notes,
          runtimeServices,
        },
        runtimeServices,
        inferenceError:
          status === "failed" ? "Managed run inference returned no canonical services." : null,
        groundingFailures,
        evidenceExcerpt: input.evidenceExcerpt,
      } satisfies ManagedRunInferenceResult;
    }).pipe(
      Effect.catch((cause) =>
        Effect.succeed({
          provider: "codex",
          model: "unknown",
          status: "failed" as const,
          rawPayload: { error: cause instanceof Error ? cause.message : String(cause) },
          normalizedPayload: {
            summary: "Managed run inference failed.",
            notes: [],
            runtimeServices: [],
          },
          runtimeServices: [],
          inferenceError: cause instanceof Error ? cause.message : String(cause),
          groundingFailures: [],
          evidenceExcerpt: input.evidenceExcerpt,
        } satisfies ManagedRunInferenceResult),
      ),
    );

  return {
    buildInferenceInput,
    inferRunServices,
  };
});

export const ManagedRunInferenceLive = Layer.effect(ManagedRunInference, makeManagedRunInference);
