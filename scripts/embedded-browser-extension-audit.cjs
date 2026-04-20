#!/usr/bin/env node

const { createServer } = require("node:http");
const { mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const process = require("node:process");

const { app, BrowserWindow, session } = require("electron");

const windows = [];

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
let auditComplete = false;
app.on("before-quit", (event) => {
  if (!auditComplete) event.preventDefault();
});

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createMv2Extension(root) {
  const dir = path.join(root, "mv2-content-script");
  await mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, "manifest.json"), {
    manifest_version: 2,
    name: "T3 Audit MV2 Content Script",
    version: "1.0.0",
    content_scripts: [
      {
        matches: ["http://127.0.0.1:*/*"],
        js: ["content.js"],
        css: ["content.css"],
        run_at: "document_idle",
      },
    ],
  });
  await writeFile(
    path.join(dir, "content.js"),
    [
      "document.documentElement.dataset.t3Mv2Injected = 'yes';",
      "const marker = document.createElement('div');",
      "marker.id = 'mv2-content-marker';",
      "marker.textContent = 'mv2 injected';",
      "document.body.appendChild(marker);",
    ].join("\n"),
    "utf8",
  );
  await writeFile(path.join(dir, "content.css"), ".ad-banner { display: none !important; }\n");
  return dir;
}

async function createMv3Extension(root) {
  const dir = path.join(root, "mv3-action-popup");
  await mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, "manifest.json"), {
    manifest_version: 3,
    name: "T3 Audit MV3 Action Popup",
    version: "1.0.0",
    permissions: ["storage", "tabs", "scripting", "activeTab"],
    host_permissions: ["http://127.0.0.1:*/*"],
    background: {
      service_worker: "service-worker.js",
    },
    action: {
      default_title: "T3 Audit",
      default_popup: "popup.html",
    },
    content_scripts: [
      {
        matches: ["http://127.0.0.1:*/*"],
        js: ["content.js"],
        run_at: "document_idle",
      },
    ],
  });
  await writeFile(
    path.join(dir, "content.js"),
    [
      "chrome.runtime.sendMessage({ type: 'audit' }, (response) => {",
      "  document.documentElement.dataset.t3Mv3Response = JSON.stringify(response);",
      "});",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(dir, "service-worker.js"),
    [
      "chrome.runtime.onInstalled.addListener(() => {",
      "  chrome.storage.local.set({ installed: 'yes', installedAt: Date.now() });",
      "});",
      "",
      "chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {",
      "  if (message?.type !== 'audit') return;",
      "  chrome.storage.local.get(null, (storage) => {",
      "    sendResponse({",
      "      ok: true,",
      "      storage,",
      "      hasRuntime: typeof chrome.runtime?.getManifest === 'function',",
      "      hasStorage: Boolean(chrome.storage?.local),",
      "      hasTabs: Boolean(chrome.tabs?.query),",
      "      hasScripting: Boolean(chrome.scripting?.executeScript),",
      "      hasAction: Boolean(chrome.action),",
      "      senderHasTab: Boolean(sender?.tab),",
      "    });",
      "  });",
      "  return true;",
      "});",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(dir, "popup.html"),
    [
      "<!doctype html>",
      "<html>",
      "<body>",
      '  <main id="root">loading</main>',
      '  <script src="popup.js"></script>',
      "</body>",
      "</html>",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(dir, "popup.js"),
    [
      "const root = document.getElementById('root');",
      "async function run() {",
      "  const result = await chrome.runtime.sendMessage({ type: 'audit' });",
      "  let tabsResult;",
      "  try {",
      "    tabsResult = await chrome.tabs.query({ active: true, currentWindow: true });",
      "  } catch (error) {",
      "    tabsResult = { error: String(error?.message ?? error) };",
      "  }",
      "  root.textContent = JSON.stringify({ result, tabsResult });",
      "}",
      "run().catch((error) => { root.textContent = `popup failed: ${String(error?.message ?? error)}`; });",
    ].join("\n"),
    "utf8",
  );
  return dir;
}

function serveAuditPage() {
  const server = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      [
        "<!doctype html>",
        "<html>",
        "<body>",
        "  <h1>Extension audit</h1>",
        '  <div class="ad-banner">blocked by mv2 css</div>',
        "</body>",
        "</html>",
      ].join("\n"),
    );
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Audit server did not expose a TCP port"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

async function runAudit() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "t3-extension-audit-"));
  app.setPath("userData", path.join(tempRoot, "electron-user-data"));
  const { server, url } = await serveAuditPage();

  try {
    await app.whenReady();
    const mv2Path = await createMv2Extension(tempRoot);
    const mv3Path = await createMv3Extension(tempRoot);
    const partition = session.fromPartition("persist:t3-extension-audit");

    const mv2 = await partition.loadExtension(mv2Path, { allowFileAccess: true });
    const mv3 = await partition.loadExtension(mv3Path, { allowFileAccess: true });

    const page = new BrowserWindow({
      show: true,
      width: 320,
      height: 240,
      webPreferences: { session: partition },
    });
    windows.push(page);
    await page.loadURL(url);
    const mv2Result = await page.webContents.executeJavaScript(`
      ({
        url: location.href,
        injected: document.documentElement.dataset.t3Mv2Injected === "yes",
        markerText: document.querySelector("#mv2-content-marker")?.textContent ?? null,
        adDisplay: getComputedStyle(document.querySelector(".ad-banner")).display,
      })
    `);

    await new Promise((resolve) => setTimeout(resolve, 500));
    const mv3ResponseText = await page.webContents.executeJavaScript(
      "document.documentElement.dataset.t3Mv3Response ?? null",
    );
    const mv3ContentScriptResponse =
      typeof mv3ResponseText === "string" ? JSON.parse(mv3ResponseText) : null;

    const serviceWorkersRaw =
      typeof partition.serviceWorkers?.getAllRunning === "function"
        ? partition.serviceWorkers.getAllRunning()
        : [];
    const serviceWorkers = Array.isArray(serviceWorkersRaw)
      ? serviceWorkersRaw
      : Object.values(serviceWorkersRaw ?? {});

    const result = {
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      mv2: {
        id: mv2.id,
        name: mv2.name,
        contentScriptInjected: mv2Result.injected,
        markerText: mv2Result.markerText,
        cssRuleApplied: mv2Result.adDisplay === "none",
      },
      mv3: {
        id: mv3.id,
        name: mv3.name,
        contentScriptMessagedServiceWorker: mv3ContentScriptResponse?.ok === true,
        contentScriptResponse: mv3ContentScriptResponse,
        actionPopupDeclared: mv3.manifest?.action?.default_popup === "popup.html",
        actionPopupDirectLoad: "not run by this harness",
        runningServiceWorkers: serviceWorkers.map((worker) => ({
          scope: worker.scope,
          scriptURL: worker.scriptURL,
          versionId: worker.versionId,
          status: worker.status,
          runningStatus: worker.runningStatus,
        })),
      },
    };

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    page.close();
    auditComplete = true;
  } finally {
    server.close();
    await app.quit();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

runAudit().catch((error) => {
  console.error(error);
  auditComplete = true;
  process.exitCode = 1;
  void app.quit();
});
