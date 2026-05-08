import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";

import type { ProjectId } from "@t3tools/contracts";

import type {
  CdpBroker,
  InstalledExtensionInfo,
  ExtensionInfo,
  ExtensionWindowInfo,
} from "../../CdpBroker.ts";
import { installBrowserHostCommands, type BrowserHostCommand } from "../../BrowserHost.ts";
import { ElectronWebContentsHost } from "./host.ts";
import type { CdpClient } from "./types.ts";

const DEFAULT_SESSION_ID = "root";
const DEFAULT_TIMEOUT_MS = 15_000;

export const ELECTRON_NATIVE_UNAVAILABLE_MESSAGE =
  "Embedded browser host is not connected yet; retry once the desktop process re-announces active browser views.";

export function unsupportedNativeToolMessage(tool: string): string {
  return `tool ${tool} is not yet supported in native (Electron) mode for this project. This project is using the embedded browser; tools that require Playwright are disabled. See T3CO-335 for parity progress.`;
}

export function unsupportedPermanentNativeToolMessage(tool: string): string {
  return `tool ${tool} is not supported in native (Electron) mode for this project. This tool requires a standalone Playwright browser context and is not meaningful in the embedded browser.`;
}

const DEFERRED_TOOLS = new Set(["cookie-import-browser"]);
const UNSUPPORTED_NATIVE_TOOLS = new Set(["focus", "visibility"]);

interface RuntimeEvaluateResponse<T> {
  readonly result?: {
    readonly value?: T;
    readonly description?: string;
    readonly subtype?: string;
  };
  readonly exceptionDetails?: {
    readonly text?: string;
    readonly exception?: {
      readonly description?: string;
    };
  };
}

interface NavigateResponse {
  readonly frameId?: string;
  readonly loaderId?: string;
  readonly errorText?: string;
}

interface HistoryResponse {
  readonly currentIndex: number;
  readonly entries: Array<{ readonly id: number; readonly url: string }>;
}

interface ElectronWebContentsBrowserHostOptions {
  readonly broker?: CdpBroker;
  readonly viewId?: string;
  readonly sessionId?: string;
}

interface BufferedEvent {
  readonly at: string;
  readonly method: string;
  readonly params: unknown;
  readonly backpressure?: {
    readonly queued: number;
    readonly capacity: number;
    readonly dropped: number;
  };
}

interface CapturedDialog {
  readonly at: string;
  readonly type?: string;
  readonly message?: string;
  readonly url?: string;
  readonly defaultPrompt?: string;
  // What the page actually saw returned. `null` for a dismissed prompt;
  // string for an accepted prompt; "true"/"false" for confirm; absent for
  // alert (no return value).
  readonly response?: string | null;
  readonly handled: "accepted" | "dismissed";
}

interface ScreenshotResponse {
  readonly data: string;
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

interface KeyEventDescriptor {
  readonly key: string;
  readonly code: string;
  readonly windowsVirtualKeyCode?: number;
  readonly nativeVirtualKeyCode?: number;
  readonly text?: string;
  readonly modifiers: number;
}

// CDP modifier bitmask — Alt=1, Ctrl=2, Meta=4, Shift=8.
const KEY_MODIFIERS: Readonly<Record<string, number>> = {
  Alt: 1,
  Ctrl: 2,
  Control: 2,
  Meta: 4,
  Cmd: 4,
  Command: 4,
  Super: 4,
  Shift: 8,
};

// Minimum key table for named keys the `press` tool promises (Enter, Tab,
// Escape, ArrowUp, Backspace, …). Printable single-character keys fall
// through to a computed descriptor below.
const NAMED_KEY_TABLE: Record<string, Omit<KeyEventDescriptor, "modifiers">> = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Return: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Esc: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
  Insert: { key: "Insert", code: "Insert", windowsVirtualKeyCode: 45 },
};

for (let fn = 1; fn <= 12; fn++) {
  NAMED_KEY_TABLE[`F${fn}`] = {
    key: `F${fn}`,
    code: `F${fn}`,
    windowsVirtualKeyCode: 111 + fn,
  };
}

function parseKeyEventDescriptor(raw: string): KeyEventDescriptor {
  const tokens = raw
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) throw new Error("press: missing key");
  const keyToken = tokens.pop() as string;
  let modifiers = 0;
  for (const mod of tokens) {
    const mask = KEY_MODIFIERS[mod];
    if (mask === undefined) throw new Error(`press: unknown modifier '${mod}'`);
    modifiers |= mask;
  }
  const named = NAMED_KEY_TABLE[keyToken];
  if (named) return { ...named, modifiers };
  if (keyToken.length === 1) {
    // Single printable character. For alphanumerics CDP wants the
    // uppercase keyCode and a "KeyA"/"Digit1"-style code. When Shift is
    // held, letters produce an uppercase `key`/`text`; non-letter shifted
    // symbols (Shift+1 = "!") are locale-dependent and intentionally left
    // to the caller (use `type` for text input, `press` for shortcuts).
    const ch = keyToken;
    const upper = ch.toUpperCase();
    const isLetter = upper >= "A" && upper <= "Z";
    const isDigit = ch >= "0" && ch <= "9";
    const shiftHeld = (modifiers & 8) !== 0;
    const printed = isLetter && shiftHeld ? upper : ch;
    const code = isLetter ? `Key${upper}` : isDigit ? `Digit${ch}` : "";
    const windowsVirtualKeyCode = isLetter || isDigit ? upper.charCodeAt(0) : ch.charCodeAt(0);
    return { key: printed, code, windowsVirtualKeyCode, text: printed, modifiers };
  }
  throw new Error(`press: unsupported key '${keyToken}'`);
}

const DIALOG_BINDING_NAME = "__t3_dialog_emit";

// Injected into every page to replace window.alert/confirm/prompt. The native
// dialog path is suppressed via `webPreferences.disableDialogs` in the desktop
// main; the shim emits each call through a `Runtime.addBinding` channel and
// returns a synchronous value driven by `window.__t3_dialog_policy`.
//
// Policy is one-shot: reset to the accept default after every dialog so stale
// decisions cannot leak across unrelated pages or interactions.
const DIALOG_OVERRIDE_SCRIPT = `(function(){
  if (window.__t3_dialog_installed) return;
  window.__t3_dialog_installed = true;
  window.__t3_dialog_policy = { accept: true };
  const consumePolicy = () => {
    const policy = window.__t3_dialog_policy || { accept: true };
    window.__t3_dialog_policy = { accept: true };
    return policy;
  };
  const emit = (entry, policy) => {
    try {
      const fn = window.${DIALOG_BINDING_NAME};
      if (typeof fn !== "function") return;
      fn(JSON.stringify({
        ...entry,
        handled: policy.accept ? "accepted" : "dismissed",
      }));
    } catch (e) {}
  };
  window.alert = function(message) {
    const policy = consumePolicy();
    emit({
      at: new Date().toISOString(),
      type: "alert",
      message: String(message == null ? "" : message),
    }, policy);
  };
  window.confirm = function(message) {
    const policy = consumePolicy();
    const response = !!policy.accept;
    emit({
      at: new Date().toISOString(),
      type: "confirm",
      message: String(message == null ? "" : message),
      response: response ? "true" : "false",
    }, policy);
    return response;
  };
  window.prompt = function(message, defaultValue) {
    const policy = consumePolicy();
    const fallback = defaultValue == null ? "" : String(defaultValue);
    const response = !policy.accept ? null : (policy.text != null ? String(policy.text) : fallback);
    emit({
      at: new Date().toISOString(),
      type: "prompt",
      message: String(message == null ? "" : message),
      defaultPrompt: fallback,
      response,
    }, policy);
    return response;
  };
})();`;

// Injected into every page to:
//   1. Override navigator.userAgent so Google's client-side Chrome detection passes
//   2. Implement chrome.webstore.install() so the install flow has somewhere to go
//   3. On webstore pages: use MutationObserver to re-enable the disabled button and
//      wire a click handler that stores the extension ID for load_extension to consume
//
// Approach based on https://github.com/nicholasgasior/electron-chrome-web-store and
// https://github.com/NeverDecaf/chromium-web-store.
const WEBSTORE_SHIM_SCRIPT = `(function(){
  // 1. UA override — remove Electron brand so navigator.userAgent looks like Chrome.
  //    Object.defineProperty is required; assignment is a no-op on the native getter.
  try {
    var ua = navigator.userAgent
      .replace(/Electron\\/[^\\s]+ /, '')
      .replace(/Chrome\\/(\\d+)/, function(_, v) { return parseInt(v) < 100 ? 'Chrome/130' : 'Chrome/' + v; });
    if (!ua.includes('Chrome/')) {
      ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    }
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  } catch(e) {}

  // 2. chrome.webstore shim — records the extension ID so load_extension can act on it.
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.webstore) {
    window.chrome.webstore = {
      install: function(url, onSuccess, onFailure) {
        try {
          var src = url
            || (document.querySelector('link[rel="chrome-webstore-item"]') || {}).href
            || window.location.href;
          var m = src.match(/\\/detail\\/(?:[^\\/]+\\/)?([a-p]{32})/);
          window.__t3_ext_install_pending = m ? m[1] : src;
        } catch(e) {
          window.__t3_ext_install_pending = url || window.location.href;
        }
        if (typeof onSuccess === 'function') onSuccess();
      },
      onInstallStageChanged: { addListener: function() {} },
      onDownloadProgress: { addListener: function() {} },
    };
  }

  // 3. Button re-enablement — only on webstore domains.
  var isWebStore = /chromewebstore\\.google\\.com|chrome\\.google\\.com\\/webstore/.test(
    location.hostname + location.pathname
  );
  if (!isWebStore) return;

  function enableInstallButtons() {
    document.querySelectorAll('button[disabled]').forEach(function(btn) {
      var text = (btn.textContent || '').toLowerCase();
      if (!text.includes('add to') && !text.includes('install')) return;
      btn.removeAttribute('disabled');
      btn.disabled = false;
      if (btn.__t3_wired) return;
      btn.__t3_wired = true;
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var m = window.location.href.match(/\\/detail\\/(?:[^\\/]+\\/)?([a-p]{32})/);
        if (m) window.__t3_ext_install_pending = m[1];
        if (window.chrome && window.chrome.webstore) window.chrome.webstore.install();
      }, true);
    });
  }

  enableInstallButtons();
  var obs = new MutationObserver(enableInstallButtons);
  function startObserver() {
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  }
  if (document.body) { startObserver(); }
  else { document.addEventListener('DOMContentLoaded', function() { startObserver(); enableInstallButtons(); }); }
})();`;

function dialogPolicyScript(policy: { accept: boolean; text?: string }): string {
  return `window.__t3_dialog_policy = ${JSON.stringify({
    accept: policy.accept,
    ...(policy.text === undefined ? {} : { text: policy.text }),
  })};`;
}

function parseClip(value: string): { x: number; y: number; width: number; height: number } {
  const parts = value.split(",").map(Number);
  const [x, y, width, height] = parts;
  if (
    parts.length !== 4 ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    !parts.every((part) => Number.isFinite(part))
  ) {
    throw new Error("screenshot: clip must be x,y,width,height");
  }
  return { x, y, width, height };
}

function parseViewport(value: string): { width: number; height: number } {
  const parts = value.split("x").map(Number);
  const [width, height] = parts;
  if (
    width === undefined ||
    height === undefined ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    throw new Error("viewport: size must be WIDTHxHEIGHT");
  }
  return {
    width: Math.min(Math.max(Math.round(width), 1), 16_384),
    height: Math.min(Math.max(Math.round(height), 1), 16_384),
  };
}

export class ElectronWebContentsBrowserHost {
  readonly kind = "electron-wc" as const;

  private readonly viewId: string;
  private activeSessionId: string;
  private readonly broker?: CdpBroker;
  private readonly cdpHost?: ElectronWebContentsHost;
  private readonly client?: CdpClient;
  private readonly subscriptionIterators: Array<AsyncIterator<unknown>> = [];
  private readonly consoleEvents: BufferedEvent[] = [];
  private readonly networkEvents: BufferedEvent[] = [];
  private readonly dialogs: CapturedDialog[] = [];
  private lastSnapshotText = "";
  private styleHistory: Array<{
    readonly selector: string;
    readonly property: string;
    readonly oldValue: string;
    readonly newValue: string;
  }> = [];
  private nextDialogAction: { readonly accept: boolean; readonly text?: string } | undefined;

  constructor(
    readonly projectId: ProjectId,
    options: ElectronWebContentsBrowserHostOptions = {},
  ) {
    this.viewId = options.viewId ?? String(projectId);
    this.activeSessionId = options.sessionId ?? DEFAULT_SESSION_ID;
    if (options.broker) {
      this.broker = options.broker;
      this.client = {
        sendCommand: (method, params) =>
          options.broker!.send(this.viewId, this.activeSessionId, method, params, {
            timeoutMs: DEFAULT_TIMEOUT_MS,
          }),
      };
      this.cdpHost = new ElectronWebContentsHost(this.client);
      void this.primeEventDomains();
      this.startEventSubscriptions();
    }
    installBrowserHostCommands(this);
  }

  readonly dispose = async (): Promise<void> => {
    await Promise.allSettled(this.subscriptionIterators.map((iterator) => iterator.return?.()));
  };

  readonly runTool: BrowserHostCommand = async (args, input) => {
    const tool = typeof input.__toolName === "string" ? input.__toolName : "";
    if (DEFERRED_TOOLS.has(tool)) {
      throw new Error(unsupportedNativeToolMessage(tool));
    }
    if (UNSUPPORTED_NATIVE_TOOLS.has(tool)) {
      throw new Error(unsupportedPermanentNativeToolMessage(tool));
    }
    if (!this.client || !this.cdpHost) throw new Error(ELECTRON_NATIVE_UNAVAILABLE_MESSAGE);

    switch (tool) {
      case "goto":
        return this.goto(args);
      case "back":
        return this.history(-1, "Back");
      case "forward":
        return this.history(1, "Forward");
      case "reload": {
        const loaded = this.waitForLoadEvent().catch(() => {});
        await this.send("Page.reload");
        await loaded;
        return `Reloaded ${await this.currentUrl()}`;
      }
      case "url":
        return this.currentUrl();
      case "text":
        return this.evaluateText(TEXT_SCRIPT);
      case "html":
        return this.html(args[0]);
      case "links":
        return this.evaluateText(LINKS_SCRIPT);
      case "forms":
        return this.evaluateJson(FORMS_SCRIPT);
      case "accessibility":
        return this.accessibility();
      case "js":
      case "evaluate":
        return this.evaluateText(args[0] ?? "");
      case "eval":
        return this.evalFile(requiredArg(args, "eval", "file"));
      case "css":
        return this.css(args[0], args[1]);
      case "attrs":
        return this.attrs(args[0]);
      case "is":
        return this.is(args[0], args[1]);
      case "console":
        return this.bufferedEvents("console", this.consoleEvents);
      case "network":
        return this.bufferedEvents("network", this.networkEvents);
      case "dialog":
        return this.dialogHistory();
      case "cookies":
        return this.cookies();
      case "storage":
        return this.storage(args);
      case "perf":
        return this.evaluateJson(PERF_SCRIPT);
      case "inspect":
        return this.inspect(args);
      case "media":
        return this.evaluateJson(MEDIA_SCRIPT(args));
      case "data":
        return this.evaluateJson(DATA_SCRIPT(args));
      case "click":
        await this.cdpHost.click(requiredArg(args, "click", "ref"));
        return `Clicked ${args[0]} -> now at ${await this.currentUrl()}`;
      case "fill":
        await this.cdpHost.fill(requiredArg(args, "fill", "ref"), args.slice(1).join(" "));
        return `Filled ${args[0]}`;
      case "select":
        return this.select(args[0], args.slice(1).join(" "));
      case "hover":
        return this.hover(args[0]);
      case "type":
        await this.cdpHost.type(args.join(" "));
        return `Typed ${args.join(" ").length} characters`;
      case "press":
        return this.press(args[0]);
      case "scroll":
        return this.scroll(args[0]);
      case "wait":
        return this.wait(args[0]);
      case "viewport":
        return this.viewport(args[0]);
      case "cookie":
        return this.setCookie(args[0]);
      case "cookie-import":
        return this.importCookies(args[0]);
      case "header":
        return this.header(args[0]);
      case "useragent":
        return this.useragent(args, input);
      case "upload":
        return this.upload(args);
      case "dialog-accept": {
        const policy: { accept: boolean; text?: string } = {
          accept: true,
          ...(args.length > 0 ? { text: args.join(" ") } : {}),
        };
        this.nextDialogAction = policy;
        await this.syncDialogPolicyToPage(policy);
        return policy.text
          ? `Dialogs will be accepted with text: "${policy.text}"`
          : "Dialogs will be accepted";
      }
      case "dialog-dismiss": {
        const policy = { accept: false };
        this.nextDialogAction = policy;
        await this.syncDialogPolicyToPage(policy);
        return "Dialogs will be dismissed";
      }
      case "style":
        return this.style(args);
      case "cleanup":
        return this.cleanup(args);
      case "prettyscreenshot":
        await this.cleanup(["--all"]);
        return this.screenshot(args);
      case "snapshot":
        return this.snapshot(args);
      case "screenshot":
        return this.screenshot(args);
      case "responsive":
        return this.responsive(args);
      case "pdf":
        return this.pdf(args[0]);
      case "diff":
        return this.diff();
      case "tabs":
        return this.listTabs();
      case "tab":
        return this.switchTab(args[0]);
      case "newtab":
        return this.newTab(args[0]);
      case "closetab":
        return this.closeTab(args[0]);
      case "status": {
        const tabCount = this.broker ? (await this.broker.listTabs(this.viewId)).tabs.length : 1;
        return [
          "Status: healthy",
          "Mode: electron-wc",
          `URL: ${await this.currentUrl()}`,
          `Tabs: ${tabCount}`,
        ].join("\n");
      }
      case "ux-audit":
        return this.evaluateJson(UX_AUDIT_SCRIPT);
      case "load_extension":
        return this.loadExtension();
      case "open_extension":
        return this.openExtension(requiredArg(args, "open_extension", "extensionId"));
      case "list_extensions":
        return this.listExtensionsChromeApi();
      case "ext_windows":
        return this.extWindows();
      case "ext_switch":
        return this.extSwitch(args[0]);
      case "ext_close":
        return this.extClose(requiredArg(args, "ext_close", "extensionId"));
      default:
        throw new Error(`unknown Electron browser tool '${tool}'`);
    }
  };

  readonly useragent: BrowserHostCommand = async (args) => {
    if (!this.client) throw new Error(ELECTRON_NATIVE_UNAVAILABLE_MESSAGE);
    if (args[0] === "--reset") {
      await this.send("Network.setUserAgentOverride", { userAgent: "" });
      return "User agent reset to Electron default";
    }
    const value = args[0];
    if (!value)
      throw new Error("useragent: missing required input.value (string), or pass reset=true");
    await this.send("Network.setUserAgentOverride", { userAgent: value });
    return `User agent set to "${value}"`;
  };

  readonly visibility: BrowserHostCommand = async () => {
    throw new Error(unsupportedPermanentNativeToolMessage("visibility"));
  };

  private async primeEventDomains(): Promise<void> {
    try {
      // `Target.setAutoAttach` with `flatten: true` is what makes
      // `Runtime.*` / `Network.*` events reach our debugger.on('message')
      // listener at all on the embedded host. Without it, events from any
      // sub-target (OOPIFs, cross-origin iframes, service workers, and in
      // newer Electron the main frame itself when site-isolation is on)
      // never make it to the connection. With `flatten: true`, all attached
      // session events flow over the same root debugger pipe — Playwright's
      // CDPSession does this automatically; we have to ask for it. Must be
      // sent before Runtime/Network/Page.enable so events from the very
      // first navigation (including the HTML document request) are caught.
      await this.send("Target.setAutoAttach", {
        autoAttach: true,
        flatten: true,
        waitForDebuggerOnStart: false,
      });
      await Promise.all([
        this.send("Runtime.enable"),
        this.send("Network.enable"),
        this.send("Page.enable"),
      ]);
      // Bind the dialog channel before installing the page-side override so
      // the shim can find `window.__t3_dialog_emit` on its first call. Adding
      // a binding without an `executionContextId` makes it survive reloads
      // and apply to all current and future contexts in the page.
      await this.send("Runtime.addBinding", { name: DIALOG_BINDING_NAME });
      await this.installDialogInterceptor();
      await this.installWebstoreShim();
    } catch (cause) {
      // The host may be constructed before the desktop bridge is fully re-announced.
      console.warn("ElectronWebContentsBrowserHost failed to prime CDP event domains", cause);
    }
  }

  // Pushes the current `nextDialogAction` to the active document so the shim
  // returns the intended value on its next call. One-shot on the page side:
  // the shim resets `window.__t3_dialog_policy` to the accept default after
  // each dialog, so this must be called before every click that might trigger
  // one. Best-effort — if the eval fails (e.g. no frame attached), we fall
  // back to the server-side default of accept.
  private async syncDialogPolicyToPage(policy: { accept: boolean; text?: string }): Promise<void> {
    if (!this.client) return;
    await this.send("Runtime.evaluate", {
      expression: dialogPolicyScript(policy),
      silent: true,
    }).catch(() => {});
  }

  private async loadExtension(): Promise<string> {
    const pendingRaw = await this.evaluateText(
      `(function(){var v=window.__t3_ext_install_pending;window.__t3_ext_install_pending=undefined;return v?String(v):"";})()`,
    );
    if (!pendingRaw.trim()) {
      throw new Error(
        "No pending extension install. Navigate to the Chrome Web Store and click 'Add to Chrome' first.",
      );
    }
    const idMatch = pendingRaw.match(/[a-p]{32}/);
    const extensionId = idMatch?.[0];
    if (!extensionId)
      throw new Error(`Could not extract a Chrome extension ID from: ${pendingRaw}`);
    if (!this.broker) throw new Error("load_extension requires the Electron embedded browser host");
    const info: InstalledExtensionInfo = await this.broker.installExtension(
      this.viewId,
      extensionId,
    );
    return `Installed: ${info.name} v${info.version} (${info.id})`;
  }

  private async openExtension(extensionId: string): Promise<string> {
    if (!this.broker) throw new Error(ELECTRON_NATIVE_UNAVAILABLE_MESSAGE);
    const result = await this.broker.extOpen(this.viewId, extensionId);
    return (
      `Opened extension popup for ${extensionId} (popupKey: ${result.popupKey}). ` +
      `Call ext_switch ${extensionId} to target it for snapshot/click/fill commands.`
    );
  }

  private async listExtensionsChromeApi(): Promise<string> {
    if (!this.broker) throw new Error(ELECTRON_NATIVE_UNAVAILABLE_MESSAGE);
    const exts: ExtensionInfo[] = await this.broker.listExtensions(this.viewId);
    if (exts.length === 0) return "(no extensions installed)";
    return exts
      .map((e) => `${e.id}  ${e.name} v${e.version}${e.hasPopup ? "  [popup open]" : ""}`)
      .join("\n");
  }

  private async extWindows(): Promise<string> {
    if (!this.broker) throw new Error(ELECTRON_NATIVE_UNAVAILABLE_MESSAGE);
    const wins: ExtensionWindowInfo[] = await this.broker.listExtensionWindows(this.viewId);
    if (wins.length === 0) return "(no extension popup windows open)";
    return wins
      .map(
        (w) =>
          `${w.extensionId}  ${w.title || "(untitled)"}  ${w.url}${w.isActive ? "  [active CDP target]" : ""}`,
      )
      .join("\n");
  }

  private async extSwitch(extensionId?: string): Promise<string> {
    if (!this.broker) throw new Error(ELECTRON_NATIVE_UNAVAILABLE_MESSAGE);
    const result = await this.broker.extSwitch(this.viewId, extensionId);
    if (!extensionId || result.popupKey === null) {
      return "Reverted CDP target to main browser tab.";
    }
    return (
      `Switched CDP target to extension popup ${result.popupKey}. ` +
      `Use snapshot/click/fill/js to interact with it. ` +
      `Call ext_switch (no extensionId) to revert to the main tab.`
    );
  }

  private async extClose(extensionId: string): Promise<string> {
    if (!this.broker) throw new Error(ELECTRON_NATIVE_UNAVAILABLE_MESSAGE);
    await this.broker.extClose(this.viewId, extensionId);
    return `Closed popup for extension ${extensionId}.`;
  }

  private async installWebstoreShim(): Promise<void> {
    await this.send("Page.addScriptToEvaluateOnNewDocument", {
      source: WEBSTORE_SHIM_SCRIPT,
    });
    await this.send("Runtime.evaluate", {
      expression: WEBSTORE_SHIM_SCRIPT,
      silent: true,
    }).catch(() => {});
  }

  // Injects the page-side alert/confirm/prompt override on every new document.
  // Idempotent in the shim (`window.__t3_dialog_installed` guard) so re-calling
  // after a reconnect is safe.
  private async installDialogInterceptor(): Promise<void> {
    await this.send("Page.addScriptToEvaluateOnNewDocument", {
      source: DIALOG_OVERRIDE_SCRIPT,
    });
    // Cover the already-loaded document. Failures here are non-fatal — new
    // documents will still get the override via addScriptToEvaluateOnNewDocument.
    await this.send("Runtime.evaluate", {
      expression: DIALOG_OVERRIDE_SCRIPT,
      silent: true,
    }).catch(() => {});
  }

  private startEventSubscriptions(): void {
    this.subscribeTo("Runtime.consoleAPICalled", (event) => {
      this.pushBuffered(this.consoleEvents, event);
    });
    for (const method of [
      "Network.requestWillBeSent",
      "Network.responseReceived",
      "Network.loadingFinished",
      "Network.loadingFailed",
    ]) {
      this.subscribeTo(method, (event) => {
        this.pushBuffered(this.networkEvents, event);
      });
    }
    this.subscribeTo("Runtime.bindingCalled", (event) => {
      const params = event.params as { name?: string; payload?: string };
      if (params.name !== DIALOG_BINDING_NAME || typeof params.payload !== "string") return;
      try {
        const dialog = JSON.parse(params.payload) as {
          at?: string;
          type?: string;
          message?: string;
          defaultPrompt?: string;
          response?: string | null;
          handled?: "accepted" | "dismissed";
        };
        this.recordCapturedDialog({
          at: dialog.at ?? new Date().toISOString(),
          ...(dialog.type === undefined ? {} : { type: dialog.type }),
          ...(dialog.message === undefined ? {} : { message: dialog.message }),
          ...(dialog.defaultPrompt === undefined ? {} : { defaultPrompt: dialog.defaultPrompt }),
          ...(dialog.response === undefined ? {} : { response: dialog.response }),
          ...(dialog.handled === undefined ? {} : { handled: dialog.handled }),
        });
      } catch {
        // Malformed payload — ignore. The shim always JSON.stringify()s the entry.
      }
    });
    this.subscribeTo("Page.javascriptDialogOpening", (event) => {
      // Safety net for the unlikely case that a dialog slips past the page-side
      // override (for example, during the brief window before the script is
      // installed on a freshly-attached target). disableDialogs in webPrefs
      // keeps it from becoming a window-modal, but we still want to answer.
      void this.handleDialogOpening(event);
    });
  }

  private recordCapturedDialog(dialog: {
    at: string;
    type?: string;
    message?: string;
    defaultPrompt?: string;
    response?: string | null;
    handled?: "accepted" | "dismissed";
  }): void {
    // Prefer the `handled` value stamped by the shim at the moment the dialog
    // fired — it reflects the actual policy that was applied. Fall back to the
    // current server-side policy for Page.javascriptDialogOpening events that
    // reach us without a shim stamp (the rare native-path safety-net case).
    const handled: "accepted" | "dismissed" =
      dialog.handled ?? ((this.nextDialogAction?.accept ?? true) ? "accepted" : "dismissed");
    this.dialogs.push({
      at: dialog.at,
      ...(dialog.type === undefined ? {} : { type: dialog.type }),
      ...(dialog.message === undefined ? {} : { message: dialog.message }),
      ...(dialog.defaultPrompt === undefined ? {} : { defaultPrompt: dialog.defaultPrompt }),
      ...(dialog.response === undefined ? {} : { response: dialog.response }),
      handled,
    });
    if (dialog.handled === undefined) this.nextDialogAction = undefined;
  }

  private subscribeTo(
    eventName: string,
    onEvent: (event: BufferedEvent) => void,
    sessionId = this.activeSessionId,
  ): void {
    if (!this.broker) return;
    const events = this.broker.subscribe(this.viewId, sessionId, eventName);
    const iterator = events[Symbol.asyncIterator]();
    this.subscriptionIterators.push(iterator);
    void (async () => {
      try {
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          onEvent({
            at: new Date().toISOString(),
            method: next.value.method,
            params: next.value.params,
            ...(next.value.backpressure === undefined
              ? {}
              : { backpressure: next.value.backpressure }),
          });
        }
      } catch (cause) {
        console.warn(`ElectronWebContentsBrowserHost subscription failed for ${eventName}`, cause);
      }
    })();
  }

  private pushBuffered(buffer: BufferedEvent[], event: BufferedEvent, limit = 200): void {
    buffer.push(event);
    if (buffer.length > limit) buffer.splice(0, buffer.length - limit);
  }

  private bufferedEvents(name: string, buffer: readonly BufferedEvent[]): string {
    if (buffer.length === 0) return `(no ${name} events captured)`;
    return JSON.stringify(buffer.slice(-50), null, 2);
  }

  private async handleDialogOpening(event: BufferedEvent): Promise<void> {
    const params = event.params as {
      readonly type?: string;
      readonly message?: string;
      readonly url?: string;
      readonly defaultPrompt?: string;
    };
    const policy = this.nextDialogAction ?? { accept: true };
    await this.send("Page.handleJavaScriptDialog", {
      accept: policy.accept,
      ...(policy.text === undefined ? {} : { promptText: policy.text }),
    }).catch((cause) => {
      console.warn("ElectronWebContentsBrowserHost failed to handle JavaScript dialog", cause);
    });
    const response: string | null | undefined = (() => {
      if (params.type === "alert") return undefined;
      if (params.type === "confirm") return policy.accept ? "true" : "false";
      if (params.type === "prompt") {
        if (!policy.accept) return null;
        return policy.text ?? params.defaultPrompt ?? "";
      }
      return undefined;
    })();
    this.dialogs.push({
      at: event.at,
      ...(params.type === undefined ? {} : { type: params.type }),
      ...(params.message === undefined ? {} : { message: params.message }),
      ...(params.url === undefined ? {} : { url: params.url }),
      ...(params.defaultPrompt === undefined ? {} : { defaultPrompt: params.defaultPrompt }),
      ...(response === undefined ? {} : { response }),
      handled: policy.accept ? "accepted" : "dismissed",
    });
    this.nextDialogAction = undefined;
  }

  private dialogHistory(): string {
    const policy = this.nextDialogAction
      ? {
          nextDialogPolicy: this.nextDialogAction.accept ? "accept" : "dismiss",
          ...(this.nextDialogAction.text === undefined ? {} : { text: this.nextDialogAction.text }),
        }
      : {};
    return JSON.stringify(
      {
        ...policy,
        dialogs: this.dialogs.slice(-25),
      },
      null,
      2,
    );
  }

  private waitForEvent(eventName: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    if (!this.broker) return Promise.reject(new Error(ELECTRON_NATIVE_UNAVAILABLE_MESSAGE));
    const events = this.broker.subscribe(this.viewId, this.activeSessionId, eventName);
    const iterator = events[Symbol.asyncIterator]();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        void iterator.return?.();
        reject(new Error(`Timed out waiting for ${eventName}`));
      }, timeoutMs);
      void iterator.next().then(
        () => {
          clearTimeout(timer);
          void iterator.return?.();
          resolve();
        },
        (cause) => {
          clearTimeout(timer);
          void iterator.return?.();
          reject(cause);
        },
      );
    });
  }

  private send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.client) throw new Error(ELECTRON_NATIVE_UNAVAILABLE_MESSAGE);
    return this.client.sendCommand<T>(method, params);
  }

  private async goto(args: readonly string[]): Promise<string> {
    const url = requiredArg(args, "goto", "url");
    const loaded = this.waitForLoadEvent().catch(() => {});
    const response = await this.send<NavigateResponse>("Page.navigate", { url });
    if (response.errorText) throw new Error(`Navigation failed: ${response.errorText}`);
    await loaded;
    return `Navigated to ${url} (native)`;
  }

  private async history(delta: -1 | 1, label: "Back" | "Forward"): Promise<string> {
    const history = await this.send<HistoryResponse>("Page.getNavigationHistory");
    const target = history.entries[history.currentIndex + delta];
    if (!target) return `${label} -> ${await this.currentUrl()}`;
    const loaded = this.waitForLoadEvent().catch(() => {});
    await this.send("Page.navigateToHistoryEntry", { entryId: target.id });
    await loaded;
    return `${label} -> ${await this.currentUrl()}`;
  }

  private async currentUrl(): Promise<string> {
    return this.evaluateText("location.href");
  }

  private async evaluate<T>(expression: string): Promise<T> {
    if (!expression) throw new Error("js: missing JavaScript expression");
    const result = await this.send<RuntimeEvaluateResponse<T>>("Runtime.evaluate", {
      expression: wrapForEval(expression),
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "JavaScript evaluation failed",
      );
    }
    return result.result?.value as T;
  }

  private async evaluateText(expression: string): Promise<string> {
    return stringifyResult(await this.evaluate(expression));
  }

  private async evaluateJson(expression: string): Promise<string> {
    return JSON.stringify(await this.evaluate(expression), null, 2);
  }

  private async evalFile(filePath: string): Promise<string> {
    // Reuse the vendored gstack path validator so the embedded host enforces
    // the same SAFE_DIRECTORIES allow-list (project cwd + temp dir) the
    // Playwright host does. Dynamic import keeps `core/**` out of T3's
    // typecheck graph (the vendored code does not satisfy our strict
    // compiler settings); see apps/server/src/browser/NOTICE.
    const { validateReadPath } = (await import("../../core/path-security.ts" as string)) as {
      readonly validateReadPath: (path: string) => void;
    };
    validateReadPath(filePath);
    let code: string;
    try {
      code = await fs.readFile(filePath, "utf-8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`File not found: ${filePath}`, { cause });
      }
      throw cause;
    }
    return this.evaluateText(code);
  }

  /**
   * Run `body` with `el` bound to the element. Accepts either a CSS selector
   * or a snapshot `@ref`. Returns the raw value (use `selectorText` /
   * `selectorJson` for string/JSON shaping).
   */
  private async evaluateOnSelector<T>(selector: string, body: string): Promise<T> {
    if (selector.startsWith("@")) return this.cdpHost!.evaluateOnRef<T>(selector, body);
    return this.evaluate<T>(elementScript(selector, body));
  }

  private async selectorText(selector: string, body: string): Promise<string> {
    return stringifyResult(await this.evaluateOnSelector(selector, body));
  }

  private async selectorJson(selector: string, body: string): Promise<string> {
    return JSON.stringify(await this.evaluateOnSelector(selector, body), null, 2);
  }

  private async html(selector?: string): Promise<string> {
    if (!selector) return this.evaluateText(HTML_SCRIPT);
    return this.selectorText(selector, "el.innerHTML");
  }

  private async css(selector: string | undefined, property: string | undefined): Promise<string> {
    if (!selector || !property) throw new Error("css: missing selector or property");
    return this.selectorText(
      selector,
      `getComputedStyle(el).getPropertyValue(${JSON.stringify(property)})`,
    );
  }

  private async attrs(selector: string | undefined): Promise<string> {
    if (!selector) throw new Error("attrs: missing selector");
    return this.selectorJson(
      selector,
      `Object.fromEntries(Array.from(el.attributes).map((attr) => [attr.name, attr.value]))`,
    );
  }

  private async is(property: string | undefined, selector: string | undefined): Promise<string> {
    if (!property || !selector) throw new Error("is: missing property or selector");
    return this.selectorText(selector, STATE_SCRIPT(property));
  }

  private async accessibility(): Promise<string> {
    const snapshot = await this.cdpHost!.snapshot({ interactive: false, compact: false });
    return snapshot.text;
  }

  private async cookies(): Promise<string> {
    const response = await this.send<{ cookies: unknown[] }>("Network.getAllCookies");
    return JSON.stringify(response.cookies, null, 2);
  }

  private async storage(args: readonly string[]): Promise<string> {
    if (args[0] === "set") {
      const key = args[1];
      if (!key) throw new Error("storage: missing key");
      await this.evaluate(
        `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(args[2] ?? "")})`,
      );
      return `Set localStorage["${key}"]`;
    }
    return this.evaluateJson(STORAGE_SCRIPT);
  }

  private async inspect(args: readonly string[]): Promise<string> {
    if (args.includes("--history")) {
      if (this.styleHistory.length === 0) return "(no style modifications)";
      return this.styleHistory
        .map(
          (entry, index) =>
            `[${index}] ${entry.selector} { ${entry.property}: ${entry.oldValue} -> ${entry.newValue} }`,
        )
        .join("\n");
    }
    const selector = args.find((arg) => !arg.startsWith("--")) ?? "body";
    return this.selectorJson(selector, INSPECT_SCRIPT);
  }

  private async select(selector: string | undefined, value: string): Promise<string> {
    if (!selector || !value) throw new Error("select: missing selector or value");
    await this.evaluateOnSelector(selector, SELECT_SCRIPT(value));
    return `Selected "${value}" in ${selector}`;
  }

  private async hover(selector: string | undefined): Promise<string> {
    if (!selector) throw new Error("hover: missing selector");
    if (selector.startsWith("@")) {
      await this.cdpHost!.hover(selector);
      return `Hovered ${selector}`;
    }
    const point = await this.elementCenter(selector);
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    return `Hovered ${selector}`;
  }

  private async press(key: string | undefined): Promise<string> {
    if (!key) throw new Error("press: missing key");
    const event = parseKeyEventDescriptor(key);
    await this.send("Input.dispatchKeyEvent", { ...event, type: "keyDown" });
    await this.send("Input.dispatchKeyEvent", { ...event, type: "keyUp" });
    return `Pressed ${key}`;
  }

  private async scroll(selector?: string): Promise<string> {
    if (selector) {
      await this.evaluateOnSelector(
        selector,
        "el.scrollIntoView({ block: 'center', inline: 'center' })",
      );
      return `Scrolled ${selector} into view`;
    }
    await this.cdpHost!.scroll(700);
    return "Scrolled to bottom";
  }

  private async wait(selector?: string): Promise<string> {
    if (selector === "--load") {
      await this.waitForLoadEvent();
      return "Page loaded";
    }
    if (selector === "--networkidle") {
      await this.waitForNetworkIdle();
      return "Network idle";
    }
    if (!selector) throw new Error("wait: missing selector");
    const started = Date.now();
    const probe = selector.startsWith("@")
      ? // `@refs` are resolved against the snapshot's ref store, not the
        // DOM. The element is "present" if the ref still resolves.
        async (): Promise<boolean> => {
          try {
            await this.cdpHost!.evaluateOnRef<boolean>(selector, "true");
            return true;
          } catch {
            return false;
          }
        }
      : async (): Promise<boolean> =>
          this.evaluate<boolean>(
            `document.querySelector(${JSON.stringify(selector)}) !== null`,
          ).catch(() => false);
    while (Date.now() - started < DEFAULT_TIMEOUT_MS) {
      if (await probe()) return `Element ${selector} appeared`;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${selector}`);
  }

  private async viewport(size: string | undefined): Promise<string> {
    if (!size) throw new Error("viewport: missing size");
    const viewport = parseViewport(size);
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 0,
      mobile: false,
    });
    return `Viewport set to ${viewport.width}x${viewport.height}`;
  }

  private async setCookie(assignment: string | undefined): Promise<string> {
    if (!assignment || !assignment.includes("=")) throw new Error("cookie: expected name=value");
    const [name, ...valueParts] = assignment.split("=");
    const url = await this.currentUrl();
    await this.send("Network.setCookie", { name, value: valueParts.join("="), url });
    return `Cookie set: ${name}=****`;
  }

  private async importCookies(filePath: string | undefined): Promise<string> {
    if (!filePath) throw new Error("cookie-import: missing file path");
    const raw = await fs.readFile(filePath, "utf8");
    const cookies = JSON.parse(raw) as Array<Record<string, unknown>>;
    if (!Array.isArray(cookies)) throw new Error("Cookie file must contain a JSON array");
    for (const cookie of cookies) await this.send("Network.setCookie", cookie);
    return `Loaded ${cookies.length} cookies from ${filePath}`;
  }

  private async header(value: string | undefined): Promise<string> {
    if (!value || !value.includes(":")) throw new Error("header: expected name:value");
    const index = value.indexOf(":");
    const name = value.slice(0, index).trim();
    const headerValue = value.slice(index + 1).trim();
    await this.send("Network.setExtraHTTPHeaders", { headers: { [name]: headerValue } });
    const redacted = [
      "authorization",
      "cookie",
      "set-cookie",
      "x-api-key",
      "x-auth-token",
    ].includes(name.toLowerCase())
      ? "****"
      : headerValue;
    return `Header set: ${name}: ${redacted}`;
  }

  private async upload(args: readonly string[]): Promise<string> {
    const selector = args[0];
    const files = args.slice(1);
    if (!selector || files.length === 0) throw new Error("upload: missing selector or files");
    const backendNodeId = selector.startsWith("@")
      ? (await this.cdpHost!.resolveRef(selector)).backendNodeId
      : await this.backendNodeIdForSelector(selector);
    if (backendNodeId === undefined) throw new Error(`${selector} cannot be used for upload`);
    await this.send("DOM.setFileInputFiles", {
      backendNodeId,
      files,
    });
    return `Uploaded: ${files.map((file) => nodePath.basename(file)).join(", ")}`;
  }

  private async style(args: readonly string[]): Promise<string> {
    if (args[0] === "--undo") {
      const index = args[1] === undefined ? this.styleHistory.length - 1 : Number(args[1]);
      const entry = this.styleHistory[index];
      if (!entry) return "(no style modifications)";
      await this.evaluateOnSelector(
        entry.selector,
        `el.style.setProperty(${JSON.stringify(entry.property)}, ${JSON.stringify(entry.oldValue)})`,
      );
      this.styleHistory.splice(index, 1);
      return `Reverted modification #${index}`;
    }
    const [selector, property, ...valueParts] = args;
    const value = valueParts.join(" ");
    if (!selector || !property || !value)
      throw new Error("style: missing selector, property, or value");
    const oldValue = await this.selectorText(
      selector,
      `getComputedStyle(el).getPropertyValue(${JSON.stringify(property)})`,
    );
    await this.evaluateOnSelector(
      selector,
      `el.style.setProperty(${JSON.stringify(property)}, ${JSON.stringify(value)}, "important")`,
    );
    this.styleHistory.push({ selector, property, oldValue, newValue: value });
    return `Style modified: ${selector} { ${property}: ${oldValue || "(none)"} -> ${value} }`;
  }

  private async cleanup(args: readonly string[]): Promise<string> {
    const all = args.length === 0 || args.includes("--all");
    const removed = await this.evaluate<number>(
      CLEANUP_SCRIPT(
        all || args.includes("--ads"),
        all || args.includes("--cookies"),
        all || args.includes("--sticky"),
        all || args.includes("--overlays"),
      ),
    );
    return `Cleanup applied (${removed} elements hidden)`;
  }

  private async snapshot(args: readonly string[]): Promise<string> {
    const depth = numberFlag(args, "--depth");
    const result = await this.cdpHost!.snapshot({
      interactive: args.includes("--interactive"),
      compact: args.includes("--compact"),
      cursorInteractive: args.includes("--cursor-interactive") || args.includes("--interactive"),
      ...(depth === undefined ? {} : { depth }),
    });
    this.lastSnapshotText = result.text;
    return result.text;
  }

  private async screenshot(args: readonly string[]): Promise<string> {
    let base64 = false;
    let outputPath = nodePath.join(os.tmpdir(), "browse-screenshot.png");
    let clip: ReturnType<typeof parseClip> | undefined;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === "--base64") base64 = true;
      else if (arg === "--clip") clip = parseClip(args[++index] ?? "");
      else if (arg && !arg.startsWith("--")) outputPath = arg;
    }
    const result =
      clip === undefined
        ? await this.cdpHost!.captureScreenshot()
        : await this.captureClippedScreenshot(clip);
    if (base64) {
      return JSON.stringify(
        {
          dataUrl: `data:image/png;base64,${result.buffer.toString("base64")}`,
          devicePixelRatio: result.devicePixelRatio,
        },
        null,
        2,
      );
    }
    await fs.writeFile(outputPath, result.buffer);
    return JSON.stringify(
      {
        path: outputPath,
        devicePixelRatio: result.devicePixelRatio,
      },
      null,
      2,
    );
  }

  // Captures three full-page screenshots at fixed mobile/tablet/desktop
  // viewport sizes — the Electron-host port of the gstack `responsive`
  // meta-tool (apps/server/src/browser/core/meta-commands.ts:211). Drives
  // CDP `Emulation.setDeviceMetricsOverride` per viewport, then clears the
  // override at the end. The renderer's per-tab viewport-emulator state
  // (`emulationByTab` in EmbeddedBrowser.tsx) is unaffected and re-issues
  // its `setViewport` IPC on the next user interaction (tab activate, drag,
  // preset change), so the embedded UI re-syncs without explicit help.
  private async responsive(args: readonly string[]): Promise<string> {
    // Dynamic-import gstack helpers; same pattern as `evalFile` (T3CO-343).
    // Keeps `core/**` out of T3's typecheck graph (vendored code does not
    // satisfy strict compiler settings; see apps/server/src/browser/NOTICE).
    const { validateOutputPath } = (await import("../../core/path-security.ts" as string)) as {
      readonly validateOutputPath: (path: string) => void;
    };
    const { TEMP_DIR } = (await import("../../core/platform.ts" as string)) as {
      readonly TEMP_DIR: string;
    };

    const prefix = args[0] ?? nodePath.join(TEMP_DIR, "browse-responsive");
    const viewports = [
      { name: "mobile", width: 375, height: 812 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "desktop", width: 1280, height: 720 },
    ] as const;

    const lines: string[] = [];
    try {
      for (const vp of viewports) {
        const screenshotPath = `${prefix}-${vp.name}.png`;
        validateOutputPath(screenshotPath);
        // Match the gstack `responsive` (and our native `viewport`) call
        // shape — pure metrics override. Note: this *does* visibly stretch
        // the embedded WebContentsView for the duration of the call, even
        // with `dontSetVisibleSize: true` and a fully-pinned screen-field
        // shape. The deterministic fix is the per-tab maintenance overlay
        // tracked in T3CO-442 (park the view + render a "Resizing browser…"
        // spinner while this runs). Until that lands, expect a brief
        // overflow on calls.
        await this.send("Emulation.setDeviceMetricsOverride", {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 0,
          mobile: false,
        });
        const buffer = await this.captureFullPageScreenshot();
        await fs.writeFile(screenshotPath, buffer);
        lines.push(`${vp.name} (${vp.width}x${vp.height}): ${screenshotPath}`);
      }
    } finally {
      await this.send("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
    }
    return lines.join("\n");
  }

  // Full-page (entire scrollable document) variant of the per-viewport
  // capture in `cdpHost.captureScreenshot()`. Uses Page.getLayoutMetrics to
  // size the clip rectangle and `captureBeyondViewport: true` so Chromium
  // renders content past the visible viewport into the output PNG.
  private async captureFullPageScreenshot(): Promise<Buffer> {
    const layout = await this.send<{
      readonly cssContentSize?: { width: number; height: number };
      readonly contentSize?: { width: number; height: number };
    }>("Page.getLayoutMetrics");
    const size = layout.cssContentSize ?? layout.contentSize;
    if (!size) throw new Error("responsive: Page.getLayoutMetrics returned no content size");
    const result = await this.send<ScreenshotResponse>("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
    });
    return Buffer.from(result.data, "base64");
  }

  private async pdf(outputPath = nodePath.join(os.tmpdir(), "browse-page.pdf")): Promise<string> {
    // `Page.printToPDF` is not exposed on the embedded Electron debugger; route
    // through the broker's native path which calls `webContents.printToPDF()`
    // in the main process. Falls back to CDP for transports that do not
    // implement the native path (Playwright host, test harness).
    const base64 = this.broker
      ? await this.broker.printPdf(this.viewId).catch(async (cause: unknown) => {
          if (
            cause instanceof Error &&
            "code" in cause &&
            (cause as { code?: string }).code === "CDP_PRINT_PDF_UNAVAILABLE"
          ) {
            const response = await this.send<{ data: string }>("Page.printToPDF", {
              printBackground: true,
            });
            return response.data;
          }
          throw cause;
        })
      : (await this.send<{ data: string }>("Page.printToPDF", { printBackground: true })).data;
    await fs.writeFile(outputPath, base64, "base64");
    return `PDF saved: ${outputPath}`;
  }

  private async diff(): Promise<string> {
    const before = this.lastSnapshotText;
    const after = await this.evaluateText(TEXT_SCRIPT);
    this.lastSnapshotText = after;
    if (!before) return after;
    return [
      `--- previous`,
      `+++ current`,
      ...after
        .split("\n")
        .filter((line) => !before.includes(line))
        .map((line) => `+ ${line}`),
    ].join("\n");
  }

  private async elementCenter(selector: string): Promise<{ x: number; y: number }> {
    return this.evaluate(
      elementScript(
        selector,
        `(() => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`,
      ),
    );
  }

  private async backendNodeIdForSelector(selector: string): Promise<number> {
    const document = await this.send<{ root: { nodeId: number } }>("DOM.getDocument", {
      depth: 0,
      pierce: true,
    });
    const found = await this.send<{ nodeId: number }>("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector,
    });
    if (!found.nodeId) throw new Error(`Element not found: ${selector}`);
    const described = await this.send<{ node: { backendNodeId?: number } }>("DOM.describeNode", {
      nodeId: found.nodeId,
    });
    if (described.node.backendNodeId === undefined) {
      throw new Error(`Element has no backend node id: ${selector}`);
    }
    return described.node.backendNodeId;
  }

  private async waitForLoadEvent(): Promise<void> {
    await this.waitForEvent("Page.loadEventFired");
  }

  private async waitForNetworkIdle(): Promise<void> {
    let seenNetworkActivity = false;
    const started = Date.now();
    while (Date.now() - started < DEFAULT_TIMEOUT_MS) {
      const before = this.networkEvents.length;
      await new Promise((resolve) => setTimeout(resolve, 250));
      const after = this.networkEvents.length;
      if (after > before) {
        seenNetworkActivity = true;
        continue;
      }
      if (seenNetworkActivity || Date.now() - started >= 500) return;
    }
    throw new Error("Timed out waiting for network idle");
  }

  private async captureClippedScreenshot(
    clip: ReturnType<typeof parseClip>,
  ): Promise<{ buffer: Buffer; devicePixelRatio: number }> {
    const [response, devicePixelRatio] = await Promise.all([
      this.send<ScreenshotResponse>("Page.captureScreenshot", { format: "png", clip }),
      this.evaluate<number>("window.devicePixelRatio").catch(() => 1),
    ]);
    return {
      buffer: Buffer.from(response.data, "base64"),
      devicePixelRatio:
        Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1,
    };
  }

  // Tab operations are routed through the broker to the Electron main process,
  // which owns the `Map<tabId, WebContentsView>` per project and handles
  // mount/unmount/throttle on switch. The server host does not maintain its
  // own registry anymore — each call re-reads from the broker so the host
  // cannot drift from desktop state when the user clicks a tab in the UI.
  private async listTabs(): Promise<string> {
    if (!this.broker) throw new Error(ELECTRON_NATIVE_UNAVAILABLE_MESSAGE);
    const { tabs, activeTabId } = await this.broker.listTabs(this.viewId);
    if (tabs.length === 0) return "(no tabs)";
    return tabs
      .toSorted((a, b) => a.id - b.id)
      .map((tab) => {
        const marker = tab.id === activeTabId ? "->" : "  ";
        return `${marker} [${tab.id}] ${tab.title || "(untitled)"} - ${tab.url}`;
      })
      .join("\n");
  }

  private async switchTab(value: string | undefined): Promise<string> {
    if (!this.broker) throw new Error(ELECTRON_NATIVE_UNAVAILABLE_MESSAGE);
    if (value === undefined) throw new Error("tab: missing id");
    const tabId = Number(value);
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error(`tab: invalid id ${value}`);
    const newActive = await this.broker.switchTab(this.viewId, tabId);
    return `Switched to tab ${newActive}`;
  }

  private async newTab(url?: string): Promise<string> {
    if (!this.broker) throw new Error(ELECTRON_NATIVE_UNAVAILABLE_MESSAGE);
    const tabId = await this.broker.newTab(this.viewId, url);
    return `Opened tab ${tabId} -> ${url ?? "about:blank"}`;
  }

  private async closeTab(value: string | undefined): Promise<string> {
    if (!this.broker) throw new Error(ELECTRON_NATIVE_UNAVAILABLE_MESSAGE);
    if (value === undefined) {
      // Fallback: close the currently active tab.
      const { activeTabId } = await this.broker.listTabs(this.viewId);
      await this.broker.closeTab(this.viewId, activeTabId);
      return `Closed tab ${activeTabId}`;
    }
    const tabId = Number(value);
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error(`closetab: invalid id ${value}`);
    const newActive = await this.broker.closeTab(this.viewId, tabId);
    return tabId === 0 && newActive === 0 ? "Reset root tab to about:blank" : `Closed tab ${tabId}`;
  }
}

function requiredArg(args: readonly string[], tool: string, name: string): string {
  const value = args[0];
  if (!value) throw new Error(`${tool}: missing ${name}`);
  return value;
}

function numberFlag(args: readonly string[], flag: string): number | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}

function wrapForEval(expression: string): string {
  return `(async () => {
    const source = ${JSON.stringify(expression)};
    const value = await (async () => (0, eval)(source))().catch(async () => {
      return await (async () => { ${expression} })();
    });
    return value;
  })()`;
}

function selectorExpression(selector: string): string {
  return selector.startsWith("@") ? `null` : `document.querySelector(${JSON.stringify(selector)})`;
}

function elementScript(selector: string, body: string): string {
  if (selector.startsWith("@")) {
    throw new Error(`Selector ${selector} requires a fresh snapshot-backed ref for this command`);
  }
  return `(() => {
    const el = ${selectorExpression(selector)};
    if (!el) throw new Error("Element not found: ${selector.replaceAll('"', '\\"')}");
    return ${body};
  })()`;
}

const TEXT_SCRIPT = `document.body?.innerText ?? ""`;
const HTML_SCRIPT = `(() => {
  const dt = document.doctype;
  const doctype = dt ? "<!DOCTYPE " + dt.name + ">\\n" : "";
  return doctype + document.documentElement.outerHTML;
})()`;
const LINKS_SCRIPT = `Array.from(document.querySelectorAll("a[href]"))
  .map((a) => ({ text: (a.textContent || "").trim().slice(0, 120), href: a.href }))
  .filter((link) => link.text && link.href)
  .map((link) => link.text + " -> " + link.href)
  .join("\\n")`;
const FORMS_SCRIPT = `Array.from(document.querySelectorAll("form")).map((form, index) => ({
  index,
  action: form.action || undefined,
  method: form.method || "get",
  id: form.id || undefined,
  fields: Array.from(form.querySelectorAll("input, select, textarea")).map((el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.type || undefined,
    name: el.name || undefined,
    id: el.id || undefined,
    placeholder: el.placeholder || undefined,
    required: !!el.required || undefined,
    value: el.type === "password" ? "[redacted]" : el.value || undefined,
    options: el.tagName === "SELECT" ? Array.from(el.options).map((o) => ({ value: o.value, text: o.text })) : undefined,
  })),
}))`;
const STORAGE_SCRIPT = `({ localStorage: { ...localStorage }, sessionStorage: { ...sessionStorage } })`;
const PERF_SCRIPT = `(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  if (!nav) return {};
  return {
    dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
    tcp: Math.round(nav.connectEnd - nav.connectStart),
    ttfb: Math.round(nav.responseStart - nav.requestStart),
    domReady: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
    load: Math.round(nav.loadEventEnd - nav.startTime),
    total: Math.round(nav.loadEventEnd - nav.startTime),
  };
})()`;
const INSPECT_SCRIPT = `(() => {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    classes: Array.from(el.classList),
    box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    styles: {
      display: style.display,
      position: style.position,
      color: style.color,
      backgroundColor: style.backgroundColor,
      fontSize: style.fontSize,
    },
  };
})()`;
const UX_AUDIT_SCRIPT = `(() => ({
  title: document.title,
  imagesMissingAlt: Array.from(document.images).filter((img) => !img.alt).length,
  buttonsWithoutText: Array.from(document.querySelectorAll("button")).filter((button) => !(button.textContent || button.getAttribute("aria-label") || "").trim()).length,
  inputsWithoutLabels: Array.from(document.querySelectorAll("input, textarea, select")).filter((input) => !input.id || !document.querySelector("label[for='" + CSS.escape(input.id) + "']")).length,
}))()`;

function STATE_SCRIPT(property: string): string {
  switch (property) {
    case "visible":
      return "!!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)";
    case "hidden":
      return "!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)";
    case "enabled":
      return "!(el.disabled || el.getAttribute('aria-disabled') === 'true')";
    case "disabled":
      return "!!(el.disabled || el.getAttribute('aria-disabled') === 'true')";
    case "checked":
      return "!!el.checked";
    case "editable":
      return "!!(el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))";
    case "focused":
      return "el === document.activeElement";
    default:
      throw new Error(`Unknown property: ${property}`);
  }
}

function SELECT_SCRIPT(value: string): string {
  return `(() => {
    if (el.tagName !== "SELECT") throw new Error("Element is not a <select>");
    const option = Array.from(el.options).find((item) => item.value === ${JSON.stringify(value)} || item.text === ${JSON.stringify(value)});
    if (!option) throw new Error("Option not found: ${value.replaceAll('"', '\\"')}");
    el.value = option.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`;
}

function MEDIA_SCRIPT(args: readonly string[]): string {
  const filter = args.includes("--images")
    ? "images"
    : args.includes("--videos")
      ? "videos"
      : args.includes("--audio")
        ? "audio"
        : "all";
  return `(() => {
    const result = {
      images: Array.from(document.images).map((img) => ({ src: img.currentSrc || img.src, alt: img.alt || "" })),
      videos: Array.from(document.querySelectorAll("video")).map((video) => ({ src: video.currentSrc || video.src || "" })),
      audio: Array.from(document.querySelectorAll("audio")).map((audio) => ({ src: audio.currentSrc || audio.src || "" })),
    };
    return ${JSON.stringify(filter)} === "all" ? result : result[${JSON.stringify(filter)}];
  })()`;
}

function DATA_SCRIPT(args: readonly string[]): string {
  const all = args.length === 0;
  return `(() => ({
    jsonLd: ${all || args.includes("--jsonld")} ? Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((script) => {
      try { return JSON.parse(script.textContent || ""); } catch { return null; }
    }).filter(Boolean) : undefined,
    openGraph: ${all || args.includes("--og")} ? Object.fromEntries(Array.from(document.querySelectorAll('meta[property^="og:"]')).map((meta) => [(meta.getAttribute("property") || "").replace(/^og:/, ""), meta.getAttribute("content") || ""])) : undefined,
    twitterCards: ${all || args.includes("--twitter")} ? Object.fromEntries(Array.from(document.querySelectorAll('meta[name^="twitter:"]')).map((meta) => [(meta.getAttribute("name") || "").replace(/^twitter:/, ""), meta.getAttribute("content") || ""])) : undefined,
    meta: ${all || args.includes("--meta")} ? {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute("content") || "",
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "",
    } : undefined,
  }))()`;
}

function CLEANUP_SCRIPT(
  ads: boolean,
  cookies: boolean,
  sticky: boolean,
  overlays: boolean,
): string {
  const selectors = [
    ...(ads ? ['[class*="ad-"]', '[id*="ad-"]', "ins"] : []),
    ...(cookies ? ['[class*="cookie"]', '[id*="cookie"]'] : []),
    ...(overlays ? ['[class*="modal"]', '[role="dialog"]'] : []),
  ];
  return `(() => {
    let removed = 0;
    for (const selector of ${JSON.stringify(selectors)}) {
      for (const el of document.querySelectorAll(selector)) {
        el.style.setProperty("display", "none", "important");
        removed++;
      }
    }
    if (${sticky}) {
      for (const el of document.querySelectorAll("*")) {
        const style = getComputedStyle(el);
        if (style.position === "fixed" || style.position === "sticky") {
          el.style.setProperty("display", "none", "important");
          removed++;
        }
      }
    }
    return removed;
  })()`;
}
