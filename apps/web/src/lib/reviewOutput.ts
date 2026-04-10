import { ReviewOutput, type ReviewOutput as ReviewOutputValue } from "@t3tools/contracts";
import { parseReviewOutputJsonCandidates } from "@t3tools/shared/review";
import { Schema } from "effect";

const decodeReviewOutput = Schema.decodeUnknownOption(ReviewOutput);

export function parseReviewOutputText(text: string): ReviewOutputValue | null {
  try {
    for (const candidate of parseReviewOutputJsonCandidates(text)) {
      const decoded = decodeReviewOutput(candidate);
      if (decoded._tag === "Some") {
        return decoded.value;
      }
    }
    return null;
  } catch {
    return null;
  }
}
