import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";

export interface SettleClaudeMcpServersOptions {
  readonly readStatus: () => Promise<McpServerStatus[]>;
  readonly signal: AbortSignal;
  readonly deadlineMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortReason(signal);
  }
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function readWithDeadline(
  readStatus: () => Promise<McpServerStatus[]>,
  signal: AbortSignal,
  remainingMs: number,
): Promise<
  { readonly timedOut: true } | { readonly timedOut: false; readonly value: McpServerStatus[] }
> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => finish(() => resolve({ timedOut: true })), remainingMs);
    const onAbort = () => finish(() => reject(abortReason(signal)));

    function finish(complete: () => void): void {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      complete();
    }

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    Promise.resolve()
      .then(readStatus)
      .then(
        (value) => finish(() => resolve({ timedOut: false, value })),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    const onAbort = () => finish(abortReason(signal));

    function finish(error?: unknown): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (error !== undefined) {
        reject(error);
      } else {
        resolve();
      }
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function settleClaudeMcpServers(
  options: SettleClaudeMcpServersOptions,
): Promise<McpServerStatus[]> {
  const deadlineMs = options.deadlineMs ?? 8_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = now();
  const realDeadlineAt = Date.now() + deadlineMs;
  let latest: McpServerStatus[] = [];

  const remainingDeadlineMs = () =>
    Math.min(deadlineMs - (now() - startedAt), realDeadlineAt - Date.now());

  while (true) {
    throwIfAborted(options.signal);
    const remainingBeforeReadMs = remainingDeadlineMs();
    if (remainingBeforeReadMs <= 0) {
      return latest;
    }
    const read = await readWithDeadline(options.readStatus, options.signal, remainingBeforeReadMs);
    if (read.timedOut) {
      return latest;
    }
    latest = read.value;

    if (latest.length > 0 && latest.every((server) => server.status !== "pending")) {
      return latest;
    }

    const remainingMs = remainingDeadlineMs();
    if (remainingMs <= 0) {
      return latest;
    }

    await raceWithAbort(
      sleep(Math.min(pollIntervalMs, remainingMs), options.signal),
      options.signal,
    );
  }
}
