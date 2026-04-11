import {
  modelSelectionProviderKind,
  providerDisplayName,
  type ModelSelection,
} from "@t3tools/contracts";

export function formatModelSelectionSummary(selection: ModelSelection): string {
  return `${providerDisplayName(modelSelectionProviderKind(selection))} / ${selection.model}`;
}

export function resolveReviewerConfigurationSummary(
  maxReviewIterations: number,
  reviewerSelection: ModelSelection,
): string {
  return maxReviewIterations === 0
    ? "Enable in the settings"
    : formatModelSelectionSummary(reviewerSelection);
}

export function resolveTicketModelOverrideState(input: {
  override: ModelSelection | null | undefined;
  globalDefault: ModelSelection;
  disabledHref?: string;
  disabledText?: string;
}):
  | {
      kind: "disabled";
      disabledHref: string;
      disabledText: string;
    }
  | {
      kind: "picker";
      hasOverride: boolean;
      effective: ModelSelection;
    } {
  if (input.disabledHref && input.disabledText) {
    return {
      kind: "disabled",
      disabledHref: input.disabledHref,
      disabledText: input.disabledText,
    };
  }

  return {
    kind: "picker",
    hasOverride: input.override != null,
    effective: input.override ?? input.globalDefault,
  };
}
