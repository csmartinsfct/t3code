import type { ManagedRunId, ManagedRunLogLine, ManagedRunLogStream } from "@t3tools/contracts";
import type { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

import { readNativeApi } from "~/nativeApi";

const HISTORICAL_TAIL_LINES = 1000;
/**
 * Hard cap on the buffer of live lines accumulated while the historical fetch
 * is in flight. If the fetch hangs and a chatty service keeps producing
 * output we silently drop the oldest entries to keep memory bounded.
 */
const PENDING_LIVE_LINES_CAP = 50_000;

interface UseManagedRunLogsOptions {
  readonly runId: string;
  /**
   * `null` ⇒ subscribe to the merged stream for the run; each rendered line
   * is prefixed with `[<service-name>]` in a stable color so the user can
   * tell services apart in the unified "All" tab. A specific serviceId
   * ⇒ subscribe only to that service and render lines verbatim.
   */
  readonly serviceId: string | null;
  readonly terminal: Terminal | null;
  readonly enabled: boolean;
  /**
   * For the merged view: resolves a `serviceId` to a human-readable display
   * label and a deterministic palette index. The hook does not introspect
   * the run summary itself — callers (the drawer) own that lookup.
   */
  readonly resolveService?: (serviceId: string) => { label: string; paletteIndex: number };
}

const ANSI_RESET = "[0m";
const ANSI_DIM = "[2m";
const ANSI_RED = "[31m";
const ANSI_YELLOW = "[33m";

/**
 * Six visually distinct ANSI 256-color foreground codes used to tag merged-view
 * lines by service. Indices are stable per `serviceId` (hash-mod-N).
 */
const SERVICE_PALETTE = [
  "[38;5;81m", // cyan
  "[38;5;156m", // green
  "[38;5;213m", // magenta
  "[38;5;221m", // amber
  "[38;5;111m", // blue
  "[38;5;209m", // orange
];

function paletteColorFor(index: number): string {
  return SERVICE_PALETTE[
    ((index % SERVICE_PALETTE.length) + SERVICE_PALETTE.length) % SERVICE_PALETTE.length
  ]!;
}

interface FormatContext {
  readonly mergedView: boolean;
  readonly resolveService: ((serviceId: string) => { label: string; paletteIndex: number }) | null;
}

function truncatePrefix(label: string): string {
  if (label.length <= 14) return label;
  return `${label.slice(0, 13)}…`;
}

function formatLineForTerminal(line: ManagedRunLogLine, ctx: FormatContext): string {
  const stderrPrefix = line.stream === "stderr" ? ANSI_RED : "";
  const stderrSuffix = line.stream === "stderr" ? ANSI_RESET : "";
  if (!ctx.mergedView || line.serviceId === null || ctx.resolveService === null) {
    return `${stderrPrefix}${line.line}${stderrSuffix}\r\n`;
  }
  const resolved = ctx.resolveService(line.serviceId);
  const color = paletteColorFor(resolved.paletteIndex);
  const label = truncatePrefix(resolved.label);
  return `${color}[${label}]${ANSI_RESET}${ANSI_DIM} ${ANSI_RESET}${stderrPrefix}${line.line}${stderrSuffix}\r\n`;
}

function streamWeight(stream: ManagedRunLogStream): number {
  if (stream === "stderr") return 1;
  if (stream === "stdout") return 2;
  return 0;
}

function compareLines(a: ManagedRunLogLine, b: ManagedRunLogLine): number {
  if (a.timestamp !== b.timestamp) {
    return a.timestamp < b.timestamp ? -1 : 1;
  }
  return streamWeight(a.stream) - streamWeight(b.stream);
}

/**
 * Loads historical NDJSON logs for a managed run into the provided xterm
 * instance, then subscribes to live log-line events and appends them as they
 * arrive. Caller owns the Terminal lifecycle; this hook only writes into it.
 *
 * `serviceId === null` produces a merged view (all services interleaved) with
 * per-service ANSI prefixes. A specific serviceId produces a per-service view.
 */
export function useManagedRunLogs({
  runId,
  serviceId,
  terminal,
  enabled,
  resolveService,
}: UseManagedRunLogsOptions): void {
  const resolveServiceRef = useRef(resolveService ?? null);
  resolveServiceRef.current = resolveService ?? null;

  useEffect(() => {
    if (!enabled || !terminal) return;

    const api = readNativeApi();
    if (!api) return;

    const mergedView = serviceId === null;
    const ctx: FormatContext = {
      mergedView,
      resolveService: mergedView ? (id) => (resolveServiceRef.current ?? defaultResolve)(id) : null,
    };

    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    // Holds live lines that arrived before the historical fetch resolved, so
    // we can interleave them in correct order without dropping anything.
    const pendingLiveLines: ManagedRunLogLine[] = [];
    let historicalLoaded = false;
    let lastTimestamp: string | null = null;

    const writeLine = (line: ManagedRunLogLine) => {
      if (disposed) return;
      lastTimestamp = line.timestamp;
      terminal.write(formatLineForTerminal(line, ctx));
    };

    const writeChunk = (lines: ReadonlyArray<ManagedRunLogLine>) => {
      if (disposed || lines.length === 0) return;
      let chunk = "";
      for (const line of lines) {
        chunk += formatLineForTerminal(line, ctx);
        lastTimestamp = line.timestamp;
      }
      terminal.write(chunk);
    };

    unsubscribe = api.managedRuns.subscribeLogs(
      serviceId !== null ? { runId, serviceId } : { runId },
      (event) => {
        if (disposed) return;
        if (!historicalLoaded) {
          pendingLiveLines.push(event.line);
          if (pendingLiveLines.length > PENDING_LIVE_LINES_CAP) {
            pendingLiveLines.splice(0, pendingLiveLines.length - PENDING_LIVE_LINES_CAP);
          }
          return;
        }
        // Drop duplicates that may have arrived in the historical tail.
        if (lastTimestamp !== null && event.line.timestamp <= lastTimestamp) {
          return;
        }
        writeLine(event.line);
      },
    );

    void (async () => {
      try {
        const historical = await api.managedRuns.getLogs({
          runId: runId as ManagedRunId,
          tailLines: HISTORICAL_TAIL_LINES,
          ...(serviceId !== null ? { serviceId } : {}),
        });
        if (disposed) return;
        writeChunk(historical);
        // Splice in any live lines that arrived during the fetch, dropping
        // duplicates by timestamp.
        if (pendingLiveLines.length > 0) {
          const cutoff = historical.at(-1)?.timestamp ?? null;
          const fresh = cutoff
            ? pendingLiveLines.filter((line) => line.timestamp > cutoff)
            : pendingLiveLines;
          fresh.sort(compareLines);
          writeChunk(fresh);
          pendingLiveLines.length = 0;
        }
        historicalLoaded = true;
      } catch {
        if (disposed) return;
        historicalLoaded = true;
        terminal.write(
          `\r\n${ANSI_YELLOW}[run-logs] Could not load historical logs; tailing live output only.${ANSI_RESET}\r\n`,
        );
        if (pendingLiveLines.length > 0) {
          pendingLiveLines.sort(compareLines);
          writeChunk(pendingLiveLines);
          pendingLiveLines.length = 0;
        }
      }
    })();

    return () => {
      disposed = true;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };
  }, [enabled, runId, serviceId, terminal]);
}

const defaultResolve = (serviceId: string) => ({
  label: serviceId,
  paletteIndex: stringHash(serviceId),
});

function stringHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return hash;
}
