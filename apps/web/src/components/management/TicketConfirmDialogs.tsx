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

const TICKET_CONFIRM_OVERLAY_ROUTES = {
  selectionDelete: "ticket-selection-delete-confirm",
  selectionArchive: "ticket-selection-archive-confirm",
  ticketDelete: "ticket-delete-confirm",
  ticketArchive: "ticket-archive-confirm",
  subTicketsArchive: "sub-tickets-archive-confirm",
} as const;

type ConfirmDialogResult = { action: "confirm" };

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
}

interface CountConfirmationDialogProps extends ConfirmationDialogProps {
  count: number;
}

interface TicketConfirmationDialogProps extends ConfirmationDialogProps {
  ticket: Pick<TicketSummary, "identifier" | "title">;
}

export function TicketSelectionDeleteConfirmDialog({
  count,
  onConfirm,
  onOpenChange,
  open,
  pending = false,
}: CountConfirmationDialogProps) {
  const routed = useRoutedOverlaySurface<ConfirmDialogResult>({
    open,
    onOpenChange,
    routeKey: TICKET_CONFIRM_OVERLAY_ROUTES.selectionDelete,
    params: { count, pending },
    presentation: { kind: "alert-dialog" },
    enabled: count > 0,
    onResult: async (result) => {
      if (result.action === "confirm") await onConfirm();
    },
  });

  return (
    <AlertDialog open={routed.domOpen} onOpenChange={routed.onDomOpenChange}>
      <AlertDialogPopup>
        <TicketSelectionDeleteConfirmContent
          count={count}
          pending={pending}
          onConfirm={onConfirm}
        />
      </AlertDialogPopup>
    </AlertDialog>
  );
}

export function TicketSelectionArchiveConfirmDialog({
  count,
  onConfirm,
  onOpenChange,
  open,
  pending = false,
}: CountConfirmationDialogProps) {
  const routed = useRoutedOverlaySurface<ConfirmDialogResult>({
    open,
    onOpenChange,
    routeKey: TICKET_CONFIRM_OVERLAY_ROUTES.selectionArchive,
    params: { count, pending },
    presentation: { kind: "alert-dialog" },
    enabled: count > 0,
    onResult: async (result) => {
      if (result.action === "confirm") await onConfirm();
    },
  });

  return (
    <AlertDialog open={routed.domOpen} onOpenChange={routed.onDomOpenChange}>
      <AlertDialogPopup>
        <TicketSelectionArchiveConfirmContent
          count={count}
          pending={pending}
          onConfirm={onConfirm}
        />
      </AlertDialogPopup>
    </AlertDialog>
  );
}

export function TicketDeleteConfirmDialog({
  onConfirm,
  onOpenChange,
  open,
  pending = false,
  ticket,
}: TicketConfirmationDialogProps) {
  const routed = useRoutedOverlaySurface<ConfirmDialogResult>({
    open,
    onOpenChange,
    routeKey: TICKET_CONFIRM_OVERLAY_ROUTES.ticketDelete,
    params: { pending, ticket },
    presentation: { kind: "alert-dialog" },
    onResult: async (result) => {
      if (result.action === "confirm") await onConfirm();
    },
  });

  return (
    <AlertDialog open={routed.domOpen} onOpenChange={routed.onDomOpenChange}>
      <AlertDialogPopup>
        <TicketDeleteConfirmContent ticket={ticket} pending={pending} onConfirm={onConfirm} />
      </AlertDialogPopup>
    </AlertDialog>
  );
}

export function TicketArchiveConfirmDialog({
  onConfirm,
  onOpenChange,
  open,
  pending = false,
  ticket,
}: TicketConfirmationDialogProps) {
  const routed = useRoutedOverlaySurface<ConfirmDialogResult>({
    open,
    onOpenChange,
    routeKey: TICKET_CONFIRM_OVERLAY_ROUTES.ticketArchive,
    params: { pending, ticket },
    presentation: { kind: "alert-dialog" },
    onResult: async (result) => {
      if (result.action === "confirm") await onConfirm();
    },
  });

  return (
    <AlertDialog open={routed.domOpen} onOpenChange={routed.onDomOpenChange}>
      <AlertDialogPopup>
        <TicketArchiveConfirmContent ticket={ticket} pending={pending} onConfirm={onConfirm} />
      </AlertDialogPopup>
    </AlertDialog>
  );
}

export function SubTicketsArchiveConfirmDialog({
  count,
  onConfirm,
  onOpenChange,
  open,
  pending = false,
}: CountConfirmationDialogProps) {
  const routed = useRoutedOverlaySurface<ConfirmDialogResult>({
    open,
    onOpenChange,
    routeKey: TICKET_CONFIRM_OVERLAY_ROUTES.subTicketsArchive,
    params: { count, pending },
    presentation: { kind: "alert-dialog" },
    enabled: count > 0,
    onResult: async (result) => {
      if (result.action === "confirm") await onConfirm();
    },
  });

  return (
    <AlertDialog open={routed.domOpen} onOpenChange={routed.onDomOpenChange}>
      <AlertDialogPopup>
        <SubTicketsArchiveConfirmContent count={count} pending={pending} onConfirm={onConfirm} />
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function TicketSelectionDeleteConfirmContent({
  count,
  onConfirm,
  pending,
}: {
  count: number;
  onConfirm: () => void | Promise<void>;
  pending: boolean;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {count === 1 ? "Delete this ticket?" : `Delete ${count} tickets?`}
        </AlertDialogTitle>
        <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
        <Button variant="destructive" onClick={() => void onConfirm()} disabled={pending}>
          {pending ? "Deleting..." : "Delete"}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

function TicketSelectionArchiveConfirmContent({
  count,
  onConfirm,
  pending,
}: {
  count: number;
  onConfirm: () => void | Promise<void>;
  pending: boolean;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {count === 1 ? "Archive this ticket?" : `Archive ${count} tickets?`}
        </AlertDialogTitle>
        <AlertDialogDescription>
          Sub-tickets will also be archived. You can restore them from Settings → Archived tickets.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
        <Button variant="destructive" onClick={() => void onConfirm()} disabled={pending}>
          {pending ? "Archiving..." : "Archive"}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

function TicketDeleteConfirmContent({
  onConfirm,
  pending,
  ticket,
}: {
  onConfirm: () => void | Promise<void>;
  pending: boolean;
  ticket: Pick<TicketSummary, "identifier" | "title">;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete ticket?</AlertDialogTitle>
        <AlertDialogDescription>
          This will permanently delete "{ticket.identifier}: {ticket.title}" and all its data. This
          action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose>
          <Button variant="outline" size="sm" disabled={pending}>
            Cancel
          </Button>
        </AlertDialogClose>
        <Button variant="destructive" size="sm" onClick={() => void onConfirm()} disabled={pending}>
          Delete
        </Button>
      </AlertDialogFooter>
    </>
  );
}

function TicketArchiveConfirmContent({
  onConfirm,
  pending,
  ticket,
}: {
  onConfirm: () => void | Promise<void>;
  pending: boolean;
  ticket: Pick<TicketSummary, "identifier" | "title">;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Archive ticket?</AlertDialogTitle>
        <AlertDialogDescription>
          "{ticket.identifier}: {ticket.title}" and any sub-tickets will be archived. You can
          restore them from Settings → Archived tickets.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose>
          <Button variant="outline" size="sm" disabled={pending}>
            Cancel
          </Button>
        </AlertDialogClose>
        <Button variant="destructive" size="sm" onClick={() => void onConfirm()} disabled={pending}>
          Archive
        </Button>
      </AlertDialogFooter>
    </>
  );
}

function SubTicketsArchiveConfirmContent({
  count,
  onConfirm,
  pending,
}: {
  count: number;
  onConfirm: () => void | Promise<void>;
  pending: boolean;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {count === 1 ? "Archive this ticket?" : `Archive ${count} tickets?`}
        </AlertDialogTitle>
        <AlertDialogDescription>
          Sub-tickets will also be archived. You can restore them from Settings → Archived tickets.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose>
          <Button variant="outline" size="sm" disabled={pending}>
            Cancel
          </Button>
        </AlertDialogClose>
        <Button variant="destructive" size="sm" onClick={() => void onConfirm()} disabled={pending}>
          {pending ? "Archiving..." : "Archive"}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

registerOverlayRoute<{ count?: unknown; pending?: unknown }>(
  TICKET_CONFIRM_OVERLAY_ROUTES.selectionDelete,
  function TicketSelectionDeleteConfirmOverlayRoute({ message, controller }) {
    const count = readCountParam(message.params.count);
    if (count <= 0) {
      controller.fail(new Error("Ticket selection delete confirmation requires a count."));
      return null;
    }

    return (
      <OverlayRouteAlertDialog>
        <AlertDialogPopup>
          <TicketSelectionDeleteConfirmContent
            count={count}
            pending={message.params.pending === true}
            onConfirm={() => controller.submit({ action: "confirm" })}
          />
        </AlertDialogPopup>
      </OverlayRouteAlertDialog>
    );
  },
);

registerOverlayRoute<{ count?: unknown; pending?: unknown }>(
  TICKET_CONFIRM_OVERLAY_ROUTES.selectionArchive,
  function TicketSelectionArchiveConfirmOverlayRoute({ message, controller }) {
    const count = readCountParam(message.params.count);
    if (count <= 0) {
      controller.fail(new Error("Ticket selection archive confirmation requires a count."));
      return null;
    }

    return (
      <OverlayRouteAlertDialog>
        <AlertDialogPopup>
          <TicketSelectionArchiveConfirmContent
            count={count}
            pending={message.params.pending === true}
            onConfirm={() => controller.submit({ action: "confirm" })}
          />
        </AlertDialogPopup>
      </OverlayRouteAlertDialog>
    );
  },
);

registerOverlayRoute<{ pending?: unknown; ticket?: unknown }>(
  TICKET_CONFIRM_OVERLAY_ROUTES.ticketDelete,
  function TicketDeleteConfirmOverlayRoute({ message, controller }) {
    const ticket = readTicketParam(message.params.ticket);
    if (!ticket) {
      controller.fail(new Error("Ticket delete confirmation requires a ticket."));
      return null;
    }

    return (
      <OverlayRouteAlertDialog>
        <AlertDialogPopup>
          <TicketDeleteConfirmContent
            ticket={ticket}
            pending={message.params.pending === true}
            onConfirm={() => controller.submit({ action: "confirm" })}
          />
        </AlertDialogPopup>
      </OverlayRouteAlertDialog>
    );
  },
);

registerOverlayRoute<{ pending?: unknown; ticket?: unknown }>(
  TICKET_CONFIRM_OVERLAY_ROUTES.ticketArchive,
  function TicketArchiveConfirmOverlayRoute({ message, controller }) {
    const ticket = readTicketParam(message.params.ticket);
    if (!ticket) {
      controller.fail(new Error("Ticket archive confirmation requires a ticket."));
      return null;
    }

    return (
      <OverlayRouteAlertDialog>
        <AlertDialogPopup>
          <TicketArchiveConfirmContent
            ticket={ticket}
            pending={message.params.pending === true}
            onConfirm={() => controller.submit({ action: "confirm" })}
          />
        </AlertDialogPopup>
      </OverlayRouteAlertDialog>
    );
  },
);

registerOverlayRoute<{ count?: unknown; pending?: unknown }>(
  TICKET_CONFIRM_OVERLAY_ROUTES.subTicketsArchive,
  function SubTicketsArchiveConfirmOverlayRoute({ message, controller }) {
    const count = readCountParam(message.params.count);
    if (count <= 0) {
      controller.fail(new Error("Sub-ticket archive confirmation requires a count."));
      return null;
    }

    return (
      <OverlayRouteAlertDialog>
        <AlertDialogPopup>
          <SubTicketsArchiveConfirmContent
            count={count}
            pending={message.params.pending === true}
            onConfirm={() => controller.submit({ action: "confirm" })}
          />
        </AlertDialogPopup>
      </OverlayRouteAlertDialog>
    );
  },
);

function readCountParam(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function readTicketParam(value: unknown): Pick<TicketSummary, "identifier" | "title"> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { identifier?: unknown; title?: unknown };
  if (typeof candidate.identifier !== "string" || typeof candidate.title !== "string") return null;
  return { identifier: candidate.identifier, title: candidate.title };
}
