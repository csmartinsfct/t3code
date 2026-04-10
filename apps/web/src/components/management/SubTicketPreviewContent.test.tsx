import type { Ticket } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SubTicketPreviewContent } from "./SubTicketPreviewContent";

// Audit traceability: c709853.
function makePreviewTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "ticket-preview" as Ticket["id"],
    projectId: "project-1" as Ticket["projectId"],
    parentId: null,
    ticketNumber: 157,
    identifier: "T3CO-157",
    title: "Markdown preview coverage",
    description: `- Preview item

[Preview link](https://example.com/preview) with \`preview code\`.

> Preview quote

\`\`\`md
preview fenced block
\`\`\`
`,
    status: "todo",
    priority: "high",
    sortOrder: 0,
    isArchived: false,
    worktree: null,
    implementerModelOverride: null,
    reviewerModelOverride: null,
    acceptanceCriteria: [{ text: "Rendered in preview", status: "pending" }],
    labels: [],
    dependencies: [],
    subTickets: [],
    comments: [],
    artifacts: [],
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("SubTicketPreviewContent", () => {
  it("renders cached preview descriptions with Markdown/GFM structure", () => {
    const ticket = makePreviewTicket();

    const html = renderToStaticMarkup(
      <SubTicketPreviewContent
        ticketId={ticket.id}
        fetchPreview={async () => null}
        getCached={() => ticket}
      />,
    );

    expect(html).toContain("Description");
    expect(html).toContain("<ul>");
    expect(html).toContain('<a href="https://example.com/preview">Preview link</a>');
    expect(html).toContain("<code>preview code</code>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('class="language-md"');
    expect(html).toContain("Acceptance Criteria (0/1)");
  });
});
