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

const SCHEDULED_TASK_DELETE_OVERLAY_ROUTE_KEY = "scheduled-task-delete-confirm";

type ConfirmDialogResult = { action: "confirm" };

export function ScheduledTaskDeleteConfirmDialog({
  onConfirm,
  onOpenChange,
  open,
  taskName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  taskName: string;
}) {
  const routed = useRoutedOverlaySurface<ConfirmDialogResult>({
    open,
    onOpenChange,
    routeKey: SCHEDULED_TASK_DELETE_OVERLAY_ROUTE_KEY,
    params: { taskName },
    presentation: { kind: "alert-dialog" },
    onResult: async (result) => {
      if (result.action === "confirm") await onConfirm();
    },
  });

  return (
    <AlertDialog open={routed.domOpen} onOpenChange={routed.onDomOpenChange}>
      <AlertDialogPopup>
        <ScheduledTaskDeleteConfirmContent taskName={taskName} onConfirm={onConfirm} />
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function ScheduledTaskDeleteConfirmContent({
  onConfirm,
  taskName,
}: {
  onConfirm: () => void | Promise<void>;
  taskName: string;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete scheduled task?</AlertDialogTitle>
        <AlertDialogDescription>
          This will permanently delete "{taskName}" and all its run history. This action cannot be
          undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose>
          <Button variant="outline" size="sm">
            Cancel
          </Button>
        </AlertDialogClose>
        <Button variant="destructive" size="sm" onClick={onConfirm}>
          Delete
        </Button>
      </AlertDialogFooter>
    </>
  );
}

registerOverlayRoute<{ taskName?: unknown }>(
  SCHEDULED_TASK_DELETE_OVERLAY_ROUTE_KEY,
  function ScheduledTaskDeleteOverlayRoute({ message, controller }) {
    return (
      <OverlayRouteAlertDialog>
        <AlertDialogPopup>
          <ScheduledTaskDeleteConfirmContent
            taskName={readTaskNameParam(message.params.taskName)}
            onConfirm={() => controller.submit({ action: "confirm" })}
          />
        </AlertDialogPopup>
      </OverlayRouteAlertDialog>
    );
  },
);

function readTaskNameParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}
