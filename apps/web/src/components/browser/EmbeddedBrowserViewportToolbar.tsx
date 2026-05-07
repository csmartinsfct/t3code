import { useId } from "react";

import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteSelect, OverlayRouteSelectPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";

import { Input } from "../ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  DEVICE_PRESETS,
  VIEWPORT_DIMENSION_MAX,
  VIEWPORT_DIMENSION_MIN,
  ZOOM_OPTIONS,
  clampDimension,
  effectiveDimensions,
  effectiveMobile,
  effectiveZoom,
  findPreset,
  type TabEmulation,
} from "./devicePresets";

const NO_EMULATION_VALUE = "__off";
const CUSTOM_VALUE = "__custom";
const VIEWPORT_PRESET_SELECT_OVERLAY_ROUTE_KEY = "browser-viewport-preset-select";
const VIEWPORT_ZOOM_SELECT_OVERLAY_ROUTE_KEY = "browser-viewport-zoom-select";

interface EmbeddedBrowserViewportToolbarProps {
  emulation: TabEmulation;
  onChange: (next: TabEmulation) => void;
}

// Floating pill that hovers above the centered viewport when device emulation
// is on. The viewport is bounded by the `WebContentsView`'s OS-level paint —
// any chrome that sits OVER the viewport is invisible — so this toolbar lives
// in the dark letterbox area above the rect, where it can be safely drawn by
// HTML. See `EmbeddedBrowser.tsx` for layout. Drives CDP
// `Emulation.setDeviceMetricsOverride` via the `setViewport` IPC; per-tab
// state is owned by the parent. See T3CO-423.
export function EmbeddedBrowserViewportToolbar({
  emulation,
  onChange,
}: EmbeddedBrowserViewportToolbarProps) {
  const widthInputId = useId();
  const heightInputId = useId();

  const presetValue =
    emulation.kind === "preset"
      ? emulation.presetId
      : emulation.kind === "custom"
        ? CUSTOM_VALUE
        : NO_EMULATION_VALUE;

  const effective = effectiveDimensions(emulation);
  const zoomValue = String(effectiveZoom(emulation));
  const isCustom = emulation.kind === "custom";

  const handlePresetChange = (value: string | null) => {
    if (value === null || value === NO_EMULATION_VALUE) {
      onChange({ kind: "off" });
      return;
    }
    if (value === CUSTOM_VALUE) {
      onChange({
        kind: "custom",
        width: effective.width ?? 1280,
        height: effective.height ?? 800,
        mobile: effectiveMobile(emulation),
        rotated: false,
        zoom: effectiveZoom(emulation),
      });
      return;
    }
    const preset = findPreset(value);
    if (!preset) return;
    onChange({
      kind: "preset",
      presetId: preset.id,
      rotated: false,
      zoom: effectiveZoom(emulation),
    });
  };

  const handleWidthChange = (raw: string) => {
    const next = clampDimension(Number(raw));
    if (next === null) return;
    onChange({
      kind: "custom",
      width: next,
      height: effective.height ?? 800,
      mobile: effectiveMobile(emulation),
      rotated: false,
      zoom: effectiveZoom(emulation),
    });
  };

  const handleHeightChange = (raw: string) => {
    const next = clampDimension(Number(raw));
    if (next === null) return;
    onChange({
      kind: "custom",
      width: effective.width ?? 1280,
      height: next,
      mobile: effectiveMobile(emulation),
      rotated: false,
      zoom: effectiveZoom(emulation),
    });
  };

  const handleZoomChange = (value: string | null) => {
    if (value === null) return;
    const next = Number(value);
    if (!Number.isFinite(next) || next <= 0) return;
    if (emulation.kind === "preset") {
      onChange({ ...emulation, zoom: next });
      return;
    }
    if (emulation.kind === "custom") {
      onChange({ ...emulation, zoom: next });
    }
  };

  const presetRoute = useRoutedPopoverSurface<HTMLButtonElement, string>({
    routeKey: VIEWPORT_PRESET_SELECT_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "start",
    side: "bottom",
    params: { value: presetValue },
    onResult: handlePresetChange,
  });
  const zoomRoute = useRoutedPopoverSurface<HTMLButtonElement, string>({
    routeKey: VIEWPORT_ZOOM_SELECT_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "start",
    side: "bottom",
    params: { value: zoomValue },
    onResult: handleZoomChange,
  });

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Select
        value={presetValue}
        onValueChange={handlePresetChange}
        open={presetRoute.domOpen}
        onOpenChange={presetRoute.onOpenChange}
      >
        <SelectTrigger
          size="sm"
          className="w-44 text-xs sm:text-xs"
          aria-label="Device preset"
          onFocusCapture={presetRoute.updateAnchor}
          onMouseOverCapture={presetRoute.updateAnchor}
          ref={presetRoute.triggerRef}
        >
          <SelectValue>{renderPresetLabel(presetValue)}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          <ViewportPresetSelectItems />
        </SelectPopup>
      </Select>

      <Input
        id={widthInputId}
        size="sm"
        type="number"
        inputMode="numeric"
        min={VIEWPORT_DIMENSION_MIN}
        max={VIEWPORT_DIMENSION_MAX}
        readOnly={!isCustom}
        value={effective.width ?? ""}
        onChange={(event) => handleWidthChange(event.target.value)}
        className="w-16 text-xs sm:text-xs"
        aria-label="Viewport width"
      />
      <span aria-hidden="true" className="text-muted-foreground">
        ×
      </span>
      <Input
        id={heightInputId}
        size="sm"
        type="number"
        inputMode="numeric"
        min={VIEWPORT_DIMENSION_MIN}
        max={VIEWPORT_DIMENSION_MAX}
        readOnly={!isCustom}
        value={effective.height ?? ""}
        onChange={(event) => handleHeightChange(event.target.value)}
        className="w-16 text-xs sm:text-xs"
        aria-label="Viewport height"
      />

      <Select
        value={zoomValue}
        onValueChange={handleZoomChange}
        open={zoomRoute.domOpen}
        onOpenChange={zoomRoute.onOpenChange}
      >
        <SelectTrigger
          size="sm"
          className="w-20 text-xs sm:text-xs"
          aria-label="Zoom"
          onFocusCapture={zoomRoute.updateAnchor}
          onMouseOverCapture={zoomRoute.updateAnchor}
          ref={zoomRoute.triggerRef}
        >
          <SelectValue>{formatZoomLabel(Number(zoomValue))}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          <ViewportZoomSelectItems />
        </SelectPopup>
      </Select>
    </div>
  );
}

function ViewportPresetSelectItems() {
  return (
    <>
      {DEVICE_PRESETS.map((preset) => (
        <SelectItem key={preset.id} value={preset.id} hideIndicator>
          {preset.label}
        </SelectItem>
      ))}
      <SelectSeparator />
      <SelectItem value={CUSTOM_VALUE} hideIndicator>
        Custom
      </SelectItem>
      <SelectItem value={NO_EMULATION_VALUE} hideIndicator>
        No emulation
      </SelectItem>
    </>
  );
}

function ViewportZoomSelectItems() {
  return (
    <>
      {ZOOM_OPTIONS.map((zoom) => (
        <SelectItem key={zoom} value={String(zoom)} hideIndicator>
          {formatZoomLabel(zoom)}
        </SelectItem>
      ))}
    </>
  );
}

function formatZoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

function renderPresetLabel(value: string): string {
  if (value === NO_EMULATION_VALUE) return "No emulation";
  if (value === CUSTOM_VALUE) return "Custom";
  return findPreset(value)?.label ?? "No emulation";
}

registerOverlayRoute<{ value?: unknown }>(
  VIEWPORT_PRESET_SELECT_OVERLAY_ROUTE_KEY,
  function ViewportPresetSelectOverlayRoute({ message, controller }) {
    const value =
      typeof message.params.value === "string" ? message.params.value : NO_EMULATION_VALUE;

    return (
      <OverlayRouteSelect
        value={value}
        onValueChange={(nextValue) => {
          if (typeof nextValue === "string") controller.submit(nextValue);
        }}
      >
        <OverlayRouteSelectPopup align="start" alignItemWithTrigger={false}>
          <ViewportPresetSelectItems />
        </OverlayRouteSelectPopup>
      </OverlayRouteSelect>
    );
  },
);

registerOverlayRoute<{ value?: unknown }>(
  VIEWPORT_ZOOM_SELECT_OVERLAY_ROUTE_KEY,
  function ViewportZoomSelectOverlayRoute({ message, controller }) {
    const value = typeof message.params.value === "string" ? message.params.value : "1";

    return (
      <OverlayRouteSelect
        value={value}
        onValueChange={(nextValue) => {
          if (typeof nextValue === "string") controller.submit(nextValue);
        }}
      >
        <OverlayRouteSelectPopup align="start" alignItemWithTrigger={false}>
          <ViewportZoomSelectItems />
        </OverlayRouteSelectPopup>
      </OverlayRouteSelect>
    );
  },
);
