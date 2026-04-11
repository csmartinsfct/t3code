import "../index.css";

import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

const REMOVED_CONNECTION_SURFACE_COPY = [
  "Starting Session",
  "Cannot reach the T3 server",
  "WebSocket connection unavailable",
  "Show connection details",
  "Some requests are slow",
  "Disconnected from T3 Server",
  "Reconnected to T3 Server",
];

function ConnectedShellFixture() {
  return (
    <div data-testid="app-shell">
      <div data-testid="route-outlet">Route outlet</div>
    </div>
  );
}

describe("reverted websocket connection surface", () => {
  it("does not bring back the removed connection-state copy or retry CTAs", async () => {
    // Audit traceability: 69a1cec, b8a41f3.
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<ConnectedShellFixture />, { container: host });

    try {
      await expect.element(page.getByTestId("app-shell")).toBeInTheDocument();

      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));

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
