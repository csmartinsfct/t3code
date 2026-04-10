import { describe, expect, it } from "vitest";

import { parseReviewOutputText } from "./reviewOutput";

describe("parseReviewOutputText", () => {
  it("parses review JSON wrapped in prose and fenced code", () => {
    expect(
      parseReviewOutputText(`I reviewed the change and captured the result below.

\`\`\`json
{
  "changesNeeded": false,
  "summary": "Looks good.",
  "comments": []
}
\`\`\`

Return value above.`),
    ).toEqual({
      changesNeeded: false,
      summary: "Looks good.",
      comments: [],
    });
  });

  it("folds legacy suggestions into general suggestion comments", () => {
    expect(
      parseReviewOutputText(`{
  "changesNeeded": true,
  "summary": "Follow-up needed.",
  "comments": [],
  "suggestions": ["Add a regression test."]
}`),
    ).toEqual({
      changesNeeded: true,
      summary: "Follow-up needed.",
      comments: [
        {
          file: null,
          line: null,
          severity: "suggestion",
          body: "Add a regression test.",
        },
      ],
    });
  });

  it("returns null when the JSON candidates do not match the review contract", () => {
    expect(
      parseReviewOutputText(`{
  "summary": "Missing required fields"
}`),
    ).toBeNull();
  });
});
