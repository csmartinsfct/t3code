import { Schema } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { removeLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import {
  getPlanSidebarReferenceWidth,
  readPersistedPanelWidth,
  resolveStoredPanelWidth,
  writeMigratedPersistedPanelWidth,
} from "~/lib/persistedPanelWidth";

const PLAN_SIDEBAR_STORAGE_KEY = "chat_plan_sidebar_width";

function measuredElement(width: number, parentElement: any = null) {
  return {
    getBoundingClientRect: () => ({ width }),
    parentElement,
  } as HTMLElement;
}

describe("PlanSidebar width persistence", () => {
  beforeEach(() => {
    removeLocalStorageItem(PLAN_SIDEBAR_STORAGE_KEY);
  });

  it("uses the parent chat row width as the responsive reference width", () => {
    const parent = measuredElement(880);
    const sidebar = measuredElement(340, parent);

    expect(getPlanSidebarReferenceWidth(sidebar)).toBe(880);
  });

  it("migrates legacy numeric widths into the responsive format", () => {
    setLocalStorageItem(PLAN_SIDEBAR_STORAGE_KEY, 520, Schema.Number);

    const storedWidth = readPersistedPanelWidth(PLAN_SIDEBAR_STORAGE_KEY);
    expect(storedWidth).toBe(520);

    const restoredWidth = resolveStoredPanelWidth({
      maxWidth: 600,
      minWidth: 260,
      referenceWidth: 800,
      storedWidth: storedWidth!,
    });

    expect(restoredWidth.width).toBe(520);
    expect(restoredWidth.migratedWidth).toEqual({
      version: 1,
      ratio: 0.65,
      lastWidthPx: 520,
    });

    writeMigratedPersistedPanelWidth(PLAN_SIDEBAR_STORAGE_KEY, restoredWidth.migratedWidth!);
    expect(readPersistedPanelWidth(PLAN_SIDEBAR_STORAGE_KEY)).toEqual({
      version: 1,
      ratio: 0.65,
      lastWidthPx: 520,
    });
  });

  it("restores responsive plan widths proportionally in narrower layouts", () => {
    writeMigratedPersistedPanelWidth(PLAN_SIDEBAR_STORAGE_KEY, {
      version: 1,
      ratio: 0.5,
      lastWidthPx: 500,
    });

    const restoredWidth = resolveStoredPanelWidth({
      maxWidth: 600,
      minWidth: 260,
      referenceWidth: 640,
      storedWidth: readPersistedPanelWidth(PLAN_SIDEBAR_STORAGE_KEY)!,
    });

    expect(restoredWidth.width).toBe(320);
  });

  it("clamps restored plan widths to the current available container width", () => {
    writeMigratedPersistedPanelWidth(PLAN_SIDEBAR_STORAGE_KEY, {
      version: 1,
      ratio: 0.9,
      lastWidthPx: 720,
    });

    const restoredWidth = resolveStoredPanelWidth({
      maxWidth: 600,
      minWidth: 260,
      referenceWidth: 400,
      storedWidth: readPersistedPanelWidth(PLAN_SIDEBAR_STORAGE_KEY)!,
    });

    expect(restoredWidth.width).toBe(360);
  });
});
