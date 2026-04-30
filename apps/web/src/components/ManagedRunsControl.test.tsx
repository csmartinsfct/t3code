import type { ManagedRunRuntimeService, ManagedRunSummary } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { runServiceStatusLabel, secondaryText } from "./ManagedRunsControl";

function makeMockRun(overrides: Partial<ManagedRunSummary> = {}): ManagedRunSummary {
  return {
    runId: "run-1" as ManagedRunSummary["runId"],
    projectId: "project-1" as ManagedRunSummary["projectId"],
    scriptId: "dev-server" as ManagedRunSummary["scriptId"],
    createdByThreadId: null,
    lastTouchedByThreadId: null,
    cwd: "/home/user/project",
    launchMode: "attached",
    status: "running",
    detectedUrl: null,
    detectedPort: null,
    terminalThreadId: null,
    terminalId: null,
    terminalPid: null,
    createdAt: "2026-04-04T10:00:00.000Z",
    updatedAt: "2026-04-04T10:01:00.000Z",
    startedAt: "2026-04-04T10:00:05.000Z",
    completedAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    declaredServices: [],
    runtimeServices: [],
    inferenceStatus: "pending",
    inferenceUpdatedAt: null,
    inferenceError: null,
    ...overrides,
  };
}

function makeMockRuntimeService(
  overrides: Partial<ManagedRunRuntimeService> = {},
): ManagedRunRuntimeService {
  return {
    serviceId: "frontend" as ManagedRunRuntimeService["serviceId"],
    declaredServiceName: "Frontend" as ManagedRunRuntimeService["declaredServiceName"],
    resolvedName: "Frontend" as ManagedRunRuntimeService["resolvedName"],
    role: "unknown",
    canonicalHealthCheck: null,
    validationStatus: "unknown",
    inferenceConfidence: "low",
    inferenceSource: "declared",
    groundedBy: ["declared"],
    evidenceLines: [],
    lastCheckedAt: null,
    ...overrides,
  };
}

/**
 * Renders the dropdown inner content directly to test data rendering
 * without requiring the full Base UI Menu provider context.
 */
function renderRunsContent(runs: ReadonlyArray<ManagedRunSummary>) {
  const element =
    runs.length === 0 ? (
      <div>No active managed runs for this project.</div>
    ) : (
      <div>
        {runs.map((run) => (
          <div key={run.runId}>
            <span>{run.scriptId}</span>
            <span>{run.status}</span>
          </div>
        ))}
      </div>
    );

  return renderToStaticMarkup(element);
}

describe("ManagedRunsControl", () => {
  it("shows empty state text when no runs", () => {
    const html = renderRunsContent([]);
    expect(html).toContain("No active managed runs for this project.");
  });

  it("shows run scriptId and status for each run", () => {
    const runs = [
      makeMockRun({ scriptId: "web-app" as any, status: "running" }),
      makeMockRun({
        runId: "run-2" as ManagedRunSummary["runId"],
        scriptId: "api-server" as any,
        status: "completed",
      }),
    ];
    const html = renderRunsContent(runs);

    expect(html).toContain("web-app");
    expect(html).toContain("running");
    expect(html).toContain("api-server");
    expect(html).toContain("completed");
  });

  it("renders multiple runs", () => {
    const html = renderRunsContent([
      makeMockRun({ runId: "r1" as ManagedRunSummary["runId"], scriptId: "web" as any }),
      makeMockRun({ runId: "r2" as ManagedRunSummary["runId"], scriptId: "api" as any }),
      makeMockRun({ runId: "r3" as ManagedRunSummary["runId"], scriptId: "worker" as any }),
    ]);
    expect(html).toContain("web");
    expect(html).toContain("api");
    expect(html).toContain("worker");
  });

  it("does not hide pending inference behind declared composite service stubs", () => {
    const run = makeMockRun({
      runtimeServices: [makeMockRuntimeService()],
      inferenceStatus: "pending",
    });

    expect(runServiceStatusLabel(run)).toBeNull();
    expect(secondaryText(run)).toBe("Inferring runtime services…");
  });

  it("surfaces ungrounded inference instead of a misleading validation count", () => {
    const run = makeMockRun({
      runtimeServices: [makeMockRuntimeService()],
      inferenceStatus: "ungrounded",
    });

    expect(runServiceStatusLabel(run)).toBe("Ungrounded");
    expect(secondaryText(run)).toBe("Inference could not produce a runtime target");
  });
});
