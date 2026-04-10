import type { ComponentProps } from "react";
import type { FormEvent } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

async function mountPrimaryActions(props?: Partial<ComponentProps<typeof ComposerPrimaryActions>>) {
  const host = document.createElement("div");
  document.body.append(host);
  const onPreviousPendingQuestion = vi.fn();
  const onInterrupt = vi.fn();
  const onImplementPlanInNewThread = vi.fn();
  const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
  const screen = await render(
    <form onSubmit={onSubmit}>
      <ComposerPrimaryActions
        compact={false}
        pendingAction={null}
        disabled={false}
        isRunning={false}
        showPlanFollowUpPrompt={false}
        promptHasText
        isSendBusy={false}
        isConnecting={false}
        isPreparingWorktree={false}
        hasSendableContent
        onPreviousPendingQuestion={onPreviousPendingQuestion}
        onInterrupt={onInterrupt}
        onImplementPlanInNewThread={onImplementPlanInNewThread}
        {...props}
      />
    </form>,
    { container: host },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
    onImplementPlanInNewThread,
    onInterrupt,
    onPreviousPendingQuestion,
    onSubmit,
  };
}

describe("ComposerPrimaryActions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the send control disabled while waiting for the agent to start", async () => {
    // Audit traceability: 623a434, 3dd6391, 03999e7.
    const mounted = await mountPrimaryActions({
      disabled: true,
    });

    try {
      const button = page.getByRole("button", { name: "Waiting for agent to start" });
      expect(button.element()).toBeDisabled();

      await button.click();

      expect(mounted.onSubmit).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows the running interrupt control while a turn is in progress", async () => {
    const mounted = await mountPrimaryActions({
      isRunning: true,
    });

    try {
      const button = page.getByRole("button", { name: "Stop generation" });
      expect(button.element()).toBeEnabled();

      await button.click();

      expect(mounted.onInterrupt).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.cleanup();
    }
  });
});
