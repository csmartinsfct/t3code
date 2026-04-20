import { assert, describe, it } from "@effect/vitest";

import { createElectronWebContentsHarness } from "./harness.ts";

describe("ElectronWebContentsHost harness", () => {
  it("boots a hidden WebContentsView and navigates to about:blank", async () => {
    const harness = await createElectronWebContentsHarness();
    try {
      assert.equal(harness.versions.electron, "40.6.0");
      await harness.goto("about:blank");
      assert.equal(await harness.getUrl(), "about:blank");
    } finally {
      await harness.dispose();
    }
  }, 30_000);
});
