import type { Comment, CommentId, TicketId } from "@t3tools/contracts";
import { SendIcon, Trash2Icon } from "lucide-react";
import { useCallback, useState } from "react";

import { ensureNativeApi } from "../../nativeApi";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { TicketMarkdown } from "../management/TicketMarkdown";
import { formatRelativeDate } from "./ticketUtils";

interface TicketCommentsProps {
  ticketId: TicketId;
  comments: ReadonlyArray<Comment>;
  onUpdated: () => void;
}

// ---------------------------------------------------------------------------
// Delete button (shared between top-level comments and replies)
// ---------------------------------------------------------------------------

function DeleteCommentButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="absolute bottom-1.5 right-1.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      onClick={onClick}
      aria-label="Delete comment"
    >
      <Trash2Icon className="size-3.5" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation dialog
// ---------------------------------------------------------------------------

function DeleteCommentDialog({
  open,
  onOpenChange,
  deleting,
  onConfirm,
  replyCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deleting: boolean;
  onConfirm: () => void;
  replyCount: number;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete comment?</AlertDialogTitle>
          <AlertDialogDescription>
            {replyCount > 0
              ? `This will permanently delete this comment and its ${replyCount === 1 ? "reply" : `${replyCount} replies`}. This action cannot be undone.`
              : "This will permanently delete this comment. This action cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </AlertDialogClose>
          <Button variant="destructive" size="sm" disabled={deleting} onClick={onConfirm}>
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Shared delete hook
// ---------------------------------------------------------------------------

function useDeleteComment(commentId: CommentId, onUpdated: () => void) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const api = ensureNativeApi();
      await api.ticketing.deleteComment({ id: commentId });
      onUpdated();
    } catch (error) {
      console.error("Failed to delete comment:", error);
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }, [commentId, onUpdated]);

  return { deleteDialogOpen, setDeleteDialogOpen, deleting, handleDelete };
}

// ---------------------------------------------------------------------------
// Reply bubble
// ---------------------------------------------------------------------------

function ReplyBubble({ reply, onUpdated }: { reply: Comment; onUpdated: () => void }) {
  const replyIsLlm = reply.authorType === "llm";
  const { deleteDialogOpen, setDeleteDialogOpen, deleting, handleDelete } = useDeleteComment(
    reply.id,
    onUpdated,
  );

  return (
    <>
      <div
        className={`group relative rounded-md px-3 py-2 ${replyIsLlm ? "border-l-2 border-info/30 bg-muted/20" : ""}`}
      >
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-medium text-foreground">{reply.authorName}</span>
          {replyIsLlm && (
            <Badge variant="info" className="text-[10px]">
              AI
            </Badge>
          )}
          <span className="text-muted-foreground">{formatRelativeDate(reply.createdAt)}</span>
        </div>
        <div className="mt-1 text-foreground">
          <TicketMarkdown>{reply.body}</TicketMarkdown>
        </div>
        <DeleteCommentButton onClick={() => setDeleteDialogOpen(true)} />
      </div>
      <DeleteCommentDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        deleting={deleting}
        onConfirm={() => void handleDelete()}
        replyCount={0}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Top-level comment bubble
// ---------------------------------------------------------------------------

function CommentBubble({
  comment,
  replies,
  ticketId,
  onUpdated,
}: {
  comment: Comment;
  replies: ReadonlyArray<Comment>;
  ticketId: TicketId;
  onUpdated: () => void;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const isLlm = comment.authorType === "llm";

  const { deleteDialogOpen, setDeleteDialogOpen, deleting, handleDelete } = useDeleteComment(
    comment.id,
    onUpdated,
  );

  const handleReply = useCallback(async () => {
    if (!replyBody.trim()) return;
    setSending(true);
    try {
      const api = ensureNativeApi();
      await api.ticketing.createComment({
        ticketId,
        parentId: comment.id,
        authorType: "human",
        authorName: "You",
        body: replyBody.trim(),
      });
      setReplyBody("");
      setReplyOpen(false);
      onUpdated();
    } catch (error) {
      console.error("Failed to post reply:", error);
    } finally {
      setSending(false);
    }
  }, [replyBody, ticketId, comment.id, onUpdated]);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`group relative rounded-md px-3 py-2 ${isLlm ? "border-l-2 border-info/30 bg-muted/20" : ""}`}
      >
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-medium text-foreground">{comment.authorName}</span>
          {isLlm && (
            <Badge variant="info" className="text-[10px]">
              AI
            </Badge>
          )}
          <span className="text-muted-foreground">{formatRelativeDate(comment.createdAt)}</span>
        </div>
        <div className="mt-1 text-foreground">
          <TicketMarkdown>{comment.body}</TicketMarkdown>
        </div>
        {!replyOpen && (
          <button
            type="button"
            className="mt-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setReplyOpen(true)}
          >
            Reply
          </button>
        )}
        <DeleteCommentButton onClick={() => setDeleteDialogOpen(true)} />
      </div>

      <DeleteCommentDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        deleting={deleting}
        onConfirm={() => void handleDelete()}
        replyCount={replies.length}
      />

      {/* Replies */}
      {replies.length > 0 && (
        <div className="ml-6 flex flex-col gap-1.5 border-l-2 border-border/50 pl-3">
          {replies.map((reply) => (
            <ReplyBubble key={reply.id} reply={reply} onUpdated={onUpdated} />
          ))}
        </div>
      )}

      {/* Reply input */}
      {replyOpen && (
        <div className="ml-6 flex flex-col gap-1.5 border-l-2 border-border/50 pl-3">
          <Textarea
            size="sm"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Write a reply..."
            autoFocus
          />
          <div className="flex items-center gap-1.5">
            <Button
              size="xs"
              disabled={!replyBody.trim() || sending}
              onClick={() => void handleReply()}
            >
              <SendIcon className="size-3" />
              {sending ? "Sending..." : "Reply"}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setReplyOpen(false);
                setReplyBody("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TicketComments({ ticketId, comments, onUpdated }: TicketCommentsProps) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const topLevel = comments.filter((c) => c.parentId === null);
  const repliesMap = new Map<string, Comment[]>();
  for (const c of comments) {
    if (c.parentId) {
      const list = repliesMap.get(c.parentId) ?? [];
      list.push(c);
      repliesMap.set(c.parentId, list);
    }
  }

  const handlePost = useCallback(async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      const api = ensureNativeApi();
      await api.ticketing.createComment({
        ticketId,
        authorType: "human",
        authorName: "You",
        body: body.trim(),
      });
      setBody("");
      onUpdated();
    } catch (error) {
      console.error("Failed to post comment:", error);
    } finally {
      setSending(false);
    }
  }, [body, ticketId, onUpdated]);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-muted-foreground">
        Comments{topLevel.length > 0 ? ` (${comments.length})` : ""}
      </h3>

      {/* New comment input */}
      <div className="flex flex-col gap-1.5">
        <Textarea
          size="sm"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a comment..."
        />
        <div className="flex justify-end">
          <Button size="xs" disabled={!body.trim() || sending} onClick={() => void handlePost()}>
            <SendIcon className="size-3" />
            {sending ? "Posting..." : "Comment"}
          </Button>
        </div>
      </div>

      {/* Comments list */}
      {topLevel.length > 0 && (
        <div className="flex flex-col gap-3">
          {topLevel.map((comment) => (
            <CommentBubble
              key={comment.id}
              comment={comment}
              replies={repliesMap.get(comment.id) ?? []}
              ticketId={ticketId}
              onUpdated={onUpdated}
            />
          ))}
        </div>
      )}
    </div>
  );
}
