import "../../index.css";

import type { Comment, NativeApi } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "~/nativeApi";

import { TicketComments } from "./TicketComments";

// Audit traceability: f2b4ce3.
function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "comment-1" as Comment["id"],
    ticketId: "ticket-1" as Comment["ticketId"],
    parentId: null,
    authorType: "human",
    authorName: "Cristiano",
    authorModel: null,
    body: "Comment body",
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:00:00.000Z",
    ...overrides,
  };
}

function installNativeApi(deleteComment: (input: { id: Comment["id"] }) => Promise<void>) {
  __resetNativeApiForTests();
  window.nativeApi = {
    ticketing: {
      deleteComment,
    },
  } as unknown as NativeApi;
}

async function mountComments(input: { comments: ReadonlyArray<Comment>; onUpdated?: () => void }) {
  const host = document.createElement("div");
  document.body.append(host);

  const screen = await render(
    <TicketComments
      ticketId={"ticket-1" as Comment["ticketId"]}
      comments={input.comments}
      onUpdated={input.onUpdated ?? (() => undefined)}
    />,
    { container: host },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("TicketComments delete coverage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    __resetNativeApiForTests();
    delete window.nativeApi;
    vi.clearAllMocks();
  });

  it("confirms top-level comment deletion with singular reply copy and refreshes after delete", async () => {
    const rootComment = makeComment();
    const reply = makeComment({
      id: "comment-2" as Comment["id"],
      parentId: rootComment.id,
      body: "Reply body",
    });
    const deleteComment = vi.fn(async () => undefined);
    const onUpdated = vi.fn();
    installNativeApi(deleteComment);

    const mounted = await mountComments({ comments: [rootComment, reply], onUpdated });

    try {
      await page.getByRole("button", { name: "Delete comment" }).nth(0).click();

      await expect.element(page.getByText("Delete comment?")).toBeInTheDocument();
      await expect
        .element(
          page.getByText(
            "This will permanently delete this comment and its reply. This action cannot be undone.",
          ),
        )
        .toBeInTheDocument();

      await page.getByRole("button", { name: "Delete" }).click();

      await vi.waitFor(() => {
        expect(deleteComment).toHaveBeenCalledWith({ id: rootComment.id });
        expect(onUpdated).toHaveBeenCalledTimes(1);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("confirms top-level comment deletion with plural reply copy for many replies", async () => {
    const rootComment = makeComment();
    const replies = [
      makeComment({
        id: "comment-2" as Comment["id"],
        parentId: rootComment.id,
        body: "First reply",
      }),
      makeComment({
        id: "comment-3" as Comment["id"],
        parentId: rootComment.id,
        body: "Second reply",
      }),
    ];
    installNativeApi(vi.fn(async () => undefined));

    const mounted = await mountComments({ comments: [rootComment, ...replies] });

    try {
      await page.getByRole("button", { name: "Delete comment" }).nth(0).click();

      await expect
        .element(
          page.getByText(
            "This will permanently delete this comment and its 2 replies. This action cannot be undone.",
          ),
        )
        .toBeInTheDocument();

      await page.getByRole("button", { name: "Cancel" }).first().click();
    } finally {
      await mounted.cleanup();
    }
  });

  it("deletes replies with zero-reply confirmation copy and refreshes after delete", async () => {
    const rootComment = makeComment();
    const reply = makeComment({
      id: "comment-2" as Comment["id"],
      parentId: rootComment.id,
      body: "Reply body",
    });
    const deleteComment = vi.fn(async () => undefined);
    const onUpdated = vi.fn();
    installNativeApi(deleteComment);

    const mounted = await mountComments({ comments: [rootComment, reply], onUpdated });

    try {
      await page.getByRole("button", { name: "Delete comment" }).nth(1).click();

      await expect
        .element(
          page.getByText(
            "This will permanently delete this comment. This action cannot be undone.",
          ),
        )
        .toBeInTheDocument();

      await page.getByRole("button", { name: "Delete" }).click();

      await vi.waitFor(() => {
        expect(deleteComment).toHaveBeenCalledWith({ id: reply.id });
        expect(onUpdated).toHaveBeenCalledTimes(1);
      });
    } finally {
      await mounted.cleanup();
    }
  });
});
