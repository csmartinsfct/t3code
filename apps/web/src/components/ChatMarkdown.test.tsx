import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });
});

describe("ChatMarkdown", () => {
  it("renders internal ticket links as anchors when a handler is available", async () => {
    const { default: ChatMarkdown } = await import("./ChatMarkdown");
    const markup = renderToStaticMarkup(
      <ChatMarkdown
        text="[T3CO-191](t3://ticket/T3CO-191)"
        cwd={undefined}
        onOpenTicketLink={() => {}}
      />,
    );

    expect(markup).toContain('href="t3://ticket/T3CO-191"');
    expect(markup).toContain(">T3CO-191</a>");
  });

  it("renders ticket links as inert text when no handler is provided", async () => {
    const { default: ChatMarkdown } = await import("./ChatMarkdown");
    const markup = renderToStaticMarkup(
      <ChatMarkdown text="[T3CO-191](t3://ticket/T3CO-191)" cwd={undefined} />,
    );

    expect(markup).toContain(">T3CO-191</span>");
    expect(markup).not.toContain('href="t3://ticket/T3CO-191"');
  });

  it("renders external links with normal outbound attributes", async () => {
    const { default: ChatMarkdown } = await import("./ChatMarkdown");
    const markup = renderToStaticMarkup(
      <ChatMarkdown text="[OpenAI](https://openai.com/)" cwd={undefined} />,
    );

    expect(markup).toContain('href="https://openai.com/"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it("keeps file links on the internal file-link path", async () => {
    const { default: ChatMarkdown } = await import("./ChatMarkdown");
    const markup = renderToStaticMarkup(
      <ChatMarkdown
        text="[ChatView](/tmp/demo.ts:12:3)"
        cwd={undefined}
        onOpenFileLink={() => {}}
      />,
    );

    expect(markup).toContain('href="/tmp/demo.ts:12:3"');
    expect(markup).not.toContain('target="_blank"');
  });
});
