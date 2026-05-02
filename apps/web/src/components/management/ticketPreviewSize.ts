import { Schema } from "effect";

export const TICKET_PREVIEW_SIZE_STORAGE_KEY = "t3code:sub-ticket-preview-size:v1";
export const TICKET_PREVIEW_POSITION_STORAGE_KEY = "t3code:sub-ticket-preview-position:v2";

export const TICKET_PREVIEW_DEFAULT_SIZE = {
  width: 380,
  maxHeight: 300,
} as const;

export const TICKET_PREVIEW_DEFAULT_POSITION = {
  x: 0,
  y: 0,
  viewportWidth: 1024,
  viewportHeight: 768,
} as const;

export const TICKET_PREVIEW_MIN_WIDTH = 320;
export const TICKET_PREVIEW_MAX_WIDTH = 720;
export const TICKET_PREVIEW_MIN_HEIGHT = 220;
export const TICKET_PREVIEW_MAX_HEIGHT = 960;
export const TICKET_PREVIEW_VIEWPORT_PADDING = 16;

const FinitePositive = Schema.Finite.check(Schema.isGreaterThan(0));

export const TicketPreviewSizeSchema = Schema.Struct({
  version: Schema.Literal(1),
  width: FinitePositive,
  maxHeight: FinitePositive,
});

export type TicketPreviewSize = typeof TicketPreviewSizeSchema.Type;

export const TicketPreviewPositionSchema = Schema.Struct({
  version: Schema.Literal(1),
  x: Schema.Finite,
  y: Schema.Finite,
  viewportWidth: FinitePositive,
  viewportHeight: FinitePositive,
});

export type TicketPreviewPosition = typeof TicketPreviewPositionSchema.Type;

export function clampTicketPreviewSize(
  size: Pick<TicketPreviewSize, "width" | "maxHeight">,
  viewport: { width: number; height: number },
): TicketPreviewSize {
  const availableWidth = Math.max(160, viewport.width - TICKET_PREVIEW_VIEWPORT_PADDING * 2);
  const availableHeight = Math.max(160, viewport.height - TICKET_PREVIEW_VIEWPORT_PADDING * 2);
  const maxWidth = Math.min(TICKET_PREVIEW_MAX_WIDTH, availableWidth);
  const maxHeight = Math.min(TICKET_PREVIEW_MAX_HEIGHT, availableHeight);
  const minWidth = Math.min(TICKET_PREVIEW_MIN_WIDTH, maxWidth);
  const minHeight = Math.min(TICKET_PREVIEW_MIN_HEIGHT, maxHeight);

  return {
    version: 1,
    width: clampDimension(size.width, minWidth, maxWidth),
    maxHeight: clampDimension(size.maxHeight, minHeight, maxHeight),
  };
}

export function getTicketPreviewViewport(): { width: number; height: number } {
  if (typeof window === "undefined") {
    return { width: 1024, height: 768 };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export function createTicketPreviewPosition(
  offset: { x: number; y: number },
  viewport: { width: number; height: number },
): TicketPreviewPosition {
  return {
    version: 1,
    x: Math.round(offset.x),
    y: Math.round(offset.y),
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  };
}

function clampDimension(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.round(Math.max(min, Math.min(value, max)));
}
