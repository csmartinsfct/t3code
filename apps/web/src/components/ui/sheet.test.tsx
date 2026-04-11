import "../../index.css";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { writePersistedPanelWidth } from "~/lib/persistedPanelWidth";
import { waitForElement } from "~/test-utils/browser";

import { Sheet, SheetPanel, SheetPopup } from "./sheet";

const STORAGE_KEY = "sheet-test-width";

function installMeasuredWidth(element: HTMLElement, fallbackWidth: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: Number.parseFloat(element.style.width || "") || fallbackWidth,
      height: 600,
      top: 0,
      right: 0,
      bottom: 600,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

function installPointerCapture(element: HTMLElement) {
  let capturedPointerId: number | null = null;
  Object.defineProperties(element, {
    setPointerCapture: {
      configurable: true,
      value: (pointerId: number) => {
        capturedPointerId = pointerId;
      },
    },
    releasePointerCapture: {
      configurable: true,
      value: (pointerId: number) => {
        if (capturedPointerId === pointerId) {
          capturedPointerId = null;
        }
      },
    },
    hasPointerCapture: {
      configurable: true,
      value: (pointerId: number) => capturedPointerId === pointerId,
    },
  });
}

async function renderResizableSheet() {
  const screen = await render(
    <Sheet open>
      <SheetPopup
        side="right"
        resizable={{
          storageKey: STORAGE_KEY,
          minWidth: 400,
          maxWidth: 800,
        }}
      >
        <SheetPanel>Sheet content</SheetPanel>
      </SheetPopup>
    </Sheet>,
  );

  const popup = await waitForElement(
    () => document.querySelector<HTMLElement>("[data-slot='sheet-popup']"),
    "Unable to find the sheet popup.",
  );
  const resizeHandle = await waitForElement(
    () => document.querySelector<HTMLElement>("[data-slot='sheet-resize-handle']"),
    "Unable to find the sheet resize handle.",
  );

  installMeasuredWidth(popup, 520);
  installPointerCapture(resizeHandle);

  return { popup, resizeHandle, unmount: () => screen.unmount() };
}

describe("Sheet resizable behavior", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1_000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("drags, clamps, and persists a shared sheet width", async () => {
    // Audit traceability: c437af0.
    const mounted = await renderResizableSheet();

    try {
      mounted.resizeHandle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 700,
          pointerId: 1,
        }),
      );
      mounted.resizeHandle.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: -100,
          pointerId: 1,
        }),
      );

      await vi.waitFor(() => {
        expect(mounted.popup.style.width).toBe("800px");
        expect(mounted.popup.style.maxWidth).toBe("800px");
      });

      mounted.resizeHandle.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: -100,
          pointerId: 1,
        }),
      );

      expect(localStorage.getItem(STORAGE_KEY)).toBe(
        JSON.stringify({
          version: 1,
          ratio: 0.8,
          lastWidthPx: 800,
        }),
      );
    } finally {
      await mounted.unmount();
    }
  });

  it("restores a persisted width and clamps it against the current viewport bounds", async () => {
    // Audit traceability: 7d32356.
    writePersistedPanelWidth(STORAGE_KEY, 950, 1_000);

    const mounted = await renderResizableSheet();

    try {
      expect(mounted.popup.style.width).toBe("800px");
      expect(mounted.popup.style.maxWidth).toBe("800px");
    } finally {
      await mounted.unmount();
    }
  });
});
