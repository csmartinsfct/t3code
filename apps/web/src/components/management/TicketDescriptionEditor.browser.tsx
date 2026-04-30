import type { TicketId } from "@t3tools/contracts";
import "../../index.css";

import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { TicketDescriptionEditor } from "./TicketDescriptionEditor";

const TABLE_MARKDOWN = `| Test | Description | Status |
| --- | --- | --- |
| 1.1 | Swap event captured | PASS |
| 1.2 | Field-level correctness | PASS |
`;

describe("TicketDescriptionEditor", () => {
  it("renders GFM markdown tables as editable table nodes", async () => {
    const screen = await render(
      <TicketDescriptionEditor
        ticketId={"ticket-table-rendering" as TicketId}
        initialContent={TABLE_MARKDOWN}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    const container = screen.container;
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("th")).toHaveLength(3);
    expect(container.textContent).toContain("Swap event captured");
    expect(container.textContent).not.toContain("TestDescriptionStatus");
  });
});
