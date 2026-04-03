import { Effect } from "effect";
import { makeProviderKind, type ProviderKind } from "@t3tools/contracts";
import type { ClaudeProfileSettings } from "@t3tools/contracts/settings";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface DiscoveredClaudeProfile {
  readonly profileId: string;
  readonly providerKind: ProviderKind;
  readonly configDir: string;
  readonly displayName: string;
}

/**
 * Scan the home directory for `~/.claude-*` directories and return a list
 * of discovered Claude profiles.  The default `~/.claude` directory is
 * excluded — it is always registered as the base `"claudeAgent"` provider.
 */
export function discoverClaudeProfiles(): Effect.Effect<ReadonlyArray<DiscoveredClaudeProfile>> {
  return Effect.sync(() => {
    const home = os.homedir();
    const profiles: DiscoveredClaudeProfile[] = [];

    let entries: string[];
    try {
      entries = fs.readdirSync(home);
    } catch {
      return profiles;
    }

    for (const entry of entries) {
      // Match directories like .claude-zbd, .claude-metric
      if (!entry.startsWith(".claude-")) continue;

      const fullPath = path.join(home, entry);
      try {
        if (!fs.statSync(fullPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const profileId = entry.slice(".claude-".length);
      if (!profileId || !/^[a-zA-Z0-9_-]+$/.test(profileId)) continue;

      profiles.push({
        profileId,
        providerKind: makeProviderKind("claudeAgent", profileId),
        configDir: fullPath,
        displayName: `Claude (${profileId})`,
      });
    }

    return profiles;
  });
}

/**
 * Merge discovered profiles with explicitly configured profiles from
 * settings.  Explicitly configured profiles take precedence — if a
 * discovered profile has the same `profileId` as a configured one, the
 * configured version wins.
 */
export function mergeClaudeProfiles(
  discovered: ReadonlyArray<DiscoveredClaudeProfile>,
  configured: ReadonlyArray<ClaudeProfileSettings>,
): ReadonlyArray<DiscoveredClaudeProfile> {
  const configuredIds = new Set(configured.map((p) => p.profileId));
  const merged: DiscoveredClaudeProfile[] = [];

  // Add all explicitly configured profiles first
  for (const profile of configured) {
    merged.push({
      profileId: profile.profileId,
      providerKind: makeProviderKind("claudeAgent", profile.profileId),
      configDir: profile.configDir,
      displayName: profile.displayName,
    });
  }

  // Add discovered profiles that aren't already configured
  for (const profile of discovered) {
    if (!configuredIds.has(profile.profileId)) {
      merged.push(profile);
    }
  }

  return merged;
}
