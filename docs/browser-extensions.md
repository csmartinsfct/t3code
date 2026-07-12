# Browser Extensions

Chrome extension support for T3 Code's embedded browser. Covers installation, the Chrome API bridge, the extensions panel UI, popup windows, and the forked `electron-chrome-extensions` dependency.

---

## Overview

Extensions are loaded per-project into the Electron session partition `persist:<projectId>`. Each project gets an independent extension registry — MetaMask in project A has no access to project B's state. Extensions persist across restarts: `DesktopExtensionManager` initializes the Web Store loader for `<dataDir>/browser/<projectId>/extensions/` and reloads any legacy flat-format extension directories.

---

## Installation flow

### Chrome Web Store

The embedded browser injects a shim into every page that:

1. Overrides `navigator.userAgent` to strip `Electron/...` so the Web Store renders the "Add to Chrome" button.
2. Sets `window.chrome.webstore.install()` to capture the extension ID and signal Electron main via a prefixed `console.log` message (`__t3_ext_install__:<id>`).
3. Uses a `MutationObserver` to re-enable disabled install buttons (Google detects non-Chrome browsers and greys the button).

When the install signal fires, T3 uses a shared verified Web Store install helper in `apps/desktop/src/desktopExtensionManager.ts`:

1. Fetches the CRX from Google's CDN (`clients2.google.com/service/update2/crx?...`).
2. Verifies the CRX3 RSA-SHA256 signature and extension ID against the exact downloaded bytes.
3. Strips the CRX3 header and extracts the ZIP using `fflate`, validating paths to prevent ZIP traversal attacks.
4. Writes `manifest.key` from the verified CRX public key so Chromium derives the same stable extension ID.
5. Runs `ensureExtensionPolyfill` to prepend the service-worker shim before the first `session.loadExtension` call.
6. Loads the extension from the verified unpacked directory and notifies the renderer via `browser:extensionsChanged`.

The agent-facing `load_extension <extensionId>` tool uses the same helper, so Web Store UI installs and agent-triggered installs verify and load the same CRX payload.

### Unpacked extensions

Local extension directories can be loaded for development via:

- **Agent tools:** `load_unpacked <folderPath>`, `reload_extension <extensionId>`, and `remove_extension <extensionId>` (see below).
- **UI:** "Load unpacked..." button in the extensions panel, which opens a native folder picker.

The extension must contain a `manifest.json` at its root. The call is idempotent — calling `load_unpacked` again with the same path reloads the extension (equivalent to clicking "Reload" in `chrome://extensions/`).

`chrome.runtime.reload()` is supported via the `electron-chrome-extensions` bridge. HMR-capable frameworks (Vite+CRXJS, Plasmo, WXT) call this automatically when files change.
T3 wires the bridge's reload hook back into the desktop extension loader, so HMR reloads re-apply the background service-worker polyfill and clear stale worker/code caches before `session.loadExtension()` runs.

Removal uses two paths: managed Web Store extensions are removed through `electron-chrome-web-store` and the managed extension directory is deleted; unpacked extensions are removed with `session.removeExtension()` only, so the source folder is never deleted. Both paths close every open popup for that extension, remove the extension from T3's pinned-extension list, purge only that extension's Chromium Preferences/storage entries, and emit `browser:extensionsChanged` so the panel refreshes immediately.

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
├── dist/types/             # Type declarations (tsc)
├── esbuild.config.js       # Standalone build config (no monorepo tooling)
└── tsconfig.json           # Standalone tsconfig (avoids T3 TS5 incompatibilities)
```

`dist/` is gitignored generated output. To rebuild after source changes:

```bash
cd packages/electron-chrome-extensions
bun run build
```

The build script compiles JS bundles, the preload file, browser-action bundles, and `dist/types/`. Declaration emit uses TypeScript `--noCheck` because this fork preserves loose upstream typing while still needing reproducible `.d.ts` output. Root `bun run dev:desktop`, direct `apps/desktop` `bun run dev`, direct `apps/desktop` `bun run build`, and release artifact builds run this package build first, so a clean checkout or `bun run clean` should not require a manual package build step.

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

### Desktop integration

`DesktopExtensionManager.getOrCreate(projectId)` creates one `ElectronChromeExtensions` instance per project and wires it to T3's tab system through narrow callbacks supplied by `main.ts`:

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

The cache-clear strategy: if `ensureExtensionPolyfill` writes new bytes (first install, polyfill version bump, unpacked extension rebuild, or HMR rewrite), the `Service Worker` and `Code Cache` directories are deleted from the Electron partition and `session.clearCodeCaches()` is called before loading or reloading the extension. This forces Chromium to recompile the patched scripts. **Cache is never cleared on subsequent restarts** unless a file is patched — clearing on every startup disrupts a running service worker and causes "Background connection unresponsive".

---

## Extensions panel UI

A puzzle-piece icon in the embedded browser URL bar opens a panel showing installed extensions. See `apps/web/src/components/browser/EmbeddedBrowserExtensionsPanel.tsx`.

- **Extension list**: eagerly fetched by `useBrowserMetadata(projectId)` when a project thread mounts, then shared through `useBrowserMetadataStore` with the toolbar and panel. The main process emits `browser:extensionsChanged` after install, reload, remove, pin changes, or startup reload, which invalidates the store and triggers a refresh.
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
parented to the `BrowserWindow` currently hosting the project's embedded browser
hide-then-destroy on close (prevents white flash)
```

### NSPanel native addon

`apps/desktop/native/panel-window/panel-window.mm` is a minimal N-API Objective-C++ addon that sets `NSWindowCollectionBehaviorFullScreenAuxiliary` on the popup `BrowserWindow`, allowing it to appear in T3's full-screen Space alongside the main window. It also calls `[win _setPreventsActivation:true]` to prevent the popup from stealing keyboard focus from T3.

The native auxiliary flag makes a popup eligible for a full-screen Space; the Electron parent relationship determines which T3 window and Space owns it. Both renderer-triggered opens and agent `open_extension` broker calls resolve the owner from the project-to-window binding before creating the popup. Project unmount detaches hidden popups from the old parent, and mount reparents them before showing, so main-window/popout transitions do not strand a popup in another Space or let a closing parent destroy it.

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

When extensions call `chrome.windows.create()` for dapp approvals (MetaMask connect, sign, send), the `createWindow` callback supplied to `DesktopExtensionManager` handles it identically to action popups — resolves the project's current owner window, creates a parented `BrowserWindow`, resolves the URL (now done in the library, not in `main.ts`), registers it with `ExtensionPopupRegistry`, and shows it.

`ExtensionPopupRegistry` gives every popup window a stable runtime `popupKey` (`popup-1`, `popup-2`, ...). `open_extension`, `ext_switch <extensionId>`, and `ext_close <extensionId>` remain compatible for the common single-popup case. When multiple windows exist for one extension, `ext_windows` lists each `popupKey`, popup type (`action` or `extension-window`), title, and URL; agents should use `ext_switch <popupKey>` / `ext_close <popupKey>` to target the intended window.

---

## Current limitations and regression anchors

- Extension support is Electron-desktop only. Server-only Playwright projects do not load Electron session extensions.
- `ext_windows` lists tracked action popups and extension windows registered through T3's popup registry. If a future extension flow opens a standalone Electron `BrowserWindow` outside that registry, add the flow to `ExtensionPopupRegistry` and cover it in the broker tests.
- The `panel-window` native addon is still macOS-specific. Production builds must keep staging `panel_window.node` outside the asar so full-screen popup behavior keeps working.
- Web Store and agent installs must continue sharing the same verified CRX helper. Do not reintroduce a path that verifies one download and loads a different payload.
- Unpacked extension removal must continue unloading the extension without deleting the developer's source directory.

---

## Extension development

T3 Code supports loading and reloading local Chrome extension directories for development, without packaging or publishing to the Web Store.

### Agent tools

| Tool                             | Description                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `load_unpacked <folderPath>`     | Load (or reload) an extension from an absolute path to the directory containing `manifest.json`. Returns the extension name, ID, and `[unpacked]` tag. |
| `reload_extension <extensionId>` | Reload an already-loaded extension by ID. Use when you have the ID from `list_extensions` but not the path.                                            |
| `remove_extension <extensionId>` | Remove a loaded extension by ID. Web Store extensions are uninstalled from T3's managed directory; unpacked source folders are left untouched.         |
| `list_extensions`                | List all installed extensions; unpacked extensions are marked `isUnpacked: true`.                                                                      |

### UI

The extensions panel ("Load unpacked..." button) opens a native macOS folder picker. The selected directory is validated (must contain `manifest.json`) and loaded into the project browser session.

### HMR framework workflow (Vite+CRXJS, Plasmo, WXT)

1. Start the framework dev server via the managed runs system (e.g. `bun run dev`).
2. Use `load_unpacked` pointing at the build output directory (e.g. `dist/`).
3. The framework calls `chrome.runtime.reload()` automatically when files change — T3's `electron-chrome-extensions` bridge delegates this to the desktop reload hook so the service-worker polyfill is re-applied before the extension reloads.

### Plain/vanilla extension workflow

Write files → `load_unpacked <dir>` → edit files → `load_unpacked <dir>` again to reload.

### `chrome.runtime.reload()` support

`chrome.runtime.reload()` is wired in `packages/electron-chrome-extensions/src/browser/api/runtime.ts` (`runtime.reload` handler) and exposed to extension renderers via `packages/electron-chrome-extensions/src/renderer/index.ts`. In T3, the bridge calls the desktop-provided `reloadExtension` hook, which runs the same polyfill/cache preparation as UI reloads before calling `session.loadExtension(extPath, { allowFileAccess: true })`.

---

## File map

| Path                                                                 | Purpose                                                                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/electron-chrome-extensions/`                               | Forked Chrome API bridge (workspace package)                                                                    |
| `apps/desktop/native/panel-window/`                                  | NSPanel N-API addon source + prebuilt binary                                                                    |
| `apps/desktop/src/main.ts`                                           | Extension orchestration glue: IPC/broker routes, tab/window callbacks, popup placement                          |
| `apps/desktop/src/desktopExtensionManager.ts`                        | Per-project Chrome API bridge lifecycle, verified Web Store installs, unpacked load/reload/remove, pin metadata |
| `apps/desktop/src/extensionPopupRegistry.ts`                         | Extension popup tracking, CDP target switching, project hide/show, and quit cleanup                             |
| `apps/desktop/src/preload.ts`                                        | `browser:listExtensions`, `browser:openExtension`, `browser:extensionsChanged` IPC channels                     |
| `packages/contracts/src/ipc.ts`                                      | `DesktopBrowserBridge` — `listExtensions`, `openExtension`, `onExtensionsChanged` types                         |
| `apps/web/src/components/browser/EmbeddedBrowserExtensionsPanel.tsx` | Extensions panel UI component + overlay route                                                                   |
