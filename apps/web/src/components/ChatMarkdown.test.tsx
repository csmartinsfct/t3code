import type { ComponentProps } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { ProposeActionEvent } from "./ChatMarkdown";
import ChatMarkdown from "./ChatMarkdown";
import { __clearDynamicChatUiFrameCacheForTests } from "./chat/DynamicChatUiArtifact";

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

const DYNAMIC_CHAT_UI_BLOCK = [
  "```t3:dynamic-chat-ui",
  JSON.stringify(
    {
      version: 1,
      id: "scenario-card",
      title: "Scenario card",
      description: "Interactive response artifact.",
      initialHeight: 240,
      html: "<!doctype html><html><body><main style='height:360px'><h1>Scenario</h1><input type='range' /></main></body></html>",
    },
    null,
    2,
  ),
  "```",
].join("\n");

const NATIVE_CODEX_VISUALIZATION_BLOCK = [
  "```t3:dynamic-chat-ui",
  JSON.stringify(
    {
      version: 1,
      id: "native-visualization",
      title: "Native visualization",
      description: "Native Codex Visualize fragment.",
      initialHeight: 240,
      html: `<!doctype html><html><body><main style="background:var(--background);color:var(--foreground);border:1px solid var(--border);font-size:var(--font-size-base)"><svg aria-label="Series" style="color:var(--muted-foreground)"><path stroke="var(--viz-series-1)" /><path stroke="var(--viz-series-2)" /><path stroke="var(--viz-series-3)" /><path stroke="var(--viz-series-4)" /><path stroke="var(--viz-series-5)" /><path stroke="var(--viz-series-6)" /></svg></main></body></html>`,
    },
    null,
    2,
  ),
  "```",
].join("\n");

const NATIVE_CODEX_MODULE_VISUALIZATION_BLOCK = [
  "```t3:dynamic-chat-ui",
  JSON.stringify(
    {
      version: 1,
      id: "native-module-visualization",
      title: "Native module visualization",
      description: "Native Codex Visualize fragment with a CDN module.",
      initialHeight: 240,
      html: `<div data-testid="d3-module-root"></div>
<script type="module">
import * as d3 from "https://esm.sh/d3@7.9.0";
const root = d3.select('[data-testid="d3-module-root"]');
root.attr("data-d3-loaded", "true");
root.append("svg").append("circle").attr("data-testid", "d3-module-mark");
window.parent.postMessage({
  source: "t3-native-module-test",
  loaded: root.attr("data-d3-loaded"),
  markCount: root.selectAll('[data-testid="d3-module-mark"]').size(),
}, "*");
</script>`,
    },
    null,
    2,
  ),
  "```",
].join("\n");

const DYNAMIC_CHAT_UI_STATUS_BLOCK = [
  "```t3:dynamic-chat-ui-status",
  JSON.stringify(
    {
      version: 1,
      title: "Scenario card",
      description: "Building the interactive view.",
      state: "generating",
    },
    null,
    2,
  ),
  "```",
].join("\n");

const DYNAMIC_CHAT_UI_MARKER_BLOCK = [
  "```t3:dynamic-chat-ui",
  JSON.stringify(
    {
      version: 1,
      id: "metadata-card",
      title: "Metadata card",
      description: "Marker stored without HTML.",
      initialHeight: 240,
      maxHeight: 420,
    },
    null,
    2,
  ),
  "```",
].join("\n");

const DYNAMIC_CHAT_UI_TALL_INITIAL_BLOCK = [
  "```t3:dynamic-chat-ui",
  JSON.stringify(
    {
      version: 1,
      id: "tight-height-card",
      title: "Tight height card",
      description: "Should shrink to content.",
      initialHeight: 700,
      maxHeight: 900,
      html: "<!doctype html><html><body><main style='height:180px;margin:0;padding:0'>Compact artifact</main></body></html>",
    },
    null,
    2,
  ),
  "```",
].join("\n");

async function mountMarkdown(props: Partial<ComponentProps<typeof ChatMarkdown>> = {}): Promise<{
  cleanup: () => Promise<void>;
  rerender: (props: Partial<ComponentProps<typeof ChatMarkdown>>) => Promise<void>;
}> {
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
    rerender: (nextProps) =>
      screen.rerender(<ChatMarkdown text="" cwd={undefined} {...nextProps} />),
  };
}

describe("ChatMarkdown", () => {
  afterEach(() => {
    __clearDynamicChatUiFrameCacheForTests();
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

  it("renders dynamic chat UI blocks as sandboxed timeline artifacts", async () => {
    const onDynamicChatUiResize = vi.fn();
    const mounted = await mountMarkdown({
      text: DYNAMIC_CHAT_UI_BLOCK,
      onDynamicChatUiResize,
    });

    try {
      expect(document.body.textContent ?? "").not.toContain("Dynamic UI");
      expect(document.body.textContent ?? "").not.toContain("Artifact height capped");

      const iframe = document.querySelector<HTMLIFrameElement>("iframe");
      expect(iframe).toBeTruthy();
      expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
      expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect(iframe?.srcdoc).toContain("Scenario");
      expect(iframe?.srcdoc).toContain("t3ChatUi");
      expect(iframe?.style.height).toBe("240px");

      await vi.waitFor(() => expect(onDynamicChatUiResize).toHaveBeenCalled());
      onDynamicChatUiResize.mockClear();
      expect(iframe?.contentWindow).toBeTruthy();
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe?.contentWindow ?? null,
          data: {
            source: "t3-dynamic-chat-ui",
            artifactId: "scenario-card",
            type: "resize",
            height: 360,
          },
        }),
      );

      await vi.waitFor(() => {
        const height = Number.parseInt(iframe?.style.height ?? "0", 10);
        expect(height).toBeGreaterThanOrEqual(360);
        expect(height).toBeLessThan(420);
        expect(onDynamicChatUiResize).toHaveBeenCalled();
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("injects native Codex Visualize theme aliases into the rendered iframe srcdoc", async () => {
    const mounted = await mountMarkdown({
      text: NATIVE_CODEX_VISUALIZATION_BLOCK,
    });

    try {
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[data-dynamic-chat-ui-artifact-id="native-visualization"]',
      );
      expect(iframe).toBeTruthy();
      const srcdoc = iframe?.srcdoc ?? "";

      for (const token of [
        "--background",
        "--foreground",
        "--card",
        "--card-foreground",
        "--popover",
        "--popover-foreground",
        "--primary",
        "--primary-foreground",
        "--secondary",
        "--secondary-foreground",
        "--muted",
        "--muted-foreground",
        "--accent",
        "--accent-foreground",
        "--destructive",
        "--border",
        "--input",
        "--ring",
        "--font-size-base",
      ]) {
        expect(srcdoc).toContain(`${token}:`);
      }

      expect(srcdoc).toContain("--viz-series-1:");
      expect(srcdoc).toContain("--viz-series-2:");
      expect(srcdoc).toContain("--viz-series-3:");
      expect(srcdoc).toContain("--viz-series-4:");
      expect(srcdoc).toContain("--viz-series-5:");
      expect(srcdoc).toContain("--viz-series-6:");

      for (const value of [
        "--viz-series-1: var(--primary);",
        "--viz-series-2: rgb(243 136 59);",
        "--viz-series-3: rgb(93 201 119);",
        "--viz-series-4: rgb(235 119 177);",
        "--viz-series-5: rgb(155 121 236);",
        "--viz-series-6: rgb(58 185 177);",
        "--viz-series-2: rgb(245 154 86);",
        "--viz-series-3: rgb(116 213 139);",
        "--viz-series-4: rgb(240 143 192);",
        "--viz-series-5: rgb(170 145 239);",
        "--viz-series-6: rgb(90 203 194);",
      ]) {
        expect(srcdoc).toContain(value);
      }
    } finally {
      await mounted.cleanup();
    }
  });

  it("runs native Codex Visualize modules from a CORS-enabled CDN", async () => {
    let resolveModuleResult: (event: MessageEvent) => void;
    const moduleResult = new Promise<MessageEvent>((resolve) => {
      resolveModuleResult = resolve;
    });
    const onMessage = (event: MessageEvent) => {
      if (event.data?.source === "t3-native-module-test") {
        resolveModuleResult(event);
      }
    };
    window.addEventListener("message", onMessage);

    const mounted = await mountMarkdown({ text: NATIVE_CODEX_MODULE_VISUALIZATION_BLOCK });

    try {
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[data-dynamic-chat-ui-artifact-id="native-module-visualization"]',
      );
      expect(iframe).toBeTruthy();

      const event = await moduleResult;
      expect(event.source).toBe(iframe?.contentWindow);
      expect(event.data).toMatchObject({ loaded: "true", markCount: 1 });
    } finally {
      window.removeEventListener("message", onMessage);
      await mounted.cleanup();
    }
  });

  it("ignores tiny dynamic chat UI iframe height jitter", async () => {
    const onDynamicChatUiResize = vi.fn();
    const mounted = await mountMarkdown({
      text: DYNAMIC_CHAT_UI_BLOCK,
      onDynamicChatUiResize,
    });

    try {
      const iframe = document.querySelector<HTMLIFrameElement>("iframe");
      expect(iframe).toBeTruthy();
      expect(iframe?.style.height).toBe("240px");
      await vi.waitFor(() => {
        expect(Number.parseInt(iframe?.style.height ?? "0", 10)).toBeGreaterThan(240);
      });
      const measuredHeight = Number.parseInt(iframe?.style.height ?? "0", 10);
      onDynamicChatUiResize.mockClear();

      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe?.contentWindow ?? null,
          data: {
            source: "t3-dynamic-chat-ui",
            artifactId: "scenario-card",
            type: "resize",
            height: measuredHeight + 2,
          },
        }),
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(iframe?.style.height).toBe(`${measuredHeight}px`);
      expect(onDynamicChatUiResize).not.toHaveBeenCalled();

      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe?.contentWindow ?? null,
          data: {
            source: "t3-dynamic-chat-ui",
            artifactId: "scenario-card",
            type: "resize",
            height: measuredHeight + 4,
          },
        }),
      );

      await vi.waitFor(() => {
        expect(iframe?.style.height).toBe(`${measuredHeight + 4}px`);
        expect(onDynamicChatUiResize).toHaveBeenCalled();
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("allows dynamic chat UI iframes to grow beyond legacy maxHeight", async () => {
    const mounted = await mountMarkdown({
      text: [
        "```t3:dynamic-chat-ui",
        JSON.stringify(
          {
            version: 1,
            id: "unbounded-card",
            title: "Unbounded card",
            description: "Can grow to fit content.",
            initialHeight: 240,
            maxHeight: 420,
            html: "<!doctype html><html><body><main style='height:1200px'>Tall artifact</main></body></html>",
          },
          null,
          2,
        ),
        "```",
      ].join("\n"),
      onDynamicChatUiResize: vi.fn(),
    });

    try {
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[data-dynamic-chat-ui-artifact-id="unbounded-card"]',
      );
      expect(iframe).toBeTruthy();
      expect(iframe?.style.height).toBe("240px");

      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe?.contentWindow ?? null,
          data: {
            source: "t3-dynamic-chat-ui",
            artifactId: "unbounded-card",
            type: "resize",
            height: 1200,
          },
        }),
      );

      await vi.waitFor(() => expect(iframe?.style.height).toBe("1200px"));
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders dynamic chat UI artifacts from message metadata", async () => {
    const mounted = await mountMarkdown({
      text: DYNAMIC_CHAT_UI_MARKER_BLOCK,
      dynamicChatUiArtifacts: [
        {
          version: 1,
          id: "metadata-card",
          title: "Metadata card",
          description: "Marker stored without HTML.",
          initialHeight: 240,
          maxHeight: 420,
          html: "<!doctype html><html><body><main><h1>Metadata artifact</h1><script>const fence = '```';</script></main></body></html>",
        },
      ],
      onDynamicChatUiResize: vi.fn(),
    });

    try {
      expect(page.getByText("Metadata card")).toBeTruthy();
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[data-dynamic-chat-ui-artifact-id="metadata-card"]',
      );
      expect(iframe).toBeTruthy();
      expect(iframe?.srcdoc).toContain("Metadata artifact");
      expect(iframe?.srcdoc).toContain("const fence = '```'");
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders dynamic chat UI status blocks as compact loading cards", async () => {
    const mounted = await mountMarkdown({
      text: DYNAMIC_CHAT_UI_STATUS_BLOCK,
    });

    try {
      expect(page.getByText("Scenario card")).toBeTruthy();
      expect(page.getByText("Building")).toBeTruthy();
      expect(page.getByText("Building the interactive view.")).toBeTruthy();
      expect(document.querySelector("iframe")).toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });

  it("shrinks dynamic chat UI iframes from an oversized initial height", async () => {
    const mounted = await mountMarkdown({
      text: DYNAMIC_CHAT_UI_TALL_INITIAL_BLOCK,
      onDynamicChatUiResize: vi.fn(),
    });

    try {
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[data-dynamic-chat-ui-artifact-id="tight-height-card"]',
      );
      expect(iframe).toBeTruthy();
      expect(iframe?.style.height).toBe("700px");

      await vi.waitFor(() => {
        const height = Number.parseInt(iframe?.style.height ?? "0", 10);
        expect(height).toBeGreaterThanOrEqual(180);
        expect(height).toBeLessThan(300);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps dynamic chat UI iframes loaded across parent markdown rerenders", async () => {
    const srcdocDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "srcdoc");
    let srcdocSetCalls = 0;

    Object.defineProperty(HTMLIFrameElement.prototype, "srcdoc", {
      configurable: true,
      get(this: HTMLIFrameElement) {
        return srcdocDescriptor?.get?.call(this) ?? this.getAttribute("srcdoc") ?? "";
      },
      set(this: HTMLIFrameElement, value: string) {
        srcdocSetCalls += 1;
        if (srcdocDescriptor?.set) {
          srcdocDescriptor.set.call(this, value);
        } else {
          this.setAttribute("srcdoc", value);
        }
      },
    });

    const mounted = await mountMarkdown({
      text: DYNAMIC_CHAT_UI_BLOCK,
      onDynamicChatUiResize: vi.fn(),
    });

    try {
      await vi.waitFor(() => expect(srcdocSetCalls).toBe(1));
      const iframe = document.querySelector<HTMLIFrameElement>("iframe");
      expect(iframe).toBeTruthy();
      expect(iframe?.srcdoc).toContain("Scenario");

      await mounted.rerender({
        text: DYNAMIC_CHAT_UI_BLOCK,
        onDynamicChatUiResize: vi.fn(),
      });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      expect(document.querySelector("iframe")).toBe(iframe);
      expect(srcdocSetCalls).toBe(1);
    } finally {
      await mounted.cleanup();
      if (srcdocDescriptor) {
        Object.defineProperty(HTMLIFrameElement.prototype, "srcdoc", srcdocDescriptor);
      }
    }
  });

  it("preserves dynamic chat UI iframes across markdown unmounts", async () => {
    const srcdocDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "srcdoc");
    let srcdocSetCalls = 0;

    Object.defineProperty(HTMLIFrameElement.prototype, "srcdoc", {
      configurable: true,
      get(this: HTMLIFrameElement) {
        return srcdocDescriptor?.get?.call(this) ?? this.getAttribute("srcdoc") ?? "";
      },
      set(this: HTMLIFrameElement, value: string) {
        srcdocSetCalls += 1;
        if (srcdocDescriptor?.set) {
          srcdocDescriptor.set.call(this, value);
        } else {
          this.setAttribute("srcdoc", value);
        }
      },
    });

    const firstMount = await mountMarkdown({
      text: DYNAMIC_CHAT_UI_BLOCK,
      onDynamicChatUiResize: vi.fn(),
    });
    let firstMountCleanedUp = false;

    try {
      await vi.waitFor(() => expect(srcdocSetCalls).toBe(1));
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[data-dynamic-chat-ui-artifact-id="scenario-card"]',
      );
      expect(iframe).toBeTruthy();

      await firstMount.cleanup();
      firstMountCleanedUp = true;
      expect(
        document.querySelector<HTMLIFrameElement>(
          '[data-dynamic-chat-ui-frame-parking-lot="true"] iframe',
        ),
      ).toBe(iframe);

      const secondMount = await mountMarkdown({
        text: DYNAMIC_CHAT_UI_BLOCK,
        onDynamicChatUiResize: vi.fn(),
      });

      try {
        await vi.waitFor(() => {
          expect(
            document.querySelector<HTMLIFrameElement>(
              'iframe[data-dynamic-chat-ui-artifact-id="scenario-card"]',
            ),
          ).toBe(iframe);
        });
        expect(srcdocSetCalls).toBe(1);
      } finally {
        await secondMount.cleanup();
      }
    } finally {
      if (!firstMountCleanedUp) {
        await firstMount.cleanup();
      }
      if (srcdocDescriptor) {
        Object.defineProperty(HTMLIFrameElement.prototype, "srcdoc", srcdocDescriptor);
      }
    }
  });
});
