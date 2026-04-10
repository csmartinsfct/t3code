import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KanbanTicketDetailDescription } from "./KanbanTicketDetail";

// Audit traceability: c709853.
const DETAIL_DESCRIPTION = `- Detail list item

Visit [spec](https://example.com/spec) with \`inline detail code\`.

> Detail quote

\`\`\`tsx
export function DetailExample() {
  return <div />;
}
\`\`\`
`;

describe("KanbanTicketDetail", () => {
  it("renders the read-only ticket description with Markdown/GFM structure", () => {
    const html = renderToStaticMarkup(
      <div className="rounded-md px-3 py-2">
        <p className="text-[11px] font-medium text-muted-foreground">Description</p>
        <KanbanTicketDetailDescription description={DETAIL_DESCRIPTION} />
      </div>,
    );

    expect(html).toContain("<ul>");
    expect(html).toContain('<a href="https://example.com/spec">spec</a>');
    expect(html).toContain("<code>inline detail code</code>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('class="language-tsx"');
  });
});
