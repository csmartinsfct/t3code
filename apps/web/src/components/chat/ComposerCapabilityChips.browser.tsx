import type { SelectedProviderCapability } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerCapabilityChips } from "./ComposerCapabilityChips";

const superpowersCapability = {
  provider: "codex",
  kind: "plugin",
  id: "superpowers@openai-curated-remote",
  displayName: "Superpowers",
  parentDisplayName: "OpenAI curated",
  iconUrl: "https://example.com/superpowers.png",
} satisfies SelectedProviderCapability;

describe("ComposerCapabilityChips", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders selected provider capability metadata and removes by capability id", async () => {
    const onRemove = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <ComposerCapabilityChips capabilities={[superpowersCapability]} onRemove={onRemove} />,
      { container: host },
    );

    try {
      const chip = page.getByTitle("plugin · OpenAI curated");
      await expect.element(chip).toHaveTextContent("Superpowers");
      expect(
        chip.element().querySelector('img[src="https://example.com/superpowers.png"]'),
      ).toBeTruthy();

      await page.getByRole("button", { name: "Remove Superpowers" }).click();

      expect(onRemove).toHaveBeenCalledWith("superpowers@openai-curated-remote");
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
