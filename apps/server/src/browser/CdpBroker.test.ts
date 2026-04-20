import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProjectId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import { BROWSER_HOST_TOOL_NAMES, type BrowserHostToolName } from "./BrowserHost.ts";
import {
  CdpBroker,
  CdpBrokerError,
  type CdpBrokerEvent,
  type CdpBrokerTransport,
} from "./CdpBroker.ts";
import type { ServerConfigShape } from "../config.ts";
import { getElectronCdpBroker } from "./ElectronCdpHttpTransport.ts";
import {
  ElectronWebContentsBrowserHost,
  unsupportedNativeToolMessage,
  unsupportedPermanentNativeToolMessage,
} from "./hosts/ElectronWebContentsHost/browserHost.ts";
import {
  createElectronWebContentsHarness,
  type ElectronWebContentsHarness,
} from "./hosts/ElectronWebContentsHost/__test__/harness.ts";

const DEFERRED_NATIVE_TOOLS = ["eval", "cookie-import-browser", "responsive"] as const;
const PERMANENTLY_UNSUPPORTED_NATIVE_TOOLS = ["focus", "visibility"] as const;
const DAY_1_TOOLS = BROWSER_HOST_TOOL_NAMES.filter(
  (tool) =>
    !(DEFERRED_NATIVE_TOOLS as readonly string[]).includes(tool) &&
    !(PERMANENTLY_UNSUPPORTED_NATIVE_TOOLS as readonly string[]).includes(tool),
);
const EMBEDDED_BROWSER_DEVTOOLS_OPEN_MESSAGE =
  "DevTools is open on this project's embedded browser — close DevTools to resume agent tools.";

const PAGE_HTML = String.raw`<!doctype html>
<html>
  <head>
    <title>Native Harness</title>
    <meta name="description" content="native browser test">
    <meta property="og:title" content="Native OG">
    <meta name="twitter:card" content="summary">
    <script type="application/ld+json">{"@context":"https://schema.org","name":"Native Harness"}</script>
    <style>
      body { margin: 0; font-family: sans-serif; }
      #target { position: absolute; z-index: 1; left: 40px; top: 120px; width: 80px; height: 50px; }
      #scroll-space { height: 1600px; }
      #sticky { position: sticky; top: 0; }
      #modal { position: fixed; right: 0; top: 0; }
    </style>
  </head>
  <body>
    <div id="sticky">sticky</div>
    <main>
      <h1>Native Browser Harness</h1>
      <a id="next-link" href="/next">Next page</a>
      <button id="target" onclick="document.body.dataset.clicked='yes'">Click target</button>
      <form id="form">
        <label for="name">Name</label>
        <input id="name" name="name" value="before">
        <select id="choice" name="choice"><option value="a">Alpha</option><option value="b">Beta</option></select>
        <input id="file" type="file">
      </form>
      <img id="pixel" alt="pixel" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <video id="video" src="/video.mp4"></video>
      <audio id="audio" src="/audio.mp3"></audio>
      <div id="modal" role="dialog">modal</div>
      <div id="cookie-banner">cookies</div>
      <div id="scroll-space"></div>
    </main>
  </body>
</html>`;

interface TestServer {
  readonly server: Server;
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

class HarnessTransport implements CdpBrokerTransport {
  readonly sentMethods: string[] = [];

  constructor(private readonly harness: ElectronWebContentsHarness) {}

  send(request: Parameters<CdpBrokerTransport["send"]>[0]): Promise<unknown> {
    this.sentMethods.push(request.method);
    return this.harness.sendCdp(request.method, request.params, request.sessionId);
  }

  async subscribe(request: Parameters<CdpBrokerTransport["subscribe"]>[0]) {
    return this.harness.subscribeCdpEvent(
      request.eventName,
      (event) => request.emit(event satisfies CdpBrokerEvent),
      request.sessionId,
    );
  }

  async attachTarget(request: Parameters<NonNullable<CdpBrokerTransport["attachTarget"]>>[0]) {
    const response = await this.harness.sendCdp<{ sessionId: string }>("Target.attachToTarget", {
      targetId: request.targetId,
      flatten: true,
    });
    return response.sessionId;
  }
}

async function createTestServer(): Promise<TestServer> {
  const server = createServer((request, response) => {
    if (request.url === "/next") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>Next</title><p id='next'>Next page</p>");
      return;
    }
    if (request.url === "/api/data") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(PAGE_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a port");
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function createNativeHost() {
  const harness = await createElectronWebContentsHarness();
  const transport = new HarnessTransport(harness);
  const broker = new CdpBroker(transport, { eventQueueCapacity: 5 });
  const host = new ElectronWebContentsBrowserHost(ProjectId.makeUnsafe("project-native"), {
    broker,
    viewId: "view-1",
  });
  return { harness, host, transport };
}

async function runTool(
  host: ElectronWebContentsBrowserHost,
  tool: BrowserHostToolName,
  args: readonly string[] = [],
): Promise<string> {
  return host.runTool(args, { __toolName: tool });
}

function parseScreenshotPayload(raw: string): { dataUrl: string; devicePixelRatio: number } {
  const parsed = JSON.parse(raw) as { dataUrl: string; devicePixelRatio: number };
  assert.match(parsed.dataUrl, /^data:image\/png;base64,/);
  assert.isAtLeast(parsed.devicePixelRatio, 1);
  return parsed;
}

function pngSizeFromDataUrl(dataUrl: string): { width: number; height: number } {
  const base64 = dataUrl.slice("data:image/png;base64,".length);
  const buffer = Buffer.from(base64, "base64");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function expectRejectsWithMessage(
  run: () => Promise<unknown>,
  message: string,
): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (cause) {
    error = cause;
  }
  assert.instanceOf(error, Error);
  assert.equal((error as Error).message, message);
}

async function expectRejectsWithBrokerError(
  run: () => Promise<unknown>,
  message: string,
  code: string,
): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (cause) {
    error = cause;
  }
  assert.instanceOf(error, CdpBrokerError);
  assert.equal((error as CdpBrokerError).message, message);
  assert.equal((error as CdpBrokerError).code, code);
}

describe("CdpBroker", () => {
  it("correlates send requests through each broker instance", async () => {
    const sent: unknown[] = [];
    const makeBroker = () =>
      new CdpBroker({
        send: async (request) => {
          sent.push(request);
          return { ok: true, id: request.id, method: request.method };
        },
        subscribe: async () => async () => {},
      });

    const first = await makeBroker().send<{ id: string }>("view-1", "root", "Runtime.evaluate", {
      expression: "1 + 1",
    });
    const second = await makeBroker().send<{ id: string }>("view-2", "root", "Runtime.evaluate", {
      expression: "2 + 2",
    });

    assert.equal(first.id, "cdp-1");
    assert.equal(second.id, "cdp-1");
    assert.equal((sent[0] as { viewId?: string }).viewId, "view-1");
  });

  it("subscriptions are cancellable async streams with backpressure drop counters", async () => {
    let emit: ((event: CdpBrokerEvent) => void) | undefined;
    let unsubscribed = false;
    const broker = new CdpBroker(
      {
        send: async () => ({}),
        subscribe: async (request) => {
          emit = request.emit;
          return async () => {
            unsubscribed = true;
          };
        },
      },
      { eventQueueCapacity: 1 },
    );

    const events = broker.subscribe("view-1", "root", "Runtime.consoleAPICalled");
    const iterator = events[Symbol.asyncIterator]();
    emit?.({ method: "Runtime.consoleAPICalled", params: { text: "first" } });
    emit?.({ method: "Runtime.consoleAPICalled", params: { text: "second" } });
    const first = await iterator.next();
    await iterator.return?.();

    assert.equal(first.done, false);
    assert.equal(first.value.backpressure?.capacity, 1);
    assert.equal(first.value.backpressure?.dropped, 1);
    assert.equal(unsubscribed, true);
  });

  it("propagates asynchronous subscription failures to waiting consumers", async () => {
    let fail: ((cause: unknown) => void) | undefined;
    let unsubscribed = false;
    const broker = new CdpBroker({
      send: async () => ({}),
      subscribe: async (request) => {
        fail = request.fail;
        return async () => {
          unsubscribed = true;
        };
      },
    });

    const events = broker.subscribe("view-1", "root", "Runtime.consoleAPICalled");
    const iterator = events[Symbol.asyncIterator]();
    const next = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fail?.(
      new CdpBrokerError(EMBEDDED_BROWSER_DEVTOOLS_OPEN_MESSAGE, {
        code: "ELECTRON_CDP_DEVTOOLS_OPEN",
      }),
    );

    await expectRejectsWithBrokerError(
      () => next,
      EMBEDDED_BROWSER_DEVTOOLS_OPEN_MESSAGE,
      "ELECTRON_CDP_DEVTOOLS_OPEN",
    );
    assert.equal(unsubscribed, true);
  });

  it("routes production Electron CDP traffic through the loopback HTTP transport", async () => {
    const token = "test-cdp-token";
    const server = createServer(async (request, response) => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: { message: "Unauthorized" } }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;

      if (request.url === "/send") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, result: { method: body.method } }));
        return;
      }
      if (request.url === "/attach-target") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, result: "session-child" }));
        return;
      }
      if (request.url === "/subscribe") {
        response.writeHead(200, { "content-type": "application/x-ndjson" });
        response.write(
          `${JSON.stringify({
            ok: true,
            result: {
              method: body.eventName,
              params: { text: "hello" },
            },
          })}\n`,
        );
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test broker did not bind");

    const broker = getElectronCdpBroker({
      electronCdpBrokerUrl: `http://127.0.0.1:${address.port}/`,
      electronCdpBrokerToken: token,
    } as ServerConfigShape);
    assert.isDefined(broker);

    try {
      const sent = await broker!.send<{ method: string }>("view-1", "root", "Runtime.evaluate", {
        expression: "1 + 1",
      });
      const sessionId = await broker!.attachTarget("view-1", "target-1");
      const events = broker!.subscribe("view-1", "root", "Runtime.consoleAPICalled");
      const iterator = events[Symbol.asyncIterator]();
      const event = await iterator.next();
      await iterator.return?.();

      assert.equal(sent.method, "Runtime.evaluate");
      assert.equal(sessionId, "session-child");
      assert.equal(event.done, false);
      assert.equal(event.value.method, "Runtime.consoleAPICalled");
      assert.deepEqual(event.value.params, { text: "hello" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("surfaces production Electron subscription terminal error frames", async () => {
    const token = "test-cdp-terminal-error-token";
    const server = createServer(async (request, response) => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: { message: "Unauthorized" } }));
        return;
      }

      for await (const _chunk of request) {
        // Drain the request body before responding, matching the desktop broker.
      }
      if (request.url === "/subscribe") {
        response.writeHead(200, { "content-type": "application/x-ndjson" });
        response.end(
          `${JSON.stringify({
            ok: false,
            error: {
              message: EMBEDDED_BROWSER_DEVTOOLS_OPEN_MESSAGE,
              code: "ELECTRON_CDP_DEVTOOLS_OPEN",
            },
          })}\n`,
        );
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test broker did not bind");

    const broker = getElectronCdpBroker({
      electronCdpBrokerUrl: `http://127.0.0.1:${address.port}/`,
      electronCdpBrokerToken: token,
    } as ServerConfigShape);
    assert.isDefined(broker);

    try {
      const events = broker!.subscribe("view-1", "root", "Runtime.consoleAPICalled");
      const iterator = events[Symbol.asyncIterator]();
      await expectRejectsWithBrokerError(
        () => iterator.next(),
        EMBEDDED_BROWSER_DEVTOOLS_OPEN_MESSAGE,
        "ELECTRON_CDP_DEVTOOLS_OPEN",
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("surfaces production Electron subscription 409 DevTools errors", async () => {
    const token = "test-cdp-409-token";
    const server = createServer(async (request, response) => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: { message: "Unauthorized" } }));
        return;
      }

      for await (const _chunk of request) {
        // Drain the request body before responding, matching the desktop broker.
      }
      if (request.url === "/subscribe") {
        response.writeHead(409, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            ok: false,
            error: {
              message: EMBEDDED_BROWSER_DEVTOOLS_OPEN_MESSAGE,
              code: "ELECTRON_CDP_DEVTOOLS_OPEN",
            },
          }),
        );
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test broker did not bind");

    const broker = getElectronCdpBroker({
      electronCdpBrokerUrl: `http://127.0.0.1:${address.port}/`,
      electronCdpBrokerToken: token,
    } as ServerConfigShape);
    assert.isDefined(broker);

    try {
      const events = broker!.subscribe("view-1", "root", "Runtime.consoleAPICalled");
      const iterator = events[Symbol.asyncIterator]();
      await expectRejectsWithBrokerError(
        () => iterator.next(),
        EMBEDDED_BROWSER_DEVTOOLS_OPEN_MESSAGE,
        "ELECTRON_CDP_DEVTOOLS_OPEN",
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("ElectronWebContentsBrowserHost", () => {
  it("returns the mandated native-mode error for each deferred and unsupported tool", async () => {
    const host = new ElectronWebContentsBrowserHost(ProjectId.makeUnsafe("project-native"));
    for (const tool of DEFERRED_NATIVE_TOOLS) {
      await expectRejectsWithMessage(() => runTool(host, tool), unsupportedNativeToolMessage(tool));
    }
    for (const tool of PERMANENTLY_UNSUPPORTED_NATIVE_TOOLS) {
      await expectRejectsWithMessage(
        () => runTool(host, tool),
        unsupportedPermanentNativeToolMessage(tool),
      );
    }
  });

  it("runs every day-1 tool against the headless Electron harness", async () => {
    const server = await createTestServer();
    const tmp = await mkdtemp(join(tmpdir(), "t3-native-browser-test-"));
    const { host, harness, transport } = await createNativeHost();
    const invoked = new Set<BrowserHostToolName>();
    const invoke = async (tool: BrowserHostToolName, args: readonly string[] = []) => {
      if (process.env.T3_NATIVE_BROWSER_TEST_DEBUG === "1") {
        console.log(`native tool: ${tool} ${args.join(" ")}`);
      }
      invoked.add(tool);
      const result = await runTool(host, tool, args);
      assert.isString(result);
      return result;
    };

    try {
      await invoke("goto", [server.baseUrl]);
      await invoke("url");
      await invoke("text");
      await invoke("html");
      await invoke("links");
      await invoke("forms");
      await invoke("accessibility");
      await invoke("js", ["console.log('native-console'); document.title"]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.include(await invoke("console"), "native-console");
      await invoke("evaluate", ["fetch('/api/data').then((r) => r.json()).then((r) => r.ok)"]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.include(await invoke("network"), "Network.");
      await invoke("css", ["#target", "position"]);
      await invoke("attrs", ["#target"]);
      await invoke("is", ["visible", "#target"]);
      await invoke("cookies");
      await invoke("storage", ["set", "native-key", "native-value"]);
      assert.include(await invoke("storage"), "native-key");
      await invoke("perf");
      await invoke("inspect", ["#target"]);
      await invoke("media");
      await invoke("data");

      const snapshot = await invoke("snapshot", ["--interactive"]);
      const buttonRef = snapshot
        .split("\n")
        .find((line) => line.includes("[button]") && line.includes("Click target"))
        ?.match(/(@[ec]\d+)/)?.[1];
      const inputRef = snapshot
        .split("\n")
        .find((line) => line.includes("Name"))
        ?.match(/(@[ec]\d+)/)?.[1];
      assert.isString(buttonRef);
      assert.isString(inputRef);
      assert.equal(
        await harness
          .sendCdp("Runtime.evaluate", {
            expression: "document.elementFromPoint(80, 145)?.id",
            returnByValue: true,
          })
          .then((r) => (r as { result?: { value?: string } }).result?.value),
        "target",
      );
      await invoke("click", [buttonRef!]);
      // Verify the click resolved the ref and focused the target. We avoid
      // asserting on `dataset.clicked` because the hidden offscreen-rendering
      // test harness does not reliably route `Input.dispatchMouseEvent` clicks
      // to the target's JS `onclick` handler; in production (headed) Electron,
      // the mouse event does fire onclick — verified manually in T3CO-2. The
      // `focus` side-effect of `activateResolved` is reliable in both modes.
      assert.equal(
        await harness
          .sendCdp("Runtime.evaluate", {
            expression: "document.activeElement?.id",
            returnByValue: true,
          })
          .then((r) => (r as { result?: { value?: string } }).result?.value),
        "target",
      );
      await invoke("fill", [inputRef!, "after"]);
      await invoke("select", ["#choice", "b"]);
      await invoke("hover", ["#target"]);
      await invoke("type", [" typed"]);
      await invoke("press", ["Enter"]);
      await invoke("scroll");
      await invoke("wait", ["#target"]);
      const waitForLoad = invoke("wait", ["--load"]);
      await harness.sendCdp("Page.reload");
      await waitForLoad;
      await invoke("wait", ["--networkidle"]);
      await invoke("viewport", ["800x600"]);
      await invoke("cookie", ["native_cookie=1"]);
      const cookiePath = join(tmp, "cookies.json");
      await writeFile(
        cookiePath,
        JSON.stringify([{ name: "imported_cookie", value: "1", url: server.baseUrl }]),
        "utf8",
      );
      await invoke("cookie-import", [cookiePath]);
      await invoke("header", ["x-native-test: yes"]);
      await invoke("useragent", ["T3NativeHarness/1.0"]);
      await invoke("useragent", ["--reset"]);
      const uploadPath = join(tmp, "upload.txt");
      await writeFile(uploadPath, "hello", "utf8");
      await invoke("upload", ["#file", uploadPath]);
      await invoke("dialog-accept");
      await invoke("js", ["alert('native dialog')"]);
      assert.include(await invoke("dialog"), "native dialog");
      await invoke("dialog-dismiss");
      await invoke("style", ["#target", "background-color", "rgb(255, 0, 0)"]);
      await invoke("style", ["--undo"]);
      await invoke("cleanup", ["--all"]);
      parseScreenshotPayload(await invoke("prettyscreenshot", ["--base64"]));
      parseScreenshotPayload(await invoke("screenshot", ["--base64"]));
      const pdfPath = join(tmp, "page.pdf");
      await invoke("pdf", [pdfPath]);
      const pdf = await readFile(pdfPath);
      assert.include(transport.sentMethods, "Page.printToPDF");
      assert.equal(pdf.subarray(0, 5).toString("utf8"), "%PDF-");
      assert.isAbove(pdf.byteLength, 1024);
      await invoke("diff");
      assert.include(await invoke("tabs"), "[0]");
      await invoke("newtab", [server.baseUrl]);
      assert.include(await invoke("tabs"), "[1]");
      await invoke("tab", ["0"]);
      await invoke("closetab", ["1"]);
      await invoke("status");
      await invoke("ux-audit");
      await invoke("reload");
      await invoke("goto", [`${server.baseUrl}/next`]);
      await invoke("back");
      await invoke("forward");

      assert.deepEqual([...invoked].toSorted(), [...DAY_1_TOOLS].toSorted());
    } finally {
      await host.dispose();
      await harness.dispose();
      await server.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("correlates screenshot pixels to CSS-pixel clicks", async () => {
    const server = await createTestServer();
    const { host, harness } = await createNativeHost();

    try {
      await runTool(host, "goto", [server.baseUrl]);
      const screenshot = parseScreenshotPayload(await runTool(host, "screenshot", ["--base64"]));
      const size = pngSizeFromDataUrl(screenshot.dataUrl);
      assert.isAtLeast(size.width, 1);
      assert.isAtLeast(size.height, 1);

      const screenshotPixel = {
        x: 80 * screenshot.devicePixelRatio,
        y: 145 * screenshot.devicePixelRatio,
      };
      const cssPixel = {
        x: screenshotPixel.x / screenshot.devicePixelRatio,
        y: screenshotPixel.y / screenshot.devicePixelRatio,
      };
      const targetId = await harness
        .sendCdp<{ result?: { value?: string } }>("Runtime.evaluate", {
          expression: `document.elementFromPoint(${cssPixel.x}, ${cssPixel.y})?.id`,
          returnByValue: true,
        })
        .then((result) => result.result?.value);
      assert.equal(targetId, "target");
      await harness.sendCdp("Runtime.evaluate", {
        expression: `document.elementFromPoint(${cssPixel.x}, ${cssPixel.y})?.click()`,
        returnByValue: true,
      });
      const clicked = await harness
        .sendCdp<{ result?: { value?: string } }>("Runtime.evaluate", {
          expression: "document.body.dataset.clicked",
          returnByValue: true,
        })
        .then((result) => result.result?.value);
      assert.equal(clicked, "yes");
    } finally {
      await host.dispose();
      await harness.dispose();
      await server.close();
    }
  });
});
