import { describe, expect, it } from "vitest";

import { extractCanonicalTicketIdentifierCandidates } from "./ticketThreadLinking.ts";

describe("extractCanonicalTicketIdentifierCandidates", () => {
  it("matches canonical identifiers case-insensitively", () => {
    expect(
      extractCanonicalTicketIdentifierCandidates("Follow up on t3co-42 and T3CO-7 please."),
    ).toEqual(["T3CO-42", "T3CO-7"]);
  });

  it("does not partially match larger identifiers", () => {
    expect(
      extractCanonicalTicketIdentifierCandidates("This mentions T3CO-420 but not the smaller one."),
    ).toEqual(["T3CO-420"]);
  });

  it("ignores loose numbers and ticket titles", () => {
    expect(
      extractCanonicalTicketIdentifierCandidates(
        "Please revisit ticket 42 and the login overhaul.",
      ),
    ).toEqual([]);
  });
});
