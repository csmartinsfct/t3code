import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts/settings";

import { mergeCursorProfiles, resolveCursorSettingsForProvider } from "./cursorProfileDiscovery";

describe("cursor profile discovery", () => {
  it("does not synthesize Cursor profile HOME/config/data paths", () => {
    const profiles = mergeCursorProfiles([
      {
        profileId: "metric",
        displayName: "Cursor (metric)",
        enabled: true,
        binaryPath: "agent",
        launchCommand: ["cursor-metric"],
        homePath: "",
        configDir: "",
        dataDir: "",
        env: {},
        customModels: [],
      },
    ]);

    expect(profiles).toEqual([
      {
        profileId: "metric",
        providerKind: "cursor:metric",
        displayName: "Cursor (metric)",
      },
    ]);
  });

  it("inherits blank environment paths from the base Cursor settings only", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        cursor: {
          ...DEFAULT_SERVER_SETTINGS.providers.cursor,
          enabled: true,
          homePath: "",
          configDir: "",
          dataDir: "",
          customModels: ["base-model"],
        },
        cursorProfiles: [
          {
            profileId: "metric",
            displayName: "Cursor (metric)",
            enabled: true,
            binaryPath: "agent",
            launchCommand: ["bash", "-lc", 'agent "$@"', "cursor-wrapper"],
            homePath: "",
            configDir: "",
            dataDir: "",
            env: { CURSOR_EXPERIMENT: "1" },
            customModels: ["profile-model"],
          },
        ],
      },
    };

    expect(resolveCursorSettingsForProvider(settings, "cursor:metric")).toMatchObject({
      enabled: true,
      binaryPath: "agent",
      launchCommand: ["bash", "-lc", 'agent "$@"', "cursor-wrapper"],
      homePath: "",
      configDir: "",
      dataDir: "",
      env: { CURSOR_EXPERIMENT: "1" },
      customModels: ["profile-model"],
    });
  });
});
