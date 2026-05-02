import { describe, expect, it } from "vitest";

import {
  TICKET_PREVIEW_MAX_HEIGHT,
  TICKET_PREVIEW_MAX_WIDTH,
  TICKET_PREVIEW_MIN_HEIGHT,
  TICKET_PREVIEW_MIN_WIDTH,
  TICKET_PREVIEW_POSITION_STORAGE_KEY,
  TICKET_PREVIEW_SIZE_STORAGE_KEY,
  clampTicketPreviewSize,
} from "./ticketPreviewSize";

describe("ticketPreviewSize", () => {
  it("keeps the original storage keys so existing preview preferences survive the rename", () => {
    expect(TICKET_PREVIEW_SIZE_STORAGE_KEY).toBe("t3code:sub-ticket-preview-size:v1");
    expect(TICKET_PREVIEW_POSITION_STORAGE_KEY).toBe("t3code:sub-ticket-preview-position:v2");
  });

  it("clamps preview dimensions to configured bounds", () => {
    expect(
      clampTicketPreviewSize(
        {
          width: 9999,
          maxHeight: 9999,
        },
        { width: 2000, height: 2000 },
      ),
    ).toEqual({
      version: 1,
      width: TICKET_PREVIEW_MAX_WIDTH,
      maxHeight: TICKET_PREVIEW_MAX_HEIGHT,
    });

    expect(
      clampTicketPreviewSize(
        {
          width: 1,
          maxHeight: 1,
        },
        { width: 2000, height: 2000 },
      ),
    ).toEqual({
      version: 1,
      width: TICKET_PREVIEW_MIN_WIDTH,
      maxHeight: TICKET_PREVIEW_MIN_HEIGHT,
    });
  });

  it("keeps oversized preferences inside the current viewport", () => {
    expect(
      clampTicketPreviewSize(
        {
          width: 720,
          maxHeight: 680,
        },
        { width: 420, height: 360 },
      ),
    ).toEqual({
      version: 1,
      width: 388,
      maxHeight: 328,
    });
  });
});
