import { memo } from "react";

interface WorkingIndicatorProps {
  createdAt: string | null;
  nowIso: string;
}

export const WorkingIndicator = memo(function WorkingIndicator({
  createdAt,
  nowIso,
}: WorkingIndicatorProps) {
  return (
    <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground/70">
      <span className="inline-flex items-center gap-[3px]">
        <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse" />
        <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:200ms]" />
        <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:400ms]" />
      </span>
      <span>
        {createdAt ? `Working for ${formatWorkingTimer(createdAt, nowIso) ?? "0s"}` : "Working..."}
      </span>
    </div>
  );
});

export function formatWorkingTimer(startIso: string, endIso: string): string | null {
  const startedAtMs = Date.parse(startIso);
  const endedAtMs = Date.parse(endIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
