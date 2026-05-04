import { RotateCwIcon, Undo2Icon } from "lucide-react";
import { useId } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  DEFAULT_ZOOM,
  DEVICE_PRESETS,
  VIEWPORT_DIMENSION_MAX,
  VIEWPORT_DIMENSION_MIN,
  ZOOM_OPTIONS,
  findPreset,
  type TabEmulation,
} from "./devicePresets";

const NO_EMULATION_VALUE = "__off";
const CUSTOM_VALUE = "__custom";

interface EmbeddedBrowserViewportToolbarProps {
  emulation: TabEmulation;
  onChange: (next: TabEmulation) => void;
}

// Toolbar row that renders below the URL bar in the embedded browser pane
// when device emulation is toggled on. Mirrors the URL bar's chrome:
// `h-10 shrink-0 border-b border-border px-3 flex items-center gap-2`.
// Drives the `Emulation.setDeviceMetricsOverride` CDP command via the
// `setViewport` IPC; per-tab state lives in the parent component. See
// T3CO-423.
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
      // Seed Custom with the currently displayed dimensions so the user
      // doesn't see jumpy values when switching from a preset.
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
    if (!next) return;
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
    if (!next) return;
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

  const handleRotate = () => {
    if (emulation.kind === "preset") {
      onChange({ ...emulation, rotated: !emulation.rotated });
      return;
    }
    if (emulation.kind === "custom") {
      onChange({
        ...emulation,
        width: emulation.height,
        height: emulation.width,
      });
    }
  };

  const handleReset = () => {
    onChange({ kind: "off" });
  };

  return (
    <div className="flex h-10 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background px-3">
      <Select value={presetValue} onValueChange={handlePresetChange}>
        <SelectTrigger size="xs" className="w-44" aria-label="Device preset">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup align="start">
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
        className="w-16"
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
        className="w-16"
        aria-label="Viewport height"
      />

      <Select value={zoomValue} onValueChange={handleZoomChange}>
        <SelectTrigger size="xs" className="w-20" aria-label="Zoom">
          <SelectValue>{formatZoomLabel(Number(zoomValue))}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="start">
          {ZOOM_OPTIONS.map((zoom) => (
            <SelectItem key={zoom} value={String(zoom)} hideIndicator>
              {formatZoomLabel(zoom)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Rotate viewport"
              onClick={handleRotate}
              disabled={emulation.kind === "off"}
            >
              <RotateCwIcon className="size-3" />
            </Button>
          }
        />
        <TooltipPopup side="top">Rotate</TooltipPopup>
      </Tooltip>

      <span className="flex-1" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Reset viewport emulation"
              onClick={handleReset}
              disabled={emulation.kind === "off"}
            >
              <Undo2Icon className="size-3" />
            </Button>
          }
        />
        <TooltipPopup side="top">Reset</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function effectiveDimensions(state: TabEmulation): {
  width: number | null;
  height: number | null;
} {
  if (state.kind === "off") return { width: null, height: null };
  if (state.kind === "preset") {
    const preset = findPreset(state.presetId);
    if (!preset) return { width: null, height: null };
    return state.rotated
      ? { width: preset.height, height: preset.width }
      : { width: preset.width, height: preset.height };
  }
  return state.rotated
    ? { width: state.height, height: state.width }
    : { width: state.width, height: state.height };
}

function effectiveZoom(state: TabEmulation): number {
  if (state.kind === "preset" || state.kind === "custom") return state.zoom;
  return DEFAULT_ZOOM;
}

function effectiveMobile(state: TabEmulation): boolean {
  if (state.kind === "preset") return findPreset(state.presetId)?.mobile ?? false;
  if (state.kind === "custom") return state.mobile;
  return false;
}

function clampDimension(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < VIEWPORT_DIMENSION_MIN || rounded > VIEWPORT_DIMENSION_MAX) return null;
  return rounded;
}

function formatZoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
