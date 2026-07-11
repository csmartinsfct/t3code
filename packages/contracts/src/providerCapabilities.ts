import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind as ProviderKindSchema, type ProviderKind } from "./providerKind";

export const ProviderCapabilityKind = Schema.Literals([
  "plugin",
  "skill",
  "agent",
  "mcp-server",
  "hook",
  "tool",
]);
export type ProviderCapabilityKind = typeof ProviderCapabilityKind.Type;

function providerCapabilityProviderKind(): Schema.Codec<ProviderKind, string, never, never> {
  return ProviderKindSchema as unknown as Schema.Codec<ProviderKind, string, never, never>;
}

export const ProviderCapabilityEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  provider: Schema.suspend(() => providerCapabilityProviderKind()),
  kind: ProviderCapabilityKind,
  name: TrimmedNonEmptyString,
  path: Schema.optional(TrimmedNonEmptyString),
  displayName: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  parentId: Schema.optional(TrimmedNonEmptyString),
  parentDisplayName: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  installed: Schema.optional(Schema.Boolean),
  needsAuth: Schema.optional(Schema.Boolean),
  capabilityRootPath: Schema.optional(TrimmedNonEmptyString),
  appIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  iconPath: Schema.optional(Schema.String),
  iconUrl: Schema.optional(Schema.String),
});
export type ProviderCapabilityEntry = typeof ProviderCapabilityEntry.Type;

export const SelectedProviderCapability = Schema.Struct({
  provider: Schema.suspend(() => providerCapabilityProviderKind()),
  kind: ProviderCapabilityKind,
  id: TrimmedNonEmptyString,
  name: Schema.optional(TrimmedNonEmptyString),
  path: Schema.optional(TrimmedNonEmptyString),
  displayName: TrimmedNonEmptyString,
  parentId: Schema.optional(TrimmedNonEmptyString),
  parentDisplayName: Schema.optional(TrimmedNonEmptyString),
  capabilityRootPath: Schema.optional(TrimmedNonEmptyString),
  appIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  iconPath: Schema.optional(Schema.String),
  iconUrl: Schema.optional(Schema.String),
});
export type SelectedProviderCapability = typeof SelectedProviderCapability.Type;

export const ResolveProviderCapabilitiesInput = Schema.Struct({
  provider: Schema.suspend(() => providerCapabilityProviderKind()),
  cwd: TrimmedNonEmptyString,
});
export type ResolveProviderCapabilitiesInput = typeof ResolveProviderCapabilitiesInput.Type;

export const ResolveProviderCapabilitiesResult = Schema.Struct({
  capabilities: Schema.Array(ProviderCapabilityEntry),
});
export type ResolveProviderCapabilitiesResult = typeof ResolveProviderCapabilitiesResult.Type;
