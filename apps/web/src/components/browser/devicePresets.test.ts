import { describe, expect, it } from "vitest";

import { DEFAULT_ZOOM, DEVICE_PRESETS, findPreset, paramsFromState } from "./devicePresets";

describe("devicePresets", () => {
  it("exposes presets keyed by stable ids", () => {
    const ids = DEVICE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of DEVICE_PRESETS) {
      expect(findPreset(preset.id)).toBe(preset);
    }
  });
});

describe("paramsFromState", () => {
  it("returns null when emulation is off", () => {
    expect(paramsFromState({ kind: "off" })).toBeNull();
  });

  it("resolves a preset to flat params with the preset UA + DPR + scale", () => {
    const params = paramsFromState({
      kind: "preset",
      presetId: "iphone-14",
      rotated: false,
      zoom: DEFAULT_ZOOM,
    });
    expect(params).toMatchObject({
      width: 390,
      height: 844,
      dpr: 3,
      mobile: true,
      scale: 1,
    });
    expect(params?.userAgent).toContain("iPhone");
  });

  it("rotates a preset by swapping width and height", () => {
    const portrait = paramsFromState({
      kind: "preset",
      presetId: "ipad-air",
      rotated: false,
      zoom: DEFAULT_ZOOM,
    });
    const landscape = paramsFromState({
      kind: "preset",
      presetId: "ipad-air",
      rotated: true,
      zoom: DEFAULT_ZOOM,
    });
    expect(portrait?.width).toBe(landscape?.height);
    expect(portrait?.height).toBe(landscape?.width);
  });

  it("returns null for an unknown preset id", () => {
    expect(
      paramsFromState({
        kind: "preset",
        presetId: "not-a-real-device",
        rotated: false,
        zoom: DEFAULT_ZOOM,
      }),
    ).toBeNull();
  });

  it("propagates zoom on a preset", () => {
    const half = paramsFromState({
      kind: "preset",
      presetId: "ipad-air",
      rotated: false,
      zoom: 0.5,
    });
    expect(half?.scale).toBe(0.5);
    // Width/height are still the simulated metrics — `scale` is a separate
    // visual zoom applied by Chromium when rendering the output.
    expect(half?.width).toBe(820);
  });

  it("emits custom params with a generic UA based on the mobile flag", () => {
    const desktop = paramsFromState({
      kind: "custom",
      width: 1280,
      height: 800,
      mobile: false,
      rotated: false,
      zoom: 1,
    });
    expect(desktop).toMatchObject({ width: 1280, height: 800, mobile: false, scale: 1 });
    expect(desktop?.userAgent).toContain("Macintosh");

    const mobile = paramsFromState({
      kind: "custom",
      width: 360,
      height: 640,
      mobile: true,
      rotated: false,
      zoom: 1,
    });
    expect(mobile?.userAgent).toContain("Mobile");
  });

  it("rotates custom dimensions", () => {
    const params = paramsFromState({
      kind: "custom",
      width: 800,
      height: 600,
      mobile: false,
      rotated: true,
      zoom: 1,
    });
    expect(params?.width).toBe(600);
    expect(params?.height).toBe(800);
  });
});
