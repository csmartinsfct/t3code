import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRoutePopover, OverlayRoutePopoverPopup } from "~/routedOverlayAdapters";

export const TERMINAL_TOOLTIP_OVERLAY_ROUTE_KEY = "terminal-tooltip";

export function TerminalTooltipContent({ label }: { label: string }) {
  return <>{label}</>;
}

registerOverlayRoute<{ label?: unknown }>(
  TERMINAL_TOOLTIP_OVERLAY_ROUTE_KEY,
  function TerminalTooltipOverlayRoute({ message, controller }) {
    const label = message.params.label;

    if (typeof label !== "string" || label.length === 0) {
      controller.fail(new Error("Terminal tooltip route requires a label param."));
      return null;
    }

    return (
      <OverlayRoutePopover>
        <OverlayRoutePopoverPopup
          tooltipStyle
          side="bottom"
          sideOffset={6}
          align="center"
          className="pointer-events-none select-none"
        >
          <TerminalTooltipContent label={label} />
        </OverlayRoutePopoverPopup>
      </OverlayRoutePopover>
    );
  },
);
