import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  ProviderCapabilityEntry,
  ResolveProviderCapabilitiesResult,
  SelectedProviderCapability,
} from "./providerCapabilities";

describe("provider capability contracts", () => {
  it("decodes an installed provider plugin", () => {
    const decoded = Schema.decodeUnknownSync(ProviderCapabilityEntry)({
      id: "superpowers@openai-curated-remote",
      provider: "codex",
      kind: "plugin",
      name: "superpowers",
      displayName: "Superpowers",
      description: "Planning, TDD, debugging, and delivery workflows for coding agents",
      enabled: true,
      installed: true,
      source: "openai-curated-remote",
    });

    expect(decoded.kind).toBe("plugin");
    expect(decoded.displayName).toBe("Superpowers");
  });

  it("decodes a provider skill with parent plugin metadata", () => {
    const decoded = Schema.decodeUnknownSync(ProviderCapabilityEntry)({
      id: "superpowers:brainstorming",
      provider: "codex",
      kind: "skill",
      name: "superpowers:brainstorming",
      displayName: "Brainstorming",
      parentId: "superpowers@openai-curated-remote",
      parentDisplayName: "Superpowers",
      enabled: true,
      installed: true,
    });

    expect(decoded.parentDisplayName).toBe("Superpowers");
  });

  it("decodes next-turn selected provider capabilities", () => {
    const decoded = Schema.decodeUnknownSync(SelectedProviderCapability)({
      provider: "codex",
      kind: "skill",
      id: "superpowers:using-superpowers",
      displayName: "Using Superpowers",
      parentId: "superpowers@openai-curated-remote",
      parentDisplayName: "Superpowers",
    });

    expect(decoded.id).toBe("superpowers:using-superpowers");
  });

  it("decodes capability resolution results", () => {
    const decoded = Schema.decodeUnknownSync(ResolveProviderCapabilitiesResult)({
      capabilities: [
        {
          id: "superpowers@openai-curated-remote",
          provider: "codex",
          kind: "plugin",
          name: "superpowers",
          displayName: "Superpowers",
          enabled: true,
          installed: true,
        },
      ],
    });

    expect(decoded.capabilities).toHaveLength(1);
  });
});
