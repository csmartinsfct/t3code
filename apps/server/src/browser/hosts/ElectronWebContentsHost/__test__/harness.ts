import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface HarnessRequest {
  id: number;
  method: "goto" | "getUrl" | "dispose";
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

type HarnessMessage = HarnessReady | HarnessResponse;

export interface ElectronWebContentsHarness {
  readonly versions: {
    readonly electron: string;
    readonly chrome: string;
  };
  goto(url: string): Promise<string>;
  getUrl(): Promise<string>;
  dispose(): Promise<void>;
}

const HARNESS_MAIN_SOURCE = `
import { app, BrowserWindow, WebContentsView } from "electron";
import { createInterface } from "node:readline";

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");

let window;
let view;

function send(message) {
  process.stdout.write("T3_ELECTRON_HARNESS " + JSON.stringify(message) + "\\n");
}

async function ensureView() {
  if (view) return view;
  await app.whenReady();
  window = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: { offscreen: true },
  });
  view = new WebContentsView();
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1024, height: 768 });
  send({
    type: "ready",
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  });
  return view;
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
    case "dispose":
      window?.close();
      app.quit();
      return undefined;
    default:
      throw new Error("Unknown harness method: " + message.method);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  try {
    const message = JSON.parse(line);
    const result = await handle(message);
    send({ id: message.id, ok: true, result });
  } catch (error) {
    send({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

ensureView().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  app.quit();
});
`;

export async function createElectronWebContentsHarness(): Promise<ElectronWebContentsHarness> {
  const dir = await mkdtemp(join(tmpdir(), "t3-electron-wc-harness-"));
  const entrypoint = join(dir, "main.mjs");
  await writeFile(entrypoint, HARNESS_MAIN_SOURCE, "utf8");

  const child = spawn("bunx", ["electron@40.6.0", entrypoint], {
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
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

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    if (process.env.T3_ELECTRON_HARNESS_DEBUG === "1") process.stderr.write(chunk);
  });

  child.once("exit", (code, signal) => {
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
      const message = JSON.parse(line.slice("T3_ELECTRON_HARNESS ".length)) as HarnessMessage;
      for (const listener of messageListeners) listener(message);
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
    async dispose() {
      if (disposed) return;
      try {
        await request("dispose");
      } finally {
        disposed = true;
        child.kill();
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
