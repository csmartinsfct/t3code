import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type {
  ConsumeCodexRateLimitResetCreditOutcome,
  ConsumeCodexRateLimitResetCreditResult,
} from "@t3tools/contracts";
import { readCodexAccountSnapshot, type CodexAccountSnapshot } from "./codexAccount";

interface JsonRpcProbeResponse {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: {
    readonly message?: unknown;
  };
}

function readErrorMessage(response: JsonRpcProbeResponse): string | undefined {
  return typeof response.error?.message === "string" ? response.error.message : undefined;
}

export function buildCodexInitializeParams() {
  return {
    clientInfo: {
      name: "t3code_desktop",
      title: "T3 Code Desktop",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  } as const;
}

export function killCodexChildProcess(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals = "SIGTERM",
): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // Fall through to direct kill when taskkill is unavailable.
    }
  }

  child.kill(signal);
}

const CODEX_CHILD_TERMINATION_GRACE_MS = 1_000;

function hasCodexChildExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function signalCodexChildProcess(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  try {
    killCodexChildProcess(child, signal);
  } catch {
    // A later force-kill attempt or the final deadline still bounds cleanup.
  }
}

function ignoreCodexChildTerminationError(): void {
  // The force-kill timer/deadline still bounds cleanup if signaling fails.
}

async function terminateCodexChildProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.pid === undefined || hasCodexChildExited(child)) {
    return;
  }

  await new Promise<void>((resolve) => {
    let completed = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let forceKillDeadline: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (completed) return;
      completed = true;
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (forceKillDeadline) clearTimeout(forceKillDeadline);
      child.removeListener("exit", finish);
      child.removeListener("error", ignoreCodexChildTerminationError);
      resolve();
    };

    child.once("exit", finish);
    child.on("error", ignoreCodexChildTerminationError);
    if (hasCodexChildExited(child)) {
      finish();
      return;
    }

    forceKillTimer = setTimeout(() => {
      forceKillTimer = undefined;
      if (!hasCodexChildExited(child)) {
        signalCodexChildProcess(child, "SIGKILL");
      }
    }, CODEX_CHILD_TERMINATION_GRACE_MS);
    forceKillDeadline = setTimeout(finish, CODEX_CHILD_TERMINATION_GRACE_MS * 2);
    for (const timer of [forceKillTimer, forceKillDeadline]) {
      if (typeof timer === "object" && "unref" in timer) {
        timer.unref();
      }
    }
    signalCodexChildProcess(child, "SIGTERM");
  });
}

export async function requestCodexAppServer<TResponse = unknown>(input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly method: string;
  readonly params: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<TResponse> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.binaryPath, ["app-server"], {
      env: {
        ...process.env,
        ...(input.homePath ? { CODEX_HOME: input.homePath } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    // Diagnostics are not part of the JSON-RPC protocol; keep the pipe drained
    // so a noisy app-server cannot block while T3 waits for stdout.
    child.stderr.resume();
    const output = readline.createInterface({ input: child.stdout });

    let completed = false;
    const timeout = setTimeout(
      () => fail(new Error(`Timed out waiting for ${input.method}.`)),
      input.timeoutMs ?? 20_000,
    );
    if (typeof timeout === "object" && "unref" in timeout) {
      timeout.unref();
    }

    const cleanupRequestListeners = () => {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      output.removeListener("line", onLine);
      output.close();
      child.removeListener("error", fail);
      child.removeListener("exit", onExit);
    };

    const finish = (callback: () => void) => {
      if (completed) return;
      completed = true;
      cleanupRequestListeners();
      void terminateCodexChildProcess(child).then(callback);
    };

    function fail(error: unknown) {
      finish(() =>
        reject(
          error instanceof Error
            ? error
            : new Error(`Codex app-server request failed: ${String(error)}.`),
        ),
      );
    }

    function abort() {
      fail(new Error("Codex app-server request aborted."));
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      if (completed) return;
      fail(
        new Error(
          `codex app-server exited before request completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        ),
      );
    }

    if (input.signal?.aborted) {
      fail(new Error("Codex app-server request aborted."));
      return;
    }
    input.signal?.addEventListener("abort", abort);

    const writeMessage = (message: unknown) => {
      if (!child.stdin.writable) {
        fail(new Error("Cannot write to codex app-server stdin."));
        return;
      }

      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    function onLine(line: string) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        fail(new Error("Received invalid JSON from codex app-server."));
        return;
      }

      if (!parsed || typeof parsed !== "object") {
        return;
      }

      const response = parsed as JsonRpcProbeResponse;
      if (response.id === 1) {
        const errorMessage = readErrorMessage(response);
        if (errorMessage) {
          fail(new Error(`initialize failed: ${errorMessage}`));
          return;
        }

        writeMessage({ method: "initialized" });
        writeMessage({ id: 2, method: input.method, params: input.params });
        return;
      }

      if (response.id === 2) {
        const errorMessage = readErrorMessage(response);
        if (errorMessage) {
          fail(new Error(`${input.method} failed: ${errorMessage}`));
          return;
        }

        finish(() => resolve(response.result as TResponse));
      }
    }

    output.on("line", onLine);
    child.once("error", fail);
    child.once("exit", onExit);

    writeMessage({
      id: 1,
      method: "initialize",
      params: buildCodexInitializeParams(),
    });
  });
}

export async function probeCodexAccount(input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly signal?: AbortSignal;
}): Promise<CodexAccountSnapshot> {
  const response = await requestCodexAppServer({
    ...input,
    method: "account/read",
    params: {},
  });
  return readCodexAccountSnapshot(response);
}

function readConsumeOutcome(value: unknown): ConsumeCodexRateLimitResetCreditOutcome {
  const outcome =
    value && typeof value === "object" && "outcome" in value
      ? (value as { readonly outcome?: unknown }).outcome
      : undefined;
  if (
    outcome !== "reset" &&
    outcome !== "nothingToReset" &&
    outcome !== "noCredit" &&
    outcome !== "alreadyRedeemed"
  ) {
    throw new Error("account/rateLimitResetCredit/consume returned an invalid outcome.");
  }
  return outcome;
}

export interface ConsumeCodexRateLimitResetCreditAppServerResult extends ConsumeCodexRateLimitResetCreditResult {
  /** Full `account/rateLimits/read` response used to refresh the shared cache. */
  readonly rateLimits?: unknown;
  /** Non-fatal refresh error after the consume request already succeeded. */
  readonly refreshError?: string;
}

export async function consumeCodexRateLimitResetCreditWithAppServer(input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly idempotencyKey: string;
  readonly creditId?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<ConsumeCodexRateLimitResetCreditAppServerResult> {
  const consumeResponse = await requestCodexAppServer({
    binaryPath: input.binaryPath,
    ...(input.homePath ? { homePath: input.homePath } : {}),
    method: "account/rateLimitResetCredit/consume",
    params: {
      idempotencyKey: input.idempotencyKey,
      ...(input.creditId !== undefined ? { creditId: input.creditId } : {}),
    },
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
  const outcome = readConsumeOutcome(consumeResponse);

  try {
    const rateLimits = await requestCodexAppServer({
      binaryPath: input.binaryPath,
      ...(input.homePath ? { homePath: input.homePath } : {}),
      method: "account/rateLimits/read",
      params: null,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    });
    return { outcome, rateLimits };
  } catch (error) {
    return {
      outcome,
      refreshError: error instanceof Error ? error.message : String(error),
    };
  }
}
