import type { ComponentProps } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { ProposeActionEvent } from "./ChatMarkdown";
import ChatMarkdown from "./ChatMarkdown";

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

const PROPOSE_ACTION_BLOCK = [
  "```t3:propose-action",
  "{",
  '  "name": "Start preview",',
  '  "command": "bun run dev",',
  '  "icon": "play",',
  '  "services": [',
  "    {",
  '      "name": "Preview",',
  '      "healthCheck": {',
  '        "type": "url",',
  '        "url": "http://localhost:3773"',
  "      }",
  "    }",
  "  ]",
  "}",
  "```",
].join("\n");

async function mountMarkdown(
  props: Partial<ComponentProps<typeof ChatMarkdown>> = {},
): Promise<{ cleanup: () => Promise<void> }> {
  const host = document.createElement("div");
  document.body.append(host);

  const screen = await render(<ChatMarkdown text="" cwd={undefined} {...props} />, {
    container: host,
  });

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("ChatMarkdown", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders internal ticket links as anchors when a handler is available", async () => {
    const mounted = await mountMarkdown({
      text: "[T3CO-191](t3://ticket/T3CO-191)",
      onOpenTicketLink: () => {},
    });

    try {
      const link = document.querySelector<HTMLAnchorElement>('a[href="t3://ticket/T3CO-191"]');
      expect(link).toBeTruthy();
      expect(link?.textContent).toBe("T3CO-191");
      expect(document.querySelector('[data-slot="badge"]')?.className).toContain("font-mono");
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders ticket links as inert text when no handler is provided", async () => {
    const mounted = await mountMarkdown({
      text: "[T3CO-191](t3://ticket/T3CO-191)",
    });

    try {
      expect(document.querySelector('[data-slot="badge"]')?.textContent).toBe("T3CO-191");
      expect(document.querySelector('a[href="t3://ticket/T3CO-191"]')).toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders backtick-wrapped ticket links as badges, not inline code", async () => {
    const mounted = await mountMarkdown({
      text: "The ticket `[METR-39](t3://ticket/METR-39)` is done.",
      onOpenTicketLink: () => {},
    });

    try {
      const link = document.querySelector<HTMLAnchorElement>('a[href="t3://ticket/METR-39"]');
      expect(link).toBeTruthy();
      expect(document.querySelector('[data-slot="badge"]')?.textContent).toBe("METR-39");
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders external links with normal outbound attributes", async () => {
    const mounted = await mountMarkdown({
      text: "[OpenAI](https://openai.com/)",
    });

    try {
      const link = document.querySelector<HTMLAnchorElement>('a[href="https://openai.com/"]');
      expect(link).toBeTruthy();
      expect(link?.target).toBe("_blank");
      expect(link?.rel).toBe("noopener noreferrer");
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps file links on the internal file-link path", async () => {
    const mounted = await mountMarkdown({
      text: "[ChatView](/tmp/demo.ts:12:3)",
      onOpenFileLink: () => {},
    });

    try {
      const link = document.querySelector<HTMLAnchorElement>('a[href="/tmp/demo.ts:12:3"]');
      expect(link).toBeTruthy();
      expect(link?.target).toBe("");
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders propose-action markdown blocks as editable cards and accepts edited values", async () => {
    // Audit traceability: ea4d857, 0ae911d.
    const onProposeAction = vi.fn<(event: ProposeActionEvent) => void>();
    const mounted = await mountMarkdown({
      text: PROPOSE_ACTION_BLOCK,
      onProposeAction,
    });

    try {
      expect(page.getByText("Proposed Action")).toBeTruthy();
      expect(page.getByText("Preview")).toBeTruthy();
      expect(page.getByText("http://localhost:3773")).toBeTruthy();

      await page.getByPlaceholder("Action name").fill("Start local preview");
      await page.getByPlaceholder("Command").fill("bun run dev --hot");
      await page.getByRole("button", { name: "Accept" }).click();

      expect(onProposeAction).toHaveBeenCalledWith({
        action: "accept",
        name: "Start local preview",
        command: "bun run dev --hot",
        icon: "play",
        services: [
          {
            name: "Preview",
            healthCheck: {
              type: "url",
              url: "http://localhost:3773",
            },
          },
        ],
      });
      expect(page.getByText("Added")).toBeTruthy();
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders propose-action markdown blocks as editable cards and rejects them", async () => {
    const onProposeAction = vi.fn<(event: ProposeActionEvent) => void>();
    const mounted = await mountMarkdown({
      text: PROPOSE_ACTION_BLOCK,
      onProposeAction,
    });

    try {
      await page.getByRole("button", { name: "Reject" }).click();

      expect(onProposeAction).toHaveBeenCalledWith({
        action: "reject",
        name: "Start preview",
        command: "bun run dev",
        icon: "play",
      });
      expect(page.getByText("Rejected")).toBeTruthy();
    } finally {
      await mounted.cleanup();
    }
  });
});
