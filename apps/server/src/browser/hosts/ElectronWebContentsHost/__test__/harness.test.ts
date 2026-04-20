import { assert, describe, it } from "@effect/vitest";

import { createElectronWebContentsHarness } from "./harness.ts";

describe("ElectronWebContentsHost harness", () => {
  it("boots a hidden WebContentsView and navigates to about:blank", async () => {
    const harness = await createElectronWebContentsHarness();
    try {
      assert.equal(harness.versions.electron, "40.6.0");
      await harness.goto("about:blank");
      assert.equal(await harness.getUrl(), "about:blank");
      const evaluated = await harness.sendCdp<{ result: { value: number } }>("Runtime.evaluate", {
        expression: "1 + 1",
        returnByValue: true,
      });
      assert.equal(evaluated.result.value, 2);

      const consoleEvents: unknown[] = [];
      const unsubscribe = await harness.subscribeCdpEvent("Runtime.consoleAPICalled", (event) => {
        consoleEvents.push(event.params);
      });
      await harness.sendCdp("Runtime.enable");
      await harness.sendCdp("Runtime.evaluate", {
        expression: "console.log('harness-cdp-event')",
      });
      await eventually(() => consoleEvents.length > 0);
      await unsubscribe();
    } finally {
      await harness.dispose();
    }
  }, 30_000);
});

async function eventually(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Timed out waiting for condition");
}
