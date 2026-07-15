import { describe, expect, it } from "vitest";

import { formatProjectName } from "./projectName";

describe("formatProjectName", () => {
  it("returns visible names unchanged", () => {
    expect(formatProjectName("Secret Project", false)).toBe("Secret Project");
  });

  it("masks every non-whitespace character while preserving spacing", () => {
    expect(formatProjectName("Secret Project", true)).toBe("****** *******");
    expect(formatProjectName("T3-Code\tClient", true)).toBe("*******\t******");
  });

  it("masks unicode characters as single display characters", () => {
    expect(formatProjectName("Café 🚀", true)).toBe("**** *");
  });
});
