import { describe, expect, it } from "vitest";
import { TicketId } from "@t3tools/contracts";

import {
  formatModelSelectionSummary,
  resolveReviewerConfigurationSummary,
} from "./orchestrationModelDisplay";
import {
  getRunnableTicketIdentifiers,
  isOrchestrationSubmitDisabled,
  submitOrchestrationConfirm,
} from "./OrchestrateConfirmDialog";

// Audit traceability: 3be0c6e, 0d23345, 6abc967, b3db7d6, 6d20dbf.
describe("OrchestrateConfirmDialog model labels", () => {
  it("formats implementer and reviewer defaults using provider display names", () => {
    expect(
      formatModelSelectionSummary({
        provider: "codex",
        model: "gpt-5.4-mini",
      }),
    ).toBe("Codex / gpt-5.4-mini");

    expect(
      resolveReviewerConfigurationSummary(2, {
        provider: "claudeAgent",
        model: "claude-sonnet-4-6",
      }),
    ).toBe("Claude / claude-sonnet-4-6");
  });

  it("shows the settings hint when automated review is disabled", () => {
    expect(
      resolveReviewerConfigurationSummary(0, {
        provider: "codex",
        model: "gpt-5.4-mini",
      }),
    ).toBe("Enable in the settings");
  });

  it("filters skipped tickets out of the startup handoff identifiers while preserving preview order", () => {
    expect(
      getRunnableTicketIdentifiers({
        kind: "valid",
        externalDeps: [],
        orderedTickets: [
          {
            annotation: "warn-reprocess",
            selectedTicketId: TicketId.makeUnsafe("ticket-2"),
            ticket: { identifier: "T3CO-2" } as never,
          },
          {
            annotation: "will-run",
            selectedTicketId: TicketId.makeUnsafe("ticket-1"),
            ticket: { identifier: "T3CO-1" } as never,
          },
          {
            annotation: "skipped-done",
            selectedTicketId: TicketId.makeUnsafe("ticket-9"),
            ticket: { identifier: "T3CO-9" } as never,
          },
        ],
      }),
    ).toEqual(["T3CO-2", "T3CO-1"]);
  });

  it("disables submit whenever validation is blocked or startup is already in flight", () => {
    expect(
      isOrchestrationSubmitDisabled({
        plan: null,
        isSubmitting: false,
      }),
    ).toBe(true);

    expect(
      isOrchestrationSubmitDisabled({
        plan: { kind: "blocked-cycle", cycles: [] },
        isSubmitting: false,
      }),
    ).toBe(true);

    expect(
      isOrchestrationSubmitDisabled({
        plan: { kind: "valid", orderedTickets: [], externalDeps: [] },
        isSubmitting: true,
      }),
    ).toBe(true);

    expect(
      isOrchestrationSubmitDisabled({
        plan: { kind: "valid", orderedTickets: [], externalDeps: [] },
        isSubmitting: false,
      }),
    ).toBe(false);

    expect(
      isOrchestrationSubmitDisabled({
        plan: {
          kind: "valid",
          orderedTickets: [],
          externalDeps: [
            {
              ticket: { identifier: "T3CO-1" } as never,
              dependsOn: { identifier: "T3CO-2", title: "Dependency", status: "todo" },
            },
          ],
        },
        isSubmitting: false,
      }),
    ).toBe(false);
  });

  it("surfaces inline startup errors when createRun -> startRun handoff fails", async () => {
    const onConfirm = async () => {
      throw new Error("Codex app server unavailable");
    };

    await expect(
      submitOrchestrationConfirm({
        plan: {
          kind: "valid",
          externalDeps: [],
          orderedTickets: [
            {
              annotation: "will-run",
              selectedTicketId: TicketId.makeUnsafe("ticket-1"),
              ticket: { identifier: "T3CO-1" } as never,
            },
          ],
        },
        selectedTicketIdentifiers: ["T3CO-1"],
        implementerModelSelection: { provider: "codex", model: "gpt-5.4" },
        reviewerModelSelection: { provider: "codex", model: "gpt-5.4-mini" },
        onConfirm,
      }),
    ).resolves.toEqual({
      kind: "error",
      message: "Codex app server unavailable",
    });
  });

  it("treats a successful confirm callback as a started orchestration handoff", async () => {
    const onConfirm = async () => undefined;

    await expect(
      submitOrchestrationConfirm({
        plan: {
          kind: "valid",
          externalDeps: [],
          orderedTickets: [
            {
              annotation: "will-run",
              selectedTicketId: TicketId.makeUnsafe("ticket-1"),
              ticket: { identifier: "T3CO-1" } as never,
            },
          ],
        },
        selectedTicketIdentifiers: ["T3CO-1"],
        implementerModelSelection: { provider: "codex", model: "gpt-5.4" },
        reviewerModelSelection: { provider: "codex", model: "gpt-5.4-mini" },
        onConfirm,
      }),
    ).resolves.toEqual({
      kind: "started",
    });
  });
});
