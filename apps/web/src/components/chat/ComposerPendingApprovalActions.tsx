import { type ApprovalRequestId, type ProviderApprovalDecision } from "@t3tools/contracts";
import { memo } from "react";
import { type PendingApproval } from "../../session-logic";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  requestKind: PendingApproval["requestKind"];
  isResponding: boolean;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<void>;
}

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  requestKind,
  isResponding,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const isPlanApproval = requestKind === "plan";
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "cancel")}
      >
        {isPlanApproval ? "Cancel plan" : "Cancel turn"}
      </Button>
      <Button
        size="sm"
        variant="destructive-outline"
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "decline")}
      >
        {isPlanApproval ? "Reject plan" : "Decline"}
      </Button>
      {!isPlanApproval ? (
        <Button
          size="sm"
          variant="outline"
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, "acceptForSession")}
        >
          Always allow this session
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="default"
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "accept")}
      >
        {isPlanApproval ? "Accept plan" : "Approve once"}
      </Button>
    </>
  );
});
