import type { TicketSummary } from "@t3tools/contracts";

import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteAlertDialog, useRoutedOverlaySurface } from "~/routedOverlayAdapters";
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

const MOVE_TICKET_TO_BOARD_OVERLAY_ROUTE_KEY = "move-ticket-to-board";

type MoveTicketToBoardDialogResult = { action: "confirm" };

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
  const routed = useRoutedOverlaySurface<MoveTicketToBoardDialogResult>({
    open,
    onOpenChange,
    routeKey: MOVE_TICKET_TO_BOARD_OVERLAY_ROUTE_KEY,
    params: { pending, tickets },
    presentation: { kind: "alert-dialog" },
    enabled: firstTicket !== undefined,
    onResult: (result) => {
      if (result.action === "confirm") onConfirm();
    },
  });

  if (!firstTicket) {
    return null;
  }

  return (
    <AlertDialog open={routed.domOpen} onOpenChange={routed.onDomOpenChange}>
      <AlertDialogPopup>
        <MoveTicketToBoardDialogContent
          firstTicket={firstTicket}
          isBulk={isBulk}
          count={count}
          pending={pending}
          onConfirm={onConfirm}
        />
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function MoveTicketToBoardDialogContent({
  count,
  firstTicket,
  isBulk,
  onConfirm,
  pending,
}: {
  count: number;
  firstTicket: TicketSummary;
  isBulk: boolean;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <>
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
    </>
  );
}

registerOverlayRoute<{ pending?: unknown; tickets?: unknown }>(
  MOVE_TICKET_TO_BOARD_OVERLAY_ROUTE_KEY,
  function MoveTicketToBoardOverlayRoute({ message, controller }) {
    const tickets = readTicketSummariesParam(message.params.tickets);
    const firstTicket = tickets[0];

    if (!firstTicket) {
      controller.fail(new Error("Move-to-board dialog route requires tickets."));
      return null;
    }

    return (
      <OverlayRouteAlertDialog>
        <AlertDialogPopup>
          <MoveTicketToBoardDialogContent
            count={tickets.length}
            firstTicket={firstTicket}
            isBulk={tickets.length > 1}
            pending={message.params.pending === true}
            onConfirm={() => controller.submit({ action: "confirm" })}
          />
        </AlertDialogPopup>
      </OverlayRouteAlertDialog>
    );
  },
);

function readTicketSummariesParam(value: unknown): TicketSummary[] {
  if (!Array.isArray(value)) return [];
  return value.filter((ticket): ticket is TicketSummary => {
    if (!ticket || typeof ticket !== "object") return false;
    const candidate = ticket as { id?: unknown; identifier?: unknown; title?: unknown };
    return (
      typeof candidate.id === "string" &&
      typeof candidate.identifier === "string" &&
      typeof candidate.title === "string"
    );
  });
}
