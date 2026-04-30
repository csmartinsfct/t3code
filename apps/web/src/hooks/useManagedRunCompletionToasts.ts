import {
  DEFAULT_RUNTIME_MODE,
  type ManagedRunStatus,
  type ManagedRunStreamEvent,
  type ManagedRunSummary,
  type ProjectId,
  type ProjectScript,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { newThreadId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { toastManager } from "~/components/ui/toast";

const TERMINAL_STATUSES: ReadonlySet<ManagedRunStatus> = new Set([
  "completed",
  "failed",
  "stopped",
  "lost",
]);

function isTerminalStatus(status: ManagedRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function isFailure(run: ManagedRunSummary): boolean {
  return (
    run.status === "failed" ||
    (run.status === "completed" && run.lastExitCode !== null && run.lastExitCode !== 0)
  );
}

function buildAskAiPrompt(params: {
  scriptName: string;
  scriptCommand: string;
  exitCode: number | null;
  exitSignal: number | null;
  logLines: string[];
}): string {
  const { scriptName, scriptCommand, exitCode, exitSignal, logLines } = params;

  const exitInfo =
    exitCode !== null
      ? `exit code ${exitCode}`
      : exitSignal !== null
        ? `signal ${exitSignal}`
        : "an unknown error";

  const lines = [
    `I just triggered the action "${scriptName}" and it failed with ${exitInfo}. Metadata can be found below.`,
    "",
    `Command: \`${scriptCommand}\``,
  ];

  if (exitCode !== null) {
    lines.push(`Exit code: ${exitCode}`);
  } else if (exitSignal !== null) {
    lines.push(`Signal: ${exitSignal}`);
  }

  if (logLines.length > 0) {
    lines.push("", `Output (last ${logLines.length} lines):`, "```", ...logLines, "```");
  }

  return lines.join("\n");
}

interface ManagedRunAskAiComposerDraftStore {
  setProjectDraftThreadId: (
    projectId: ProjectId,
    threadId: ThreadId,
    state: {
      createdAt: string;
      runtimeMode: typeof DEFAULT_RUNTIME_MODE;
    },
  ) => void;
  applyStickyState: (threadId: ThreadId) => void;
  setPrompt: (threadId: ThreadId, prompt: string) => void;
}

export async function startManagedRunAskAiThread(input: {
  projectId: ProjectId;
  prompt: string;
  composerDraftStore: ManagedRunAskAiComposerDraftStore;
  createThreadId?: () => ThreadId;
  now?: () => string;
  navigateToThread: (threadId: ThreadId) => Promise<void> | void;
}): Promise<ThreadId> {
  const threadId = (input.createThreadId ?? newThreadId)();
  const createdAt = (input.now ?? (() => new Date().toISOString()))();

  input.composerDraftStore.setProjectDraftThreadId(input.projectId, threadId, {
    createdAt,
    runtimeMode: DEFAULT_RUNTIME_MODE,
  });
  input.composerDraftStore.applyStickyState(threadId);
  input.composerDraftStore.setPrompt(threadId, input.prompt);
  await input.navigateToThread(threadId);
  return threadId;
}

export function useManagedRunCompletionToasts(options: {
  projectId: ProjectId | undefined;
  scripts: ReadonlyArray<ProjectScript> | undefined;
}): {
  handleRunEvent: (event: ManagedRunStreamEvent) => void;
} {
  const { projectId, scripts } = options;
  const notifiedRunIdsRef = useRef(new Set<string>());
  const navigate = useNavigate();

  // Clear the notified set when the project changes.
  useEffect(() => {
    notifiedRunIdsRef.current.clear();
  }, [projectId]);

  const scriptsRef = useRef(scripts);
  scriptsRef.current = scripts;

  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const handleRunEvent = useCallback(
    (event: ManagedRunStreamEvent) => {
      if (event.type === "snapshot") {
        // Seed the notified set with already-terminal runs to avoid stale toasts on mount/reconnect.
        for (const run of event.runs) {
          if (isTerminalStatus(run.status)) {
            notifiedRunIdsRef.current.add(run.runId);
          }
        }
        return;
      }
      if (event.type === "removed") {
        // The run was orphaned and cleaned up; drop it from our notified-set
        // bookkeeping so a future re-run with the same id (unlikely but
        // possible) is treated cleanly.
        notifiedRunIdsRef.current.delete(event.runId);
        return;
      }

      const { run } = event;
      if (!isTerminalStatus(run.status)) return;
      if (notifiedRunIdsRef.current.has(run.runId)) return;
      notifiedRunIdsRef.current.add(run.runId);

      const currentScripts = scriptsRef.current;
      const script = currentScripts?.find((s) => s.id === run.scriptId);
      const scriptName = script?.name ?? run.scriptId;

      if (isFailure(run)) {
        const exitDesc = run.lastExitCode !== null ? ` (exit code ${run.lastExitCode})` : "";
        const toastId = toastManager.add({
          type: "error",
          title: `"${scriptName}" failed${exitDesc}`,
          timeout: 0,
          actionProps: {
            children: "Ask AI",
            onClick: () => {
              void handleAskAi(run, script ?? null, toastId);
            },
          },
        });
        return;
      }

      if (run.status === "stopped") {
        toastManager.add({
          type: "info",
          title: `"${scriptName}" stopped`,
          data: { dismissAfterVisibleMs: 5_000 },
        });
        return;
      }

      if (run.status === "completed") {
        toastManager.add({
          type: "success",
          title: `"${scriptName}" completed`,
          data: { dismissAfterVisibleMs: 8_000 },
        });
        return;
      }

      if (run.status === "lost") {
        toastManager.add({
          type: "warning",
          title: `"${scriptName}" connection lost`,
          data: { dismissAfterVisibleMs: 8_000 },
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scriptsRef/projectIdRef are stable refs
    [],
  );

  async function handleAskAi(
    run: ManagedRunSummary,
    script: ProjectScript | null,
    toastId: ReturnType<typeof toastManager.add>,
  ): Promise<void> {
    const currentProjectId = projectIdRef.current;
    const api = readNativeApi();
    if (!api || !currentProjectId) return;

    const scriptName = script?.name ?? run.scriptId;
    const scriptCommand = script?.command ?? run.scriptId;

    // Fetch tail logs — continue without them if the fetch fails.
    let logLines: string[] = [];
    try {
      const logs = await api.managedRuns.getLogs({ runId: run.runId, tailLines: 50 });
      logLines = logs.map((l) => l.line);
    } catch {
      // Logs may have expired or the run may not have produced output.
    }

    const prompt = buildAskAiPrompt({
      scriptName,
      scriptCommand,
      exitCode: run.lastExitCode,
      exitSignal: run.lastExitSignal,
      logLines,
    });

    await startManagedRunAskAiThread({
      projectId: currentProjectId,
      prompt,
      composerDraftStore: useComposerDraftStore.getState(),
      navigateToThread: (threadId) => navigate({ to: "/$threadId", params: { threadId } }),
    });

    toastManager.close(toastId);
  }

  return { handleRunEvent };
}
