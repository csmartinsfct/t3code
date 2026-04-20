import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface HarnessRequest {
  id: number;
  method: "goto" | "getUrl" | "cdp.send" | "cdp.subscribe" | "cdp.unsubscribe" | "dispose";
  params?: Record<string, unknown>;
}

interface HarnessResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface HarnessReady {
  type: "ready";
  electron: string;
  chrome: string;
}

interface HarnessCdpEvent {
  type: "cdp.event";
  method: string;
  params: unknown;
  sessionId?: string;
}

type HarnessMessage = HarnessReady | HarnessResponse | HarnessCdpEvent;

export interface HarnessCdpEventMessage {
  readonly method: string;
  readonly params: unknown;
  readonly sessionId?: string;
}

export interface ElectronWebContentsHarness {
  readonly versions: {
    readonly electron: string;
    readonly chrome: string;
  };
  goto(url: string): Promise<string>;
  getUrl(): Promise<string>;
  sendCdp<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T>;
  subscribeCdpEvent(
    method: string,
    listener: (event: HarnessCdpEventMessage) => void,
    sessionId?: string,
  ): Promise<() => Promise<void>>;
  dispose(): Promise<void>;
}

const electronPath = resolveElectronPath();
const CLEANUP_RETRY_COUNT = 10;
const CLEANUP_RETRY_DELAY_MS = 100;

const HARNESS_MAIN_SOURCE = `
import { app, BrowserWindow, WebContentsView } from "electron";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";

if (process.env.T3_ELECTRON_HARNESS_USER_DATA) {
  const userData = process.env.T3_ELECTRON_HARNESS_USER_DATA;
  mkdirSync(userData, { recursive: true });
  app.setPath("userData", userData);
}
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");

let window;
let rootView;
let activeTargetId = "root";
let nextTargetId = 1;
let nextSessionId = 1;
const targets = new Map();
const sessions = new Map([["root", "root"]]);
const cdpSubscriptions = new Set();

function send(message) {
  process.stdout.write("T3_ELECTRON_HARNESS " + JSON.stringify(message) + "\\n");
}

function debug(message) {
  if (process.env.T3_ELECTRON_HARNESS_DEBUG === "1") {
    console.error("[harness]", message);
  }
}

function subscriptionKey(sessionId, method) {
  return sessionId + ":" + method;
}

function sendCdpEvent(sessionId, method, params) {
  if (!cdpSubscriptions.has(subscriptionKey(sessionId, method))) return;
  send({ type: "cdp.event", method, params, sessionId });
}

async function createView(targetId, bounds = { x: 0, y: 0, width: 1024, height: 768 }) {
  debug("createView " + targetId);
  const view = new WebContentsView();
  window.contentView.addChildView(view);
  view.setBounds(bounds);
  debug("attach debugger " + targetId);
  view.webContents.debugger.attach("1.3");
  view.webContents.debugger.on("message", (_event, method, params) => {
    for (const [sessionId, mappedTargetId] of sessions) {
      if (mappedTargetId === targetId) sendCdpEvent(sessionId, method, params);
    }
  });
  targets.set(targetId, view);
  return view;
}

async function ensureView() {
  if (rootView) return rootView;
  debug("app.whenReady");
  await app.whenReady();
  debug("create BrowserWindow");
  window = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: { offscreen: true },
  });
  rootView = await createView("root");
  debug("send ready");
  send({
    type: "ready",
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  });
  return rootView;
}

function viewForSession(sessionId) {
  const targetId = sessions.get(sessionId || "root") || activeTargetId;
  const target = targets.get(targetId);
  if (!target) throw new Error("Unknown CDP session: " + sessionId);
  return { target, targetId };
}

async function sendCdpCommand(sessionId, method, params) {
  await ensureView();
  if (method === "Target.createTarget") {
    const targetId = "target-" + nextTargetId++;
    const view = await createView(targetId);
    const url = String(params?.url || "about:blank");
    await view.webContents.loadURL(url);
    return { targetId };
  }
  if (method === "Target.attachToTarget") {
    const targetId = String(params?.targetId || "");
    if (!targets.has(targetId)) throw new Error("Unknown target: " + targetId);
    const nextSession = "session-" + nextSessionId++;
    sessions.set(nextSession, targetId);
    return { sessionId: nextSession };
  }
  if (method === "Target.closeTarget") {
    const targetId = String(params?.targetId || "");
    const target = targets.get(targetId);
    if (target && target !== rootView) {
      if (target.webContents.debugger.isAttached()) target.webContents.debugger.detach();
      window.contentView.removeChildView(target);
      target.webContents.close();
      targets.delete(targetId);
      for (const [mappedSessionId, mappedTargetId] of Array.from(sessions)) {
        if (mappedTargetId === targetId) sessions.delete(mappedSessionId);
      }
    }
    return { success: true };
  }
  const { target } = viewForSession(sessionId);
  if (method === "Page.printToPDF") {
    const buffer = await target.webContents.printToPDF({ printBackground: true });
    return { data: buffer.toString("base64") };
  }
  return target.webContents.debugger.sendCommand(method, params);
}

async function handle(message) {
  const target = await ensureView();
  switch (message.method) {
    case "goto": {
      const url = String(message.params?.url ?? "");
      await target.webContents.loadURL(url);
      return target.webContents.getURL();
    }
    case "getUrl":
      return target.webContents.getURL();
    case "cdp.send": {
      const method = String(message.params?.method ?? "");
      if (!method) throw new Error("cdp.send requires params.method");
      const params = message.params?.params;
      return sendCdpCommand(String(message.params?.sessionId || "root"), method, params);
    }
    case "cdp.subscribe": {
      const method = String(message.params?.method ?? "");
      if (!method) throw new Error("cdp.subscribe requires params.method");
      const sessionId = String(message.params?.sessionId || "root");
      cdpSubscriptions.add(subscriptionKey(sessionId, method));
      return undefined;
    }
    case "cdp.unsubscribe": {
      const method = String(message.params?.method ?? "");
      if (!method) throw new Error("cdp.unsubscribe requires params.method");
      const sessionId = String(message.params?.sessionId || "root");
      cdpSubscriptions.delete(subscriptionKey(sessionId, method));
      return undefined;
    }
    case "dispose":
      for (const target of targets.values()) {
        if (target.webContents.debugger.isAttached()) target.webContents.debugger.detach();
      }
      window?.close();
      app.quit();
      return undefined;
    default:
      throw new Error("Unknown harness method: " + message.method);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
    const result = await handle(message);
    send({ id: message.id, ok: true, result });
  } catch (error) {
    send({
      id: message?.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

setImmediate(() => {
  ensureView().catch((error) => {
    console.error(error);
    process.exitCode = 1;
    app.quit();
  });
});
`;

function resolveElectronPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const desktopPackageJson = resolve(currentDir, "../../../../../../desktop/package.json");
  const desktopRequire = createRequire(desktopPackageJson);
  const resolved = desktopRequire("electron");
  if (typeof resolved !== "string") {
    throw new Error("Expected the desktop workspace electron package to resolve to a binary path");
  }
  return resolved;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeHarnessDir(dir: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < CLEANUP_RETRY_COUNT; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(CLEANUP_RETRY_DELAY_MS);
    }
  }
  await rm(dir, { recursive: true, force: true }).catch((error: unknown) => {
    throw lastError ?? error;
  });
}

export async function createElectronWebContentsHarness(): Promise<ElectronWebContentsHarness> {
  const dir = await mkdtemp(join(tmpdir(), "t3-electron-wc-harness-"));
  const entrypoint = join(dir, "main.mjs");
  await writeFile(entrypoint, HARNESS_MAIN_SOURCE, "utf8");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    T3_ELECTRON_HARNESS_USER_DATA: join(dir, "userData"),
  };
  if (process.platform === "darwin") delete env.DISPLAY;

  const child = spawn(electronPath, [entrypoint], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  let nextId = 1;
  let disposed = false;
  let childExited = false;

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    if (process.env.T3_ELECTRON_HARNESS_DEBUG === "1") process.stderr.write(chunk);
  });

  child.once("exit", (code, signal) => {
    childExited = true;
    disposed = true;
    const error = new Error(
      `Electron harness exited before responding (code=${String(code)}, signal=${String(signal)})`,
    );
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });

  let stdoutBuffer = "";
  const messageListeners = new Set<(message: HarnessMessage) => void>();
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    while (true) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline === -1) break;
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line.startsWith("T3_ELECTRON_HARNESS ")) continue;
      try {
        const message = JSON.parse(line.slice("T3_ELECTRON_HARNESS ".length)) as HarnessMessage;
        for (const listener of messageListeners) listener(message);
      } catch (error) {
        for (const waiter of pending.values()) {
          waiter.reject(error instanceof Error ? error : new Error(String(error)));
        }
        pending.clear();
      }
    }
  });

  const ready = await new Promise<HarnessReady>((resolve, reject) => {
    const onMessage = (message: HarnessMessage) => {
      if ("type" in message && message.type === "ready") {
        cleanup();
        resolve(message);
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Electron harness exited during startup (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    };
    const cleanup = () => {
      messageListeners.delete(onMessage);
      child.off("exit", onExit);
    };
    messageListeners.add(onMessage);
    child.once("exit", onExit);
  });

  messageListeners.add((message: HarnessMessage) => {
    if (!("id" in message)) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.ok) waiter.resolve(message.result);
    else waiter.reject(new Error(message.error ?? "Electron harness command failed"));
  });

  async function request<T>(method: HarnessRequest["method"], params?: Record<string, unknown>) {
    if (disposed) throw new Error("Electron harness has already been disposed");
    const id = nextId++;
    const message: HarnessRequest = params === undefined ? { id, method } : { id, method, params };
    const response = new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    child.stdin?.write(`${JSON.stringify(message)}\n`);
    return response;
  }

  return {
    versions: {
      electron: ready.electron,
      chrome: ready.chrome,
    },
    goto: (url) => request<string>("goto", { url }),
    getUrl: () => request<string>("getUrl"),
    sendCdp: (method, params, sessionId) =>
      request("cdp.send", { method, params, ...(sessionId === undefined ? {} : { sessionId }) }),
    async subscribeCdpEvent(method, listener, sessionId) {
      const onMessage = (message: HarnessMessage) => {
        if (
          !("type" in message) ||
          message.type !== "cdp.event" ||
          message.method !== method ||
          (sessionId !== undefined && message.sessionId !== sessionId)
        ) {
          return;
        }
        listener({
          method: message.method,
          params: message.params,
          ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }),
        });
      };
      messageListeners.add(onMessage);
      await request("cdp.subscribe", {
        method,
        ...(sessionId === undefined ? {} : { sessionId }),
      });
      return async () => {
        messageListeners.delete(onMessage);
        await request("cdp.unsubscribe", {
          method,
          ...(sessionId === undefined ? {} : { sessionId }),
        });
      };
    },
    async dispose() {
      if (disposed) return;
      try {
        await request("dispose");
      } finally {
        disposed = true;
        const exited =
          childExited ||
          (await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), 1_000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve(true);
            });
          }));
        if (!exited) child.kill();
        await removeHarnessDir(dir);
      }
    },
  };
}
