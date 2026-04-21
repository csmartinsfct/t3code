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
