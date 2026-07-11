import type { SelectedProviderCapability } from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { memo } from "react";

import { Button } from "../ui/button";

interface ComposerCapabilityChipsProps {
  capabilities: readonly SelectedProviderCapability[];
  onRemove: (capabilityId: string) => void;
}

export const ComposerCapabilityChips = memo(function ComposerCapabilityChips({
  capabilities,
  onRemove,
}: ComposerCapabilityChipsProps) {
  if (capabilities.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-1 pt-2">
      {capabilities.map((capability) => (
        <div
          key={`${capability.provider}:${capability.kind}:${capability.id}`}
          className="flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-muted/60 px-2 py-1 text-xs transition-colors"
          title={
            capability.parentDisplayName
              ? `${capability.kind} · ${capability.parentDisplayName}`
              : `${capability.kind} · ${capability.provider}`
          }
        >
          <span className="truncate text-foreground">{capability.displayName}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="ml-0.5 size-4 rounded-sm text-muted-foreground/72 hover:text-foreground [&_svg]:size-2.5"
            aria-label={`Remove ${capability.displayName}`}
            onClick={() => onRemove(capability.id)}
          >
            <XIcon />
          </Button>
        </div>
      ))}
    </div>
  );
});
