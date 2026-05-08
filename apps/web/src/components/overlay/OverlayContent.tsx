import type { RefObject } from "react";

import type { OverlayRenderMessage } from "@t3tools/contracts";

import { OverlayAlertDialog } from "./OverlayAlertDialog";
import { OverlayComposerCommand } from "./OverlayComposerCommand";
import { OverlayImagePreview } from "./OverlayImagePreview";
import { OverlayRoute } from "./OverlayRoute";
import type { OverlayBridgeHandle } from "./overlayTypes";

interface OverlayContentProps {
  message: OverlayRenderMessage;
  anchorRef: RefObject<HTMLDivElement | null>;
  bridge: OverlayBridgeHandle;
}

export function OverlayContent({ message, anchorRef, bridge }: OverlayContentProps) {
  switch (message.type) {
    case "composer-command":
      return <OverlayComposerCommand message={message} anchorRef={anchorRef} bridge={bridge} />;
    case "alert-dialog":
      return <OverlayAlertDialog message={message} bridge={bridge} />;
    case "image-preview":
      return <OverlayImagePreview message={message} bridge={bridge} />;
    case "route":
      return <OverlayRoute message={message} anchorRef={anchorRef} bridge={bridge} />;
    // Phase 2 types — not yet implemented.
    case "dialog":
    case "sheet":
    case "command":
      return null;
    default:
      return null;
  }
}
