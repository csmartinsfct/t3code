import { RotateCwIcon, Undo2Icon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { TabEmulation } from "./devicePresets";

interface EmbeddedBrowserViewportActionsProps {
  emulation: TabEmulation;
  onChange: (next: TabEmulation) => void;
}

// Floating action pill with rotate + reset, sibling to the main toolbar.
// Lives outside the toolbar so the user reads them as discrete actions
// rather than inputs alongside the device/dimension controls. See T3CO-423.
export function EmbeddedBrowserViewportActions({
  emulation,
  onChange,
}: EmbeddedBrowserViewportActionsProps) {
  const disabled = emulation.kind === "off";

  const handleRotate = () => {
    if (emulation.kind === "preset") {
      onChange({ ...emulation, rotated: !emulation.rotated });
      return;
    }
    if (emulation.kind === "custom") {
      onChange({
        ...emulation,
        width: emulation.height,
        height: emulation.width,
      });
    }
  };

  const handleReset = () => {
    onChange({ kind: "off" });
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Rotate viewport"
              onClick={handleRotate}
              disabled={disabled}
            >
              <RotateCwIcon className="size-3" />
            </Button>
          }
        />
        <TooltipPopup side="top">Rotate</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Reset viewport emulation"
              onClick={handleReset}
              disabled={disabled}
            >
              <Undo2Icon className="size-3" />
            </Button>
          }
        />
        <TooltipPopup side="top">Reset</TooltipPopup>
      </Tooltip>
    </div>
  );
}
