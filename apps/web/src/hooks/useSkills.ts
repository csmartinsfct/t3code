import { useEffect, useRef, useState } from "react";

import type { SkillEntry } from "@t3tools/contracts";
import { readNativeApi } from "../nativeApi";

const EMPTY: readonly SkillEntry[] = [];
const POLL_INTERVAL_MS = 5_000;

/**
 * Discover skill files from known directories for the given working directory.
 * Polls every ~5 s to pick up new or removed skills automatically.
 */
export function useSkills(cwd: string | undefined): readonly SkillEntry[] {
  const [skills, setSkills] = useState<readonly SkillEntry[]>(EMPTY);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!cwd) {
      setSkills(EMPTY);
      return;
    }

    let cancelled = false;

    const fetchSkills = () => {
      const api = readNativeApi();
      if (!api || cancelled) return;
      api.server
        .resolveSkills({ cwd })
        .then((result) => {
          if (!cancelled) {
            setSkills(result.skills.length > 0 ? result.skills : EMPTY);
          }
        })
        .catch((error) => {
          console.error("[useSkills] RPC failed:", error);
        });
    };

    // Fetch immediately, then poll.
    fetchSkills();
    intervalRef.current = setInterval(fetchSkills, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [cwd]);

  return skills;
}
