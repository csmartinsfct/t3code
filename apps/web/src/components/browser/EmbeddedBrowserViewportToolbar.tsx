import { useId, useMemo } from "react";

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
  const presetOverlayItems = useMemo(
    () => [
      ...DEVICE_PRESETS.map((preset) => ({
        value: preset.id,
        label: preset.label,
        hideIndicator: true,
      })),
      { value: "__preset-separator", label: "", separator: true },
      { value: CUSTOM_VALUE, label: "Custom", hideIndicator: true },
      { value: NO_EMULATION_VALUE, label: "No emulation", hideIndicator: true },
    ],
    [],
  );
  const zoomOverlayItems = useMemo(
    () =>
      ZOOM_OPTIONS.map((zoom) => ({
        value: String(zoom),
        label: formatZoomLabel(zoom),
        hideIndicator: true,
      })),
    [],
  );

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

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Select
        value={presetValue}
        onValueChange={handlePresetChange}
        overlayItems={presetOverlayItems}
        overlaySelectAlign="start"
        overlayAlignItemWithTrigger={false}
      >
        <SelectTrigger size="sm" className="w-44 text-xs sm:text-xs" aria-label="Device preset">
          <SelectValue>{renderPresetLabel(presetValue)}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
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
        overlayItems={zoomOverlayItems}
        overlaySelectAlign="start"
        overlayAlignItemWithTrigger={false}
      >
        <SelectTrigger size="sm" className="w-20 text-xs sm:text-xs" aria-label="Zoom">
          <SelectValue>{formatZoomLabel(Number(zoomValue))}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          {ZOOM_OPTIONS.map((zoom) => (
            <SelectItem key={zoom} value={String(zoom)} hideIndicator>
              {formatZoomLabel(zoom)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
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
