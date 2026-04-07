import type { Comment, TicketId } from "@t3tools/contracts";
import { SendIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { ensureNativeApi } from "../../nativeApi";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { formatRelativeDate } from "./ticketUtils";

interface TicketCommentsProps {
  ticketId: TicketId;
  comments: ReadonlyArray<Comment>;
  onUpdated: () => void;
}

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
        className={`rounded-md px-3 py-2 ${isLlm ? "border-l-2 border-info/30 bg-muted/20" : ""}`}
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
        <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">{comment.body}</p>
        {!replyOpen && (
          <button
            type="button"
            className="mt-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setReplyOpen(true)}
          >
            Reply
          </button>
        )}
      </div>

      {/* Replies */}
      {replies.length > 0 && (
        <div className="ml-6 flex flex-col gap-1.5 border-l-2 border-border/50 pl-3">
          {replies.map((reply) => {
            const replyIsLlm = reply.authorType === "llm";
            return (
              <div
                key={reply.id}
                className={`rounded-md px-3 py-2 ${replyIsLlm ? "border-l-2 border-info/30 bg-muted/20" : ""}`}
              >
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-medium text-foreground">{reply.authorName}</span>
                  {replyIsLlm && (
                    <Badge variant="info" className="text-[10px]">
                      AI
                    </Badge>
                  )}
                  <span className="text-muted-foreground">
                    {formatRelativeDate(reply.createdAt)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">{reply.body}</p>
              </div>
            );
          })}
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
