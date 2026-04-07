import type { TicketHistoryEntry, TicketId } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { ensureNativeApi } from "../../nativeApi";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { formatFullDate, historyActionLabel } from "./ticketUtils";

interface TicketHistoryProps {
  ticketId: TicketId;
}

export function TicketHistory({ ticketId }: TicketHistoryProps) {
  const [entries, setEntries] = useState<ReadonlyArray<TicketHistoryEntry> | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (entries !== null) return;
    setLoading(true);
    try {
      const api = ensureNativeApi();
      const history = await api.ticketing.getHistory({ ticketId, limit: 50 });
      setEntries(history);
    } catch (error) {
      console.error("Failed to fetch ticket history:", error);
    } finally {
      setLoading(false);
    }
  }, [ticketId, entries]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open) void fetchHistory();
    },
    [fetchHistory],
  );

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRightIcon
          className={`size-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
        />
        History
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="mt-3 flex flex-col gap-1">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : entries && entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No history yet.</p>
          ) : entries ? (
            <>
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-0 px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                <span>Date</span>
                <span>Action</span>
                <span>By</span>
              </div>
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 rounded-md px-2 py-1.5 text-xs hover:bg-accent/30"
                >
                  <span className="text-muted-foreground">{formatFullDate(entry.performedAt)}</span>
                  <span className="text-foreground">
                    {historyActionLabel(entry.action as never)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{entry.performedBy}</span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
