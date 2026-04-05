import { Schema } from "effect";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";

const MATERIAL_WIDTH_DELTA_PX = 1;

const PositiveFinite = Schema.Finite.check(Schema.isGreaterThan(0));
const RatioSchema = PositiveFinite.check(Schema.isLessThanOrEqualTo(1));

export const PersistedPanelWidthV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  ratio: RatioSchema,
  lastWidthPx: PositiveFinite,
});

export type PersistedPanelWidthV1 = typeof PersistedPanelWidthV1Schema.Type;

export const LegacyOrPersistedPanelWidthSchema = Schema.Union([
  PositiveFinite,
  PersistedPanelWidthV1Schema,
]);

export type LegacyOrPersistedPanelWidth = typeof LegacyOrPersistedPanelWidthSchema.Type;

type WidthBounds = {
  maxWidth: number;
  minWidth: number;
  referenceWidth: number;
};

type ResolvePanelWidthCandidateOptions = WidthBounds & {
  acceptWidth?: ((nextWidth: number) => boolean) | undefined;
  desiredWidth: number;
};

type ResolveStoredPanelWidthOptions = WidthBounds & {
  acceptWidth?: ((nextWidth: number) => boolean) | undefined;
  storedWidth: LegacyOrPersistedPanelWidth;
};

type MeasuredElement = Pick<HTMLElement, "getBoundingClientRect"> & {
  parentElement: HTMLElement | null;
};

function measureElementWidth(element: MeasuredElement | null | undefined): number {
  if (!element) {
    return 0;
  }
  const width = element.getBoundingClientRect().width;
  return Number.isFinite(width) && width > 0 ? width : 0;
}

function getUpperBound({ maxWidth, minWidth, referenceWidth }: WidthBounds): number | null {
  const boundedMaxWidth = Number.isFinite(maxWidth) ? maxWidth : Number.POSITIVE_INFINITY;
  const upperBound = Math.min(boundedMaxWidth, referenceWidth);
  if (!Number.isFinite(upperBound) || upperBound < minWidth) {
    return null;
  }
  return upperBound;
}

export function clampPanelWidth(width: number, bounds: WidthBounds): number | null {
  const upperBound = getUpperBound(bounds);
  if (upperBound === null) {
    return null;
  }
  return Math.max(bounds.minWidth, Math.min(width, upperBound));
}

export function findWidestAcceptablePanelWidth(options: {
  acceptWidth?: ((nextWidth: number) => boolean) | undefined;
  desiredWidth: number;
  minWidth: number;
}): number | null {
  const desiredWidth = Math.floor(options.desiredWidth);
  const minWidth = Math.ceil(options.minWidth);
  if (desiredWidth < minWidth) {
    return null;
  }
  if (!options.acceptWidth) {
    return desiredWidth;
  }
  if (options.acceptWidth(desiredWidth)) {
    return desiredWidth;
  }
  if (!options.acceptWidth(minWidth)) {
    return null;
  }

  let low = minWidth;
  let high = desiredWidth;
  let best = minWidth;

  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    if (options.acceptWidth(candidate)) {
      best = candidate;
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }

  return best;
}

export function resolvePanelWidthCandidate(
  options: ResolvePanelWidthCandidateOptions,
): number | null {
  const clampedWidth = clampPanelWidth(options.desiredWidth, options);
  if (clampedWidth === null) {
    return null;
  }

  return findWidestAcceptablePanelWidth({
    acceptWidth: options.acceptWidth,
    desiredWidth: clampedWidth,
    minWidth: options.minWidth,
  });
}

export function createPersistedPanelWidth(
  width: number,
  referenceWidth: number,
): PersistedPanelWidthV1 | null {
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(referenceWidth) ||
    referenceWidth <= 0
  ) {
    return null;
  }
  return {
    version: 1,
    ratio: Math.min(1, width / referenceWidth),
    lastWidthPx: width,
  };
}

export function resolveStoredPanelWidth(options: ResolveStoredPanelWidthOptions): {
  migratedWidth: PersistedPanelWidthV1 | null;
  width: number | null;
} {
  const desiredWidth =
    typeof options.storedWidth === "number"
      ? options.storedWidth
      : options.storedWidth.ratio * options.referenceWidth;

  const width = resolvePanelWidthCandidate({
    acceptWidth: options.acceptWidth,
    desiredWidth,
    maxWidth: options.maxWidth,
    minWidth: options.minWidth,
    referenceWidth: options.referenceWidth,
  });

  if (width === null) {
    return { migratedWidth: null, width: null };
  }

  return {
    migratedWidth:
      typeof options.storedWidth === "number"
        ? createPersistedPanelWidth(width, options.referenceWidth)
        : null,
    width,
  };
}

export function readPersistedPanelWidth(storageKey: string): LegacyOrPersistedPanelWidth | null {
  try {
    return getLocalStorageItem(storageKey, LegacyOrPersistedPanelWidthSchema);
  } catch {
    return null;
  }
}

export function writePersistedPanelWidth(
  storageKey: string,
  width: number,
  referenceWidth: number,
): PersistedPanelWidthV1 | null {
  const persistedWidth = createPersistedPanelWidth(width, referenceWidth);
  if (!persistedWidth) {
    return null;
  }
  setLocalStorageItem(storageKey, persistedWidth, PersistedPanelWidthV1Schema);
  return persistedWidth;
}

export function writeMigratedPersistedPanelWidth(
  storageKey: string,
  persistedWidth: PersistedPanelWidthV1,
) {
  setLocalStorageItem(storageKey, persistedWidth, PersistedPanelWidthV1Schema);
}

export function getSidebarReferenceWidth(options: {
  sidebarContainer: MeasuredElement | null;
  wrapper: MeasuredElement | null;
}): number {
  const wrapperWidth = measureElementWidth(options.wrapper);
  const sidebarWidth = measureElementWidth(options.sidebarContainer);
  if (wrapperWidth > sidebarWidth + MATERIAL_WIDTH_DELTA_PX) {
    return wrapperWidth;
  }

  const parentWidth = measureElementWidth(options.wrapper?.parentElement ?? null);
  if (parentWidth > wrapperWidth + MATERIAL_WIDTH_DELTA_PX) {
    return parentWidth;
  }

  return wrapperWidth || parentWidth || sidebarWidth;
}

export function getPlanSidebarReferenceWidth(sidebarElement: MeasuredElement | null): number {
  const parentWidth = measureElementWidth(sidebarElement?.parentElement ?? null);
  const sidebarWidth = measureElementWidth(sidebarElement);
  return parentWidth || sidebarWidth;
}
