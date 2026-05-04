// Pure decision helpers for the embedded-browser idle-suspend reaper. Lives
// outside main.ts so unit tests can exercise the rules without booting
// Electron. See T3CO-422.

export interface IdleReaperProjectFacts {
  readonly mounted: boolean;
  readonly suspended: boolean;
  readonly lastActivityAt: number;
}

export function shouldSuspendForIdle(opts: {
  readonly project: IdleReaperProjectFacts;
  readonly thresholdMs: number;
  readonly now: number;
}): boolean {
  if (opts.thresholdMs <= 0) return false;
  if (opts.project.mounted) return false;
  if (opts.project.suspended) return false;
  return opts.now - opts.project.lastActivityAt > opts.thresholdMs;
}
