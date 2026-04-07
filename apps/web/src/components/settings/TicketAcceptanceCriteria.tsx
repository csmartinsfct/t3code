import type { AcceptanceCriterion, TicketId } from "@t3tools/contracts";
import { CheckIcon, XIcon } from "lucide-react";
import { useCallback } from "react";

import { ensureNativeApi } from "../../nativeApi";
import { formatRelativeDate } from "./ticketUtils";

interface TicketAcceptanceCriteriaProps {
  ticketId: TicketId;
  criteria: ReadonlyArray<AcceptanceCriterion>;
  onUpdated: () => void;
}

export function TicketAcceptanceCriteria({
  ticketId,
  criteria,
  onUpdated,
}: TicketAcceptanceCriteriaProps) {
  const metCount = criteria.filter((c) => c.status === "met").length;

  const handleToggle = useCallback(
    async (index: number, current: AcceptanceCriterion) => {
      try {
        const api = ensureNativeApi();
        const nextStatus = current.status === "met" ? "pending" : "met";
        await api.ticketing.updateCriterionStatus({
          ticketId,
          index,
          status: nextStatus,
        });
        onUpdated();
      } catch (error) {
        console.error("Failed to update criterion status:", error);
      }
    },
    [ticketId, onUpdated],
  );

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-muted-foreground">
        Acceptance Criteria ({metCount}/{criteria.length})
      </h3>
      <div className="flex flex-col gap-1.5">
        {criteria.map((criterion, index) => (
          <div key={index} className="flex items-start gap-2.5 rounded-md px-2 py-1.5">
            <button
              type="button"
              className="mt-0.5 shrink-0"
              onClick={() => void handleToggle(index, criterion)}
            >
              {criterion.status === "met" ? (
                <div className="flex size-4 items-center justify-center rounded-[.25rem] bg-emerald-500 text-white">
                  <CheckIcon className="size-3" strokeWidth={3} />
                </div>
              ) : criterion.status === "not_met" ? (
                <div className="flex size-4 items-center justify-center rounded-[.25rem] bg-destructive text-white">
                  <XIcon className="size-3" strokeWidth={3} />
                </div>
              ) : (
                <div className="size-4 rounded-[.25rem] border border-input" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <span
                className={`text-xs ${criterion.status === "met" ? "text-muted-foreground line-through" : criterion.status === "not_met" ? "text-destructive" : "text-foreground"}`}
              >
                {criterion.text}
              </span>
              {criterion.reason && (
                <p className="mt-0.5 text-[11px] italic text-muted-foreground">
                  {criterion.reason}
                </p>
              )}
              {criterion.verifiedBy && (
                <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                  Verified by {criterion.verifiedBy}
                  {criterion.verifiedAt && ` · ${formatRelativeDate(criterion.verifiedAt)}`}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
