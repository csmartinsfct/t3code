// Mirrors MAX_REVIEW_ITERATIONS_UI_MAX from @t3tools/contracts/settings.
// Keeping this helper dependency-free avoids pulling the contracts schema layer
// into its small unit test.
const DEFAULT_MAX_REVIEW_ITERATIONS_UI_MAX = 10;

export function clampReviewIterations(
  rawValue: number,
  maxValue = DEFAULT_MAX_REVIEW_ITERATIONS_UI_MAX,
): number {
  return Math.max(0, Math.min(maxValue, Math.trunc(rawValue)));
}
