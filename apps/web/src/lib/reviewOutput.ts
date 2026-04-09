import { ReviewOutput, type ReviewOutput as ReviewOutputValue } from "@t3tools/contracts";
import { Schema } from "effect";

const decodeReviewOutput = Schema.decodeUnknownOption(ReviewOutput);

export function parseReviewOutputText(text: string): ReviewOutputValue | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    const decoded = decodeReviewOutput(JSON.parse(trimmed));
    return decoded._tag === "Some" ? decoded.value : null;
  } catch {
    return null;
  }
}
