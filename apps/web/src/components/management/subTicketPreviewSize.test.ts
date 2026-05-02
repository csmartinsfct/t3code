import { describe, expect, it } from "vitest";

import {
  SUB_TICKET_PREVIEW_MAX_HEIGHT,
  SUB_TICKET_PREVIEW_MAX_WIDTH,
  SUB_TICKET_PREVIEW_MIN_HEIGHT,
  SUB_TICKET_PREVIEW_MIN_WIDTH,
  clampSubTicketPreviewSize,
} from "./subTicketPreviewSize";

describe("subTicketPreviewSize", () => {
  it("clamps preview dimensions to configured bounds", () => {
    expect(
      clampSubTicketPreviewSize(
        {
          width: 9999,
          maxHeight: 9999,
        },
        { width: 2000, height: 2000 },
      ),
    ).toEqual({
      version: 1,
      width: SUB_TICKET_PREVIEW_MAX_WIDTH,
      maxHeight: SUB_TICKET_PREVIEW_MAX_HEIGHT,
    });

    expect(
      clampSubTicketPreviewSize(
        {
          width: 1,
          maxHeight: 1,
        },
        { width: 2000, height: 2000 },
      ),
    ).toEqual({
      version: 1,
      width: SUB_TICKET_PREVIEW_MIN_WIDTH,
      maxHeight: SUB_TICKET_PREVIEW_MIN_HEIGHT,
    });
  });

  it("keeps oversized preferences inside the current viewport", () => {
    expect(
      clampSubTicketPreviewSize(
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
