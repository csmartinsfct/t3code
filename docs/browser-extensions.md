# Browser Extensions

Chrome extension support for T3 Code's embedded browser. Covers installation, the Chrome API bridge, the extensions panel UI, popup windows, and the forked `electron-chrome-extensions` dependency.

---

## Overview

Extensions are loaded per-project into the Electron session partition `persist:<projectId>`. Each project gets an independent extension registry — MetaMask in project A has no access to project B's state. Extensions persist across restarts: on startup, `reloadPersistedExtensions` scans `<dataDir>/browser/<projectId>/extensions/` and reloads each one.

---

## Installation flow

### Chrome Web Store

The embedded browser injects a shim into every page that:

1. Overrides `navigator.userAgent` to strip `Electron/...` so the Web Store renders the "Add to Chrome" button.
2. Sets `window.chrome.webstore.install()` to capture the extension ID and signal Electron main via a prefixed `console.log` message (`__t3_ext_install__:<id>`).
3. Uses a `MutationObserver` to re-enable disabled install buttons (Google detects non-Chrome browsers and greys the button).

When the install signal fires, `loadExtensionFromCrx` in `apps/desktop/src/main.ts`:

1. Fetches the CRX from Google's CDN (`clients2.google.com/service/update2/crx?...`).
2. Strips the CRX3 header and extracts the ZIP using `fflate`.
3. Validates paths to prevent ZIP traversal attacks.
4. Runs `ensureExtensionPolyfill` to prepend a `requestAnimationFrame` shim to the background service worker (MV3 service workers don't have this DOM API).
5. Calls `session.loadExtension(extDir, { allowFileAccess: true })`.
6. Notifies the renderer via `browser:extensionsChanged` so the extensions panel refreshes immediately.

### Unpacked extensions (Settings UI — T3CO-468)

Not yet implemented. Planned: folder picker in Settings → Browser → Extensions.

---

## Chrome API bridge — `electron-chrome-extensions`

Electron wraps Chromium's content layer but not the browser shell. This means APIs like `chrome.tabs`, `chrome.windows`, `chrome.offscreen`, and `chrome.notifications` are absent or incomplete, causing extensions to crash.

T3 uses a **forked and patched** version of `electron-chrome-extensions` (originally by samuelmaddock, hosted at `packages/electron-chrome-extensions/`) as a workspace package. The fork was necessary because:

- The upstream package was last published ~10 months before our integration.
- It uses NAN for its native components, which is incompatible with Electron 40's V8 (removed `SetPrototype`, `WriteUtf8`, `AccessControl`).
- Several Chrome API gaps needed fixing for real-world wallets (MetaMask, Rainbow).

### Fork location and build

```
packages/electron-chrome-extensions/
├── src/                    # TypeScript source (the fork)
├── dist/cjs/               # Built CJS output (esbuild)
├── dist/esm/               # Built ESM output (esbuild)
├── dist/types/             # Type declarations (vendored from npm 4.9.0)
├── esbuild.config.js       # Standalone build config (no monorepo tooling)
└── tsconfig.json           # Standalone tsconfig (avoids T3 TS5 incompatibilities)
```

To rebuild after source changes:

```bash
cd packages/electron-chrome-extensions
bun run build          # compiles JS + preload (dist/cjs, dist/esm, dist/chrome-extension-api.preload.js)
npx tsc --noEmit false --rootDir src --ignoreDeprecations 6.0  # generates dist/types/
```

Both steps are required before running `bun run dev:desktop`:
- `bun run build` is needed because `dist/` is gitignored — a fresh clone has no compiled output.
- The type declaration step is needed once to satisfy `apps/desktop` typecheck (`moduleResolution: "Bundler"` resolves types from the `exports.types` field).

`apps/desktop/package.json` references it as `"electron-chrome-extensions": "workspace:*"` — never published to npm, resolved locally by bun.

### Electron 40 service worker isolated world

**Context**: Electron 35 introduced `session.registerPreloadScript({ type: "service-worker" })`. In Electron 35, SW preloads ran in the same JS realm as the extension's background script, so calling `mainWorldScript()` directly patched the same `chrome` object the extension used.

**Electron 40 change**: SW preloads now run in an **isolated world**, separate from background.js. Direct calls to `mainWorldScript()` only affected the isolated world — `chrome.tabs.create` in background.js remained native and non-intercepted, silently doing nothing.

**Fix** (in `src/renderer/index.ts`): When `contextBridge.executeInMainWorld` is available in the SW preload context (Electron 40+), use it instead of calling `mainWorldScript()` directly. This executes the API overrides in the main world where background.js runs, making `chrome.tabs.create` and other APIs route through the IPC bridge.

```typescript
if (contextBridge && "executeInMainWorld" in contextBridge) {
  contextBridge.exposeInMainWorld("electron", electronContext);
  (contextBridge as any).executeInMainWorld({ func: mainWorldScript });
} else {
  mainWorldScript(); // older Electron — same realm, direct call works
}
```

### Integration in `main.ts`

`getOrCreateChromeExtensions(projectId)` creates one `ElectronChromeExtensions` instance per project and wires it to T3's tab system:

```typescript
const ext = new ElectronChromeExtensions({
  license: "GPL-3.0",
  session: ses,
  createTab: (details) => {
    /* opens new T3 browser tab */
  },
  selectTab: (tab) => {
    /* switches T3 active tab */
  },
  removeTab: (tab) => {
    /* closes T3 tab */
  },
  createWindow: (details) => {
    /* opens extension notification popup */
  },
});
```

`addTab` / `removeTab` / `selectTab` are called from `createEmbeddedBrowserTab`'s `did-finish-load` and `will-be-destroyed` events so `chrome.tabs.*` events fire correctly as T3's tab system changes.

The library's preload (`dist/chrome-extension-api.preload.js`) is registered via `session.registerPreloadScript` so all frames in the session receive `chrome.*` APIs.

### Gaps fixed in the fork

Five gaps in the upstream library were fixed. See [T3CO-475](t3://ticket/T3CO-475) for the original tracking.

| Gap                                                                              | File         | Fix                                                                           |
| -------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------- |
| Relative URLs in `createWindow` (e.g. `'notification.html'` → `ERR_INVALID_URL`) | `store.ts`   | Resolve against `event.extension.id` before calling callback                  |
| `chrome.windows.create({tabId})` opens blank window                              | `store.ts`   | Populate `url` from `tabDetailsCache` for the given tab                       |
| `chrome.windows.getCurrent()` returns wrong window in popup context              | `windows.ts` | Walk window registry to find the window containing the sender's `webContents` |
| `tabs.onUpdated` silently dropped first event (cache miss early return)          | `tabs.ts`    | Create initial cache entry instead of returning early                         |
| `tabs.onActivated` silently dropped when `addTab` already set tab active         | `tabs.ts`    | Removed `activeChanged` guard — set+emit is idempotent                        |

---

## Background script polyfill

`ensureExtensionPolyfill` prepends a small runtime shim to each extension's background service worker before `session.loadExtension` is called. The shim is idempotent (guarded by `/*__t3_polyfill_v1__*/` sentinel):

```javascript
// Only requestAnimationFrame — MV3 service workers don't have this DOM API.
// chrome.tabs/windows events are provided by electron-chrome-extensions.
if (typeof requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
```

The cache-clear strategy: if `ensureExtensionPolyfill` writes new bytes (first install or polyfill version bump), the `Service Worker` and `Code Cache` directories are deleted from the Electron partition and `session.clearCodeCaches()` is called before reloading. This forces Chromium to recompile the patched scripts. **Cache is never cleared on subsequent restarts** — clearing on every startup disrupts a running service worker and causes "Background connection unresponsive".

---

## Extensions panel UI

A puzzle-piece icon in the embedded browser URL bar opens a panel showing installed extensions. See `apps/web/src/components/browser/EmbeddedBrowserExtensionsPanel.tsx`.

- **Extension list**: fetched via `browser:listExtensions` IPC on panel open; cached in a module-level Map keyed by `projectId`. The main process emits `browser:extensionsChanged` after install or startup reload, which invalidates the cache and triggers a refresh.
- **Icons**: returned as `data:image/png;base64,...` URLs from the IPC handler (reading from disk). `chrome-extension://` URLs can't be used in the overlay renderer, which runs in a different session partition.
- **Opening an extension**: `browser:openExtension` creates a floating `BrowserWindow` for popup extensions or opens `home.html` in a tab for full-page extensions.

The panel uses CSS-only hover labels for extension icons (no JS `<Tooltip>`) to avoid tooltips appearing on focus when the panel opens.

---

## Extension popup windows

When a user clicks an extension's icon in the panel, or when an extension calls `chrome.windows.create()` (e.g. MetaMask's dapp approval flow), T3 creates a floating `BrowserWindow`:

```
frame: true, titleBarStyle default (visible + draggable)
alwaysOnTop: true
NSPanel via panel-window native addon (see below)
hide-then-destroy on close (prevents white flash)
```

### NSPanel native addon

`apps/desktop/native/panel-window/panel-window.mm` is a minimal N-API Objective-C++ addon that sets `NSWindowCollectionBehaviorFullScreenAuxiliary` on the popup `BrowserWindow`, allowing it to appear in T3's full-screen Space alongside the main window. It also calls `[win _setPreventsActivation:true]` to prevent the popup from stealing keyboard focus from T3.

This addon replaces the class-swapping approach used by `@egoist/electron-panel-window` (which is incompatible with Electron 40's V8 via NAN). It does **not** use `object_setClass` — the window class is untouched, avoiding the `cleanup` selector crash on close.

Build:

```bash
node ~/.nvm/versions/node/v22.22.1/lib/node_modules/node-gyp/bin/node-gyp.js \
  configure build \
  --directory=apps/desktop/native/panel-window \
  --target=40.6.0 --arch=arm64 \
  --dist-url=https://electronjs.org/headers --runtime=electron
```

The built `.node` binary is committed to the worktree. For production builds see [T3CO-474](t3://ticket/T3CO-474).

### Popup position

Popups are positioned below the URL bar on the right side of the screen. In macOS full-screen, `ownerWindow.getBounds()` returns screen dimensions, so `isFullScreen()` is checked and `cursorDisplay.bounds` is used instead.

### Dapp approval popups

When extensions call `chrome.windows.create()` for dapp approvals (MetaMask connect, sign, send), the `createWindow` callback in `getOrCreateChromeExtensions` handles it identically to action popups — creates a `BrowserWindow`, resolves the URL (now done in the library, not in `main.ts`), and shows it.

---

## Known limitations and open tickets

| Ticket                               | Description                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| [T3CO-465–467](t3://ticket/T3CO-465) | Agent tools for extension popup windows (`ext_windows`, `ext_switch`, `ext_close`) |
| [T3CO-468](t3://ticket/T3CO-468)     | Settings UI for loading unpacked extensions                                        |
| [T3CO-469](t3://ticket/T3CO-469)     | Docs update pass                                                                   |
| [T3CO-471](t3://ticket/T3CO-471)     | CRX signature verification (currently skipped)                                     |
| [T3CO-473](t3://ticket/T3CO-473)     | Full-screen popup via NSPanel (N-API port incompatible with Electron 40 NAN)       |
| [T3CO-474](t3://ticket/T3CO-474)     | Production build integration for `panel-window` native addon                       |
| [T3CO-475](t3://ticket/T3CO-475)     | Fork `electron-chrome-extensions` — done; remaining upstream gaps tracked here     |

---

## File map

| Path                                                                 | Purpose                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/electron-chrome-extensions/`                               | Forked Chrome API bridge (workspace package)                                                                                         |
| `apps/desktop/native/panel-window/`                                  | NSPanel N-API addon source + prebuilt binary                                                                                         |
| `apps/desktop/src/main.ts`                                           | `getOrCreateChromeExtensions`, `loadExtensionFromCrx`, `reloadPersistedExtensions`, `ensureExtensionPolyfill`, popup window creation |
| `apps/desktop/src/preload.ts`                                        | `browser:listExtensions`, `browser:openExtension`, `browser:extensionsChanged` IPC channels                                          |
| `packages/contracts/src/ipc.ts`                                      | `DesktopBrowserBridge` — `listExtensions`, `openExtension`, `onExtensionsChanged` types                                              |
| `apps/web/src/components/browser/EmbeddedBrowserExtensionsPanel.tsx` | Extensions panel UI component + overlay route                                                                                        |
