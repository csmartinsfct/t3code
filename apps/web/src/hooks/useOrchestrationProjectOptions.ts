import { useEffect, useMemo, useState } from "react";

import {
  getOrchestrationProjectOptions,
  mapProjectsToOrchestrationProjectOptions,
  type OrchestrationProjectOption,
} from "../lib/orchestrationProjectOptions";
import { ensureNativeApi } from "../nativeApi";
import { useStore } from "../store";

export function useOrchestrationProjectOptions(): ReadonlyArray<OrchestrationProjectOption> {
  const storeProjects = useStore((store) => store.projects);
  const storeOptions = useMemo(
    () => mapProjectsToOrchestrationProjectOptions(storeProjects),
    [storeProjects],
  );
  const [fallbackOptions, setFallbackOptions] = useState<ReadonlyArray<OrchestrationProjectOption>>(
    [],
  );

  useEffect(() => {
    if (storeOptions.length > 0) return;

    let canceled = false;
    void getOrchestrationProjectOptions(ensureNativeApi())
      .then((projects) => {
        if (!canceled) setFallbackOptions(projects);
      })
      .catch(() => {});

    return () => {
      canceled = true;
    };
  }, [storeOptions.length]);

  return storeOptions.length > 0 ? storeOptions : fallbackOptions;
}
