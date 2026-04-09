import type { OrchestrationRun } from "@t3tools/contracts";
import { EyeIcon, Loader2Icon } from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrchestrationReadOnlyComposerProps {
  run: OrchestrationRun | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OrchestrationReadOnlyComposer({ run }: OrchestrationReadOnlyComposerProps) {
  const isActive = run?.status === "running" || run?.status === "pending";

  return (
    <div className="mx-auto w-full min-w-0 max-w-[52rem]">
      <div className="rounded-[20px] border border-border bg-card px-4 py-3">
        <div className="flex items-center justify-center gap-2 text-muted-foreground/50">
          {isActive ? (
            <>
              <Loader2Icon className="size-3.5 animate-spin" />
              <span className="text-sm">Orchestration in progress</span>
            </>
          ) : (
            <>
              <EyeIcon className="size-3.5" />
              <span className="text-sm">
                Read-only — select a working thread to interact with an agent
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export type { OrchestrationReadOnlyComposerProps };
