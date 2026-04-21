const BROWSER_NAVIGATION_ABORT_CODE = "ERR_ABORTED";
const BROWSER_NAVIGATION_ABORT_ERRNO = -3;

export function isBrowserNavigationAbortError(cause: unknown): boolean {
  if (typeof cause === "string") return cause.includes(BROWSER_NAVIGATION_ABORT_CODE);

  if (cause instanceof Error && cause.message.includes(BROWSER_NAVIGATION_ABORT_CODE)) {
    return true;
  }

  if (typeof cause !== "object" || cause === null) return false;
  const record = cause as Record<PropertyKey, unknown>;
  if (
    typeof record.message === "string" &&
    record.message.includes(BROWSER_NAVIGATION_ABORT_CODE)
  ) {
    return true;
  }

  return (
    record.code === BROWSER_NAVIGATION_ABORT_CODE || record.errno === BROWSER_NAVIGATION_ABORT_ERRNO
  );
}
