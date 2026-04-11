import type { TicketLinkedThread } from "@t3tools/contracts";
import { Clock3Icon, FileCode2Icon, SearchCheckIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import { formatRelativeDate } from "../settings/ticketUtils";

interface TicketThreadRowButtonProps {
  readonly thread: TicketLinkedThread;
  readonly onOpenThread: (threadId: string) => void;
}

const LINK_BADGE_CONFIG = {
  origin: { label: "Origin", variant: "outline" as const },
  bound: { label: "Bound", variant: "secondary" as const },
} satisfies Partial<Record<string, { label: string; variant: string }>>;

export function TicketThreadRowButton({ thread, onOpenThread }: TicketThreadRowButtonProps) {
  return (
    <button
      type="button"
      className="flex items-start gap-2.5 rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-accent/30"
      onClick={() => onOpenThread(thread.threadId)}
    >
      {thread.isOrchestrationThread ? (
        <SearchCheckIcon className="mt-0.5 size-3.5 shrink-0 text-info-foreground" />
      ) : (
        <FileCode2Icon className="mt-0.5 size-3.5 shrink-0 text-success-foreground" />
      )}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <span className="truncate text-foreground">{thread.title}</span>
        {thread.linkTypes.map((linkType) => {
          const config = LINK_BADGE_CONFIG[linkType as keyof typeof LINK_BADGE_CONFIG];
          if (!config) return null;
          return (
            <Badge key={linkType} size="sm" variant={config.variant}>
              {config.label}
            </Badge>
          );
        })}
        {thread.archivedAt && (
          <Badge size="sm" variant="outline">
            Archived
          </Badge>
        )}
        {thread.isOrchestrationThread && (
          <Badge size="sm" variant="info">
            Review
          </Badge>
        )}
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock3Icon className="size-3 shrink-0" />
          <span>{formatRelativeDate(thread.linkedAt)}</span>
        </span>
      </div>
    </button>
  );
}

interface TicketOriginThreadSectionProps {
  readonly thread: TicketLinkedThread;
  readonly onOpenThread: (threadId: string) => void;
}

export function TicketOriginThreadSection({
  thread,
  onOpenThread,
}: TicketOriginThreadSectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">Origin Thread</h3>
      <TicketThreadRowButton thread={thread} onOpenThread={onOpenThread} />
    </div>
  );
}

interface TicketRelatedThreadsSectionProps {
  readonly threads: readonly TicketLinkedThread[];
  readonly onOpenThread: (threadId: string) => void;
}

export function TicketRelatedThreadsSection({
  threads,
  onOpenThread,
}: TicketRelatedThreadsSectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        Related Threads ({threads.length})
      </h3>
      <div className="flex flex-col gap-1">
        {threads.map((thread) => (
          <TicketThreadRowButton
            key={thread.threadId}
            thread={thread}
            onOpenThread={onOpenThread}
          />
        ))}
      </div>
    </div>
  );
}
