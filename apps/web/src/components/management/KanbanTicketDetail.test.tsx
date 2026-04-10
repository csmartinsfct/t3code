import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TicketMarkdown } from "./TicketMarkdown";

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

function ReadOnlyKanbanTicketDescription({ description }: { description: string }) {
  return (
    <div className="rounded-md px-3 py-2">
      <p className="text-[11px] font-medium text-muted-foreground">Description</p>
      <div className="mt-0.5 cursor-text text-foreground">
        <TicketMarkdown>{description}</TicketMarkdown>
      </div>
    </div>
  );
}

describe("KanbanTicketDetail", () => {
  it("renders the read-only ticket description with Markdown/GFM structure", () => {
    const html = renderToStaticMarkup(
      <ReadOnlyKanbanTicketDescription description={DETAIL_DESCRIPTION} />,
    );

    expect(html).toContain("<ul>");
    expect(html).toContain('<a href="https://example.com/spec">spec</a>');
    expect(html).toContain("<code>inline detail code</code>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('class="language-tsx"');
  });
});
