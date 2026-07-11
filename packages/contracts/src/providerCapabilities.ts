import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const ProviderCapabilityKind = Schema.Literals([
  "plugin",
  "skill",
  "agent",
  "mcp-server",
  "hook",
  "tool",
]);
export type ProviderCapabilityKind = typeof ProviderCapabilityKind.Type;

export const ProviderCapabilityEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  provider: Schema.suspend(() => ProviderKind),
  kind: ProviderCapabilityKind,
  name: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  parentId: Schema.optional(TrimmedNonEmptyString),
  parentDisplayName: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  installed: Schema.optional(Schema.Boolean),
  needsAuth: Schema.optional(Schema.Boolean),
  iconPath: Schema.optional(Schema.String),
  iconUrl: Schema.optional(Schema.String),
});
export type ProviderCapabilityEntry = typeof ProviderCapabilityEntry.Type;

export const SelectedProviderCapability = Schema.Struct({
  provider: Schema.suspend(() => ProviderKind),
  kind: ProviderCapabilityKind,
  id: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  parentId: Schema.optional(TrimmedNonEmptyString),
  parentDisplayName: Schema.optional(TrimmedNonEmptyString),
});
export type SelectedProviderCapability = typeof SelectedProviderCapability.Type;

export const ResolveProviderCapabilitiesInput = Schema.Struct({
  provider: Schema.suspend(() => ProviderKind),
  cwd: TrimmedNonEmptyString,
});
export type ResolveProviderCapabilitiesInput = typeof ResolveProviderCapabilitiesInput.Type;

export const ResolveProviderCapabilitiesResult = Schema.Struct({
  capabilities: Schema.Array(ProviderCapabilityEntry),
});
export type ResolveProviderCapabilitiesResult = typeof ResolveProviderCapabilitiesResult.Type;
