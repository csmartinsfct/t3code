import { formatTimelineLog } from "@t3tools/shared/timeline";

export function logWebTimeline(event: string, details?: Record<string, unknown>): void {
  if (import.meta.env.MODE === "test") {
    return;
  }
  console.info(formatTimelineLog("web", event, details));
}

export function warnWebTimeline(event: string, details?: Record<string, unknown>): void {
  if (import.meta.env.MODE === "test") {
    return;
  }
  console.warn(formatTimelineLog("web", event, details));
}
