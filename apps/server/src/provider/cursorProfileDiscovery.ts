import { makeProviderKind, providerProfileId, type ProviderKind } from "@t3tools/contracts";
import type { CursorProfileSettings } from "@t3tools/contracts/settings";
import type { CursorSettings, ServerSettings } from "@t3tools/contracts";

export interface ResolvedCursorProfile {
  readonly profileId: string;
  readonly providerKind: ProviderKind;
  readonly displayName: string;
}

export function mergeCursorProfiles(
  configured: ReadonlyArray<CursorProfileSettings>,
): ReadonlyArray<ResolvedCursorProfile> {
  return configured.map((profile) => ({
    profileId: profile.profileId,
    providerKind: makeProviderKind("cursor", profile.profileId),
    displayName: profile.displayName,
  }));
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

  return {
    enabled: configured?.enabled ?? settings.providers.cursor.enabled,
    binaryPath: configured?.binaryPath || settings.providers.cursor.binaryPath,
    launchCommand:
      configured && configured.launchCommand.length > 0
        ? configured.launchCommand
        : settings.providers.cursor.launchCommand,
    homePath: configured?.homePath || settings.providers.cursor.homePath,
    configDir: configured?.configDir || settings.providers.cursor.configDir,
    dataDir: configured?.dataDir || settings.providers.cursor.dataDir,
    env: {
      ...settings.providers.cursor.env,
      ...configured?.env,
    },
    customModels: configured?.customModels ?? settings.providers.cursor.customModels,
  };
}
