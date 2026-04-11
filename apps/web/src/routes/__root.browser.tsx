import "../index.css";

import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { APP_DISPLAY_NAME } from "../branding";

const REMOVED_CONNECTION_SURFACE_COPY = [
  "Cannot reach the T3 server",
  "WebSocket connection unavailable",
  "Show connection details",
  "Some requests are slow",
  "Disconnected from T3 Server",
  "Reconnected to T3 Server",
];

function BootstrapFallbackFixture() {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Connecting to {APP_DISPLAY_NAME} server...</p>
      </div>
    </div>
  );
}

describe("root route bootstrap fallback", () => {
  it("keeps the reverted bootstrap shell minimal", async () => {
    // Audit traceability: 69a1cec, b8a41f3.
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<BootstrapFallbackFixture />, { container: host });

    try {
      await expect
        .element(page.getByText(`Connecting to ${APP_DISPLAY_NAME} server...`))
        .toBeInTheDocument();

      const text = document.body.textContent ?? "";
      for (const removedCopy of REMOVED_CONNECTION_SURFACE_COPY) {
        expect(text).not.toContain(removedCopy);
      }

      expect(document.querySelectorAll('[data-slot="toast-title"]')).toHaveLength(0);
      expect(
        Array.from(document.querySelectorAll("button")).some((button) => {
          const label = button.textContent?.trim();
          return label === "Retry" || label === "Retry now";
        }),
      ).toBe(false);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
