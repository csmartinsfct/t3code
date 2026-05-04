import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import { ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import { BROWSER_HOST_TOOL_NAMES, type BrowserHostCommand } from "./BrowserHost.ts";
import { createBrowserHostResolver, getCachedBrowserHostResolver } from "./BrowserHostResolver.ts";
import { CdpBroker } from "./CdpBroker.ts";
import type { BrowserInstance, BrowserManagerServiceShape } from "./Services/BrowserManager.ts";
import { playwrightCommandDescriptors } from "./handlers.ts";

const PROJECT_ELECTRON = ProjectId.makeUnsafe("project-electron");
const PROJECT_PLAYWRIGHT = ProjectId.makeUnsafe("project-playwright");

function fakeBrowserManager(): BrowserManagerServiceShape {
  const instance: BrowserInstance = {
    _kind: "T3BrowserInstance",
    projectId: PROJECT_PLAYWRIGHT,
    userDataDir: "/tmp/t3-browser-host-resolver-test",
    inner: {},
  };
  return {
    acquire: () => Effect.succeed(instance),
    recreate: () => Effect.succeed(instance),
    release: () => Effect.void,
    releaseAll: () => Effect.void,
  };
}

function fakeElectronBroker(): CdpBroker {
  return new CdpBroker({
    send: async () => ({}),
    subscribe: async () => async () => {},
  });
}

it("BrowserHostResolver returns Electron host when broker present, Playwright otherwise (T3CO-421)", async () => {
  // No host.json setup, no on-disk state — host choice is driven entirely
  // by whether the broker is wired (desktop) or not (server-only).
  const baseDir = await fs.mkdtemp("/tmp/t3-browser-resolver-");
  const stateDir = nodePath.join(baseDir, "userdata");

  const desktop = await createBrowserHostResolver({
    stateDir,
    browser: fakeBrowserManager(),
    descriptors: playwrightCommandDescriptors,
    electronBroker: fakeElectronBroker(),
  });
  const electronHost = await Effect.runPromise(desktop.get(PROJECT_ELECTRON));
  assert.equal(electronHost.kind, "electron-wc");

  const serverOnly = await createBrowserHostResolver({
    stateDir,
    browser: fakeBrowserManager(),
    descriptors: playwrightCommandDescriptors,
  });
  const playwrightHost = await Effect.runPromise(serverOnly.get(PROJECT_PLAYWRIGHT));
  assert.equal(playwrightHost.kind, "playwright");
});

it("BrowserHostResolver memoizes Electron hosts per project across get() calls (T3CO-350)", async () => {
  const baseDir = await fs.mkdtemp("/tmp/t3-browser-resolver-");
  const stateDir = nodePath.join(baseDir, "userdata");
  const resolver = await createBrowserHostResolver({
    stateDir,
    browser: fakeBrowserManager(),
    descriptors: playwrightCommandDescriptors,
    electronBroker: fakeElectronBroker(),
  });

  const first = await Effect.runPromise(resolver.get(PROJECT_ELECTRON));
  const second = await Effect.runPromise(resolver.get(PROJECT_ELECTRON));
  assert.equal(first.kind, "electron-wc");
  // Same project must return the same instance so @ref maps, snapshot/console/
  // network/dialog buffers, and tab registry survive between HTTP requests.
  assert.strictEqual(first, second);
});

it("BrowserHostResolver concurrent get() calls return the same Electron host", async () => {
  const baseDir = await fs.mkdtemp("/tmp/t3-browser-resolver-");
  const stateDir = nodePath.join(baseDir, "userdata");
  const resolver = await createBrowserHostResolver({
    stateDir,
    browser: fakeBrowserManager(),
    descriptors: playwrightCommandDescriptors,
    electronBroker: fakeElectronBroker(),
  });

  const [a, b, c] = await Promise.all([
    Effect.runPromise(resolver.get(PROJECT_ELECTRON)),
    Effect.runPromise(resolver.get(PROJECT_ELECTRON)),
    Effect.runPromise(resolver.get(PROJECT_ELECTRON)),
  ]);
  assert.strictEqual(a, b);
  assert.strictEqual(b, c);
});

it("BrowserHostResolver.dispose disposes cached hosts and evicts the cache", async () => {
  const baseDir = await fs.mkdtemp("/tmp/t3-browser-resolver-");
  const stateDir = nodePath.join(baseDir, "userdata");
  const resolver = await createBrowserHostResolver({
    stateDir,
    browser: fakeBrowserManager(),
    descriptors: playwrightCommandDescriptors,
    electronBroker: fakeElectronBroker(),
  });

  const first = await Effect.runPromise(resolver.get(PROJECT_ELECTRON));
  await Effect.runPromise(resolver.dispose());
  const second = await Effect.runPromise(resolver.get(PROJECT_ELECTRON));
  assert.notStrictEqual(first, second, "dispose should evict cache so a fresh host is returned");
});

it("getCachedBrowserHostResolver disposes superseded entries on broker cycle", async () => {
  const baseDir = await fs.mkdtemp("/tmp/t3-browser-resolver-");
  const stateDir = nodePath.join(baseDir, "userdata");

  const brokerA = fakeElectronBroker();
  const resolverA = await getCachedBrowserHostResolver({
    stateDir,
    browser: fakeBrowserManager(),
    descriptors: playwrightCommandDescriptors,
    electronBroker: brokerA,
    electronBrokerCacheKey: "broker-a",
  });
  const hostA = await Effect.runPromise(resolverA.get(PROJECT_ELECTRON));
  // Spy on dispose — we want to confirm superseded entries actually close.
  // `BrowserHost.dispose` is declared readonly; the cast here is strictly for
  // test-observation and does not survive outside this block.
  let disposed = false;
  const mutableHostA = hostA as { dispose: () => Promise<void> };
  const originalDispose = mutableHostA.dispose;
  mutableHostA.dispose = async () => {
    disposed = true;
    await originalDispose.call(hostA);
  };

  // Simulate broker rotation: new URL/token → new cache key under the same stateDir.
  const resolverB = await getCachedBrowserHostResolver({
    stateDir,
    browser: fakeBrowserManager(),
    descriptors: playwrightCommandDescriptors,
    electronBroker: fakeElectronBroker(),
    electronBrokerCacheKey: "broker-b",
  });
  // Let the dispose microtask flush.
  await new Promise((resolve) => setImmediate(resolve));
  assert.isTrue(disposed, "superseded resolver's hosts should be disposed");
  assert.notStrictEqual(resolverA, resolverB, "broker rotation should return a fresh resolver");
});

it("BrowserHost command methods cannot return pixel streams", async () => {
  type Return = Awaited<ReturnType<BrowserHostCommand>>;
  // This type assertion is the load-bearing guard: widening BrowserHostCommand to
  // a stream/binary return type makes `bun typecheck` fail here.
  const _returnMustStayPlaintext: Return = "ok";
  assert.equal(_returnMustStayPlaintext, "ok");

  // The source scan is a defense-in-depth check against reintroducing a
  // stream-shaped sibling method in this interface or its day-1 host classes.
  const sourcePaths = [
    nodePath.join(import.meta.dirname, "BrowserHost.ts"),
    nodePath.join(import.meta.dirname, "hosts", "PlaywrightHost", "PlaywrightBrowserHost.ts"),
    nodePath.join(import.meta.dirname, "hosts", "ElectronWebContentsHost", "browserHost.ts"),
  ];
  const source = (await Promise.all(sourcePaths.map((path) => fs.readFile(path, "utf8")))).join(
    "\n",
  );
  for (const forbidden of ["AsyncIterable", "Readable", "ReadableStream", "Uint8Array"]) {
    assert.notInclude(source, forbidden);
  }
  assert.isAtLeast(BROWSER_HOST_TOOL_NAMES.length, 54);
});
