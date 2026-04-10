import type { TicketSummary } from "@t3tools/contracts";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

interface MoveTicketToBoardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tickets: readonly TicketSummary[];
  pending?: boolean;
  onConfirm: () => void;
}

export function MoveTicketToBoardDialog({
  open,
  onOpenChange,
  tickets,
  pending = false,
  onConfirm,
}: MoveTicketToBoardDialogProps) {
  const count = tickets.length;
  const firstTicket = tickets[0];
  const isBulk = count > 1;

  if (!firstTicket) {
    return null;
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isBulk ? "Move all tickets to board?" : "Move sub-ticket to board?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isBulk
              ? `This will remove ${count} selected sub-tickets from their parent tickets and promote them to top-level board tickets. Their current statuses will be preserved.`
              : `This will remove "${firstTicket.identifier}: ${firstTicket.title}" from its parent ticket and promote it to a top-level board ticket. Its current status will be preserved.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose>
            <Button variant="outline" size="sm" disabled={pending}>
              Cancel
            </Button>
          </AlertDialogClose>
          <Button size="sm" disabled={pending} onClick={onConfirm}>
            {pending ? "Moving..." : "Move to board"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
