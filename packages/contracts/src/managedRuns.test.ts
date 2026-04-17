import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ManagedRunDetail,
  ManagedRunEvidenceSource,
  ManagedRunEvidenceType,
  ManagedRunId,
  ManagedRunLaunchMode,
  ManagedRunLaunchProjectScriptInput,
  ManagedRunLogLine,
  ManagedRunLogStream,
  ManagedRunNotFoundError,
  ManagedRunOperationError,
  ManagedRunScriptLookupError,
  ManagedRunStatus,
  ManagedRunStreamEvent,
  ManagedRunSummary,
} from "./managedRuns";

function decodeSync<S extends Schema.Top>(schema: S, input: unknown): Schema.Schema.Type<S> {
  return Schema.decodeUnknownSync(schema as never)(input) as Schema.Schema.Type<S>;
}

function decodes<S extends Schema.Top>(schema: S, input: unknown): boolean {
  try {
    Schema.decodeUnknownSync(schema as never)(input);
    return true;
  } catch {
    return false;
  }
}

const now = new Date().toISOString();

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    projectId: "proj-1",
    scriptId: "dev",
    createdByThreadId: "thread-1",
    lastTouchedByThreadId: "thread-1",
    cwd: "/tmp/project",
    launchMode: "attached",
    status: "running",
    detectedUrl: null,
    detectedPort: null,
    terminalThreadId: "thread-1",
    terminalId: "term-1",
    terminalPid: 1234,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    declaredServices: [],
    runtimeServices: [],
    serviceStatuses: [],
    inferenceStatus: "pending",
    inferenceUpdatedAt: null,
    inferenceError: null,
    ...overrides,
  };
}

describe("ManagedRunId", () => {
  it("accepts trimmed non-empty strings", () => {
    expect(decodes(ManagedRunId, "run-123")).toBe(true);
  });

  it("rejects empty strings", () => {
    expect(decodes(ManagedRunId, "")).toBe(false);
  });

  it("rejects whitespace-only strings", () => {
    expect(decodes(ManagedRunId, "   ")).toBe(false);
  });
});

describe("ManagedRunStatus", () => {
  for (const status of ["starting", "running", "completed", "failed", "stopped", "lost"]) {
    it(`accepts "${status}"`, () => {
      expect(decodes(ManagedRunStatus, status)).toBe(true);
    });
  }

  it("rejects invalid status", () => {
    expect(decodes(ManagedRunStatus, "unknown")).toBe(false);
  });
});

describe("ManagedRunLaunchMode", () => {
  it('accepts "attached"', () => {
    expect(decodes(ManagedRunLaunchMode, "attached")).toBe(true);
  });

  it("rejects other values", () => {
    expect(decodes(ManagedRunLaunchMode, "detached")).toBe(false);
  });
});

describe("ManagedRunLogStream", () => {
  for (const stream of ["pty", "stdout", "stderr"]) {
    it(`accepts "${stream}"`, () => {
      expect(decodes(ManagedRunLogStream, stream)).toBe(true);
    });
  }

  it("rejects invalid stream", () => {
    expect(decodes(ManagedRunLogStream, "stdin")).toBe(false);
  });
});

describe("ManagedRunEvidenceType", () => {
  for (const type of ["process", "url", "docker"]) {
    it(`accepts "${type}"`, () => {
      expect(decodes(ManagedRunEvidenceType, type)).toBe(true);
    });
  }

  it("rejects invalid type", () => {
    expect(decodes(ManagedRunEvidenceType, "k8s")).toBe(false);
  });
});

describe("ManagedRunEvidenceSource", () => {
  for (const source of ["declared", "inferred"]) {
    it(`accepts "${source}"`, () => {
      expect(decodes(ManagedRunEvidenceSource, source)).toBe(true);
    });
  }

  it("rejects invalid source", () => {
    expect(decodes(ManagedRunEvidenceSource, "guessed")).toBe(false);
  });
});

describe("ManagedRunSummary", () => {
  it("decodes a valid full summary", () => {
    const result = decodeSync(ManagedRunSummary, makeSummary());
    expect(result.runId).toBe("run-1");
    expect(result.status).toBe("running");
    expect(result.launchMode).toBe("attached");
  });

  it("accepts null for nullable fields", () => {
    expect(
      decodes(
        ManagedRunSummary,
        makeSummary({
          createdByThreadId: null,
          lastTouchedByThreadId: null,
          detectedUrl: null,
          detectedPort: null,
          terminalThreadId: null,
          terminalId: null,
          terminalPid: null,
          completedAt: null,
          lastExitCode: null,
          lastExitSignal: null,
          serviceStatuses: [],
        }),
      ),
    ).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(decodes(ManagedRunSummary, { runId: "run-1" })).toBe(false);
  });
});

describe("ManagedRunDetail", () => {
  it("decodes with empty evidence array", () => {
    const result = decodeSync(ManagedRunDetail, {
      ...makeSummary(),
      lastError: null,
      logsExpireAt: null,
      evidence: [],
      latestInference: null,
    });
    expect(result.evidence).toEqual([]);
  });

  it("decodes with process evidence", () => {
    const result = decodeSync(ManagedRunDetail, {
      ...makeSummary(),
      lastError: null,
      logsExpireAt: null,
      latestInference: null,
      evidence: [
        {
          type: "process",
          source: "declared",
          createdAt: now,
          value: {
            pid: 5678,
            command: "node server.js",
            cwd: "/tmp/project",
          },
        },
      ],
    });
    expect(result.evidence).toHaveLength(1);
  });

  it("decodes with url evidence", () => {
    expect(
      decodes(ManagedRunDetail, {
        ...makeSummary(),
        lastError: null,
        logsExpireAt: null,
        latestInference: null,
        evidence: [
          {
            type: "url",
            source: "inferred",
            createdAt: now,
            value: {
              url: "http://localhost:3000",
              port: 3000,
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it("decodes with docker evidence", () => {
    expect(
      decodes(ManagedRunDetail, {
        ...makeSummary(),
        lastError: null,
        logsExpireAt: null,
        latestInference: null,
        evidence: [
          {
            type: "docker",
            source: "declared",
            createdAt: now,
            value: {
              project: "my-app",
            },
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("ManagedRunLogLine", () => {
  it("validates timestamp, stream, and line", () => {
    const result = decodeSync(ManagedRunLogLine, {
      timestamp: now,
      stream: "stdout",
      line: "Server started on port 3000",
    });
    expect(result.timestamp).toBe(now);
    expect(result.stream).toBe("stdout");
    expect(result.line).toBe("Server started on port 3000");
  });

  it("accepts empty line content", () => {
    expect(decodes(ManagedRunLogLine, { timestamp: now, stream: "pty", line: "" })).toBe(true);
  });

  it("rejects invalid stream value", () => {
    expect(decodes(ManagedRunLogLine, { timestamp: now, stream: "stdin", line: "" })).toBe(false);
  });
});

describe("ManagedRunLaunchProjectScriptInput", () => {
  it("validates required fields", () => {
    const result = decodeSync(ManagedRunLaunchProjectScriptInput, {
      projectId: "proj-1",
      threadId: "thread-1",
      scriptId: "dev",
    });
    expect(result.projectId).toBe("proj-1");
    expect(result.threadId).toBe("thread-1");
    expect(result.scriptId).toBe("dev");
  });

  it("accepts optional cwd and worktreePath", () => {
    expect(
      decodes(ManagedRunLaunchProjectScriptInput, {
        projectId: "proj-1",
        threadId: "thread-1",
        scriptId: "dev",
        cwd: "/tmp/project",
        worktreePath: "/tmp/worktree",
      }),
    ).toBe(true);
  });

  it("accepts optional env record", () => {
    const result = decodeSync(ManagedRunLaunchProjectScriptInput, {
      projectId: "proj-1",
      threadId: "thread-1",
      scriptId: "dev",
      env: { NODE_ENV: "development", PORT: "3000" },
    });
    expect(result.env).toMatchObject({ NODE_ENV: "development", PORT: "3000" });
  });

  it("rejects missing required scriptId", () => {
    expect(
      decodes(ManagedRunLaunchProjectScriptInput, {
        projectId: "proj-1",
        threadId: "thread-1",
      }),
    ).toBe(false);
  });

  it("rejects invalid env keys", () => {
    expect(
      decodes(ManagedRunLaunchProjectScriptInput, {
        projectId: "proj-1",
        threadId: "thread-1",
        scriptId: "dev",
        env: { "bad-key!": "value" },
      }),
    ).toBe(false);
  });
});

describe("ManagedRunStreamEvent", () => {
  it('validates "snapshot" variant', () => {
    const result = decodeSync(ManagedRunStreamEvent, {
      type: "snapshot",
      projectId: "proj-1",
      runs: [makeSummary()],
    });
    expect(result.type).toBe("snapshot");
    if (result.type === "snapshot") {
      expect(result.runs).toHaveLength(1);
    }
  });

  it('validates "upserted" variant', () => {
    const result = decodeSync(ManagedRunStreamEvent, {
      type: "upserted",
      projectId: "proj-1",
      run: makeSummary(),
    });
    expect(result.type).toBe("upserted");
  });

  it("rejects unknown event type", () => {
    expect(
      decodes(ManagedRunStreamEvent, {
        type: "deleted",
        projectId: "proj-1",
      }),
    ).toBe(false);
  });
});

describe("Error classes", () => {
  it("ManagedRunNotFoundError can be constructed", () => {
    const error = new ManagedRunNotFoundError({ runId: "run-404" as ManagedRunId });
    expect(error.runId).toBe("run-404");
    expect(error.message).toContain("run-404");
    expect(error._tag).toBe("ManagedRunNotFoundError");
  });

  it("ManagedRunScriptLookupError can be constructed", () => {
    const error = new ManagedRunScriptLookupError({
      projectId: "proj-1" as any,
      scriptId: "missing-script" as any,
    });
    expect(error.scriptId).toBe("missing-script");
    expect(error.message).toContain("missing-script");
    expect(error._tag).toBe("ManagedRunScriptLookupError");
  });

  it("ManagedRunOperationError can be constructed", () => {
    const error = new ManagedRunOperationError({
      operation: "stop" as any,
      message: "Process not found" as any,
    });
    expect(error.operation).toBe("stop");
    expect(error._tag).toBe("ManagedRunOperationError");
  });
});
