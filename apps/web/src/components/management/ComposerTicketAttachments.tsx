import { TicketIcon, XIcon } from "lucide-react";
import { memo } from "react";

import type { ComposerTicketAttachment } from "../../composerDraftStore";

interface ComposerTicketAttachmentsProps {
  attachments: ComposerTicketAttachment[];
  onRemove: (attachmentId: string) => void;
}

export const ComposerTicketAttachments = memo(function ComposerTicketAttachments({
  attachments,
  onRemove,
}: ComposerTicketAttachmentsProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-1 pt-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex items-center gap-1.5 rounded-md border border-border/70 bg-accent/30 px-2 py-1 text-xs transition-colors"
          title={`${attachment.identifier}: ${attachment.title}`}
        >
          <TicketIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="font-mono text-foreground">
            {attachment.identifier}
            <span className="ml-1 font-sans text-muted-foreground">{attachment.title}</span>
          </span>
          <button
            type="button"
            aria-label={`Remove ${attachment.identifier}`}
            className="ml-0.5 flex size-3.5 items-center justify-center rounded-sm text-muted-foreground/72 transition-colors hover:bg-foreground/8 hover:text-foreground"
            onClick={() => onRemove(attachment.id)}
          >
            <XIcon className="size-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
});
