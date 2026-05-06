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

const IMAGE_EXTENSION_CONFIRM_ROUTE_KEY = "image-extension-confirm";

type ImageExtensionConfirmResult = { action: "keep" | "use" };

interface ImageExtensionConfirmDialogProps {
  from: string;
  onKeep: () => void;
  onOpenChange: (open: boolean) => void;
  onUse: () => void;
  open: boolean;
  to: string;
}

export function ImageExtensionConfirmDialog({
  from,
  onKeep,
  onOpenChange,
  onUse,
  open,
  to,
}: ImageExtensionConfirmDialogProps) {
  const routed = useRoutedOverlaySurface<ImageExtensionConfirmResult>({
    open,
    onOpenChange,
    routeKey: IMAGE_EXTENSION_CONFIRM_ROUTE_KEY,
    params: { from, to },
    presentation: { kind: "alert-dialog" },
    enabled: from.length > 0 && to.length > 0,
    onResult: (result) => {
      if (result.action === "keep") onKeep();
      else onUse();
    },
  });

  return (
    <AlertDialog open={routed.domOpen} onOpenChange={routed.onDomOpenChange}>
      <AlertDialogPopup>
        <ImageExtensionConfirmContent from={from} to={to} onKeep={onKeep} onUse={onUse} />
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function ImageExtensionConfirmContent({
  from,
  onKeep,
  onUse,
  to,
}: {
  from: string;
  onKeep: () => void;
  onUse: () => void;
  to: string;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Use "{to}"?</AlertDialogTitle>
        <AlertDialogDescription>
          If you change the filename extension from "{from}" to "{to}", your file may open in a
          different application.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose>
          <Button variant="outline" onClick={onKeep}>
            Keep "{from}"
          </Button>
        </AlertDialogClose>
        <Button onClick={onUse}>Use "{to}"</Button>
      </AlertDialogFooter>
    </>
  );
}

registerOverlayRoute<{ from?: unknown; to?: unknown }>(
  IMAGE_EXTENSION_CONFIRM_ROUTE_KEY,
  function ImageExtensionConfirmOverlayRoute({ message, controller }) {
    const from = readStringParam(message.params.from);
    const to = readStringParam(message.params.to);
    if (from.length === 0 || to.length === 0) {
      controller.fail(new Error("Image extension confirmation requires from/to extensions."));
      return null;
    }

    return (
      <OverlayRouteAlertDialog>
        <AlertDialogPopup>
          <ImageExtensionConfirmContent
            from={from}
            to={to}
            onKeep={() => controller.submit({ action: "keep" })}
            onUse={() => controller.submit({ action: "use" })}
          />
        </AlertDialogPopup>
      </OverlayRouteAlertDialog>
    );
  },
);

function readStringParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}
