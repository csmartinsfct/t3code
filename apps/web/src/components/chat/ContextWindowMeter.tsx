import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRoutePopover, OverlayRoutePopoverPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";
import { cn } from "~/lib/utils";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

const CONTEXT_WINDOW_METER_OVERLAY_ROUTE_KEY = "context-window-meter";

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
  const routedPopover = useRoutedPopoverSurface<HTMLButtonElement>({
    routeKey: CONTEXT_WINDOW_METER_OVERLAY_ROUTE_KEY,
    params: { usage },
    side: "top",
    align: "end",
    interaction: "hover",
  });
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference;

  return (
    <Popover open={routedPopover.domOpen} onOpenChange={routedPopover.onOpenChange}>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className="group inline-flex items-center justify-center rounded-full transition-opacity hover:opacity-85"
            onFocusCapture={routedPopover.updateAnchor}
            onMouseOverCapture={routedPopover.updateAnchor}
            ref={routedPopover.triggerRef}
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
        <ContextWindowPopoverContent usage={usage} />
      </PopoverPopup>
    </Popover>
  );
}

function ContextWindowPopoverContent({ usage }: { usage: ContextWindowSnapshot }) {
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const categories = (usage.breakdown?.categories ?? []).filter(showsCategory).slice(0, 6);
  const contextTotal = usage.breakdown?.totalTokens ?? usage.usedTokens;

  return (
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
          <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70">
            Breakdown
          </div>
          <div className="space-y-1.5">
            {categories.map((category) => {
              const pct =
                contextTotal > 0
                  ? Math.max(0, Math.min(100, (category.tokens / contextTotal) * 100))
                  : 0;
              return (
                <div key={`${category.name}-${category.tokens}`} className="space-y-1">
                  <div className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-muted-foreground">{category.name}</span>
                    <span className="shrink-0 font-medium text-foreground/90">
                      {formatContextWindowTokens(category.tokens)}
                    </span>
                  </div>
                  <div className="h-[2px] overflow-hidden rounded-full bg-muted/50">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: "var(--color-muted-foreground)",
                      }}
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
  );
}

registerOverlayRoute<{ usage?: unknown }>(
  CONTEXT_WINDOW_METER_OVERLAY_ROUTE_KEY,
  function ContextWindowMeterOverlayRoute({ message, controller }) {
    const usage = readContextWindowSnapshot(message.params.usage);

    if (!usage) {
      controller.fail(new Error("Context window meter route requires usage params."));
      return null;
    }

    return (
      <OverlayRoutePopover>
        <OverlayRoutePopoverPopup
          tooltipStyle
          side="top"
          align="end"
          className="w-[260px] px-3 py-2.5"
        >
          <ContextWindowPopoverContent usage={usage} />
        </OverlayRoutePopoverPopup>
      </OverlayRoutePopover>
    );
  },
);

function readContextWindowSnapshot(value: unknown): ContextWindowSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<ContextWindowSnapshot>;
  if (typeof snapshot.usedTokens !== "number") return null;
  if (typeof snapshot.usedPercentage !== "number" && snapshot.usedPercentage !== null) return null;
  if (typeof snapshot.maxTokens !== "number" && snapshot.maxTokens !== null) return null;
  return value as ContextWindowSnapshot;
}
