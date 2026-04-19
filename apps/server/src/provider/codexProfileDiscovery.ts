import { makeProviderKind, providerProfileId, type ProviderKind } from "@t3tools/contracts";
import type { CodexProfileSettings, ServerSettings } from "@t3tools/contracts/settings";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface DiscoveredCodexProfile {
  readonly profileId: string;
  readonly providerKind: ProviderKind;
  readonly homePath: string;
  readonly displayName: string;
}

export function defaultCodexHomePath(): string {
  return path.join(os.homedir(), ".codex");
}

export function resolveCodexHomePath(settings: ServerSettings): string {
  return settings.providers.codex.homePath || defaultCodexHomePath();
}

export function resolveCodexHomePathForProfile(
  settings: ServerSettings,
  profileId: string,
): string {
  return (
    settings.providers.codexProfiles.find((profile) => profile.profileId === profileId)?.homePath ||
    path.join(os.homedir(), `.codex-${profileId}`)
  );
}

export function resolveCodexHomePathForProvider(
  settings: ServerSettings,
  provider: ProviderKind,
): string {
  const profileId = providerProfileId(provider);
  return profileId
    ? resolveCodexHomePathForProfile(settings, profileId)
    : resolveCodexHomePath(settings);
}

/**
 * Scan the home directory for `~/.codex-*` directories and return a list
 * of discovered Codex profiles. The default `~/.codex` directory is excluded
 * because it is always registered as the base `"codex"` provider.
 */
export function discoverCodexProfiles(): Effect.Effect<ReadonlyArray<DiscoveredCodexProfile>> {
  return Effect.sync(() => {
    const home = os.homedir();
    const profiles: DiscoveredCodexProfile[] = [];

    let entries: string[];
    try {
      entries = fs.readdirSync(home);
    } catch {
      return profiles;
    }

    for (const entry of entries) {
      if (!entry.startsWith(".codex-")) continue;

      const fullPath = path.join(home, entry);
      try {
        if (!fs.statSync(fullPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const profileId = entry.slice(".codex-".length);
      if (!profileId || !/^[a-zA-Z0-9_-]+$/.test(profileId)) continue;

      profiles.push({
        profileId,
        providerKind: makeProviderKind("codex", profileId),
        homePath: fullPath,
        displayName: `Codex (${profileId})`,
      });
    }

    return profiles;
  });
}

/**
 * Merge discovered profiles with explicitly configured profiles from settings.
 * Explicitly configured profiles take precedence.
 */
export function mergeCodexProfiles(
  discovered: ReadonlyArray<DiscoveredCodexProfile>,
  configured: ReadonlyArray<CodexProfileSettings>,
): ReadonlyArray<DiscoveredCodexProfile> {
  const configuredIds = new Set(configured.map((profile) => profile.profileId));
  const merged: DiscoveredCodexProfile[] = [];

  for (const profile of configured) {
    merged.push({
      profileId: profile.profileId,
      providerKind: makeProviderKind("codex", profile.profileId),
      homePath: profile.homePath,
      displayName: profile.displayName,
    });
  }

  for (const profile of discovered) {
    if (!configuredIds.has(profile.profileId)) {
      merged.push(profile);
    }
  }

  return merged;
}
