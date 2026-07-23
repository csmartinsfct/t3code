import type { ProviderCapabilityEntry, SelectedProviderCapability } from "@t3tools/contracts";
import { BookOpenIcon, PlugIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { cn } from "~/lib/utils";

type CapabilityWithIcon = Pick<
  ProviderCapabilityEntry | SelectedProviderCapability,
  "kind" | "displayName" | "iconPath" | "iconUrl"
>;

function isWebSafeIconSource(value: string | undefined): value is string {
  if (!value) return false;
  if (/^(https?:|data:|blob:)/i.test(value)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return false;
  if (value.startsWith("file:")) return false;
  if (value.startsWith("/")) {
    return !/^\/(?:Applications|Users|Volumes|bin|dev|etc|home|opt|private|sbin|tmp|usr|var)\//.test(
      value,
    );
  }
  return false;
}

export function resolveProviderCapabilityIconSource(capability: CapabilityWithIcon): string | null {
  if (isWebSafeIconSource(capability.iconUrl)) return capability.iconUrl;
  if (isWebSafeIconSource(capability.iconPath)) return capability.iconPath;
  return null;
}

export const ProviderCapabilityIcon = memo(function ProviderCapabilityIcon({
  capability,
  className,
}: {
  capability: CapabilityWithIcon;
  className?: string;
}) {
  const [failedIconSource, setFailedIconSource] = useState<string | null>(null);
  const iconSource = useMemo(() => resolveProviderCapabilityIconSource(capability), [capability]);
  const failed = iconSource !== null && failedIconSource === iconSource;

  if (iconSource !== null && !failed) {
    return (
      <img
        src={iconSource}
        alt=""
        aria-hidden="true"
        className={cn("size-4 shrink-0 rounded-[3px] object-contain", className)}
        loading="lazy"
        onError={() => setFailedIconSource(iconSource)}
      />
    );
  }

  const FallbackIcon = capability.kind === "plugin" ? PlugIcon : BookOpenIcon;
  return <FallbackIcon className={cn("size-4 shrink-0 text-muted-foreground/80", className)} />;
});
