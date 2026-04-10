import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TicketMarkdown } from "./TicketMarkdown";

// Audit traceability: c709853.
const FULL_GFM_SAMPLE = `- Item one
- Item two

[OpenAI](https://example.com) with \`inline code\`.

> Blockquote line

\`\`\`ts
const answer = 42;
\`\`\`
`;

describe("TicketMarkdown", () => {
  it("renders core Markdown and GFM structures", () => {
    const html = renderToStaticMarkup(<TicketMarkdown>{FULL_GFM_SAMPLE}</TicketMarkdown>);

    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Item one</li>");
    expect(html).toContain('<a href="https://example.com">OpenAI</a>');
    expect(html).toContain("<code>inline code</code>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<pre><code class="language-ts">const answer = 42;');
  });
});
