import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { ThreadSwitcherDropdown } from "./ThreadSwitcherDropdown";

// Audit traceability: 5b6a8b2.

describe("ThreadSwitcherDropdown", () => {
  const scrollIntoViewMock = vi.fn();
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  });

  afterEach(() => {
    scrollIntoViewMock.mockReset();
    document.body.innerHTML = "";
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("renders orchestration items and navigates to the parent timeline", async () => {
    const onNavigate = vi.fn();
    const screen = await render(
      <ThreadSwitcherDropdown
        currentLabel="T3CO-168"
        onNavigate={onNavigate}
        items={[
          {
            id: "timeline",
            kind: "timeline",
            label: "Timeline",
            sublabel: "Orchestration timeline",
            isActive: false,
            isStarted: true,
            threadId: "thread-parent",
          },
          {
            id: "thread-child",
            kind: "working-thread",
            label: "T3CO-168",
            sublabel: "Waiting child thread",
            isActive: true,
            isStarted: false,
            threadId: "thread-child",
          },
          {
            id: "thread-review",
            kind: "review-thread",
            label: "T3CO-168 Review",
            sublabel: "Waiting child thread",
            isActive: false,
            isStarted: true,
            threadId: "thread-review",
          },
        ]}
      />,
    );

    try {
      await page.getByRole("button", { name: "T3CO-168" }).click();

      await expect.element(page.getByRole("menuitem", { name: /Timeline/ })).toBeInTheDocument();
      await expect
        .element(page.getByRole("menuitem", { name: /T3CO-168 Waiting child thread/ }))
        .toBeInTheDocument();
      expect(document.body.textContent ?? "").toContain("T3CO-168 Review");
      expect(document.body.textContent ?? "").toContain("Review");

      await page.getByRole("menuitem", { name: /Timeline/ }).click();

      expect(onNavigate).toHaveBeenCalledWith("thread-parent");
    } finally {
      await screen.unmount();
    }
  });

  it("keeps waiting child threads selectable even before the agent starts", async () => {
    const onNavigate = vi.fn();
    const screen = await render(
      <ThreadSwitcherDropdown
        currentLabel="Orchestration timeline"
        onNavigate={onNavigate}
        items={[
          {
            id: "timeline",
            kind: "timeline",
            label: "Timeline",
            sublabel: "Orchestration timeline",
            isActive: true,
            isStarted: true,
            threadId: "thread-parent",
          },
          {
            id: "thread-child",
            kind: "working-thread",
            label: "T3CO-168",
            sublabel: "Waiting child thread",
            isActive: false,
            isStarted: false,
            threadId: "thread-child",
          },
        ]}
      />,
    );

    try {
      await page.getByRole("button", { name: "Orchestration timeline" }).click();
      await page.getByRole("menuitem", { name: /T3CO-168 Waiting child thread/ }).click();

      expect(onNavigate).toHaveBeenCalledWith("thread-child");
    } finally {
      await screen.unmount();
    }
  });

  it("scrolls the active review child into view when the switcher opens", async () => {
    const onNavigate = vi.fn();
    const screen = await render(
      <ThreadSwitcherDropdown
        currentLabel="T3CO-168 Review"
        onNavigate={onNavigate}
        items={[
          {
            id: "timeline",
            kind: "timeline",
            label: "Timeline",
            sublabel: "Orchestration timeline",
            isActive: false,
            isStarted: true,
            threadId: "thread-parent",
          },
          {
            id: "thread-child",
            kind: "working-thread",
            label: "T3CO-168",
            sublabel: "Waiting child thread",
            isActive: false,
            isStarted: true,
            threadId: "thread-child",
          },
          {
            id: "thread-review",
            kind: "review-thread",
            label: "T3CO-168 Review",
            sublabel: "Automated reviewer",
            isActive: true,
            isStarted: true,
            threadId: "thread-review",
          },
        ]}
      />,
    );

    try {
      await page.getByRole("button", { name: "T3CO-168 Review" }).click();

      await expect.element(page.getByRole("menuitem", { name: /T3CO-168 Review/ })).toBeVisible();
      await vi.waitFor(() => {
        expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "center" });
      });
      expect(document.body.textContent ?? "").toContain("Automated reviewer");
    } finally {
      await screen.unmount();
    }
  });
});
