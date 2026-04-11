import { describe, expect, it } from "vitest";

import { clampReviewIterations, getMcpDeliveryModeLabel } from "./settingsPanelHelpers";

// Audit traceability: 3be0c6e, 0d23345, 6abc967.
describe("settings panel helpers", () => {
  it("maps MCP delivery modes to the UI labels", () => {
    expect(getMcpDeliveryModeLabel("tools")).toBe("Native tools");
    expect(getMcpDeliveryModeLabel("prompt")).toBe("HTTP endpoints");
  });

  it("clamps automated review iterations into the supported range", () => {
    expect(clampReviewIterations(7)).toBe(7);
    expect(clampReviewIterations(999)).toBe(10);
    expect(clampReviewIterations(-4)).toBe(0);
    expect(clampReviewIterations(3.9)).toBe(3);
  });
});
