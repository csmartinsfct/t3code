import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRoutePopover, OverlayRoutePopoverPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";
import { cn } from "~/lib/utils";
import {
  type OAuthTierSnapshot,
  type RateLimitSnapshot,
  formatPercentage,
  formatResetsAt,
  formatUpdatedAt,
} from "~/lib/rateLimit";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

const RATE_LIMIT_METER_OVERLAY_ROUTE_KEY = "rate-limit-meter";

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function utilizationColor(pct: number): string {
  if (pct >= 80) return "var(--color-destructive)";
  if (pct >= 50) return "var(--color-warning, #f59e0b)";
  return "var(--color-muted-foreground)";
}

function ringColor(snapshot: RateLimitSnapshot): string {
  if (snapshot.status === "rejected") return "var(--color-destructive)";
  if (snapshot.status === "allowed_warning") return "var(--color-warning, #f59e0b)";
  if (snapshot.usedPercentage !== null) return utilizationColor(snapshot.usedPercentage);
  return "var(--color-muted-foreground)";
}

function ringTextClass(snapshot: RateLimitSnapshot): string {
  if (snapshot.status === "rejected") return "text-destructive";
  if (snapshot.status === "allowed_warning") return "text-warning";
  return "text-muted-foreground";
}

function statusGlyph(status: RateLimitSnapshot["status"]): string {
  switch (status) {
    case "rejected":
      return "\u2715";
    case "allowed_warning":
      return "!";
    default:
      return "\u2713";
  }
}

// ---------------------------------------------------------------------------
// Tier row with inline progress bar
// ---------------------------------------------------------------------------

function TierRow(props: { tier: OAuthTierSnapshot; isPrimary: boolean }) {
  const { tier, isPrimary } = props;
  const pct = Math.round(tier.usedPercentage);
  const reset = formatResetsAt(tier.resetsAt);
  const barColor = utilizationColor(tier.usedPercentage);

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "flex items-baseline justify-between gap-4 text-xs",
          isPrimary ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        <span className="min-w-0 truncate">{tier.tierLabel}</span>
        <span className="shrink-0 tabular-nums">
          {pct}%
          {reset ? (
            <span className="ml-1 text-[10px] text-muted-foreground/60">{reset}</span>
          ) : null}
        </span>
      </div>
      {/* Thin progress bar */}
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-muted/50">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${Math.min(100, pct)}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fallback single-tier row (SDK data only, no OAuth)
// ---------------------------------------------------------------------------

function SingleTierContent(props: { rateLimit: RateLimitSnapshot }) {
  const { rateLimit } = props;
  const pct = formatPercentage(rateLimit.usedPercentage);

  return (
    <>
      <div className="flex items-baseline justify-between gap-4 text-xs font-medium text-foreground">
        {pct ? (
          <span>{pct} used</span>
        ) : (
          <span className="capitalize">{rateLimit.status.replace(/_/g, " ")}</span>
        )}
        {rateLimit.rateLimitTypeLabel ? (
          <span className="text-muted-foreground">{rateLimit.rateLimitTypeLabel}</span>
        ) : null}
      </div>

      {pct && rateLimit.usedPercentage !== null ? (
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-muted/50">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out"
            style={{
              width: `${Math.min(100, rateLimit.usedPercentage)}%`,
              backgroundColor: utilizationColor(rateLimit.usedPercentage),
            }}
          />
        </div>
      ) : null}

      {rateLimit.resetsAt ? (
        <div className="text-[10px] text-muted-foreground/60">
          {formatResetsAt(rateLimit.resetsAt)}
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RateLimitMeter(props: { rateLimit: RateLimitSnapshot }) {
  const { rateLimit } = props;
  const routedPopover = useRoutedPopoverSurface<HTMLButtonElement>({
    routeKey: RATE_LIMIT_METER_OVERLAY_ROUTE_KEY,
    params: { rateLimit },
    side: "top",
    align: "end",
    interaction: "hover",
  });
  const usedPercentage = formatPercentage(rateLimit.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, rateLimit.usedPercentage ?? 0));
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
              usedPercentage
                ? `Rate limit ${usedPercentage} used`
                : `Rate limit status: ${rateLimit.status}`
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
                  stroke={ringColor(rateLimit)}
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
                  ringTextClass(rateLimit),
                )}
              >
                {rateLimit.usedPercentage !== null
                  ? Math.round(rateLimit.usedPercentage)
                  : statusGlyph(rateLimit.status)}
              </span>
            </span>
          </button>
        }
      />
      <PopoverPopup tooltipStyle side="top" align="end" className="w-max max-w-none px-3 py-2.5">
        <RateLimitPopoverContent rateLimit={rateLimit} />
      </PopoverPopup>
    </Popover>
  );
}

function RateLimitPopoverContent({ rateLimit }: { rateLimit: RateLimitSnapshot }) {
  const hasOAuthTiers = rateLimit.oauthTiers.length > 0;

  return (
    <div className="min-w-[180px] space-y-2 leading-tight">
      {/* Header */}
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Usage
      </div>

      {hasOAuthTiers ? (
        <div className="space-y-2">
          {rateLimit.oauthTiers.map((tier) => (
            <TierRow
              key={tier.tier}
              tier={tier}
              isPrimary={tier.tier === rateLimit.primaryTier?.tier}
            />
          ))}
        </div>
      ) : (
        <SingleTierContent rateLimit={rateLimit} />
      )}

      {/* Overage */}
      {rateLimit.isUsingOverage ? (
        <div className="text-[10px] text-muted-foreground/60">
          Overage: {rateLimit.overageStatus?.replace(/_/g, " ") ?? "active"}
          {rateLimit.overageResetsAt ? ` · ${formatResetsAt(rateLimit.overageResetsAt)}` : null}
        </div>
      ) : null}
      {rateLimit.overageDisabledReason ? (
        <div className="text-[10px] text-muted-foreground/60">
          Overage disabled: {rateLimit.overageDisabledReason.replace(/_/g, " ")}
        </div>
      ) : null}

      {/* Fetch warning */}
      {rateLimit.fetchWarning ? (
        <div className="text-[10px] text-warning/70">{rateLimit.fetchWarning}</div>
      ) : null}

      {/* Timestamp */}
      <div className="text-[10px] text-muted-foreground/40">
        {formatUpdatedAt(rateLimit.updatedAt)}
      </div>
    </div>
  );
}

registerOverlayRoute<{ rateLimit?: unknown }>(
  RATE_LIMIT_METER_OVERLAY_ROUTE_KEY,
  function RateLimitMeterOverlayRoute({ message, controller }) {
    const rateLimit = readRateLimitSnapshot(message.params.rateLimit);

    if (!rateLimit) {
      controller.fail(new Error("Rate limit meter route requires rateLimit params."));
      return null;
    }

    return (
      <OverlayRoutePopover>
        <OverlayRoutePopoverPopup
          tooltipStyle
          side="top"
          align="end"
          className="w-max max-w-none px-3 py-2.5"
        >
          <RateLimitPopoverContent rateLimit={rateLimit} />
        </OverlayRoutePopoverPopup>
      </OverlayRoutePopover>
    );
  },
);

function readRateLimitSnapshot(value: unknown): RateLimitSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<RateLimitSnapshot>;
  if (typeof snapshot.status !== "string") return null;
  if (!Array.isArray(snapshot.oauthTiers)) return null;
  if (typeof snapshot.usedPercentage !== "number" && snapshot.usedPercentage !== null) return null;
  return value as RateLimitSnapshot;
}
