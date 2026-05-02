import { makeProviderKind, providerProfileId, type ProviderKind } from "@t3tools/contracts";
import type { CursorProfileSettings } from "@t3tools/contracts/settings";
import type { CursorSettings, ServerSettings } from "@t3tools/contracts";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface DiscoveredCursorProfile {
  readonly profileId: string;
  readonly providerKind: ProviderKind;
  readonly homePath: string;
  readonly configDir: string;
  readonly dataDir: string;
  readonly displayName: string;
}

export function defaultCursorProfilesRoot(): string {
  return path.join(os.homedir(), ".cursor-profiles");
}

export function defaultCursorProfileHomePath(profileId: string): string {
  return path.join(defaultCursorProfilesRoot(), profileId);
}

function makeDiscoveredCursorProfile(profileId: string, homePath: string): DiscoveredCursorProfile {
  const cursorDir = path.join(homePath, ".cursor");
  return {
    profileId,
    providerKind: makeProviderKind("cursor", profileId),
    homePath,
    configDir: cursorDir,
    dataDir: cursorDir,
    displayName: `Cursor (${profileId})`,
  };
}

/**
 * Scan `~/.cursor-profiles/*` for profile homes. This matches the validated
 * local `cursor-metric` layout without assuming the Bash function itself is
 * visible to the T3 server process.
 */
export function discoverCursorProfiles(): Effect.Effect<ReadonlyArray<DiscoveredCursorProfile>> {
  return Effect.sync(() => {
    const root = defaultCursorProfilesRoot();
    const profiles: DiscoveredCursorProfile[] = [];

    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      return profiles;
    }

    for (const entry of entries) {
      if (!/^[a-zA-Z0-9_-]+$/.test(entry)) continue;

      const fullPath = path.join(root, entry);
      try {
        if (!fs.statSync(fullPath).isDirectory()) continue;
      } catch {
        continue;
      }

      profiles.push(makeDiscoveredCursorProfile(entry, fullPath));
    }

    return profiles;
  });
}

export function mergeCursorProfiles(
  discovered: ReadonlyArray<DiscoveredCursorProfile>,
  configured: ReadonlyArray<CursorProfileSettings>,
): ReadonlyArray<DiscoveredCursorProfile> {
  const configuredIds = new Set(configured.map((profile) => profile.profileId));
  const merged: DiscoveredCursorProfile[] = [];

  for (const profile of configured) {
    const homePath = profile.homePath || defaultCursorProfileHomePath(profile.profileId);
    const configDir = profile.configDir || path.join(homePath, ".cursor");
    const dataDir = profile.dataDir || configDir;
    merged.push({
      profileId: profile.profileId,
      providerKind: makeProviderKind("cursor", profile.profileId),
      homePath,
      configDir,
      dataDir,
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

export function resolveCursorSettingsForProvider(
  settings: ServerSettings,
  providerKind: ProviderKind,
): CursorSettings {
  const profileId = providerProfileId(providerKind);
  if (!profileId) {
    return settings.providers.cursor;
  }

  const configured = settings.providers.cursorProfiles.find(
    (candidate) => candidate.profileId === profileId,
  );
  const homePath = configured?.homePath || defaultCursorProfileHomePath(profileId);
  const configDir = configured?.configDir || path.join(homePath, ".cursor");
  const dataDir = configured?.dataDir || configDir;

  return {
    enabled: configured?.enabled ?? settings.providers.cursor.enabled,
    binaryPath: configured?.binaryPath || settings.providers.cursor.binaryPath,
    launchCommand:
      configured && configured.launchCommand.length > 0
        ? configured.launchCommand
        : settings.providers.cursor.launchCommand,
    homePath,
    configDir,
    dataDir,
    env: {
      ...settings.providers.cursor.env,
      ...configured?.env,
    },
    customModels: configured?.customModels ?? settings.providers.cursor.customModels,
  };
}
