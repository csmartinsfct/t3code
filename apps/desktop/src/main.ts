import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as HTTP from "node:http";
import * as OS from "node:os";
import * as Path from "node:path";
import type { AddressInfo } from "node:net";

import {
  app,
  BaseWindow,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  protocol,
  session,
  shell,
  WebContentsView,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";
import * as Effect from "effect/Effect";
import type {
  DesktopTheme,
  DesktopUpdateActionResult,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
} from "@t3tools/contracts";
import { autoUpdater } from "electron-updater";

import type { ContextMenuItem } from "@t3tools/contracts";
import { NetService } from "@t3tools/shared/Net";
import { isBrowserNavigationAbortError } from "@t3tools/shared/browserNavigationErrors";
import { RotatingFileSink } from "@t3tools/shared/logging";
import { resolveT3StateDir } from "@t3tools/shared/paths";
import {
  DEFAULT_IDLE_BROWSER_SUSPEND_MINUTES,
  parsePersistedBrowserSuspendMinutes,
  parsePersistedServerObservabilitySettings,
} from "@t3tools/shared/serverSettings";
import { formatTimelineLog, isTimelineLogMessage } from "@t3tools/shared/timeline";
import { showDesktopConfirmDialog } from "./confirmDialog";
import { createSafeStdIoWrite } from "./safeStdio";
import { syncShellEnvironment } from "./syncShellEnvironment";
import { getAutoUpdateDisabledReason, shouldBroadcastDownloadProgress } from "./updateState";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadProgress,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnNoUpdate,
  reduceDesktopUpdateStateOnUpdateAvailable,
} from "./updateMachine";
import { shouldSuspendForIdle } from "./embeddedBrowserIdleReaper";
import { isArm64HostRunningIntelBuild, resolveDesktopRuntimeInfo } from "./runtimeArch";

syncShellEnvironment();

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const GET_WS_URL_CHANNEL = "desktop:get-ws-url";
const BROWSER_MOUNT_CHANNEL = "browser:mount";
const BROWSER_SET_BOUNDS_CHANNEL = "browser:setBounds";
const BROWSER_UNMOUNT_CHANNEL = "browser:unmount";
const BROWSER_SUSPEND_CHANNEL = "browser:suspendForModal";
const BROWSER_RESUME_CHANNEL = "browser:resumeFromModal";
const BROWSER_NAVIGATE_CHANNEL = "browser:navigate";
const BROWSER_GET_URL_CHANNEL = "browser:getUrl";
const BROWSER_LIST_TABS_CHANNEL = "browser:listTabs";
const BROWSER_NEW_TAB_CHANNEL = "browser:newTab";
const BROWSER_SWITCH_TAB_CHANNEL = "browser:switchTab";
const BROWSER_CLOSE_TAB_CHANNEL = "browser:closeTab";
const BROWSER_TABS_CHANGED_CHANNEL = "browser:tabsChanged";
const BASE_DIR = process.env.T3CODE_HOME?.trim() || Path.join(OS.homedir(), ".t3");
const DESKTOP_SCHEME = "t3";
const ROOT_DIR = Path.resolve(__dirname, "../../..");
const devServerUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
const isDevelopment = Boolean(devServerUrl);
const STATE_DIR = resolveT3StateDir(BASE_DIR, isDevelopment);
const APP_DISPLAY_NAME = isDevelopment ? "T3 Code (Dev)" : "T3 Code (Alpha)";
const APP_USER_MODEL_ID = "com.t3tools.t3code";
const LINUX_DESKTOP_ENTRY_NAME = isDevelopment ? "t3code-dev.desktop" : "t3code.desktop";
const LINUX_WM_CLASS = isDevelopment ? "t3code-dev" : "t3code";
const USER_DATA_DIR_NAME = isDevelopment ? "t3code-dev" : "t3code";
const LEGACY_USER_DATA_DIR_NAME = isDevelopment ? "T3 Code (Dev)" : "T3 Code (Alpha)";
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
const COMMIT_HASH_DISPLAY_LENGTH = 12;
const LOG_DIR = Path.join(STATE_DIR, "logs");
const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
const LOG_FILE_MAX_FILES = 10;
const APP_RUN_ID = Crypto.randomBytes(6).toString("hex");
const SERVER_SETTINGS_PATH = Path.join(STATE_DIR, "settings.json");
const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DESKTOP_UPDATE_CHANNEL = "latest";
const DESKTOP_UPDATE_ALLOW_PRERELEASE = false;

type DesktopUpdateErrorContext = DesktopUpdateState["errorContext"];
type BrowserViewBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};
type EmbeddedBrowserCdpSubscription = {
  readonly closeWithError: (error: unknown, code?: string) => void;
};
// Each tab is its own WebContentsView + debugger attachment. Fields that used
// to describe "the project's view" now live per-tab; fields that describe the
// project as a whole (mounted state, bounds, active tab) live on
// EmbeddedBrowserProjectState below. The type is still named `…ViewState` in
// many comments and call sites — treat "view" and "tab" as interchangeable
// terms in this file.
type EmbeddedBrowserTabState = {
  readonly projectId: string;
  readonly tabId: number;
  readonly view: WebContentsView;
  readonly subscriptions: Set<EmbeddedBrowserCdpSubscription>;
  reattachRetryTimer: ReturnType<typeof setTimeout> | null;
  devtoolsOpen: boolean;
  title: string;
  favicon: string | null;
};
type EmbeddedBrowserProjectState = {
  readonly projectId: string;
  readonly handle: string;
  readonly tabs: Map<number, EmbeddedBrowserTabState>;
  activeTabId: number;
  nextTabId: number;
  mounted: boolean;
  suspendedForModal: boolean;
  bounds: BrowserViewBounds | null;
  // Updated on every activity signal (CDP request, mount, unmount, page
  // event). The idle reaper compares this to the configured threshold to
  // decide whether to suspend an unmounted view. See T3CO-422.
  lastActivityAt: number;
  // True while the project's WebContents have been background-throttled and
  // audio-muted by the idle reaper. Cleared on the next activity signal.
  suspended: boolean;
};
type EmbeddedBrowserWindowState = {
  readonly projectsByProjectId: Map<string, EmbeddedBrowserProjectState>;
  activeProjectId: string | null;
  mountRequestId: number;
};
const MAX_TABS_PER_PROJECT = 5;
type BrowserCdpSendRequest = {
  readonly id: string;
  readonly viewId: string;
  readonly sessionId: string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
};
type BrowserCdpSubscribeRequest = {
  readonly id: string;
  readonly viewId: string;
  readonly sessionId: string;
  readonly eventName: string;
};
type BrowserCdpAttachTargetRequest = {
  readonly id: string;
  readonly viewId: string;
  readonly targetId: string;
};
type BrowserPrintPdfRequest = {
  readonly id: string;
  readonly viewId: string;
  readonly options?: Electron.PrintToPDFOptions;
};
type BrowserTabsBaseRequest = {
  readonly id: string;
  readonly viewId: string; // treated as projectId for tab-scoped routes
};
type BrowserNewTabRequest = BrowserTabsBaseRequest & { readonly url?: string };
type BrowserTabIdRequest = BrowserTabsBaseRequest & { readonly tabId: number };
type LinuxDesktopNamedApp = Electron.App & {
  setDesktopName?: (desktopName: string) => void;
};

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess.ChildProcess | null = null;
let backendPort = 0;
let backendAuthToken = "";
let backendWsUrl = "";
let browserCdpBrokerServer: HTTP.Server | null = null;
let browserCdpBrokerUrl: string | undefined;
let browserCdpBrokerToken = "";
let restartAttempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let isQuitting = false;
let desktopProtocolRegistered = false;
let aboutCommitHashCache: string | null | undefined;
let desktopLogSink: RotatingFileSink | null = null;
let backendLogSink: RotatingFileSink | null = null;
let restoreStdIoCapture: (() => void) | null = null;
const embeddedBrowserStateByWindow = new WeakMap<BrowserWindow, EmbeddedBrowserWindowState>();
const embeddedBrowserProjectsByProjectId = new Map<string, EmbeddedBrowserProjectState>();
const EMBEDDED_BROWSER_DEVTOOLS_OPEN_MESSAGE =
  "DevTools is open on this project's embedded browser — close DevTools to resume agent tools.";
const EMBEDDED_BROWSER_IDLE_REAPER_INTERVAL_MS = 60_000;
let embeddedBrowserIdleReaperTimer: NodeJS.Timeout | null = null;
let backendObservabilitySettings: {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
} = {
  otlpTracesUrl: undefined,
  otlpMetricsUrl: undefined,
};

let destructiveMenuIconCache: Electron.NativeImage | null | undefined;
const expectedBackendExitChildren = new WeakSet<ChildProcess.ChildProcess>();
const desktopRuntimeInfo = resolveDesktopRuntimeInfo({
  platform: process.platform,
  processArch: process.arch,
  runningUnderArm64Translation: app.runningUnderARM64Translation === true,
});
const initialUpdateState = (): DesktopUpdateState =>
  createInitialDesktopUpdateState(app.getVersion(), desktopRuntimeInfo);

installStdIoCapture();
backendObservabilitySettings = readPersistedBackendObservabilitySettings();

function logTimestamp(): string {
  return new Date().toISOString();
}

function logScope(scope: string): string {
  return `${scope} run=${APP_RUN_ID}`;
}

function sanitizeLogValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readPersistedBackendObservabilitySettings(): {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
} {
  try {
    if (!FS.existsSync(SERVER_SETTINGS_PATH)) {
      return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
    }
    return parsePersistedServerObservabilitySettings(FS.readFileSync(SERVER_SETTINGS_PATH, "utf8"));
  } catch (error) {
    console.warn("[desktop] failed to read persisted backend observability settings", error);
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }
}

function backendChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.T3CODE_PORT;
  delete env.T3CODE_AUTH_TOKEN;
  delete env.T3CODE_MODE;
  delete env.T3CODE_NO_BROWSER;
  delete env.T3CODE_HOST;
  delete env.T3CODE_DESKTOP_WS_URL;

  // Point Playwright at the Chromium bundle shipped in Resources (staged by
  // `scripts/build-desktop-artifact.ts`). The packaged app cannot self-install
  // Chromium at runtime — `playwright/cli.js` is unresolvable from inside
  // `app.asar.unpacked` under Bun — so the browser tool depends on the binary
  // being present here. Dev builds leave the env var unset so Playwright uses
  // the developer's `~/Library/Caches/ms-playwright/` install.
  if (app.isPackaged) {
    env.PLAYWRIGHT_BROWSERS_PATH = Path.join(process.resourcesPath, "playwright-browsers");
  }

  return env;
}

function writeDesktopLogHeader(message: string): void {
  if (!desktopLogSink) return;
  desktopLogSink.write(`[${logTimestamp()}] [${logScope("desktop")}] ${message}\n`);
}

function writeDesktopTimeline(event: string, details?: unknown): void {
  writeDesktopLogHeader(formatTimelineLog("desktop", event, details));
}

function writeBackendSessionBoundary(phase: "START" | "END", details: string): void {
  if (!backendLogSink) return;
  const normalizedDetails = sanitizeLogValue(details);
  backendLogSink.write(
    `[${logTimestamp()}] ---- APP SESSION ${phase} run=${APP_RUN_ID} ${normalizedDetails} ----\n`,
  );
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function getSafeExternalUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return null;
  }

  return parsedUrl.toString();
}

function getSafeTheme(rawTheme: unknown): DesktopTheme | null {
  if (rawTheme === "light" || rawTheme === "dark" || rawTheme === "system") {
    return rawTheme;
  }

  return null;
}

function writeDesktopStreamChunk(
  streamName: "stdout" | "stderr",
  chunk: unknown,
  encoding: BufferEncoding | undefined,
): void {
  if (!desktopLogSink) return;
  const buffer = Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(String(chunk), typeof chunk === "string" ? encoding : undefined);
  desktopLogSink.write(`[${logTimestamp()}] [${logScope(streamName)}] `);
  desktopLogSink.write(buffer);
  if (buffer.length === 0 || buffer[buffer.length - 1] !== 0x0a) {
    desktopLogSink.write("\n");
  }
}

function installStdIoCapture(): void {
  if (restoreStdIoCapture !== null) {
    return;
  }

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = createSafeStdIoWrite(originalStdoutWrite, (chunk, encoding) => {
    if (!app.isPackaged || desktopLogSink === null) return;
    writeDesktopStreamChunk("stdout", chunk, encoding);
  });
  process.stderr.write = createSafeStdIoWrite(originalStderrWrite, (chunk, encoding) => {
    if (!app.isPackaged || desktopLogSink === null) return;
    writeDesktopStreamChunk("stderr", chunk, encoding);
  });

  restoreStdIoCapture = () => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    restoreStdIoCapture = null;
  };
}

function initializePackagedLogging(): void {
  if (!app.isPackaged) return;
  try {
    desktopLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "desktop-main.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
    backendLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "server-child.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
    writeDesktopLogHeader(`runtime log capture enabled logDir=${LOG_DIR}`);
  } catch (error) {
    // Logging setup should never block app startup.
    console.error("[desktop] failed to initialize packaged logging", error);
  }
}

function captureBackendOutput(child: ChildProcess.ChildProcess): void {
  if (!app.isPackaged || backendLogSink === null) return;
  const writeChunk = (chunk: unknown): void => {
    if (!backendLogSink) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    backendLogSink.write(buffer);
  };
  child.stdout?.on("data", writeChunk);
  child.stderr?.on("data", writeChunk);
}

initializePackagedLogging();

if (process.platform === "linux") {
  app.commandLine.appendSwitch("class", LINUX_WM_CLASS);
}

function getDestructiveMenuIcon(): Electron.NativeImage | undefined {
  if (process.platform !== "darwin") return undefined;
  if (destructiveMenuIconCache !== undefined) {
    return destructiveMenuIconCache ?? undefined;
  }
  try {
    const icon = nativeImage.createFromNamedImage("trash").resize({
      width: 14,
      height: 14,
    });
    if (icon.isEmpty()) {
      destructiveMenuIconCache = null;
      return undefined;
    }
    icon.setTemplateImage(true);
    destructiveMenuIconCache = icon;
    return icon;
  } catch {
    destructiveMenuIconCache = null;
    return undefined;
  }
}
let updatePollTimer: ReturnType<typeof setInterval> | null = null;
let updateStartupTimer: ReturnType<typeof setTimeout> | null = null;
let updateCheckInFlight = false;
let updateDownloadInFlight = false;
let updateInstallInFlight = false;
let updaterConfigured = false;
let updateState: DesktopUpdateState = initialUpdateState();

function resolveUpdaterErrorContext(): DesktopUpdateErrorContext {
  if (updateInstallInFlight) return "install";
  if (updateDownloadInFlight) return "download";
  if (updateCheckInFlight) return "check";
  return updateState.errorContext;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function resolveAppRoot(): string {
  if (!app.isPackaged) {
    return ROOT_DIR;
  }
  return app.getAppPath();
}

/** Read the baked-in app-update.yml config (if applicable). */
function readAppUpdateYml(): Record<string, string> | null {
  try {
    // electron-updater reads from process.resourcesPath in packaged builds,
    // or dev-app-update.yml via app.getAppPath() in dev.
    const ymlPath = app.isPackaged
      ? Path.join(process.resourcesPath, "app-update.yml")
      : Path.join(app.getAppPath(), "dev-app-update.yml");
    const raw = FS.readFileSync(ymlPath, "utf-8");
    // The YAML is simple key-value pairs — avoid pulling in a YAML parser by
    // doing a line-based parse (fields: provider, owner, repo, releaseType, …).
    const entries: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match?.[1] && match[2]) entries[match[1]] = match[2].trim();
    }
    return entries.provider ? entries : null;
  } catch {
    return null;
  }
}

function normalizeCommitHash(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!COMMIT_HASH_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.slice(0, COMMIT_HASH_DISPLAY_LENGTH).toLowerCase();
}

function resolveEmbeddedCommitHash(): string | null {
  const packageJsonPath = Path.join(resolveAppRoot(), "package.json");
  if (!FS.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const raw = FS.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { t3codeCommitHash?: unknown };
    return normalizeCommitHash(parsed.t3codeCommitHash);
  } catch {
    return null;
  }
}

function resolveAboutCommitHash(): string | null {
  if (aboutCommitHashCache !== undefined) {
    return aboutCommitHashCache;
  }

  const envCommitHash = normalizeCommitHash(process.env.T3CODE_COMMIT_HASH);
  if (envCommitHash) {
    aboutCommitHashCache = envCommitHash;
    return aboutCommitHashCache;
  }

  // Only packaged builds are required to expose commit metadata.
  if (!app.isPackaged) {
    aboutCommitHashCache = null;
    return aboutCommitHashCache;
  }

  aboutCommitHashCache = resolveEmbeddedCommitHash();

  return aboutCommitHashCache;
}

function resolveBackendEntry(): string {
  const entry = Path.join(resolveAppRoot(), "apps/server/dist/bin.mjs");
  // In packaged builds `resolveAppRoot()` is `app.getAppPath()`, which for
  // asar-enabled builds ends in `.../app.asar`. Electron's Node APIs
  // transparently redirect `app.asar` → `app.asar.unpacked` for paths listed
  // in electron-builder's `asarUnpack`, but the child Bun process we spawn
  // does NOT get that redirect and will fail with "Module not found" on any
  // asar-virtual path. Swap to the real on-disk unpacked path so Bun can
  // read `bin.mjs` and follow its `node_modules` import graph.
  return app.isPackaged
    ? entry.replace(`${Path.sep}app.asar${Path.sep}`, `${Path.sep}app.asar.unpacked${Path.sep}`)
    : entry;
}

/**
 * Resolve the Bun binary used to spawn the backend.
 *
 * T3 switched from Electron-Node to Bun for the backend runtime (T3CO-328)
 * so the vendored `cookie-import-browser.ts` can static-import `bun:sqlite`
 * without crashing the whole browser surface under Electron's Node.
 *
 * Resolution order:
 * 1. Packaged app — bundled binary at `<appResources>/bin/bun[.exe]`. The
 *    build script (`scripts/build-desktop-artifact.ts`) downloads Bun
 *    per-platform + arch at package time and electron-builder copies it
 *    into the app Resources dir.
 * 2. Dev — honours `T3CODE_BUN_BINARY` env var if set, otherwise falls back
 *    to `bun` on PATH. Throws if neither is available.
 */
function resolveBackendRuntime(): string {
  const exeName = process.platform === "win32" ? "bun.exe" : "bun";
  if (app.isPackaged) {
    // In a packaged Electron app, process.resourcesPath points at
    // Contents/Resources (macOS) / resources/ (win/linux).
    const bundled = Path.join(process.resourcesPath, "bin", exeName);
    if (FS.existsSync(bundled)) return bundled;
    throw new Error(
      `[desktop] bundled Bun binary missing at ${bundled}. ` +
        "The production build did not include the per-platform Bun binary.",
    );
  }
  const envOverride = process.env.T3CODE_BUN_BINARY;
  if (envOverride && FS.existsSync(envOverride)) return envOverride;
  // Development: rely on `bun` on PATH. ChildProcess.spawn resolves unqualified
  // names through PATH when shell is false.
  return exeName;
}

function resolveBackendCwd(): string {
  if (!app.isPackaged) {
    return resolveAppRoot();
  }
  return OS.homedir();
}

function resolveDesktopStaticDir(): string | null {
  const appRoot = resolveAppRoot();
  const candidates = [
    Path.join(appRoot, "apps/server/dist/client"),
    Path.join(appRoot, "apps/web/dist"),
  ];

  for (const candidate of candidates) {
    if (FS.existsSync(Path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return null;
}

function resolveDesktopStaticPath(staticRoot: string, requestUrl: string): string {
  const url = new URL(requestUrl);
  const rawPath = decodeURIComponent(url.pathname);
  const normalizedPath = Path.posix.normalize(rawPath).replace(/^\/+/, "");
  if (normalizedPath.includes("..")) {
    return Path.join(staticRoot, "index.html");
  }

  const requestedPath = normalizedPath.length > 0 ? normalizedPath : "index.html";
  const resolvedPath = Path.join(staticRoot, requestedPath);

  if (Path.extname(resolvedPath)) {
    return resolvedPath;
  }

  const nestedIndex = Path.join(resolvedPath, "index.html");
  if (FS.existsSync(nestedIndex)) {
    return nestedIndex;
  }

  return Path.join(staticRoot, "index.html");
}

function isStaticAssetRequest(requestUrl: string): boolean {
  try {
    const url = new URL(requestUrl);
    return Path.extname(url.pathname).length > 0;
  } catch {
    return false;
  }
}

function handleFatalStartupError(stage: string, error: unknown): void {
  const message = formatErrorMessage(error);
  const detail =
    error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
  writeDesktopLogHeader(`fatal startup error stage=${stage} message=${message}`);
  console.error(`[desktop] fatal startup error (${stage})`, error);
  if (!isQuitting) {
    isQuitting = true;
    dialog.showErrorBox("T3 Code failed to start", `Stage: ${stage}\n${message}${detail}`);
  }
  stopBackend();
  restoreStdIoCapture?.();
  app.quit();
}

function registerDesktopProtocol(): void {
  if (isDevelopment || desktopProtocolRegistered) return;

  const staticRoot = resolveDesktopStaticDir();
  if (!staticRoot) {
    throw new Error(
      "Desktop static bundle missing. Build apps/server (with bundled client) first.",
    );
  }

  const staticRootResolved = Path.resolve(staticRoot);
  const staticRootPrefix = `${staticRootResolved}${Path.sep}`;
  const fallbackIndex = Path.join(staticRootResolved, "index.html");

  protocol.registerFileProtocol(DESKTOP_SCHEME, (request, callback) => {
    try {
      const candidate = resolveDesktopStaticPath(staticRootResolved, request.url);
      const resolvedCandidate = Path.resolve(candidate);
      const isInRoot =
        resolvedCandidate === fallbackIndex || resolvedCandidate.startsWith(staticRootPrefix);
      const isAssetRequest = isStaticAssetRequest(request.url);

      if (!isInRoot || !FS.existsSync(resolvedCandidate)) {
        if (isAssetRequest) {
          callback({ error: -6 });
          return;
        }
        callback({ path: fallbackIndex });
        return;
      }

      callback({ path: resolvedCandidate });
    } catch {
      callback({ path: fallbackIndex });
    }
  });

  desktopProtocolRegistered = true;
}

function dispatchMenuAction(action: string): void {
  const existingWindow =
    BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
  const targetWindow = existingWindow ?? createWindow();
  if (!existingWindow) {
    mainWindow = targetWindow;
  }

  const send = () => {
    if (targetWindow.isDestroyed()) return;
    targetWindow.webContents.send(MENU_ACTION_CHANNEL, action);
    if (!targetWindow.isVisible()) {
      targetWindow.show();
    }
    targetWindow.focus();
  };

  if (targetWindow.webContents.isLoadingMainFrame()) {
    targetWindow.webContents.once("did-finish-load", send);
    return;
  }

  send();
}

function handleCheckForUpdatesMenuClick(): void {
  const disabledReason = getAutoUpdateDisabledReason({
    isDevelopment,
    isPackaged: app.isPackaged,
    platform: process.platform,
    appImage: process.env.APPIMAGE,
    disabledByEnv: process.env.T3CODE_DISABLE_AUTO_UPDATE === "1",
  });
  if (disabledReason) {
    console.info("[desktop-updater] Manual update check requested, but updates are disabled.");
    void dialog.showMessageBox({
      type: "info",
      title: "Updates unavailable",
      message: "Automatic updates are not available right now.",
      detail: disabledReason,
      buttons: ["OK"],
    });
    return;
  }

  if (!BrowserWindow.getAllWindows().length) {
    mainWindow = createWindow();
  }
  void checkForUpdatesFromMenu();
}

async function checkForUpdatesFromMenu(): Promise<void> {
  await checkForUpdates("menu");

  if (updateState.status === "up-to-date") {
    void dialog.showMessageBox({
      type: "info",
      title: "You're up to date!",
      message: `T3 Code ${updateState.currentVersion} is currently the newest version available.`,
      buttons: ["OK"],
    });
  } else if (updateState.status === "error") {
    void dialog.showMessageBox({
      type: "warning",
      title: "Update check failed",
      message: "Could not check for updates.",
      detail: updateState.message ?? "An unknown error occurred. Please try again later.",
      buttons: ["OK"],
    });
  }
}

function configureApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          click: () => handleCheckForUpdatesMenuClick(),
        },
        { type: "separator" },
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => dispatchMenuAction("open-settings"),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    {
      label: "File",
      submenu: [
        ...(process.platform === "darwin"
          ? []
          : [
              {
                label: "Settings...",
                accelerator: "CmdOrCtrl+,",
                click: () => dispatchMenuAction("open-settings"),
              },
              { type: "separator" as const },
            ]),
        { role: process.platform === "darwin" ? "close" : "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn", accelerator: "CmdOrCtrl+=" },
        { role: "zoomIn", accelerator: "CmdOrCtrl+Plus", visible: false },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Check for Updates...",
          click: () => handleCheckForUpdatesMenuClick(),
        },
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function resolveResourcePath(fileName: string): string | null {
  const candidates = [
    Path.join(__dirname, "../resources", fileName),
    Path.join(__dirname, "../prod-resources", fileName),
    Path.join(process.resourcesPath, "resources", fileName),
    Path.join(process.resourcesPath, fileName),
  ];

  for (const candidate of candidates) {
    if (FS.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveIconPath(ext: "ico" | "icns" | "png"): string | null {
  return resolveResourcePath(`icon.${ext}`);
}

/**
 * Resolve the Electron userData directory path.
 *
 * Electron derives the default userData path from `productName` in
 * package.json, which currently produces directories with spaces and
 * parentheses (e.g. `~/.config/T3 Code (Alpha)` on Linux). This is
 * unfriendly for shell usage and violates Linux naming conventions.
 *
 * We override it to a clean lowercase name (`t3code`). If the legacy
 * directory already exists we keep using it so existing users don't
 * lose their Chromium profile data (localStorage, cookies, sessions).
 */
function resolveUserDataPath(): string {
  const appDataBase =
    process.platform === "win32"
      ? process.env.APPDATA || Path.join(OS.homedir(), "AppData", "Roaming")
      : process.platform === "darwin"
        ? Path.join(OS.homedir(), "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || Path.join(OS.homedir(), ".config");

  const legacyPath = Path.join(appDataBase, LEGACY_USER_DATA_DIR_NAME);
  if (FS.existsSync(legacyPath)) {
    return legacyPath;
  }

  return Path.join(appDataBase, USER_DATA_DIR_NAME);
}

function configureAppIdentity(): void {
  app.setName(APP_DISPLAY_NAME);
  const commitHash = resolveAboutCommitHash();
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
    version: commitHash ?? "unknown",
  });

  if (process.platform === "win32") {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }

  if (process.platform === "linux") {
    (app as LinuxDesktopNamedApp).setDesktopName?.(LINUX_DESKTOP_ENTRY_NAME);
  }

  if (process.platform === "darwin" && app.dock) {
    const iconPath = resolveIconPath("png");
    if (iconPath) {
      app.dock.setIcon(iconPath);
    }
  }
}

function clearUpdatePollTimer(): void {
  if (updateStartupTimer) {
    clearTimeout(updateStartupTimer);
    updateStartupTimer = null;
  }
  if (updatePollTimer) {
    clearInterval(updatePollTimer);
    updatePollTimer = null;
  }
}

function emitUpdateState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(UPDATE_STATE_CHANNEL, updateState);
  }
}

function setUpdateState(patch: Partial<DesktopUpdateState>): void {
  updateState = { ...updateState, ...patch };
  emitUpdateState();
}

function shouldEnableAutoUpdates(): boolean {
  return (
    getAutoUpdateDisabledReason({
      isDevelopment,
      isPackaged: app.isPackaged,
      platform: process.platform,
      appImage: process.env.APPIMAGE,
      disabledByEnv: process.env.T3CODE_DISABLE_AUTO_UPDATE === "1",
    }) === null
  );
}

async function checkForUpdates(reason: string): Promise<boolean> {
  if (isQuitting || !updaterConfigured || updateCheckInFlight) return false;
  if (updateState.status === "downloading" || updateState.status === "downloaded") {
    console.info(
      `[desktop-updater] Skipping update check (${reason}) while status=${updateState.status}.`,
    );
    return false;
  }
  updateCheckInFlight = true;
  setUpdateState(reduceDesktopUpdateStateOnCheckStart(updateState, new Date().toISOString()));
  console.info(`[desktop-updater] Checking for updates (${reason})...`);

  try {
    await autoUpdater.checkForUpdates();
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState(
      reduceDesktopUpdateStateOnCheckFailure(updateState, message, new Date().toISOString()),
    );
    console.error(`[desktop-updater] Failed to check for updates: ${message}`);
    return true;
  } finally {
    updateCheckInFlight = false;
  }
}

async function downloadAvailableUpdate(): Promise<{ accepted: boolean; completed: boolean }> {
  if (!updaterConfigured || updateDownloadInFlight || updateState.status !== "available") {
    return { accepted: false, completed: false };
  }
  updateDownloadInFlight = true;
  setUpdateState(reduceDesktopUpdateStateOnDownloadStart(updateState));
  autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(desktopRuntimeInfo);
  console.info("[desktop-updater] Downloading update...");

  try {
    await autoUpdater.downloadUpdate();
    return { accepted: true, completed: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState(reduceDesktopUpdateStateOnDownloadFailure(updateState, message));
    console.error(`[desktop-updater] Failed to download update: ${message}`);
    return { accepted: true, completed: false };
  } finally {
    updateDownloadInFlight = false;
  }
}

async function installDownloadedUpdate(): Promise<{ accepted: boolean; completed: boolean }> {
  if (isQuitting || !updaterConfigured || updateState.status !== "downloaded") {
    return { accepted: false, completed: false };
  }

  isQuitting = true;
  updateInstallInFlight = true;
  clearUpdatePollTimer();
  try {
    await stopBackendAndWaitForExit();
    // Destroy all windows before launching the NSIS installer to avoid the installer finding live windows it needs to close.
    for (const win of BrowserWindow.getAllWindows()) {
      win.destroy();
    }
    // `quitAndInstall()` only starts the handoff to the updater. The actual
    // install may still fail asynchronously, so keep the action incomplete
    // until we either quit or receive an updater error.
    autoUpdater.quitAndInstall(true, true);
    return { accepted: true, completed: false };
  } catch (error: unknown) {
    const message = formatErrorMessage(error);
    updateInstallInFlight = false;
    isQuitting = false;
    setUpdateState(reduceDesktopUpdateStateOnInstallFailure(updateState, message));
    console.error(`[desktop-updater] Failed to install update: ${message}`);
    return { accepted: true, completed: false };
  }
}

function configureAutoUpdater(): void {
  const enabled = shouldEnableAutoUpdates();
  setUpdateState({
    ...createInitialDesktopUpdateState(app.getVersion(), desktopRuntimeInfo),
    enabled,
    status: enabled ? "idle" : "disabled",
  });
  if (!enabled) {
    return;
  }
  updaterConfigured = true;

  const githubToken =
    process.env.T3CODE_DESKTOP_UPDATE_GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || "";
  if (githubToken) {
    // When a token is provided, re-configure the feed with `private: true` so
    // electron-updater uses the GitHub API (api.github.com) instead of the
    // public Atom feed (github.com/…/releases.atom) which rejects Bearer auth.
    const appUpdateYml = readAppUpdateYml();
    if (appUpdateYml?.provider === "github") {
      autoUpdater.setFeedURL({
        ...appUpdateYml,
        provider: "github" as const,
        private: true,
        token: githubToken,
      });
    }
  }

  if (process.env.T3CODE_DESKTOP_MOCK_UPDATES) {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: `http://localhost:${process.env.T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT ?? 3000}`,
    });
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  // Keep alpha branding, but force all installs onto the stable update track.
  autoUpdater.channel = DESKTOP_UPDATE_CHANNEL;
  autoUpdater.allowPrerelease = DESKTOP_UPDATE_ALLOW_PRERELEASE;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(desktopRuntimeInfo);
  let lastLoggedDownloadMilestone = -1;

  if (isArm64HostRunningIntelBuild(desktopRuntimeInfo)) {
    console.info(
      "[desktop-updater] Apple Silicon host detected while running Intel build; updates will switch to arm64 packages.",
    );
  }

  autoUpdater.on("checking-for-update", () => {
    console.info("[desktop-updater] Looking for updates...");
  });
  autoUpdater.on("update-available", (info) => {
    setUpdateState(
      reduceDesktopUpdateStateOnUpdateAvailable(
        updateState,
        info.version,
        new Date().toISOString(),
      ),
    );
    lastLoggedDownloadMilestone = -1;
    console.info(`[desktop-updater] Update available: ${info.version}`);
  });
  autoUpdater.on("update-not-available", () => {
    setUpdateState(reduceDesktopUpdateStateOnNoUpdate(updateState, new Date().toISOString()));
    lastLoggedDownloadMilestone = -1;
    console.info("[desktop-updater] No updates available.");
  });
  autoUpdater.on("error", (error) => {
    const message = formatErrorMessage(error);
    if (updateInstallInFlight) {
      updateInstallInFlight = false;
      isQuitting = false;
      setUpdateState(reduceDesktopUpdateStateOnInstallFailure(updateState, message));
      console.error(`[desktop-updater] Updater error: ${message}`);
      return;
    }
    if (!updateCheckInFlight && !updateDownloadInFlight) {
      setUpdateState({
        status: "error",
        message,
        checkedAt: new Date().toISOString(),
        downloadPercent: null,
        errorContext: resolveUpdaterErrorContext(),
        canRetry: updateState.availableVersion !== null || updateState.downloadedVersion !== null,
      });
    }
    console.error(`[desktop-updater] Updater error: ${message}`);
  });
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.floor(progress.percent);
    if (
      shouldBroadcastDownloadProgress(updateState, progress.percent) ||
      updateState.message !== null
    ) {
      setUpdateState(reduceDesktopUpdateStateOnDownloadProgress(updateState, progress.percent));
    }
    const milestone = percent - (percent % 10);
    if (milestone > lastLoggedDownloadMilestone) {
      lastLoggedDownloadMilestone = milestone;
      console.info(`[desktop-updater] Download progress: ${percent}%`);
    }
  });
  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState(reduceDesktopUpdateStateOnDownloadComplete(updateState, info.version));
    console.info(`[desktop-updater] Update downloaded: ${info.version}`);
  });

  clearUpdatePollTimer();

  updateStartupTimer = setTimeout(() => {
    updateStartupTimer = null;
    void checkForUpdates("startup");
  }, AUTO_UPDATE_STARTUP_DELAY_MS);
  updateStartupTimer.unref();

  updatePollTimer = setInterval(() => {
    void checkForUpdates("poll");
  }, AUTO_UPDATE_POLL_INTERVAL_MS);
  updatePollTimer.unref();
}
function scheduleBackendRestart(reason: string): void {
  if (isQuitting || restartTimer) return;

  const delayMs = Math.min(500 * 2 ** restartAttempt, 10_000);
  restartAttempt += 1;
  console.error(`[desktop] backend exited unexpectedly (${reason}); restarting in ${delayMs}ms`);

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startBackend();
  }, delayMs);
}

async function handleBrowserCdpBrokerRequest(
  request: HTTP.IncomingMessage,
  response: HTTP.ServerResponse,
): Promise<void> {
  if (!isAuthorizedBrowserCdpRequest(request)) {
    sendBrokerError(response, 401, "Unauthorized", "ELECTRON_CDP_UNAUTHORIZED");
    return;
  }

  if (request.method !== "POST") {
    sendBrokerError(response, 405, "Method not allowed", "ELECTRON_CDP_METHOD_NOT_ALLOWED");
    return;
  }

  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = await readBrokerJsonBody(request);
    // Lazy materialization (T3CO-421): every routed request carries a
    // `viewId` that resolves to a project. If the project doesn't have a
    // live WebContentsView yet — common after restart, or for agents
    // touching a project before the user has ever opened the embedded UI —
    // create it offscreen here so the downstream lookup succeeds. Tab ops
    // that additionally require a window-bound project (`/tabs/list`,
    // `/tabs/new`, etc.) still throw if the project isn't mounted; the
    // viewId-based agent surface (send/subscribe/attach-target/print-pdf)
    // works without any user mount.
    const rawViewId = isRecord(body) && typeof body.viewId === "string" ? body.viewId : undefined;
    if (rawViewId) {
      const { projectId } = parseViewId(rawViewId);
      if (projectId) markEmbeddedBrowserActive(ensureEmbeddedBrowserProject(projectId));
    }
    // One-line breadcrumb per agent CDP request: which route, which project,
    // and (for /send only) which CDP method. Subscriptions log on open only,
    // not per delivered event, to avoid flooding active subscribe streams.
    const cdpMethod =
      url.pathname === "/send" && isRecord(body) && typeof body.method === "string"
        ? body.method
        : undefined;
    console.log("[desktop/browser] cdp request", {
      route: url.pathname,
      viewId: rawViewId,
      ...(cdpMethod ? { method: cdpMethod } : {}),
    });
    if (url.pathname === "/send") {
      const result = await sendEmbeddedBrowserCdpCommand(parseCdpSendRequest(body));
      sendBrokerSuccess(response, result);
      return;
    }
    if (url.pathname === "/attach-target") {
      const sessionId = await attachEmbeddedBrowserCdpTarget(parseCdpAttachTargetRequest(body));
      sendBrokerSuccess(response, sessionId);
      return;
    }
    if (url.pathname === "/subscribe") {
      subscribeEmbeddedBrowserCdpEvents(response, parseCdpSubscribeRequest(body));
      return;
    }
    if (url.pathname === "/print-pdf") {
      const base64 = await printEmbeddedBrowserPdf(parsePrintPdfRequest(body));
      sendBrokerSuccess(response, base64);
      return;
    }
    if (url.pathname === "/tabs/list") {
      const result = listEmbeddedBrowserTabs(parseTabsBaseRequest(body));
      sendBrokerSuccess(response, result);
      return;
    }
    if (url.pathname === "/tabs/new") {
      const tabId = await newEmbeddedBrowserTab(parseNewTabRequest(body));
      sendBrokerSuccess(response, tabId);
      return;
    }
    if (url.pathname === "/tabs/switch") {
      const activeTabId = await switchEmbeddedBrowserTab(parseTabIdRequest(body));
      sendBrokerSuccess(response, activeTabId);
      return;
    }
    if (url.pathname === "/tabs/close") {
      const activeTabId = await closeEmbeddedBrowserTab(parseTabIdRequest(body));
      sendBrokerSuccess(response, activeTabId);
      return;
    }
    sendBrokerError(response, 404, "Unknown CDP broker route", "ELECTRON_CDP_NOT_FOUND");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendBrokerError(
      response,
      message === EMBEDDED_BROWSER_DEVTOOLS_OPEN_MESSAGE ? 409 : 400,
      error,
      message === EMBEDDED_BROWSER_DEVTOOLS_OPEN_MESSAGE
        ? "ELECTRON_CDP_DEVTOOLS_OPEN"
        : "ELECTRON_CDP_REQUEST_FAILED",
    );
  }
}

async function startBrowserCdpBrokerServer(): Promise<void> {
  if (browserCdpBrokerServer) return;
  browserCdpBrokerToken = Crypto.randomBytes(24).toString("hex");
  const server = HTTP.createServer((request, response) => {
    void handleBrowserCdpBrokerRequest(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("CDP broker failed to bind a loopback port");
  }
  browserCdpBrokerServer = server;
  browserCdpBrokerUrl = `http://127.0.0.1:${(address as AddressInfo).port}/`;
  console.info(`[desktop/browser] CDP broker listening at ${browserCdpBrokerUrl}`);
}

function startBackend(): void {
  if (isQuitting || backendProcess) return;

  backendObservabilitySettings = readPersistedBackendObservabilitySettings();
  const backendEntry = resolveBackendEntry();
  if (!FS.existsSync(backendEntry)) {
    scheduleBackendRestart(`missing server entry at ${backendEntry}`);
    return;
  }

  const captureBackendLogs = app.isPackaged && backendLogSink !== null;
  let backendRuntime: string;
  try {
    backendRuntime = resolveBackendRuntime();
  } catch (err) {
    handleFatalStartupError("resolve-backend-runtime", err);
    return;
  }
  // Backend runs under Bun (T3CO-328). This lets the vendored browser code
  // static-import `bun:sqlite` without crashing, keeps parity with `bun run
  // dev` during development, and matches T3's existing @effect/*-bun deps.
  // No `ELECTRON_RUN_AS_NODE=1` — we explicitly DON'T want the Electron
  // binary acting as the runtime.
  const child = ChildProcess.spawn(backendRuntime, [backendEntry, "--bootstrap-fd", "3"], {
    cwd: resolveBackendCwd(),
    env: backendChildEnv(),
    stdio: captureBackendLogs
      ? ["ignore", "pipe", "pipe", "pipe"]
      : ["ignore", "inherit", "inherit", "pipe"],
  });
  const bootstrapStream = child.stdio[3];
  if (bootstrapStream && "write" in bootstrapStream) {
    bootstrapStream.write(
      `${JSON.stringify({
        mode: "desktop",
        noBrowser: true,
        port: backendPort,
        t3Home: BASE_DIR,
        authToken: backendAuthToken,
        ...(browserCdpBrokerUrl && browserCdpBrokerToken
          ? {
              electronCdpBrokerUrl: browserCdpBrokerUrl,
              electronCdpBrokerToken: browserCdpBrokerToken,
            }
          : {}),
        ...(backendObservabilitySettings.otlpTracesUrl
          ? { otlpTracesUrl: backendObservabilitySettings.otlpTracesUrl }
          : {}),
        ...(backendObservabilitySettings.otlpMetricsUrl
          ? { otlpMetricsUrl: backendObservabilitySettings.otlpMetricsUrl }
          : {}),
      })}\n`,
    );
    bootstrapStream.end();
  } else {
    child.kill("SIGTERM");
    scheduleBackendRestart("missing desktop bootstrap pipe");
    return;
  }
  backendProcess = child;
  let backendSessionClosed = false;
  const closeBackendSession = (details: string) => {
    if (backendSessionClosed) return;
    backendSessionClosed = true;
    writeBackendSessionBoundary("END", details);
  };
  writeBackendSessionBoundary(
    "START",
    `pid=${child.pid ?? "unknown"} port=${backendPort} cwd=${resolveBackendCwd()}`,
  );
  captureBackendOutput(child);

  child.once("spawn", () => {
    restartAttempt = 0;
  });

  child.on("error", (error) => {
    const wasExpected = expectedBackendExitChildren.has(child);
    if (backendProcess === child) {
      backendProcess = null;
    }
    closeBackendSession(`pid=${child.pid ?? "unknown"} error=${error.message}`);
    if (wasExpected) {
      return;
    }
    scheduleBackendRestart(error.message);
  });

  child.on("exit", (code, signal) => {
    const wasExpected = expectedBackendExitChildren.has(child);
    if (backendProcess === child) {
      backendProcess = null;
    }
    closeBackendSession(
      `pid=${child.pid ?? "unknown"} code=${code ?? "null"} signal=${signal ?? "null"}`,
    );
    if (isQuitting || wasExpected) return;
    const reason = `code=${code ?? "null"} signal=${signal ?? "null"}`;
    scheduleBackendRestart(reason);
  });
}

function stopBackend(): void {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child) return;

  if (child.exitCode === null && child.signalCode === null) {
    expectedBackendExitChildren.add(child);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000).unref();
  }
}

function stopBrowserCdpBrokerServer(): void {
  browserCdpBrokerUrl = undefined;
  browserCdpBrokerToken = "";
  browserCdpBrokerServer?.close();
  browserCdpBrokerServer = null;
}

async function stopBackendAndWaitForExit(timeoutMs = 5_000): Promise<void> {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child) return;
  const backendChild = child;
  if (backendChild.exitCode !== null || backendChild.signalCode !== null) return;
  expectedBackendExitChildren.add(backendChild);

  await new Promise<void>((resolve) => {
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let exitTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

    function settle(): void {
      if (settled) return;
      settled = true;
      backendChild.off("exit", onExit);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      if (exitTimeoutTimer) {
        clearTimeout(exitTimeoutTimer);
      }
      resolve();
    }

    function onExit(): void {
      settle();
    }

    backendChild.once("exit", onExit);
    backendChild.kill("SIGTERM");

    forceKillTimer = setTimeout(() => {
      if (backendChild.exitCode === null && backendChild.signalCode === null) {
        backendChild.kill("SIGKILL");
      }
    }, 2_000);
    forceKillTimer.unref();

    exitTimeoutTimer = setTimeout(() => {
      settle();
    }, timeoutMs);
    exitTimeoutTimer.unref();
  });
}

function sendBrokerJson(
  response: HTTP.ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendBrokerSuccess(response: HTTP.ServerResponse, result: unknown): void {
  sendBrokerJson(response, 200, { ok: true, result });
}

function sendBrokerError(
  response: HTTP.ServerResponse,
  status: number,
  error: unknown,
  code = "ELECTRON_CDP_BROKER_ERROR",
): void {
  sendBrokerJson(response, status, {
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      code,
    },
  });
}

function writeBrokerNdjsonError(
  response: HTTP.ServerResponse,
  error: unknown,
  code = "ELECTRON_CDP_BROKER_ERROR",
): void {
  if (response.destroyed || response.writableEnded) return;
  response.write(
    `${JSON.stringify({
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code,
      },
    })}\n`,
  );
}

function isAuthorizedBrowserCdpRequest(request: HTTP.IncomingMessage): boolean {
  return (
    browserCdpBrokerToken.length > 0 &&
    request.headers.authorization === `Bearer ${browserCdpBrokerToken}`
  );
}

async function readBrokerJsonBody(request: HTTP.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCdpSendRequest(value: unknown): BrowserCdpSendRequest {
  if (!isRecord(value)) throw new Error("invalid CDP send request");
  const { id, viewId, sessionId, method, params } = value;
  if (
    typeof id !== "string" ||
    typeof viewId !== "string" ||
    typeof sessionId !== "string" ||
    typeof method !== "string"
  ) {
    throw new Error("invalid CDP send request");
  }
  if (params !== undefined && !isRecord(params)) throw new Error("invalid CDP command params");
  return {
    id,
    viewId,
    sessionId,
    method,
    ...(params === undefined ? {} : { params }),
  };
}

function parseCdpSubscribeRequest(value: unknown): BrowserCdpSubscribeRequest {
  if (!isRecord(value)) throw new Error("invalid CDP subscribe request");
  const { id, viewId, sessionId, eventName } = value;
  if (
    typeof id !== "string" ||
    typeof viewId !== "string" ||
    typeof sessionId !== "string" ||
    typeof eventName !== "string"
  ) {
    throw new Error("invalid CDP subscribe request");
  }
  return { id, viewId, sessionId, eventName };
}

function parseCdpAttachTargetRequest(value: unknown): BrowserCdpAttachTargetRequest {
  if (!isRecord(value)) throw new Error("invalid CDP attachTarget request");
  const { id, viewId, targetId } = value;
  if (typeof id !== "string" || typeof viewId !== "string" || typeof targetId !== "string") {
    throw new Error("invalid CDP attachTarget request");
  }
  return { id, viewId, targetId };
}

function parseTabsBaseRequest(value: unknown): BrowserTabsBaseRequest {
  if (!isRecord(value)) throw new Error("invalid tabs request");
  const { id, viewId } = value;
  if (typeof id !== "string" || typeof viewId !== "string") {
    throw new Error("invalid tabs request");
  }
  return { id, viewId };
}

function parseNewTabRequest(value: unknown): BrowserNewTabRequest {
  const base = parseTabsBaseRequest(value);
  const url = (value as { url?: unknown }).url;
  if (url !== undefined && typeof url !== "string") throw new Error("invalid newTab url");
  return { ...base, ...(url === undefined ? {} : { url }) };
}

function parseTabIdRequest(value: unknown): BrowserTabIdRequest {
  const base = parseTabsBaseRequest(value);
  const tabIdRaw = (value as { tabId?: unknown }).tabId;
  const tabId = Number(tabIdRaw);
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error("invalid tabId");
  return { ...base, tabId };
}

function parsePrintPdfRequest(value: unknown): BrowserPrintPdfRequest {
  if (!isRecord(value)) throw new Error("invalid printPdf request");
  const { id, viewId, options } = value;
  if (typeof id !== "string" || typeof viewId !== "string") {
    throw new Error("invalid printPdf request");
  }
  if (options !== undefined && !isRecord(options)) {
    throw new Error("invalid printPdf options");
  }
  return {
    id,
    viewId,
    ...(options === undefined ? {} : { options: options as Electron.PrintToPDFOptions }),
  };
}

function getEmbeddedBrowserWindowState(window: BrowserWindow): EmbeddedBrowserWindowState {
  const existing = embeddedBrowserStateByWindow.get(window);
  if (existing) return existing;
  const state: EmbeddedBrowserWindowState = {
    projectsByProjectId: new Map(),
    activeProjectId: null,
    mountRequestId: 0,
  };
  embeddedBrowserStateByWindow.set(window, state);
  return state;
}

function normalizeProjectId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.:-]+$/.test(trimmed) ? trimmed : null;
}

function normalizeBrowserBounds(value: unknown): BrowserViewBounds | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const width = Number(record.width);
  const height = Number(record.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
  };
}

function normalizeBrowserUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return ["about:", "http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function isEmbeddedBrowserDestroyed(embedded: EmbeddedBrowserTabState): boolean {
  return embedded.view.webContents.isDestroyed();
}

function failEmbeddedBrowserCdpSubscriptions(
  embedded: EmbeddedBrowserTabState,
  error: unknown,
  code = "ELECTRON_CDP_BROKER_ERROR",
): void {
  for (const subscription of Array.from(embedded.subscriptions)) {
    subscription.closeWithError(error, code);
  }
}

async function sendBrowserCdp(
  embedded: EmbeddedBrowserTabState,
  method: string,
  params?: Record<string, unknown>,
): Promise<boolean> {
  try {
    if (isEmbeddedBrowserDestroyed(embedded)) return false;
    if (!embedded.view.webContents.debugger.isAttached()) return false;
    await embedded.view.webContents.debugger.sendCommand(method, params);
    return true;
  } catch (error) {
    console.warn("[desktop/browser] CDP command failed", {
      projectId: embedded.projectId,
      method,
      error,
    });
    return false;
  }
}

function clearEmbeddedBrowserDebuggerRetry(embedded: EmbeddedBrowserTabState): void {
  if (!embedded.reattachRetryTimer) return;
  clearTimeout(embedded.reattachRetryTimer);
  embedded.reattachRetryTimer = null;
}

function attachEmbeddedBrowserDebugger(embedded: EmbeddedBrowserTabState): boolean {
  if (isEmbeddedBrowserDestroyed(embedded)) return false;
  if (embedded.view.webContents.debugger.isAttached()) {
    embedded.devtoolsOpen = false;
    clearEmbeddedBrowserDebuggerRetry(embedded);
    return true;
  }
  try {
    embedded.view.webContents.debugger.attach("1.3");
    embedded.devtoolsOpen = false;
    clearEmbeddedBrowserDebuggerRetry(embedded);
    return true;
  } catch (error) {
    embedded.devtoolsOpen = true;
    console.warn("[desktop/browser] failed to attach debugger", {
      projectId: embedded.projectId,
      error,
    });
    return false;
  }
}

function scheduleEmbeddedBrowserDebuggerRetry(embedded: EmbeddedBrowserTabState): void {
  if (embedded.reattachRetryTimer || isEmbeddedBrowserDestroyed(embedded)) return;
  embedded.reattachRetryTimer = setTimeout(() => {
    embedded.reattachRetryTimer = null;
    void resumeEmbeddedBrowser(embedded).then((attached) => {
      if (!attached && !isEmbeddedBrowserDestroyed(embedded)) {
        scheduleEmbeddedBrowserDebuggerRetry(embedded);
      }
    });
  }, 1000);
  embedded.reattachRetryTimer.unref?.();
}

// Pauses media in a hidden embedded browser. The view stays alive and CDP
// commands run at full speed regardless of UI mount status — per T3CO-421
// every project's WebContentsView is always-on, so unmount no longer means
// "stop the page." The only deterministic UX win on hide is silencing
// background <video>/<audio>; CPU throttling intentionally not applied.
async function pauseEmbeddedBrowserMedia(embedded: EmbeddedBrowserTabState): Promise<void> {
  await sendBrowserCdp(embedded, "Runtime.evaluate", {
    expression:
      "Promise.resolve().then(() => { for (const media of document.querySelectorAll('video,audio')) { try { media.pause(); } catch {} } })",
    awaitPromise: true,
  });
}

async function resumeEmbeddedBrowser(embedded: EmbeddedBrowserTabState): Promise<boolean> {
  return attachEmbeddedBrowserDebugger(embedded);
}

// Marks a project as freshly active and resumes it if it was idle-suspended.
// Called from every activity chokepoint: CDP broker, BROWSER_MOUNT/UNMOUNT
// IPC handlers, and a small set of page events. Idempotent. See T3CO-422.
function markEmbeddedBrowserActive(project: EmbeddedBrowserProjectState): void {
  project.lastActivityAt = Date.now();
  if (project.suspended) resumeEmbeddedBrowserProject(project);
}

function suspendEmbeddedBrowserProject(project: EmbeddedBrowserProjectState): void {
  if (project.suspended) return;
  for (const tab of project.tabs.values()) {
    if (isEmbeddedBrowserDestroyed(tab)) continue;
    try {
      tab.view.webContents.setBackgroundThrottling(true);
      tab.view.webContents.setAudioMuted(true);
    } catch (error) {
      console.warn("[desktop/browser] suspend failed", { projectId: project.projectId, error });
    }
  }
  project.suspended = true;
  console.log("[desktop/browser] suspended idle project", {
    projectId: project.projectId,
    idleMs: Date.now() - project.lastActivityAt,
    tabs: project.tabs.size,
  });
}

function resumeEmbeddedBrowserProject(project: EmbeddedBrowserProjectState): void {
  if (!project.suspended) return;
  for (const tab of project.tabs.values()) {
    if (isEmbeddedBrowserDestroyed(tab)) continue;
    try {
      tab.view.webContents.setBackgroundThrottling(false);
      tab.view.webContents.setAudioMuted(false);
    } catch (error) {
      console.warn("[desktop/browser] resume failed", { projectId: project.projectId, error });
    }
  }
  project.suspended = false;
  console.log("[desktop/browser] resumed project", {
    projectId: project.projectId,
    tabs: project.tabs.size,
  });
}

function readBrowserSuspendMinutes(): number {
  try {
    if (!FS.existsSync(SERVER_SETTINGS_PATH)) return DEFAULT_IDLE_BROWSER_SUSPEND_MINUTES;
    return parsePersistedBrowserSuspendMinutes(FS.readFileSync(SERVER_SETTINGS_PATH, "utf8"));
  } catch {
    return DEFAULT_IDLE_BROWSER_SUSPEND_MINUTES;
  }
}

function runEmbeddedBrowserIdleReaperSweep(): void {
  const minutes = readBrowserSuspendMinutes();
  if (minutes <= 0) return;
  const thresholdMs = minutes * 60_000;
  const now = Date.now();
  for (const project of embeddedBrowserProjectsByProjectId.values()) {
    if (isEmbeddedBrowserProjectDestroyed(project)) continue;
    if (shouldSuspendForIdle({ project, thresholdMs, now })) {
      suspendEmbeddedBrowserProject(project);
    }
  }
}

function startEmbeddedBrowserIdleReaper(): void {
  if (embeddedBrowserIdleReaperTimer) return;
  embeddedBrowserIdleReaperTimer = setInterval(
    runEmbeddedBrowserIdleReaperSweep,
    EMBEDDED_BROWSER_IDLE_REAPER_INTERVAL_MS,
  );
  embeddedBrowserIdleReaperTimer.unref?.();
}

function getIpcBrowserWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
}

function findEmbeddedBrowserOwnerWindow(tab: EmbeddedBrowserTabState): BrowserWindow | null {
  for (const window of BrowserWindow.getAllWindows()) {
    const state = embeddedBrowserStateByWindow.get(window);
    const project = state?.projectsByProjectId.get(tab.projectId);
    if (project && project.tabs.get(tab.tabId) === tab) return window;
  }
  return null;
}

function getActiveEmbeddedBrowserProject(
  window: BrowserWindow,
): EmbeddedBrowserProjectState | null {
  const state = getEmbeddedBrowserWindowState(window);
  if (!state.activeProjectId) return null;
  const project = state.projectsByProjectId.get(state.activeProjectId) ?? null;
  if (project && isEmbeddedBrowserProjectDestroyed(project)) {
    cleanupEmbeddedBrowserProject(project, state);
    return null;
  }
  return project;
}

function getProjectScopedEmbeddedBrowserProject(
  window: BrowserWindow,
  rawProjectId: unknown,
  action: string,
): EmbeddedBrowserProjectState | null {
  const projectId = normalizeProjectId(rawProjectId);
  if (!projectId) throw new Error(`invalid embedded browser ${action} request`);

  const state = getEmbeddedBrowserWindowState(window);
  if (state.activeProjectId !== projectId) {
    console.warn("[desktop/browser] ignored stale embedded browser request", {
      action,
      requestedProjectId: projectId,
      activeProjectId: state.activeProjectId,
    });
    return null;
  }

  const project = state.projectsByProjectId.get(projectId) ?? null;
  if (project && isEmbeddedBrowserProjectDestroyed(project)) {
    cleanupEmbeddedBrowserProject(project, state);
    return null;
  }
  return project;
}

function isEmbeddedBrowserProjectDestroyed(project: EmbeddedBrowserProjectState): boolean {
  for (const tab of project.tabs.values()) {
    if (!isEmbeddedBrowserDestroyed(tab)) return false;
  }
  return true;
}

function cdpSessionId(sessionId: string): string | undefined {
  return sessionId === "root" ? undefined : sessionId;
}

function cleanupEmbeddedBrowserView(
  tab: EmbeddedBrowserTabState,
  state?: EmbeddedBrowserWindowState,
): void {
  clearEmbeddedBrowserDebuggerRetry(tab);
  failEmbeddedBrowserCdpSubscriptions(tab, "Embedded browser tab was destroyed");
  const project = embeddedBrowserProjectsByProjectId.get(tab.projectId);
  if (!project) return;
  if (project.tabs.get(tab.tabId) === tab) project.tabs.delete(tab.tabId);
  if (project.tabs.size === 0) {
    cleanupEmbeddedBrowserProject(project, state);
    return;
  }
  if (project.activeTabId === tab.tabId) {
    // Fall back to any remaining tab. Tab order is insertion order — pick the
    // earliest (most likely the root tab 0, or the lowest-numbered sibling).
    const next = project.tabs.keys().next();
    if (!next.done) project.activeTabId = next.value;
  }
}

function cleanupEmbeddedBrowserProject(
  project: EmbeddedBrowserProjectState,
  state?: EmbeddedBrowserWindowState,
): void {
  project.mounted = false;
  project.suspendedForModal = false;
  for (const tab of project.tabs.values()) {
    clearEmbeddedBrowserDebuggerRetry(tab);
    failEmbeddedBrowserCdpSubscriptions(tab, "Embedded browser project was destroyed");
  }
  project.tabs.clear();
  if (embeddedBrowserProjectsByProjectId.get(project.projectId) === project) {
    embeddedBrowserProjectsByProjectId.delete(project.projectId);
  }
  if (state?.projectsByProjectId.get(project.projectId) === project) {
    state.projectsByProjectId.delete(project.projectId);
  }
  if (state?.activeProjectId === project.projectId) {
    state.activeProjectId = null;
  }
}

// viewId lookup. Accepts:
//   - `<projectId>`               → the project's currently active tab
//   - `<projectId>:<tabId>`       → a specific tab within a project
//   - `electron-wc:<webContentsId>` (legacy handle) → matching tab by handle
function getEmbeddedBrowserForCdp(viewId: string): EmbeddedBrowserTabState {
  const { projectId, tabId } = parseViewId(viewId);
  if (projectId) {
    const project = embeddedBrowserProjectsByProjectId.get(projectId);
    if (project) {
      const targetTabId = tabId ?? project.activeTabId;
      const tab = project.tabs.get(targetTabId);
      if (tab && !isEmbeddedBrowserDestroyed(tab)) return tab;
    }
  }
  // Legacy handle lookup: scan all tabs for a matching `handle` on the project.
  for (const [id, project] of embeddedBrowserProjectsByProjectId) {
    if (project.handle === viewId) {
      const tab = project.tabs.get(project.activeTabId);
      if (tab && !isEmbeddedBrowserDestroyed(tab)) return tab;
    }
    if (isEmbeddedBrowserProjectDestroyed(project)) {
      embeddedBrowserProjectsByProjectId.delete(id);
    }
  }
  throw new Error(
    "Embedded browser host is not connected yet; retry once the desktop process re-announces active browser views.",
  );
}

function parseViewId(viewId: string): { projectId: string | null; tabId: number | null } {
  const colon = viewId.indexOf(":");
  if (colon < 0) return { projectId: viewId, tabId: null };
  // Legacy handles use the prefix "electron-wc:" — treat them as opaque.
  if (viewId.startsWith("electron-wc:")) return { projectId: null, tabId: null };
  const projectId = viewId.slice(0, colon);
  const tabIdRaw = viewId.slice(colon + 1);
  const tabId = Number(tabIdRaw);
  if (!Number.isFinite(tabId) || !Number.isInteger(tabId) || tabId < 0) {
    return { projectId, tabId: null };
  }
  return { projectId, tabId };
}

function assertEmbeddedBrowserDebuggerAvailable(embedded: EmbeddedBrowserTabState): void {
  if (embedded.devtoolsOpen || !embedded.view.webContents.debugger.isAttached()) {
    throw new Error(EMBEDDED_BROWSER_DEVTOOLS_OPEN_MESSAGE);
  }
}

async function sendEmbeddedBrowserCdpCommand(request: BrowserCdpSendRequest): Promise<unknown> {
  const embedded = getEmbeddedBrowserForCdp(request.viewId);
  assertEmbeddedBrowserDebuggerAvailable(embedded);
  try {
    return await embedded.view.webContents.debugger.sendCommand(
      request.method,
      request.params,
      cdpSessionId(request.sessionId),
    );
  } catch (error) {
    if (!embedded.view.webContents.debugger.isAttached()) {
      embedded.devtoolsOpen = true;
      throw new Error(EMBEDDED_BROWSER_DEVTOOLS_OPEN_MESSAGE, { cause: error });
    }
    throw error;
  }
}

async function attachEmbeddedBrowserCdpTarget(
  request: BrowserCdpAttachTargetRequest,
): Promise<string> {
  const response = (await sendEmbeddedBrowserCdpCommand({
    id: request.id,
    viewId: request.viewId,
    sessionId: "root",
    method: "Target.attachToTarget",
    params: { targetId: request.targetId, flatten: true },
  })) as { sessionId?: unknown };
  if (typeof response.sessionId !== "string") {
    throw new Error("CDP Target.attachToTarget did not return a sessionId");
  }
  return response.sessionId;
}

// Electron's embedded debugger does not expose `Page.printToPDF`, so the
// server host cannot produce a PDF over the regular CDP send path. This
// routes through `webContents.printToPDF()` (the native Electron API) and
// returns a base64-encoded payload so the existing broker response envelope
// stays a plain JSON string.
// Tab ops against the broker: the viewId is the projectId (not a tabId). We
// look up the EmbeddedBrowserProjectState, find the owning window (so active
// tab switches are visible), and route through the same helpers the IPC
// handlers use. Responses mirror the shapes the server host expects — tab
// summaries with {id,url,title,favicon,active}.
function findProjectAndWindowForBroker(projectId: string): {
  project: EmbeddedBrowserProjectState;
  window: BrowserWindow;
} {
  const project = embeddedBrowserProjectsByProjectId.get(projectId);
  if (!project) {
    throw new Error(
      "Embedded browser host is not connected yet; retry once the desktop process re-announces active browser views.",
    );
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    const state = embeddedBrowserStateByWindow.get(window);
    if (state?.projectsByProjectId.get(projectId) === project) return { project, window };
  }
  throw new Error(`no BrowserWindow currently hosts project ${projectId}`);
}

function listEmbeddedBrowserTabs(request: BrowserTabsBaseRequest): {
  tabs: ReturnType<typeof summarizeEmbeddedBrowserTabs>;
  activeTabId: number;
} {
  const project = embeddedBrowserProjectsByProjectId.get(request.viewId);
  if (!project) {
    throw new Error(
      "Embedded browser host is not connected yet; retry once the desktop process re-announces active browser views.",
    );
  }
  return { tabs: summarizeEmbeddedBrowserTabs(project), activeTabId: project.activeTabId };
}

async function newEmbeddedBrowserTab(request: BrowserNewTabRequest): Promise<number> {
  const { project, window } = findProjectAndWindowForBroker(request.viewId);
  const url = request.url ? (normalizeBrowserUrl(request.url) ?? "about:blank") : "about:blank";
  const tabId = openNewBrowserTab(project, url);
  await switchBrowserTab(project, tabId, window);
  return tabId;
}

async function switchEmbeddedBrowserTab(request: BrowserTabIdRequest): Promise<number> {
  const { project, window } = findProjectAndWindowForBroker(request.viewId);
  if (!project.tabs.has(request.tabId)) throw new Error(`unknown tab id ${request.tabId}`);
  await switchBrowserTab(project, request.tabId, window);
  return project.activeTabId;
}

async function closeEmbeddedBrowserTab(request: BrowserTabIdRequest): Promise<number> {
  const { project, window } = findProjectAndWindowForBroker(request.viewId);
  await closeBrowserTab(project, request.tabId, window);
  return project.activeTabId;
}

async function printEmbeddedBrowserPdf(request: BrowserPrintPdfRequest): Promise<string> {
  const embedded = getEmbeddedBrowserForCdp(request.viewId);
  assertEmbeddedBrowserDebuggerAvailable(embedded);
  const options: Electron.PrintToPDFOptions = {
    printBackground: true,
    ...(request.options ?? {}),
  };
  const buffer = await embedded.view.webContents.printToPDF(options);
  return buffer.toString("base64");
}

function subscribeEmbeddedBrowserCdpEvents(
  response: HTTP.ServerResponse,
  request: BrowserCdpSubscribeRequest,
): void {
  const embedded = getEmbeddedBrowserForCdp(request.viewId);
  assertEmbeddedBrowserDebuggerAvailable(embedded);

  const expectedSessionId = cdpSessionId(request.sessionId);
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });

  let closed = false;
  const writeEvent = (event: unknown, method: string, params: unknown, sessionId?: string) => {
    void event;
    if (closed) return;
    if (method !== request.eventName) return;
    if ((sessionId ?? undefined) !== expectedSessionId) return;
    response.write(
      `${JSON.stringify({
        ok: true,
        result: {
          method,
          params,
          ...(sessionId === undefined ? {} : { sessionId }),
        },
      })}\n`,
    );
  };

  let subscription: EmbeddedBrowserCdpSubscription | null = null;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (subscription) embedded.subscriptions.delete(subscription);
    embedded.view.webContents.debugger.off("message", writeEvent);
  };
  const closeWithError = (error: unknown, code = "ELECTRON_CDP_BROKER_ERROR") => {
    if (closed || response.destroyed || response.writableEnded) return;
    writeBrokerNdjsonError(response, error, code);
    response.end();
    cleanup();
  };
  subscription = { closeWithError };
  embedded.subscriptions.add(subscription);
  embedded.view.webContents.debugger.on("message", writeEvent);
  response.once("close", cleanup);
}

// Hidden BaseWindow that parents every embedded-browser WebContentsView when
// it isn't mounted in a real BrowserWindow. Chromium suspends the compositor
// for any view not attached to some window's contentView, which breaks
// paint-dependent CDP commands (`Page.captureScreenshot`, `Page.printToPDF`,
// media extraction) for hidden projects. The window is never shown.
let offscreenBrowserHost: BaseWindow | null = null;
function ensureOffscreenBrowserHost(): BaseWindow {
  if (offscreenBrowserHost && !offscreenBrowserHost.isDestroyed()) return offscreenBrowserHost;
  offscreenBrowserHost = new BaseWindow({
    show: false,
    width: 1280,
    height: 800,
    x: -10000,
    y: -10000,
    skipTaskbar: true,
  });
  return offscreenBrowserHost;
}

function parkEmbeddedBrowserView(view: WebContentsView): void {
  const host = ensureOffscreenBrowserHost();
  try {
    host.contentView.addChildView(view);
  } catch (error) {
    console.warn("[desktop/browser] failed to park view in offscreen host", { error });
  }
}

// Returns the live project for projectId, creating it (and its root tab)
// offscreen if it does not exist or has been fully destroyed. Called from
// the agent CDP broker handler (lazy first-touch) and BROWSER_MOUNT_CHANNEL
// (reuse the warm view if it exists, create one if the agent raced ahead).
// Per T3CO-421 a project's lifecycle is decoupled from window mount state.
function ensureEmbeddedBrowserProject(projectId: string): EmbeddedBrowserProjectState {
  const existing = embeddedBrowserProjectsByProjectId.get(projectId);
  if (existing && !isEmbeddedBrowserProjectDestroyed(existing)) return existing;
  if (existing) cleanupEmbeddedBrowserProject(existing);
  console.log("[desktop/browser] materializing project view (offscreen)", {
    projectId,
    replacingDestroyed: existing !== undefined,
  });
  const project: EmbeddedBrowserProjectState = {
    projectId,
    handle: `electron-wc:${projectId}`,
    tabs: new Map(),
    activeTabId: 0,
    nextTabId: 1,
    mounted: false,
    suspendedForModal: false,
    bounds: null,
    lastActivityAt: Date.now(),
    suspended: false,
  };
  const rootTab = createEmbeddedBrowserTab(project, 0, "about:blank");
  project.tabs.set(0, rootTab);
  embeddedBrowserProjectsByProjectId.set(projectId, project);
  return project;
}

function createEmbeddedBrowserTab(
  project: EmbeddedBrowserProjectState,
  tabId: number,
  initialUrl: string,
): EmbeddedBrowserTabState {
  const { projectId } = project;
  const partition = `persist:${projectId}`;
  const view = new WebContentsView({
    webPreferences: {
      session: session.fromPartition(partition),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Suppress Chromium's native JavaScript dialog path. alert/confirm/prompt
      // would otherwise render a window-modal dialog attached to the owning
      // BrowserWindow — blurring the entire T3 Code UI, not just the webview.
      // The server host injects a page-side override that captures the dialog
      // and returns a synchronous value driven by dialog-accept/dialog-dismiss.
      disableDialogs: true,
    },
  });
  // Park the new view immediately so Chromium starts compositing — see
  // ensureOffscreenBrowserHost above. Mount paths use `addChildView` on a
  // real BrowserWindow which re-parents it; unmount paths re-park it here.
  parkEmbeddedBrowserView(view);
  // Electron disables Chromium's native pinch-to-zoom path by default. Without
  // this call, macOS trackpad pinch gestures inside the webview are swallowed
  // entirely — `zoom-changed` only fires for Ctrl+wheel, not for native pinch.
  // Matching Chrome/Safari behavior by enabling visual zoom in a reasonable
  // range. Page zoom (Cmd+=/−/0) still handled separately via before-input-event.
  view.webContents.setVisualZoomLevelLimits(1, 3).catch((error: unknown) => {
    console.warn("[desktop/browser] setVisualZoomLevelLimits failed", { projectId, error });
  });

  const tab: EmbeddedBrowserTabState = {
    projectId,
    tabId,
    view,
    subscriptions: new Set(),
    reattachRetryTimer: null,
    devtoolsOpen: false,
    title: "",
    favicon: null,
  };

  view.webContents.debugger.on("detach", (_event, reason) => {
    tab.devtoolsOpen = true;
    console.warn("[desktop/browser] debugger detached from embedded browser tab", {
      projectId,
      tabId,
      reason,
    });
    failEmbeddedBrowserCdpSubscriptions(
      tab,
      new Error(EMBEDDED_BROWSER_DEVTOOLS_OPEN_MESSAGE),
      "ELECTRON_CDP_DEVTOOLS_OPEN",
    );
  });
  view.webContents.on("devtools-closed", () => {
    void resumeEmbeddedBrowser(tab).then((attached) => {
      if (!attached) scheduleEmbeddedBrowserDebuggerRetry(tab);
    });
  });
  view.webContents.on("page-title-updated", (_event, title) => {
    tab.title = title;
    notifyEmbeddedBrowserTabsChanged(project);
  });
  // Cmd/Ctrl-click (and window.open, target="_blank", etc.) normally spawn a
  // separate Electron window. Intercept and route into a new tab in this
  // project instead, so the flow stays contained in the chat shell. The new
  // tab is created in the background — we do not switch to it, matching
  // standard browser behavior for modifier-clicks.
  view.webContents.setWindowOpenHandler((details) => {
    try {
      openNewBrowserTab(project, details.url || "about:blank");
    } catch (error) {
      console.warn("[desktop/browser] failed to open link in new tab", {
        projectId,
        url: details.url,
        error,
      });
    }
    return { action: "deny" };
  });
  // Tab keyboard shortcuts — intercepted here so they fire even while focus is
  // inside the webview (where the React shell's window-level keydown listener
  // never sees them). Cmd/Ctrl+T opens a new tab and switches to it, Cmd/Ctrl+W
  // closes the active tab, Cmd/Ctrl+R reloads the active tab (Shift for a
  // cache-bypassing reload). Without the reload intercept the menu's
  // `role: "reload"` accelerator would reload the host T3 Code window instead.
  // Cmd/Ctrl+<number> is intentionally NOT bound — that range is owned by the
  // chat-thread navigation shortcut.
  view.webContents.on("before-input-event", (event, input) => {
    // Any user input — keys, mouse — counts as activity for the idle reaper.
    markEmbeddedBrowserActive(project);
    if (input.type !== "keyDown") return;
    const mod = input.meta || input.control;
    if (!mod) return;
    const owner = findEmbeddedBrowserOwnerWindow(tab);
    if (!owner || owner.isDestroyed()) return;
    const key = input.key.toLowerCase();
    // DevTools toggle — matches Chrome's shortcuts: Cmd+Alt+I (mac) and
    // Ctrl+Shift+I (win/linux). Detached mode keeps the page visible alongside
    // the inspector. Opening DevTools detaches our CDP debugger (Chromium's
    // protocol is single-client); `devtools-closed` re-attaches it — see T3CO-341.
    // Use `input.code` (physical key) rather than `input.key` because macOS
    // mangles the key char when Option is held (Cmd+Opt+I yields key="ˆ"), so a
    // `key === "i"` check would miss the match and let the menu accelerator
    // (which opens DevTools for the host window) win.
    if (input.code === "KeyI" && (input.alt || input.shift)) {
      event.preventDefault();
      try {
        if (view.webContents.isDevToolsOpened()) {
          view.webContents.closeDevTools();
        } else {
          // Default to docked on the right side of the host BrowserWindow.
          // WebContentsView can't dock inside its own view region — Chromium
          // docks against BrowserWindow — so "right" puts the inspector next
          // to the whole T3 Code window. The DevTools toolbar's dock-side
          // picker still lets users undock to a separate window at any time.
          view.webContents.openDevTools({ mode: "right" });
        }
      } catch (error) {
        console.warn("[desktop/browser] shortcut toggleDevTools failed", { projectId, error });
      }
      return;
    }
    // Remaining shortcuts reject alt so Option-modified keys (text composition
    // etc.) pass through to the page.
    if (input.alt) return;
    if (key === "t") {
      event.preventDefault();
      try {
        const newTabId = openNewBrowserTab(project, "about:blank");
        void switchBrowserTab(project, newTabId, owner);
      } catch (error) {
        console.warn("[desktop/browser] shortcut newTab failed", { projectId, error });
      }
      return;
    }
    if (key === "w") {
      event.preventDefault();
      void closeBrowserTab(project, project.activeTabId, owner).catch((error: unknown) => {
        console.warn("[desktop/browser] shortcut closeTab failed", { projectId, error });
      });
      return;
    }
    if (key === "r") {
      event.preventDefault();
      try {
        if (input.shift) {
          view.webContents.reloadIgnoringCache();
        } else {
          view.webContents.reload();
        }
      } catch (error) {
        console.warn("[desktop/browser] shortcut reload failed", { projectId, error });
      }
      return;
    }
    // Zoom shortcuts — intercepted for the same reason as reload. The menu's
    // zoomIn/zoomOut/resetZoom roles would otherwise zoom the host T3 Code
    // window. Cmd/Ctrl+= (and shift variant "+") zoom in, Cmd/Ctrl+- zooms out,
    // Cmd/Ctrl+0 resets. Levels are clamped to Chromium's typical UI range.
    if (key === "=" || key === "+") {
      event.preventDefault();
      try {
        const next = Math.min(9, view.webContents.getZoomLevel() + 1);
        view.webContents.setZoomLevel(next);
      } catch (error) {
        console.warn("[desktop/browser] shortcut zoomIn failed", { projectId, error });
      }
      return;
    }
    if (key === "-") {
      event.preventDefault();
      try {
        const next = Math.max(-3, view.webContents.getZoomLevel() - 1);
        view.webContents.setZoomLevel(next);
      } catch (error) {
        console.warn("[desktop/browser] shortcut zoomOut failed", { projectId, error });
      }
      return;
    }
    if (key === "0") {
      event.preventDefault();
      try {
        view.webContents.setZoomLevel(0);
      } catch (error) {
        console.warn("[desktop/browser] shortcut zoomReset failed", { projectId, error });
      }
    }
  });
  // Trackpad pinch zoom on macOS. Electron fires `zoom-changed` on every pinch
  // tick but does not apply the zoom itself — we translate the direction into a
  // level delta and clamp to the same range as the keyboard shortcuts.
  view.webContents.on("zoom-changed", (_event, zoomDirection) => {
    try {
      const current = view.webContents.getZoomLevel();
      const next =
        zoomDirection === "in" ? Math.min(9, current + 0.5) : Math.max(-3, current - 0.5);
      view.webContents.setZoomLevel(next);
    } catch (error) {
      console.warn("[desktop/browser] pinch zoom failed", { projectId, error });
    }
  });
  view.webContents.on("page-favicon-updated", (_event, favicons) => {
    tab.favicon = favicons[0] ?? null;
    notifyEmbeddedBrowserTabsChanged(project);
  });
  // Prevent the webview from stealing focus from the chat shell on programmatic
  // navigations. See T3CO-3.
  let preNavHadViewFocus = false;
  view.webContents.on("did-start-loading", () => {
    preNavHadViewFocus = view.webContents.isFocused();
  });
  view.webContents.on("did-finish-load", () => {
    if (tab.devtoolsOpen) void resumeEmbeddedBrowser(tab);
    if (!preNavHadViewFocus && view.webContents.isFocused()) {
      const owner = findEmbeddedBrowserOwnerWindow(tab);
      if (owner && !owner.isDestroyed()) owner.webContents.focus();
    }
    markEmbeddedBrowserActive(project);
    notifyEmbeddedBrowserTabsChanged(project);
  });
  view.webContents.on("destroyed", () => {
    // Resolve the owning window at destroy-time rather than at tab creation:
    // a view created offscreen may later be bound to a real BrowserWindow.
    const owner = findEmbeddedBrowserOwnerWindow(tab);
    const ownerState = owner ? embeddedBrowserStateByWindow.get(owner) : undefined;
    cleanupEmbeddedBrowserView(tab, ownerState);
    notifyEmbeddedBrowserTabsChanged(project);
  });

  attachEmbeddedBrowserDebugger(tab);
  void view.webContents.loadURL(initialUrl).catch((error) => {
    if (isBrowserNavigationAbortError(error)) {
      console.warn("[desktop/browser] embedded browser initial navigation canceled", {
        projectId,
        tabId,
        requestedUrl: initialUrl,
        currentUrl: view.webContents.getURL(),
      });
      return;
    }

    console.warn("[desktop/browser] failed to load embedded browser tab", {
      projectId,
      tabId,
      url: initialUrl,
      error,
    });
  });
  return tab;
}

// Push "tabs changed" updates to any interested BrowserWindow that hosts this
// project so the tab strip in the chat shell can re-render without polling.
function notifyEmbeddedBrowserTabsChanged(project: EmbeddedBrowserProjectState): void {
  const payload = summarizeEmbeddedBrowserTabs(project);
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    const state = embeddedBrowserStateByWindow.get(window);
    if (state?.projectsByProjectId.get(project.projectId) !== project) continue;
    try {
      window.webContents.send(BROWSER_TABS_CHANGED_CHANNEL, {
        projectId: project.projectId,
        tabs: payload,
        activeTabId: project.activeTabId,
      });
    } catch (error) {
      console.warn("[desktop/browser] failed to push tabs update", {
        projectId: project.projectId,
        error,
      });
    }
  }
}

async function mountActiveTabInWindow(
  project: EmbeddedBrowserProjectState,
  window: BrowserWindow,
  bounds: BrowserViewBounds,
): Promise<boolean> {
  const activeTab = project.tabs.get(project.activeTabId);
  if (!activeTab) return false;
  await resumeEmbeddedBrowser(activeTab);
  const state = embeddedBrowserStateByWindow.get(window);
  if (state?.activeProjectId !== project.projectId) return false;
  activeTab.view.setBounds(bounds);
  if (!project.mounted) {
    window.contentView.addChildView(activeTab.view);
    project.mounted = true;
  }
  return true;
}

function openNewBrowserTab(project: EmbeddedBrowserProjectState, url: string): number {
  const liveTabs = Array.from(project.tabs.values()).filter(
    (tab) => !isEmbeddedBrowserDestroyed(tab),
  );
  if (liveTabs.length >= MAX_TABS_PER_PROJECT) {
    throw new Error(
      `browser tab limit reached (${MAX_TABS_PER_PROJECT}); close an existing tab first`,
    );
  }
  const tabId = project.nextTabId++;
  const tab = createEmbeddedBrowserTab(project, tabId, url);
  project.tabs.set(tabId, tab);
  console.log("[desktop/browser] tab opened", {
    projectId: project.projectId,
    tabId,
    url,
    tabCount: project.tabs.size,
  });
  notifyEmbeddedBrowserTabsChanged(project);
  return tabId;
}

async function switchBrowserTab(
  project: EmbeddedBrowserProjectState,
  tabId: number,
  window: BrowserWindow,
): Promise<void> {
  if (project.activeTabId === tabId && project.mounted) {
    notifyEmbeddedBrowserTabsChanged(project);
    return;
  }
  const previousTabId = project.activeTabId;
  const currentActive = project.tabs.get(project.activeTabId);
  if (project.mounted && currentActive) {
    window.contentView.removeChildView(currentActive.view);
    parkEmbeddedBrowserView(currentActive.view);
    void pauseEmbeddedBrowserMedia(currentActive);
  }
  project.mounted = false;
  project.activeTabId = tabId;
  if (project.bounds) {
    await mountActiveTabInWindow(project, window, project.bounds);
  }
  console.log("[desktop/browser] tab switched", {
    projectId: project.projectId,
    fromTabId: previousTabId,
    toTabId: tabId,
  });
  notifyEmbeddedBrowserTabsChanged(project);
}

async function closeBrowserTab(
  project: EmbeddedBrowserProjectState,
  tabId: number,
  window: BrowserWindow,
): Promise<void> {
  const tab = project.tabs.get(tabId);
  if (!tab) throw new Error(`unknown tab id ${tabId}`);
  if (project.tabs.size <= 1) {
    // Reset the root tab to about:blank rather than destroying the last tab —
    // the project always has at least one tab so the webview stays mounted.
    await tab.view.webContents.loadURL("about:blank");
    tab.title = "";
    tab.favicon = null;
    console.log("[desktop/browser] tab reset (root)", { projectId: project.projectId, tabId });
    notifyEmbeddedBrowserTabsChanged(project);
    return;
  }
  const wasActive = project.activeTabId === tabId;
  project.tabs.delete(tabId);
  tab.view.webContents.close();
  console.log("[desktop/browser] tab closed", {
    projectId: project.projectId,
    tabId,
    wasActive,
    tabCount: project.tabs.size,
  });
  if (wasActive) {
    const next = project.tabs.keys().next();
    if (!next.done) {
      await switchBrowserTab(project, next.value, window);
      return;
    }
  }
  notifyEmbeddedBrowserTabsChanged(project);
}

function summarizeEmbeddedBrowserTabs(
  project: EmbeddedBrowserProjectState,
): Array<{ id: number; url: string; title: string; favicon: string | null; active: boolean }> {
  const summaries: Array<{
    id: number;
    url: string;
    title: string;
    favicon: string | null;
    active: boolean;
  }> = [];
  for (const [tabId, tab] of project.tabs) {
    if (isEmbeddedBrowserDestroyed(tab)) continue;
    summaries.push({
      id: tabId,
      url: tab.view.webContents.getURL(),
      title: tab.title || tab.view.webContents.getTitle(),
      favicon: tab.favicon,
      active: tabId === project.activeTabId,
    });
  }
  return summaries;
}

function registerIpcHandlers(): void {
  ipcMain.removeAllListeners(GET_WS_URL_CHANNEL);
  ipcMain.on(GET_WS_URL_CHANNEL, (event) => {
    event.returnValue = backendWsUrl;
  });

  ipcMain.removeHandler(BROWSER_MOUNT_CHANNEL);
  ipcMain.handle(
    BROWSER_MOUNT_CHANNEL,
    async (event, rawProjectId: unknown, rawBounds: unknown) => {
      const window = getIpcBrowserWindow(event);
      const projectId = normalizeProjectId(rawProjectId);
      const bounds = normalizeBrowserBounds(rawBounds);
      if (!window || !projectId || !bounds) {
        throw new Error("invalid embedded browser mount request");
      }

      const state = getEmbeddedBrowserWindowState(window);
      const mountRequestId = ++state.mountRequestId;
      const previousActive =
        state.activeProjectId && state.activeProjectId !== projectId
          ? state.projectsByProjectId.get(state.activeProjectId)
          : null;
      if (previousActive?.mounted) {
        const activeTab = previousActive.tabs.get(previousActive.activeTabId);
        if (activeTab) {
          window.contentView.removeChildView(activeTab.view);
          parkEmbeddedBrowserView(activeTab.view);
          await pauseEmbeddedBrowserMedia(activeTab);
        }
        previousActive.mounted = false;
        previousActive.suspendedForModal = false;
      }

      // Reuse the warm offscreen project if one already exists (created
      // either by a prior mount in another window or by an agent CDP call
      // that lazily materialized it). Per T3CO-421, project lifecycle is
      // global — projectsByProjectId on a window state is just a binding
      // index that says "this window currently mounts this project."
      let scoped = state.projectsByProjectId.get(projectId);
      if (scoped && isEmbeddedBrowserProjectDestroyed(scoped)) {
        cleanupEmbeddedBrowserProject(scoped, state);
        scoped = undefined;
      }
      const project = scoped ?? ensureEmbeddedBrowserProject(projectId);
      if (!scoped) state.projectsByProjectId.set(projectId, project);
      markEmbeddedBrowserActive(project);

      project.bounds = bounds;
      project.suspendedForModal = false;
      state.activeProjectId = projectId;
      console.log("[desktop/browser] mount", {
        projectId,
        tabs: project.tabs.size,
        activeTabId: project.activeTabId,
        previousProjectId: previousActive?.projectId,
      });
      await mountActiveTabInWindow(project, window, bounds);
      if (state.mountRequestId !== mountRequestId) {
        console.warn("[desktop/browser] embedded browser mount completed after newer request", {
          projectId,
          activeProjectId: state.activeProjectId,
        });
      }
      return project.handle;
    },
  );

  ipcMain.removeHandler(BROWSER_SET_BOUNDS_CHANNEL);
  ipcMain.handle(
    BROWSER_SET_BOUNDS_CHANNEL,
    async (event, rawProjectId: unknown, rawBounds: unknown) => {
      const window = getIpcBrowserWindow(event);
      const bounds = normalizeBrowserBounds(rawBounds);
      const project = window
        ? getProjectScopedEmbeddedBrowserProject(window, rawProjectId, "setBounds")
        : null;
      if (!project || !bounds) return;
      project.bounds = bounds;
      const activeTab = project.tabs.get(project.activeTabId);
      if (activeTab) activeTab.view.setBounds(bounds);
    },
  );

  ipcMain.removeHandler(BROWSER_UNMOUNT_CHANNEL);
  ipcMain.handle(BROWSER_UNMOUNT_CHANNEL, async (event, rawProjectId: unknown) => {
    const window = getIpcBrowserWindow(event);
    const project = window
      ? getProjectScopedEmbeddedBrowserProject(window, rawProjectId, "unmount")
      : null;
    if (!window || !project) return;

    const wasMounted = project.mounted;
    const activeTab = project.tabs.get(project.activeTabId);
    if (project.mounted && activeTab) {
      window.contentView.removeChildView(activeTab.view);
      parkEmbeddedBrowserView(activeTab.view);
    }
    project.mounted = false;
    project.suspendedForModal = false;
    // Reset the idle clock so a freshly-unmounted project gets a full
    // grace period before the reaper considers suspending it.
    markEmbeddedBrowserActive(project);
    if (activeTab) await pauseEmbeddedBrowserMedia(activeTab);
    console.log("[desktop/browser] unmount", {
      projectId: project.projectId,
      wasMounted,
      tabs: project.tabs.size,
    });
  });

  ipcMain.removeHandler(BROWSER_SUSPEND_CHANNEL);
  ipcMain.handle(BROWSER_SUSPEND_CHANNEL, async (event) => {
    const window = getIpcBrowserWindow(event);
    const project = window ? getActiveEmbeddedBrowserProject(window) : null;
    if (!window || !project) return;

    project.suspendedForModal = true;
    if (!project.mounted) return;

    const activeTab = project.tabs.get(project.activeTabId);
    if (activeTab) {
      window.contentView.removeChildView(activeTab.view);
      parkEmbeddedBrowserView(activeTab.view);
    }
    project.mounted = false;
  });

  ipcMain.removeHandler(BROWSER_RESUME_CHANNEL);
  ipcMain.handle(BROWSER_RESUME_CHANNEL, async (event) => {
    const window = getIpcBrowserWindow(event);
    const project = window ? getActiveEmbeddedBrowserProject(window) : null;
    if (!window || !project) return;

    project.suspendedForModal = false;
    if (project.bounds) await mountActiveTabInWindow(project, window, project.bounds);
  });

  ipcMain.removeHandler(BROWSER_NAVIGATE_CHANNEL);
  ipcMain.handle(
    BROWSER_NAVIGATE_CHANNEL,
    async (event, rawProjectId: unknown, rawUrl: unknown) => {
      const window = getIpcBrowserWindow(event);
      const project = window
        ? getProjectScopedEmbeddedBrowserProject(window, rawProjectId, "navigate")
        : null;
      const url = normalizeBrowserUrl(rawUrl);
      const activeTab = project?.tabs.get(project.activeTabId);
      if (!project) return;
      if (!activeTab || !url) {
        throw new Error("invalid embedded browser navigation request");
      }
      try {
        await activeTab.view.webContents.loadURL(url);
      } catch (cause) {
        if (isBrowserNavigationAbortError(cause)) {
          console.warn("[desktop/browser] embedded browser navigation canceled", {
            projectId: activeTab.projectId,
            tabId: activeTab.tabId,
            requestedUrl: url,
            currentUrl: activeTab.view.webContents.getURL(),
          });
          return;
        }
        throw cause;
      }
    },
  );

  ipcMain.removeHandler(BROWSER_GET_URL_CHANNEL);
  ipcMain.handle(BROWSER_GET_URL_CHANNEL, async (event, rawProjectId: unknown) => {
    const window = getIpcBrowserWindow(event);
    const project = window
      ? getProjectScopedEmbeddedBrowserProject(window, rawProjectId, "getUrl")
      : null;
    const tab = project ? (project.tabs.get(project.activeTabId) ?? null) : null;
    return tab?.view.webContents.getURL() ?? "";
  });

  ipcMain.removeHandler(BROWSER_LIST_TABS_CHANNEL);
  ipcMain.handle(BROWSER_LIST_TABS_CHANNEL, async (event, rawProjectId: unknown) => {
    const window = getIpcBrowserWindow(event);
    const project = window
      ? getProjectScopedEmbeddedBrowserProject(window, rawProjectId, "listTabs")
      : null;
    if (!project) return { tabs: [], activeTabId: 0 };
    return { tabs: summarizeEmbeddedBrowserTabs(project), activeTabId: project.activeTabId };
  });

  ipcMain.removeHandler(BROWSER_NEW_TAB_CHANNEL);
  ipcMain.handle(BROWSER_NEW_TAB_CHANNEL, async (event, rawProjectId: unknown, rawUrl: unknown) => {
    const window = getIpcBrowserWindow(event);
    const project = window
      ? getProjectScopedEmbeddedBrowserProject(window, rawProjectId, "newTab")
      : null;
    if (!window || !project) return 0;
    const url = rawUrl == null ? "about:blank" : (normalizeBrowserUrl(rawUrl) ?? "about:blank");
    const tabId = openNewBrowserTab(project, url);
    await switchBrowserTab(project, tabId, window);
    return tabId;
  });

  ipcMain.removeHandler(BROWSER_SWITCH_TAB_CHANNEL);
  ipcMain.handle(
    BROWSER_SWITCH_TAB_CHANNEL,
    async (event, rawProjectId: unknown, rawTabId: unknown) => {
      const window = getIpcBrowserWindow(event);
      const project = window
        ? getProjectScopedEmbeddedBrowserProject(window, rawProjectId, "switchTab")
        : null;
      if (!window || !project) return;
      const tabId = Number(rawTabId);
      if (!project.tabs.has(tabId)) throw new Error(`unknown tab id ${rawTabId}`);
      await switchBrowserTab(project, tabId, window);
    },
  );

  ipcMain.removeHandler(BROWSER_CLOSE_TAB_CHANNEL);
  ipcMain.handle(
    BROWSER_CLOSE_TAB_CHANNEL,
    async (event, rawProjectId: unknown, rawTabId: unknown) => {
      const window = getIpcBrowserWindow(event);
      const project = window
        ? getProjectScopedEmbeddedBrowserProject(window, rawProjectId, "closeTab")
        : null;
      if (!window || !project) return 0;
      const tabId = Number(rawTabId);
      await closeBrowserTab(project, tabId, window);
      return project.activeTabId;
    },
  );

  ipcMain.removeHandler(PICK_FOLDER_CHANNEL);
  ipcMain.handle(PICK_FOLDER_CHANNEL, async () => {
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          properties: ["openDirectory", "createDirectory"],
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.removeHandler(CONFIRM_CHANNEL);
  ipcMain.handle(CONFIRM_CHANNEL, async (_event, message: unknown) => {
    if (typeof message !== "string") {
      return false;
    }

    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    return showDesktopConfirmDialog(message, owner);
  });

  ipcMain.removeHandler(SET_THEME_CHANNEL);
  ipcMain.handle(SET_THEME_CHANNEL, async (_event, rawTheme: unknown) => {
    const theme = getSafeTheme(rawTheme);
    if (!theme) {
      return;
    }

    nativeTheme.themeSource = theme;
  });

  ipcMain.removeHandler(CONTEXT_MENU_CHANNEL);
  ipcMain.handle(
    CONTEXT_MENU_CHANNEL,
    async (_event, items: ContextMenuItem[], position?: { x: number; y: number }) => {
      type NormalizedItem = {
        id: string;
        label: string;
        destructive: boolean;
        disabled: boolean;
        children?: NormalizedItem[];
      };

      function normalizeItems(raw: ContextMenuItem[]): NormalizedItem[] {
        return raw
          .filter((item) => typeof item.id === "string" && typeof item.label === "string")
          .map((item) => {
            const normalized: NormalizedItem = {
              id: item.id,
              label: item.label,
              destructive: item.destructive === true,
              disabled: item.disabled === true,
            };
            if (Array.isArray(item.children) && item.children.length > 0) {
              normalized.children = normalizeItems(item.children as ContextMenuItem[]);
            }
            return normalized;
          });
      }

      const normalizedItems = normalizeItems(items);
      if (normalizedItems.length === 0) {
        return null;
      }

      const popupPosition =
        position &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y) &&
        position.x >= 0 &&
        position.y >= 0
          ? {
              x: Math.floor(position.x),
              y: Math.floor(position.y),
            }
          : null;

      const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
      if (!window) return null;

      return new Promise<string | null>((resolve) => {
        function buildMenuTemplate(menuItems: NormalizedItem[]): MenuItemConstructorOptions[] {
          const template: MenuItemConstructorOptions[] = [];
          let hasInsertedDestructiveSeparator = false;
          for (const item of menuItems) {
            if (item.destructive && !hasInsertedDestructiveSeparator && template.length > 0) {
              template.push({ type: "separator" });
              hasInsertedDestructiveSeparator = true;
            }
            const itemOption: MenuItemConstructorOptions = {
              label: item.label,
              enabled: !item.disabled,
            };
            if (item.children && item.children.length > 0) {
              itemOption.submenu = buildMenuTemplate(item.children);
            } else {
              itemOption.click = () => resolve(item.id);
            }
            if (item.destructive) {
              const destructiveIcon = getDestructiveMenuIcon();
              if (destructiveIcon) {
                itemOption.icon = destructiveIcon;
              }
            }
            template.push(itemOption);
          }
          return template;
        }

        const template = buildMenuTemplate(normalizedItems);
        const menu = Menu.buildFromTemplate(template);
        menu.popup({
          window,
          ...popupPosition,
          callback: () => resolve(null),
        });
      });
    },
  );

  ipcMain.removeHandler(OPEN_EXTERNAL_CHANNEL);
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (_event, rawUrl: unknown) => {
    const externalUrl = getSafeExternalUrl(rawUrl);
    if (!externalUrl) {
      return false;
    }

    try {
      await shell.openExternal(externalUrl);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.removeHandler(UPDATE_GET_STATE_CHANNEL);
  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, async () => updateState);

  ipcMain.removeHandler(UPDATE_DOWNLOAD_CHANNEL);
  ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, async () => {
    const result = await downloadAvailableUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });

  ipcMain.removeHandler(UPDATE_INSTALL_CHANNEL);
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, async () => {
    if (isQuitting) {
      return {
        accepted: false,
        completed: false,
        state: updateState,
      } satisfies DesktopUpdateActionResult;
    }
    const result = await installDownloadedUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });

  ipcMain.removeHandler(UPDATE_CHECK_CHANNEL);
  ipcMain.handle(UPDATE_CHECK_CHANNEL, async () => {
    if (!updaterConfigured) {
      return {
        checked: false,
        state: updateState,
      } satisfies DesktopUpdateCheckResult;
    }
    const checked = await checkForUpdates("web-ui");
    return {
      checked,
      state: updateState,
    } satisfies DesktopUpdateCheckResult;
  });
}

function getIconOption(): { icon: string } | Record<string, never> {
  if (process.platform === "darwin") return {}; // macOS uses .icns from app bundle
  const ext = process.platform === "win32" ? "ico" : "png";
  const iconPath = resolveIconPath(ext);
  return iconPath ? { icon: iconPath } : {};
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 840,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    ...getIconOption(),
    title: APP_DISPLAY_NAME,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: Path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on("context-menu", (event, params) => {
    event.preventDefault();

    const menuTemplate: MenuItemConstructorOptions[] = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menuTemplate.push({
          label: suggestion,
          click: () => window.webContents.replaceMisspelling(suggestion),
        });
      }
      if (params.dictionarySuggestions.length === 0) {
        menuTemplate.push({ label: "No suggestions", enabled: false });
      }
      menuTemplate.push({ type: "separator" });
    }

    menuTemplate.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    );

    Menu.buildFromTemplate(menuTemplate).popup({ window });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = getSafeExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }
    return { action: "deny" };
  });

  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(APP_DISPLAY_NAME);
  });
  window.webContents.on("did-finish-load", () => {
    window.setTitle(APP_DISPLAY_NAME);
    writeDesktopTimeline("renderer.did-finish-load", {
      url: window.webContents.getURL(),
    });
    emitUpdateState();
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    writeDesktopTimeline("renderer.did-fail-load", {
      errorCode,
      errorDescription,
      validatedUrl,
    });
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const shouldPersist =
      level >= 2 || isTimelineLogMessage(message) || message.startsWith("[orchestration-recovery]");
    if (!shouldPersist) {
      return;
    }
    writeDesktopTimeline("renderer.console", {
      level,
      message,
      line,
      sourceId,
    });
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    writeDesktopTimeline("renderer.process-gone", details);
  });
  window.on("unresponsive", () => {
    writeDesktopTimeline("renderer.unresponsive", {
      url: window.webContents.getURL(),
    });
  });
  window.on("responsive", () => {
    writeDesktopTimeline("renderer.responsive", {
      url: window.webContents.getURL(),
    });
  });
  window.once("ready-to-show", () => {
    if (isDevelopment && process.env.T3_DEV_RESTARTING) {
      // After a dev-mode restart (file-watch triggered), show the window
      // without activating the app so it doesn't steal focus from the
      // editor or terminal the developer is working in.
      window.showInactive();
    } else {
      window.show();
    }
    writeDesktopTimeline("renderer.ready-to-show", {
      isDevelopment,
    });
  });

  if (isDevelopment) {
    void window.loadURL(devServerUrl as string);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadURL(`${DESKTOP_SCHEME}://app/index.html`);
  }

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  return window;
}

// Override Electron's userData path before the `ready` event so that
// Chromium session data uses a filesystem-friendly directory name.
// Must be called synchronously at the top level — before `app.whenReady()`.
app.setPath("userData", resolveUserDataPath());

configureAppIdentity();

async function bootstrap(): Promise<void> {
  writeDesktopLogHeader("bootstrap start");
  backendPort = await Effect.service(NetService).pipe(
    Effect.flatMap((net) => net.reserveLoopbackPort()),
    Effect.provide(NetService.layer),
    Effect.runPromise,
  );
  writeDesktopLogHeader(`reserved backend port via NetService port=${backendPort}`);
  backendAuthToken = Crypto.randomBytes(24).toString("hex");
  const baseUrl = `ws://127.0.0.1:${backendPort}`;
  backendWsUrl = `${baseUrl}/?token=${encodeURIComponent(backendAuthToken)}`;
  writeDesktopLogHeader(`bootstrap resolved websocket endpoint baseUrl=${baseUrl}`);
  await startBrowserCdpBrokerServer();
  writeDesktopLogHeader("bootstrap browser cdp broker started");

  registerIpcHandlers();
  writeDesktopLogHeader("bootstrap ipc handlers registered");
  startEmbeddedBrowserIdleReaper();
  writeDesktopLogHeader("bootstrap embedded browser idle reaper started");
  startBackend();
  writeDesktopLogHeader("bootstrap backend start requested");
  mainWindow = createWindow();
  writeDesktopLogHeader("bootstrap main window created");
}

app.on("before-quit", () => {
  isQuitting = true;
  updateInstallInFlight = false;
  writeDesktopLogHeader("before-quit received");
  clearUpdatePollTimer();
  stopBackend();
  stopBrowserCdpBrokerServer();
  restoreStdIoCapture?.();
});

app
  .whenReady()
  .then(() => {
    writeDesktopLogHeader("app ready");
    configureAppIdentity();
    configureApplicationMenu();
    registerDesktopProtocol();
    configureAutoUpdater();
    void bootstrap().catch((error) => {
      handleFatalStartupError("bootstrap", error);
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });
  })
  .catch((error) => {
    handleFatalStartupError("whenReady", error);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !isQuitting) {
    app.quit();
  }
});

if (process.platform !== "win32") {
  process.on("SIGINT", () => {
    if (isQuitting) return;
    isQuitting = true;
    writeDesktopLogHeader("SIGINT received");
    clearUpdatePollTimer();
    stopBackend();
    restoreStdIoCapture?.();
    app.quit();
  });

  process.on("SIGTERM", () => {
    if (isQuitting) return;
    isQuitting = true;
    writeDesktopLogHeader("SIGTERM received");
    clearUpdatePollTimer();
    stopBackend();
    restoreStdIoCapture?.();
    app.quit();
  });
}
