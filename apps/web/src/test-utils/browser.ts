import { expect, vi } from "vitest";

export function dispatchModifiedClick(
  element: HTMLButtonElement,
  modifiers: { altKey?: boolean; shiftKey?: boolean },
) {
  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...modifiers,
  };
  element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
  element.dispatchEvent(new MouseEvent("mousedown", eventInit));
  element.dispatchEvent(new PointerEvent("pointerup", eventInit));
  element.dispatchEvent(new MouseEvent("mouseup", eventInit));
  element.dispatchEvent(new MouseEvent("click", eventInit));
}

export function findButtonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Unable to find button containing "${text}"`);
  }
  return button;
}

export async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string,
): Promise<T> {
  let element: T | null = null;
  await vi.waitFor(
    () => {
      element = query();
      expect(element, errorMessage).toBeTruthy();
    },
    { timeout: 8_000, interval: 16 },
  );
  if (!element) {
    throw new Error(errorMessage);
  }
  return element;
}

export function createTextClipboardData(text: string): DataTransfer {
  return {
    files: [],
    items: [],
    types: ["text/plain"],
    getData: (type: string) => (type === "text/plain" ? text : ""),
  } as unknown as DataTransfer;
}

export function dispatchTextPaste(target: HTMLElement, text: string): ClipboardEvent {
  const event = new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "clipboardData", {
    configurable: true,
    value: createTextClipboardData(text),
  });
  target.dispatchEvent(event);
  return event;
}
