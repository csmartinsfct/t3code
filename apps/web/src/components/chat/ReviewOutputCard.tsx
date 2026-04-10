import type { ReviewCommentSeverity, ReviewOutput } from "@t3tools/contracts";
import { SparklesIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Badge, type badgeVariants } from "../ui/badge";
import type { VariantProps } from "class-variance-authority";

interface ReviewOutputCardProps {
  output: ReviewOutput;
  heading?: string;
  className?: string;
}

function severityBadgeVariant(severity: ReviewCommentSeverity): {
  label: string;
  variant: VariantProps<typeof badgeVariants>["variant"];
} {
  switch (severity) {
    case "critical":
      return { label: "Critical", variant: "error" };
    case "suggestion":
      return { label: "Suggestion", variant: "warning" };
    case "nit":
      return { label: "Nit", variant: "outline" };
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
        <Badge variant={output.changesNeeded ? "warning" : "success"} size="sm">
          {output.changesNeeded ? "Changes needed" : "Approved"}
        </Badge>
      </div>

      {output.comments.length > 0 && (
        <div className="mt-3 space-y-2">
          {output.comments.map((comment) => {
            const badge = severityBadgeVariant(comment.severity);
            return (
              <div
                key={`${comment.file ?? "general"}:${comment.line ?? "line"}:${comment.severity}:${comment.body}`}
                className="rounded-lg border border-border/65 bg-background/70 p-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={badge.variant} size="sm">
                    {badge.label}
                  </Badge>
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

      {output.comments.length === 0 && (
        <div className="mt-3 rounded-lg border border-border/65 bg-background/60 px-2.5 py-2 text-sm text-muted-foreground/70">
          No detailed review comments were included.
        </div>
      )}
    </div>
  );
}

export default ReviewOutputCard;
