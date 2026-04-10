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
