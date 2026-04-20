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

function makeResolver(stateDir: string) {
  return createBrowserHostResolver({
    stateDir,
    browser: fakeBrowserManager(),
    descriptors: playwrightCommandDescriptors,
  });
}

function fakeElectronBroker(): CdpBroker {
  return new CdpBroker({
    send: async () => ({}),
    subscribe: async () => async () => {},
  });
}

it("BrowserHostResolver seeds Electron host assignments from host.json", async () => {
  const baseDir = await fs.mkdtemp("/tmp/t3-browser-resolver-");
  const stateDir = nodePath.join(baseDir, "userdata");
  await fs.mkdir(nodePath.join(stateDir, "browser", PROJECT_ELECTRON), { recursive: true });
  await fs.writeFile(
    nodePath.join(stateDir, "browser", PROJECT_ELECTRON, "host.json"),
    JSON.stringify({ host: "electron" }),
  );

  const resolver = await makeResolver(stateDir);
  const recoveryError = await Effect.runPromise(resolver.get(PROJECT_ELECTRON).pipe(Effect.flip));
  assert.include(recoveryError.message, "recovering after a server restart");

  await Effect.runPromise(resolver.completeRestartRecovery([PROJECT_ELECTRON]));
  const electronHost = await Effect.runPromise(resolver.get(PROJECT_ELECTRON));
  const playwrightHost = await Effect.runPromise(resolver.get(PROJECT_PLAYWRIGHT));

  assert.equal(electronHost.kind, "electron-wc");
  assert.equal(playwrightHost.kind, "playwright");
});

it("BrowserHostResolver persists first Electron mount to host.json", async () => {
  const baseDir = await fs.mkdtemp("/tmp/t3-browser-resolver-");
  const stateDir = nodePath.join(baseDir, "userdata");
  const resolver = await makeResolver(stateDir);
  await Effect.runPromise(resolver.persistElectronHost(PROJECT_ELECTRON));
  const file = nodePath.join(baseDir, "userdata", "browser", PROJECT_ELECTRON, "host.json");
  const raw = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(raw) as { host?: string };
  assert.equal(parsed.host, "electron");
});

it("BrowserHostResolver returns a transient recovery error until re-announce completes", async () => {
  const baseDir = await fs.mkdtemp("/tmp/t3-browser-resolver-");
  const stateDir = nodePath.join(baseDir, "userdata");
  const resolver = await makeResolver(stateDir);
  await Effect.runPromise(resolver.persistElectronHost(PROJECT_ELECTRON));
  await Effect.runPromise(resolver.beginRestartRecovery());

  const result = await Effect.runPromise(resolver.get(PROJECT_ELECTRON).pipe(Effect.flip));
  assert.include(result.message, "recovering after a server restart");

  await Effect.runPromise(resolver.completeRestartRecovery([PROJECT_ELECTRON]));
  const host = await Effect.runPromise(resolver.get(PROJECT_ELECTRON));
  assert.equal(host.kind, "electron-wc");
  void baseDir;
});

it("BrowserHostResolver discovers host.json written after resolver creation when broker is connected", async () => {
  const baseDir = await fs.mkdtemp("/tmp/t3-browser-resolver-");
  const stateDir = nodePath.join(baseDir, "userdata");
  const resolver = await createBrowserHostResolver({
    stateDir,
    browser: fakeBrowserManager(),
    descriptors: playwrightCommandDescriptors,
    electronBroker: fakeElectronBroker(),
  });

  const playwrightHost = await Effect.runPromise(resolver.get(PROJECT_ELECTRON));
  assert.equal(playwrightHost.kind, "playwright");

  await fs.mkdir(nodePath.join(stateDir, "browser", PROJECT_ELECTRON), { recursive: true });
  await fs.writeFile(
    nodePath.join(stateDir, "browser", PROJECT_ELECTRON, "host.json"),
    JSON.stringify({ host: "electron" }),
  );

  const electronHost = await Effect.runPromise(resolver.get(PROJECT_ELECTRON));
  assert.equal(electronHost.kind, "electron-wc");
});

it("BrowserHostResolver cached startup failures are retryable", async () => {
  const baseDir = await fs.mkdtemp("/tmp/t3-browser-resolver-");
  const stateDir = nodePath.join(baseDir, "userdata");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(nodePath.join(stateDir, "browser"), "not a directory", "utf8");

  const options = {
    stateDir,
    browser: fakeBrowserManager(),
    descriptors: playwrightCommandDescriptors,
  };

  let firstFailure: unknown;
  try {
    await getCachedBrowserHostResolver(options);
  } catch (cause) {
    firstFailure = cause;
  }
  assert.isDefined(firstFailure);

  await fs.rm(nodePath.join(stateDir, "browser"), { force: true });
  const resolver = await getCachedBrowserHostResolver(options);
  const host = await Effect.runPromise(resolver.get(PROJECT_PLAYWRIGHT));
  assert.equal(host.kind, "playwright");
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
