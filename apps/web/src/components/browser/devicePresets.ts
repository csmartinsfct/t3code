import type { ViewportEmulationParams } from "@t3tools/contracts";

export interface DevicePreset {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly mobile: boolean;
  readonly userAgent: string;
}

// Curated device list — UA strings adapted from Chrome DevTools' built-in
// device toolbar. Widths/heights and DPRs match real device specs. Order is
// roughly small → large for the dropdown.
export const DEVICE_PRESETS: ReadonlyArray<DevicePreset> = [
  {
    id: "iphone-se",
    label: "iPhone SE",
    width: 375,
    height: 667,
    dpr: 2,
    mobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  },
  {
    id: "iphone-14",
    label: "iPhone 14",
    width: 390,
    height: 844,
    dpr: 3,
    mobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  },
  {
    id: "iphone-14-pro-max",
    label: "iPhone 14 Pro Max",
    width: 430,
    height: 932,
    dpr: 3,
    mobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  },
  {
    id: "pixel-7",
    label: "Pixel 7",
    width: 412,
    height: 915,
    dpr: 2.625,
    mobile: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
  },
  {
    id: "galaxy-s23",
    label: "Galaxy S23",
    width: 360,
    height: 780,
    dpr: 3,
    mobile: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
  },
  {
    id: "ipad-air",
    label: "iPad Air",
    width: 820,
    height: 1180,
    dpr: 2,
    mobile: true,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  },
  {
    id: "ipad-pro-12",
    label: 'iPad Pro 12.9"',
    width: 1024,
    height: 1366,
    dpr: 2,
    mobile: true,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  },
  {
    id: "macbook-air-13",
    label: 'MacBook Air 13"',
    width: 1280,
    height: 800,
    dpr: 2,
    mobile: false,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
  },
  {
    id: "desktop-1080",
    label: "Desktop 1920×1080",
    width: 1920,
    height: 1080,
    dpr: 1,
    mobile: false,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
  },
];

const DEVICE_PRESETS_BY_ID: ReadonlyMap<string, DevicePreset> = new Map(
  DEVICE_PRESETS.map((preset) => [preset.id, preset]),
);

export function findPreset(id: string): DevicePreset | undefined {
  return DEVICE_PRESETS_BY_ID.get(id);
}

// Per-tab UI state. `off` means no emulation; `preset` references a curated
// device id (rotated swaps width/height); `custom` carries arbitrary numeric
// dimensions plus an explicit mobile flag (UA inherits a generic Chrome UA
// since the user didn't pick a real device). `zoom` is the visual scale at
// which the simulated viewport is rendered (1 = 100%, matches Chrome
// DevTools' zoom dropdown). Each preset still carries its own `dpr` so the
// page reads the correct `window.devicePixelRatio`; DPR is not user-tunable
// because in our setup it has no visible effect — only `scale` (zoom)
// changes how the rendered output is sized.
export type TabEmulation =
  | { kind: "off" }
  | { kind: "preset"; presetId: string; rotated: boolean; zoom: number }
  | {
      kind: "custom";
      width: number;
      height: number;
      mobile: boolean;
      rotated: boolean;
      zoom: number;
    };

const GENERIC_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36";
const GENERIC_MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36";

// Translates UI state into the flat `ViewportEmulationParams` shape that
// crosses the IPC boundary. Returns `null` when emulation is off or the
// preset id is unknown — the caller should pass `null` to clear emulation.
export function paramsFromState(state: TabEmulation): ViewportEmulationParams | null {
  if (state.kind === "off") return null;
  if (state.kind === "preset") {
    const preset = findPreset(state.presetId);
    if (!preset) return null;
    const [width, height] = state.rotated
      ? [preset.height, preset.width]
      : [preset.width, preset.height];
    return {
      width,
      height,
      dpr: preset.dpr,
      mobile: preset.mobile,
      userAgent: preset.userAgent,
      scale: state.zoom,
    };
  }
  const [width, height] = state.rotated ? [state.height, state.width] : [state.width, state.height];
  return {
    width,
    height,
    // Custom mode uses a sensible default DPR — desktop 1, mobile 2.
    dpr: state.mobile ? 2 : 1,
    mobile: state.mobile,
    userAgent: state.mobile ? GENERIC_MOBILE_UA : GENERIC_DESKTOP_UA,
    scale: state.zoom,
  };
}

export const VIEWPORT_DIMENSION_MIN = 200;
export const VIEWPORT_DIMENSION_MAX = 4096;
// Match Chrome DevTools' zoom dropdown values. 1 = 100%.
export const ZOOM_OPTIONS: ReadonlyArray<number> = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const DEFAULT_ZOOM = 1;

export const DEFAULT_PRESET_ID = "pixel-7";

// Shared helpers for the toolbar and the resize handles. They derive a
// concrete dimension/zoom/mobile reading from a `TabEmulation` value so the
// toolbar's inputs and the drag handlers can read the same source of truth.

export function effectiveDimensions(state: TabEmulation): {
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

export function effectiveZoom(state: TabEmulation): number {
  if (state.kind === "preset" || state.kind === "custom") return state.zoom;
  return DEFAULT_ZOOM;
}

export function effectiveMobile(state: TabEmulation): boolean {
  if (state.kind === "preset") return findPreset(state.presetId)?.mobile ?? false;
  if (state.kind === "custom") return state.mobile;
  return false;
}

export function clampDimension(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < VIEWPORT_DIMENSION_MIN) return VIEWPORT_DIMENSION_MIN;
  if (rounded > VIEWPORT_DIMENSION_MAX) return VIEWPORT_DIMENSION_MAX;
  return rounded;
}
