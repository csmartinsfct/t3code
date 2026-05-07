import type { TicketPriority, TicketStatus } from "@t3tools/contracts";

import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { useRoutedPopoverSurface } from "~/routedPopover";
import { OverlayRoutePopover, OverlayRoutePopoverPopup } from "~/routedOverlayAdapters";

import { Badge } from "../ui/badge";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  ALL_PRIORITIES,
  ALL_STATUSES,
  PRIORITY_CONFIG,
  STATUS_CONFIG,
} from "../settings/ticketUtils";
import { PriorityIcon } from "./PriorityIcon";

const TICKET_DETAIL_FIELD_SELECT_ROUTE_KEY = "ticket-detail-field-select";

type TicketDetailFieldSelect = "status" | "priority";
type TicketDetailFieldSelectResult =
  | { field: "status"; value: TicketStatus }
  | { field: "priority"; value: TicketPriority };

export function TicketDetailStatusSelect({
  onValueChange,
  value,
}: {
  onValueChange: (value: TicketStatus) => void | Promise<void>;
  value: TicketStatus;
}) {
  const routed = useRoutedPopoverSurface<HTMLButtonElement, TicketDetailFieldSelectResult>({
    routeKey: TICKET_DETAIL_FIELD_SELECT_ROUTE_KEY,
    kind: "popover",
    side: "bottom",
    align: "start",
    params: { field: "status", value },
    onResult: (result) => {
      if (result.field === "status") void onValueChange(result.value);
    },
  });

  return (
    <Select
      value={value}
      open={routed.domOpen}
      onOpenChange={routed.onOpenChange}
      onValueChange={(v) => void onValueChange(v as TicketStatus)}
    >
      <SelectTrigger
        ref={routed.triggerRef}
        size="xs"
        variant="ghost"
        className="h-auto gap-1.5 px-1.5 py-1"
        onFocusCapture={routed.updateAnchor}
        onPointerDownCapture={routed.updateAnchor}
      >
        <Badge size="sm" variant={STATUS_CONFIG[value].badgeVariant}>
          <SelectValue />
        </Badge>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {ALL_STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            <TicketDetailStatusOption status={status} />
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function TicketDetailPrioritySelect({
  onValueChange,
  value,
}: {
  onValueChange: (value: TicketPriority) => void | Promise<void>;
  value: TicketPriority;
}) {
  const routed = useRoutedPopoverSurface<HTMLButtonElement, TicketDetailFieldSelectResult>({
    routeKey: TICKET_DETAIL_FIELD_SELECT_ROUTE_KEY,
    kind: "popover",
    side: "bottom",
    align: "start",
    params: { field: "priority", value },
    onResult: (result) => {
      if (result.field === "priority") void onValueChange(result.value);
    },
  });

  return (
    <Select
      value={value}
      open={routed.domOpen}
      onOpenChange={routed.onOpenChange}
      onValueChange={(v) => void onValueChange(v as TicketPriority)}
    >
      <SelectTrigger
        ref={routed.triggerRef}
        size="xs"
        variant="ghost"
        className="h-auto gap-1.5 px-1.5 py-1"
        onFocusCapture={routed.updateAnchor}
        onPointerDownCapture={routed.updateAnchor}
      >
        <PriorityIcon priority={value} className="size-4 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {ALL_PRIORITIES.toReversed().map((priority) => (
          <SelectItem key={priority} value={priority}>
            <TicketDetailPriorityOption priority={priority} />
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function TicketDetailStatusOption({ status }: { status: TicketStatus }) {
  return (
    <div className="flex items-center gap-2">
      <Badge size="sm" variant={STATUS_CONFIG[status].badgeVariant}>
        {STATUS_CONFIG[status].label}
      </Badge>
    </div>
  );
}

function TicketDetailPriorityOption({ priority }: { priority: TicketPriority }) {
  return (
    <div className="flex items-center gap-2">
      <PriorityIcon priority={priority} className="size-4 text-muted-foreground" />
      {PRIORITY_CONFIG[priority].label}
    </div>
  );
}

function TicketDetailFieldSelectRoutePopup({
  field,
  onSelect,
  value,
}: {
  field: TicketDetailFieldSelect;
  onSelect: (result: TicketDetailFieldSelectResult) => void;
  value: string;
}) {
  const entries =
    field === "status"
      ? ALL_STATUSES.map((status) => ({
          key: status,
          result: { field, value: status } satisfies TicketDetailFieldSelectResult,
          content: <TicketDetailStatusOption status={status} />,
        }))
      : ALL_PRIORITIES.toReversed().map((priority) => ({
          key: priority,
          result: { field, value: priority } satisfies TicketDetailFieldSelectResult,
          content: <TicketDetailPriorityOption priority={priority} />,
        }));

  return (
    <OverlayRoutePopover>
      <OverlayRoutePopoverPopup
        className="p-0 text-foreground [&>[data-slot=popover-viewport]]:p-0"
        positionerClassName="z-50 select-none transition-none"
      >
        <div className="relative h-full min-w-(--anchor-width) rounded-lg border bg-popover not-dark:bg-clip-padding shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
          <div className="max-h-(--available-height) overflow-y-auto p-1">
            {entries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className="grid min-h-8 w-full cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-sm py-1 ps-2 pe-4 text-left text-base outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground sm:min-h-7 sm:text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4"
                onClick={() => onSelect(entry.result)}
              >
                <span className="col-start-1">
                  {entry.key === value ? <TicketDetailFieldSelectCheckmark /> : null}
                </span>
                <span className="col-start-2 min-w-0">{entry.content}</span>
              </button>
            ))}
          </div>
        </div>
      </OverlayRoutePopoverPopup>
    </OverlayRoutePopover>
  );
}

function TicketDetailFieldSelectCheckmark() {
  return (
    <svg
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
    </svg>
  );
}

registerOverlayRoute<{ field?: unknown; value?: unknown }>(
  TICKET_DETAIL_FIELD_SELECT_ROUTE_KEY,
  function TicketDetailFieldSelectOverlayRoute({ message, controller }) {
    const field = readTicketDetailFieldParam(message.params.field);
    if (!field) {
      controller.fail(new Error("Ticket detail field select requires a field."));
      return null;
    }

    return (
      <TicketDetailFieldSelectRoutePopup
        field={field}
        value={readTicketDetailFieldValueParam(message.params.value)}
        onSelect={(result) => controller.submit(result)}
      />
    );
  },
);

function readTicketDetailFieldParam(value: unknown): TicketDetailFieldSelect | null {
  return value === "status" || value === "priority" ? value : null;
}

function readTicketDetailFieldValueParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}
