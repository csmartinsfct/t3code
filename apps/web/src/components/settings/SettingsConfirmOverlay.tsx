import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { isEmbeddedBrowserMounted } from "~/embeddedBrowserModalSuspension";
import {
  isNativeOverlayAvailable,
  openNativeOverlayRoute,
  type NativeOverlayRouteResult,
} from "~/nativeOverlayBridge";
import { OverlayRouteAlertDialog } from "~/routedOverlayAdapters";
import {
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

const SETTINGS_CONFIRM_OVERLAY_ROUTE_KEY = "settings-confirm";

type SettingsConfirmResult = { action: "confirm" };

export interface SettingsConfirmOptions {
  title: string;
  description?: string | undefined;
  confirmLabel?: string | undefined;
  destructive?: boolean | undefined;
}

function messageFromOptions(options: SettingsConfirmOptions): string {
  return [options.title, options.description].filter(Boolean).join("\n\n");
}

async function fallbackConfirm(options: SettingsConfirmOptions): Promise<boolean> {
  const message = messageFromOptions(options);
  const bridge = window.desktopBridge;
  if (bridge) return bridge.confirm(message);
  if (typeof window.confirm === "function") return window.confirm(message);
  return false;
}

export async function confirmSettingsAction(options: SettingsConfirmOptions): Promise<boolean> {
  if (!isNativeOverlayAvailable() || !isEmbeddedBrowserMounted()) {
    return fallbackConfirm(options);
  }

  let fallbackValue: boolean | undefined;
  const fallback = async () => {
    fallbackValue = await fallbackConfirm(options);
  };

  const session = await openNativeOverlayRoute<SettingsConfirmResult>(
    {
      routeKey: SETTINGS_CONFIRM_OVERLAY_ROUTE_KEY,
      params: { ...options },
      presentation: { kind: "alert-dialog" },
    },
    { fallback },
  );
  if (!session) return fallbackValue ?? false;

  const result: NativeOverlayRouteResult<SettingsConfirmResult> = await session.result;
  if (result.status === "submitted") return result.value.action === "confirm";
  if (result.status === "error" && fallbackValue !== undefined) return fallbackValue;
  return false;
}

registerOverlayRoute<{
  confirmLabel?: unknown;
  description?: unknown;
  destructive?: unknown;
  title?: unknown;
}>(
  SETTINGS_CONFIRM_OVERLAY_ROUTE_KEY,
  function SettingsConfirmOverlayRoute({ controller, message }) {
    const title = typeof message.params.title === "string" ? message.params.title : "Are you sure?";
    const description =
      typeof message.params.description === "string" ? message.params.description : "";
    const confirmLabel =
      typeof message.params.confirmLabel === "string" ? message.params.confirmLabel : "Confirm";
    const destructive = message.params.destructive === true;

    return (
      <OverlayRouteAlertDialog>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </AlertDialogClose>
            <Button
              variant={destructive ? "destructive" : "default"}
              size="sm"
              onClick={() => controller.submit({ action: "confirm" })}
            >
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </OverlayRouteAlertDialog>
    );
  },
);
