import { beforeEach, describe, expect, it } from "vitest";

import { removeLocalStorageItem } from "~/hooks/useLocalStorage";

import {
  createPersistedPanelWidth,
  findWidestAcceptablePanelWidth,
  readPersistedPanelWidth,
  resolvePanelWidthCandidate,
  resolveStoredPanelWidth,
  writePersistedPanelWidth,
} from "./persistedPanelWidth";

const STORAGE_KEY = "test_persisted_panel_width";

describe("persistedPanelWidth", () => {
  beforeEach(() => {
    removeLocalStorageItem(STORAGE_KEY);
  });

  it("creates a responsive persisted width record", () => {
    expect(createPersistedPanelWidth(480, 960)).toEqual({
      version: 1,
      ratio: 0.5,
      lastWidthPx: 480,
    });
  });

  it("reads back persisted width records from local storage", () => {
    writePersistedPanelWidth(STORAGE_KEY, 360, 900);

    expect(readPersistedPanelWidth(STORAGE_KEY)).toEqual({
      version: 1,
      ratio: 0.4,
      lastWidthPx: 360,
    });
  });

  it("resolves legacy stored widths and returns a migrated responsive record", () => {
    const restoredWidth = resolveStoredPanelWidth({
      maxWidth: Number.POSITIVE_INFINITY,
      minWidth: 260,
      referenceWidth: 800,
      storedWidth: 520,
    });

    expect(restoredWidth.width).toBe(520);
    expect(restoredWidth.migratedWidth).toEqual({
      version: 1,
      ratio: 0.65,
      lastWidthPx: 520,
    });
  });

  it("restores proportional widths from the responsive format", () => {
    const restoredWidth = resolveStoredPanelWidth({
      maxWidth: Number.POSITIVE_INFINITY,
      minWidth: 260,
      referenceWidth: 600,
      storedWidth: {
        version: 1,
        ratio: 0.5,
        lastWidthPx: 480,
      },
    });

    expect(restoredWidth.width).toBe(300);
    expect(restoredWidth.migratedWidth).toBeNull();
  });

  it("clamps resolved widths to the available reference width", () => {
    expect(
      resolvePanelWidthCandidate({
        desiredWidth: 900,
        maxWidth: Number.POSITIVE_INFINITY,
        minWidth: 260,
        referenceWidth: 480,
      }),
    ).toBe(480);
  });

  it("finds the widest acceptable width when constraints reject oversized panels", () => {
    expect(
      findWidestAcceptablePanelWidth({
        acceptWidth: (nextWidth) => nextWidth <= 420,
        desiredWidth: 600,
        minWidth: 260,
      }),
    ).toBe(420);
  });

  it("returns null when no candidate width is acceptable", () => {
    expect(
      resolvePanelWidthCandidate({
        acceptWidth: () => false,
        desiredWidth: 400,
        maxWidth: 600,
        minWidth: 260,
        referenceWidth: 500,
      }),
    ).toBeNull();
  });
});
