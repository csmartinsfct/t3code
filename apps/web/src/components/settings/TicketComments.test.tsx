import type { Comment } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DELETE_COMMENT_BUTTON_CLASS_NAME,
  getDeleteCommentConfirmationText,
  TicketComments,
} from "./TicketComments";

// Audit traceability: c709853, f2b4ce3.
function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "comment-1" as Comment["id"],
    ticketId: "ticket-1" as Comment["ticketId"],
    parentId: null,
    authorType: "human",
    authorName: "Cristiano",
    authorModel: null,
    body: `- Comment item

[Comment link](https://example.com/comment) with \`comment code\`.

> Comment quote

\`\`\`txt
comment fenced block
\`\`\`
`,
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("TicketComments", () => {
  it("renders ticket comments and replies with Markdown/GFM structure", () => {
    const rootComment = makeComment();
    const reply = makeComment({
      id: "comment-2" as Comment["id"],
      parentId: rootComment.id,
      body: "> Reply quote with \`reply code\`",
    });

    const html = renderToStaticMarkup(
      <TicketComments
        ticketId={rootComment.ticketId}
        comments={[rootComment, reply]}
        onUpdated={() => {}}
      />,
    );

    expect(html).toContain("Comments (2)");
    expect(html).toContain("<ul>");
    expect(html).toContain('<a href="https://example.com/comment">Comment link</a>');
    expect(html).toContain("<code>comment code</code>");
    expect(html).toContain('class="language-txt"');
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<code>reply code</code>");
  });

  it("renders delete affordances as hover-only controls for both comments and replies", () => {
    const rootComment = makeComment();
    const reply = makeComment({
      id: "comment-2" as Comment["id"],
      parentId: rootComment.id,
      body: "Reply body",
    });

    const html = renderToStaticMarkup(
      <TicketComments
        ticketId={rootComment.ticketId}
        comments={[rootComment, reply]}
        onUpdated={() => {}}
      />,
    );

    const deleteAffordanceMarkup = `class="${DELETE_COMMENT_BUTTON_CLASS_NAME}"`;

    expect(DELETE_COMMENT_BUTTON_CLASS_NAME).toContain("opacity-0");
    expect(DELETE_COMMENT_BUTTON_CLASS_NAME).toContain("group-hover:opacity-100");
    expect(html.match(new RegExp(deleteAffordanceMarkup, "g"))).toHaveLength(2);
  });

  it("uses reply-count-sensitive delete confirmation copy for zero, one, and many replies", () => {
    expect(getDeleteCommentConfirmationText(0)).toBe(
      "This will permanently delete this comment. This action cannot be undone.",
    );
    expect(getDeleteCommentConfirmationText(1)).toBe(
      "This will permanently delete this comment and its reply. This action cannot be undone.",
    );
    expect(getDeleteCommentConfirmationText(3)).toBe(
      "This will permanently delete this comment and its 3 replies. This action cannot be undone.",
    );
  });
});
