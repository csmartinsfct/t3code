import { Schema } from "effect";

export const BASE_PROVIDER_KINDS = ["codex", "claudeAgent", "gemini", "cursor"] as const;
export type BaseProviderKind = (typeof BASE_PROVIDER_KINDS)[number];
export const BaseProviderKind = Schema.Literals(BASE_PROVIDER_KINDS);

export type ProviderKind =
  | BaseProviderKind
  | `codex:${string}`
  | `claudeAgent:${string}`
  | `gemini:${string}`
  | `cursor:${string}`;

/**
 * Runtime Schema that validates profiled provider kinds like "claudeAgent:zbd".
 *
 * IMPORTANT: The runtime regex accepts profiled variants ("claudeAgent:zbd"),
 * but the TS type is narrowed to base kinds for struct-field compatibility.
 * Use {@link asProviderInput} at call sites that need to pass profiled kinds
 * through schema-validated boundaries.
 */
export const ProviderKind = Schema.String.check(
  Schema.isPattern(/^(codex|claudeAgent|gemini|cursor)(:[a-zA-Z0-9_-]+)?$/),
) as unknown as typeof BaseProviderKind;

/**
 * Safely narrow a full ProviderKind (possibly profiled) for use as a
 * schema-validated provider input field. The runtime schema accepts profiled
 * kinds; this is a compile-time bridge to satisfy the narrow TS type.
 */
export function asProviderInput(kind: ProviderKind): BaseProviderKind {
  return kind as BaseProviderKind;
}

/** Extract the base provider kind from a (possibly profiled) ProviderKind. */
export function baseProviderKind(kind: ProviderKind): BaseProviderKind {
  const idx = kind.indexOf(":");
  return (idx === -1 ? kind : kind.slice(0, idx)) as BaseProviderKind;
}

/** Extract the profile id suffix, if any. */
export function providerProfileId(kind: ProviderKind): string | undefined {
  const idx = kind.indexOf(":");
  return idx === -1 ? undefined : kind.slice(idx + 1);
}

/** Construct a ProviderKind from a base kind and optional profile id. */
export function makeProviderKind(base: BaseProviderKind, profileId?: string): ProviderKind {
  return profileId ? `${base}:${profileId}` : base;
}

/** Type guard for ProviderKind (accepts profiled variants). */
export function isValidProviderKind(value: string): value is ProviderKind {
  return (
    value === "codex" ||
    value === "claudeAgent" ||
    value === "gemini" ||
    value === "cursor" ||
    value.startsWith("codex:") ||
    value.startsWith("claudeAgent:") ||
    value.startsWith("gemini:") ||
    value.startsWith("cursor:")
  );
}

export const DEFAULT_PROVIDER_KIND: BaseProviderKind = "codex";
