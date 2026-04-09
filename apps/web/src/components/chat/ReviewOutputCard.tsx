import type { ReviewCommentSeverity, ReviewOutput } from "@t3tools/contracts";
import { CheckCircle2Icon, LightbulbIcon, SparklesIcon } from "lucide-react";
import { cn } from "~/lib/utils";

interface ReviewOutputCardProps {
  output: ReviewOutput;
  heading?: string;
  className?: string;
}

function severityBadgeMeta(severity: ReviewCommentSeverity) {
  switch (severity) {
    case "critical":
      return {
        label: "Critical",
        className: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
      };
    case "suggestion":
      return {
        label: "Suggestion",
        className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
    case "nit":
      return {
        label: "Nit",
        className:
          "border-muted-foreground/20 bg-muted text-muted-foreground dark:text-muted-foreground",
      };
  }
}

function commentLocation(comment: ReviewOutput["comments"][number]): string {
  if (comment.file && comment.line) {
    return `${comment.file}:${comment.line}`;
  }
  if (comment.file) {
    return comment.file;
  }
  if (comment.line) {
    return `Line ${comment.line}`;
  }
  return "General";
}

export function ReviewOutputCard({ output, heading, className }: ReviewOutputCardProps) {
  return (
    <div className={cn("rounded-xl border border-border/70 bg-card/70 p-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
            <SparklesIcon className="size-3" />
            <span>{heading ?? "Automated review"}</span>
          </div>
          <p className="mt-1.5 text-sm leading-6 text-foreground/90">{output.summary}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em]",
            output.changesNeeded
              ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          )}
        >
          {output.changesNeeded ? "Changes needed" : "Approved"}
        </span>
      </div>

      {output.comments.length > 0 && (
        <div className="mt-3 space-y-2">
          {output.comments.map((comment) => {
            const badge = severityBadgeMeta(comment.severity);
            return (
              <div
                key={`${comment.file ?? "general"}:${comment.line ?? "line"}:${comment.severity}:${comment.body}`}
                className="rounded-lg border border-border/65 bg-background/70 p-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]",
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground/65">
                    {commentLocation(comment)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-foreground/85">{comment.body}</p>
              </div>
            );
          })}
        </div>
      )}

      {output.suggestions.length > 0 && (
        <div className="mt-3 rounded-lg border border-border/65 bg-background/60 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
            <LightbulbIcon className="size-3" />
            <span>Suggestions</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {output.suggestions.map((suggestion) => (
              <div key={suggestion} className="flex items-start gap-2 text-sm">
                <CheckCircle2Icon className="mt-0.5 size-3 text-emerald-500" />
                <span className="leading-6 text-foreground/80">{suggestion}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {output.comments.length === 0 && output.suggestions.length === 0 && (
        <div className="mt-3 rounded-lg border border-border/65 bg-background/60 px-2.5 py-2 text-sm text-muted-foreground/70">
          No detailed comments or follow-up suggestions were included.
        </div>
      )}
    </div>
  );
}

export default ReviewOutputCard;
