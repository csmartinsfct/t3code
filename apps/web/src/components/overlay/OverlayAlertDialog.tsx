import type { OverlayAlertDialogMessage } from "@t3tools/contracts";

import type { OverlayBridgeHandle } from "./overlayTypes";

interface OverlayAlertDialogProps {
  message: OverlayAlertDialogMessage;
  bridge: OverlayBridgeHandle;
}

export function OverlayAlertDialog({ message, bridge }: OverlayAlertDialogProps) {
  const handleConfirm = () => {
    bridge.emitEvent("confirm", {});
    bridge.requestDismiss();
  };

  const handleCancel = () => {
    bridge.emitEvent("cancel", {});
    bridge.requestDismiss();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/32 backdrop-blur-sm">
      <div
        className="relative w-full max-w-lg rounded-2xl border bg-popover not-dark:bg-clip-padding px-6 py-6 text-popover-foreground shadow-lg/5"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="overlay-alert-title"
        aria-describedby="overlay-alert-desc"
      >
        <p id="overlay-alert-title" className="text-xl font-semibold text-foreground">
          {message.title}
        </p>
        <p id="overlay-alert-desc" className="mt-2 text-sm text-muted-foreground">
          {message.description}
        </p>
        <div className="mt-6 flex flex-row-reverse gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className={`inline-flex h-9 sm:h-8 items-center justify-center rounded-lg px-3 text-base sm:text-sm font-medium transition-shadow ${
              message.destructive
                ? "bg-destructive text-white hover:bg-destructive/90 shadow-destructive/24"
                : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/24"
            }`}
          >
            {message.confirmLabel ?? "Confirm"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex h-9 sm:h-8 items-center justify-center rounded-lg border border-input bg-background px-3 text-base sm:text-sm font-medium text-foreground transition-shadow hover:bg-accent"
          >
            {message.cancelLabel ?? "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
