export function recordActiveBrowserTabId(
  history: readonly number[],
  activeTabId: number,
  tabIds: Iterable<number>,
): readonly number[] {
  const available = new Set(tabIds);
  if (!available.has(activeTabId)) return pruneBrowserTabActivationHistory(history, available);
  return [activeTabId, ...history.filter((tabId) => tabId !== activeTabId && available.has(tabId))];
}

export function pruneBrowserTabActivationHistory(
  history: readonly number[],
  tabIds: Iterable<number>,
): readonly number[] {
  const available = tabIds instanceof Set ? tabIds : new Set(tabIds);
  return history.filter((tabId, index) => index === history.indexOf(tabId) && available.has(tabId));
}

export function chooseNextBrowserTabIdAfterClose(input: {
  readonly activeTabId: number;
  readonly closingTabId: number;
  readonly tabIds: readonly number[];
  readonly activationHistory: readonly number[];
}): number | null {
  const remainingTabIds = input.tabIds.filter((tabId) => tabId !== input.closingTabId);
  if (remainingTabIds.length === 0) return null;

  if (input.activeTabId !== input.closingTabId && remainingTabIds.includes(input.activeTabId)) {
    return input.activeTabId;
  }

  for (const tabId of input.activationHistory) {
    if (tabId !== input.closingTabId && remainingTabIds.includes(tabId)) return tabId;
  }

  const closingIndex = input.tabIds.indexOf(input.closingTabId);
  for (let index = closingIndex - 1; index >= 0; index -= 1) {
    const tabId = input.tabIds[index];
    if (tabId !== undefined && remainingTabIds.includes(tabId)) return tabId;
  }

  return remainingTabIds[0] ?? null;
}
