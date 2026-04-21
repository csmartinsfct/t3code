import { cn } from "~/lib/utils";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

function barColor(pct: number): string {
  if (pct >= 80) return "var(--color-destructive)";
  if (pct >= 50) return "var(--color-warning, #f59e0b)";
  return "var(--color-muted-foreground)";
}

const HIDDEN_CONTEXT_CATEGORY_NAMES = new Set(["autocompact buffer", "free space"]);

const SDK_CONTEXT_COLOR_MAP: Record<string, string> = {
  claude: "var(--color-primary)",
  inactive: "var(--color-muted-foreground)",
  promptBorder: "var(--color-muted-foreground)",
  purple_FOR_SUBAGENTS_ONLY: "#a78bfa",
  warning: "var(--color-warning, #f59e0b)",
};

function categoryColor(color: string | undefined): string {
  if (!color) {
    return "var(--color-muted-foreground)";
  }
  return SDK_CONTEXT_COLOR_MAP[color] ?? color;
}

function showsCategory(
  category: NonNullable<ContextWindowSnapshot["breakdown"]>["categories"][number],
): boolean {
  return (
    category.tokens > 0 &&
    !category.isDeferred &&
    !HIDDEN_CONTEXT_CATEGORY_NAMES.has(category.name.toLowerCase())
  );
}

export function ContextWindowMeter(props: { usage: ContextWindowSnapshot }) {
  const { usage } = props;
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const categories = (usage.breakdown?.categories ?? []).filter(showsCategory).slice(0, 6);
  const contextTotal = usage.breakdown?.totalTokens ?? usage.usedTokens;
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference;

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className="group inline-flex items-center justify-center rounded-full transition-opacity hover:opacity-85"
            aria-label={
              usage.maxTokens !== null && usedPercentage
                ? `Context window ${usedPercentage} used`
                : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
            }
          >
            <span className="relative flex h-6 w-6 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 h-full w-full transform-gpu"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="color-mix(in oklab, var(--color-muted) 70%, transparent)"
                  strokeWidth="3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="var(--color-muted-foreground)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
                />
              </svg>
              <span
                className={cn(
                  "relative flex h-[15px] w-[15px] items-center justify-center rounded-full bg-background text-[8px] font-medium",
                  "text-muted-foreground",
                )}
              >
                {usage.usedPercentage !== null
                  ? Math.round(usage.usedPercentage)
                  : formatContextWindowTokens(usage.usedTokens)}
              </span>
            </span>
          </button>
        }
      />
      <PopoverPopup tooltipStyle side="top" align="end" className="w-[260px] px-3 py-2.5">
        <div className="space-y-2.5 leading-tight">
          {/* Header */}
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Context window
          </div>

          {/* Usage stats */}
          {usage.maxTokens !== null && usedPercentage ? (
            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-4 text-xs font-medium text-foreground">
                <span>{usedPercentage}</span>
                <span className="text-muted-foreground">
                  {formatContextWindowTokens(usage.usedTokens)}/
                  {formatContextWindowTokens(usage.maxTokens ?? null)}
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-muted/50">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${Math.min(100, normalizedPercentage)}%`,
                    backgroundColor: barColor(normalizedPercentage),
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="text-xs font-medium text-foreground">
              {formatContextWindowTokens(usage.usedTokens)} tokens
            </div>
          )}

          {categories.length > 0 ? (
            <div className="space-y-1.5 border-t border-border/60 pt-2">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70">
                <span>Breakdown</span>
                {usage.breakdown?.model ? (
                  <span className="max-w-[130px] truncate normal-case tracking-normal">
                    {usage.breakdown.model}
                  </span>
                ) : null}
              </div>
              <div className="space-y-1.5">
                {categories.map((category) => {
                  const pct =
                    contextTotal > 0
                      ? Math.max(0, Math.min(100, (category.tokens / contextTotal) * 100))
                      : 0;
                  const color = categoryColor(category.color);
                  return (
                    <div key={`${category.name}-${category.tokens}`} className="space-y-1">
                      <div className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
                        <span className="flex min-w-0 items-center gap-1.5 text-foreground/90">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: color }}
                            aria-hidden="true"
                          />
                          <span className="truncate">{category.name}</span>
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {formatContextWindowTokens(category.tokens)}
                        </span>
                      </div>
                      <div className="h-[2px] overflow-hidden rounded-full bg-muted/50">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Total processed (only if meaningfully different from used) */}
          {(usage.totalProcessedTokens ?? null) !== null &&
          (usage.totalProcessedTokens ?? 0) > usage.usedTokens ? (
            <div className="text-[10px] text-muted-foreground/60">
              {formatContextWindowTokens(usage.totalProcessedTokens ?? null)} total processed
            </div>
          ) : null}

          {/* Auto-compaction note */}
          {usage.compactsAutomatically ? (
            <div className="text-[10px] text-muted-foreground/40">Auto-compacts when needed</div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
