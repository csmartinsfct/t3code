# Composer File Picker Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep keyboard focus in the chat composer while its native `@` file picker is open, while preserving picker navigation, selection, and pointer interaction.

**Architecture:** Add a typed focus policy to the existing overlay acquire IPC. Electron overlays continue focusing by default; only the `composer-command` caller opts out. The existing composer command handler remains the sole owner of character input, Up/Down, Tab, and Enter.

**Tech Stack:** TypeScript, React, Lexical, Electron `WebContentsView`, Vitest

---

## File Map

- `packages/contracts/src/ipc.ts`: define the typed overlay acquire options shared by the renderer and desktop preload.
- `apps/desktop/src/preload.ts`: forward acquire options over IPC.
- `apps/desktop/src/overlayPool.ts`: honor the focus policy when attaching an overlay view.
- `apps/desktop/src/overlayPool.test.ts`: verify default focus and the non-focusing exception at the Electron pool boundary.
- `apps/web/src/nativeOverlayBridge.ts`: pass focus options through the high-level overlay lifecycle.
- `apps/web/src/nativeOverlayBridge.test.ts`: verify the renderer bridge requests non-focusing acquisition.
- `apps/web/src/components/ChatView.tsx`: opt the composer command menu out of focus-on-acquire.
- `docs/overlays.md`: document keyboard ownership for the composer overlay exception.
- `docs/browser-tools.md`: document the focus option in the overlay IPC/runtime flow.

### Task 1: Add a typed overlay acquire focus policy

**Files:**

- Modify: `packages/contracts/src/ipc.ts`
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/web/src/nativeOverlayBridge.ts`
- Test: `apps/web/src/nativeOverlayBridge.test.ts`

- [ ] **Step 1: Write the failing renderer bridge test**

Import `acquireNativeOverlay` in `apps/web/src/nativeOverlayBridge.test.ts`, open a composer message with `{ focus: false }`, and assert that the desktop bridge receives the option:

```typescript
it("requests a non-focusing native overlay when configured", async () => {
  const overlay = installOverlayBridge();
  setEmbeddedBrowserMountedForModalSuspension(true);

  const handle = await acquireNativeOverlay(
    {
      type: "composer-command",
      anchor: { x: 0, y: 0, width: 100, height: 40 },
      items: [],
      resolvedTheme: "dark",
      isLoading: false,
      triggerKind: "path",
      activeItemId: null,
    },
    { focus: false },
  );

  expect(handle).not.toBeNull();
  expect(overlay.acquire).toHaveBeenCalledWith({ focus: false });
  handle?.release();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun run test apps/web/src/nativeOverlayBridge.test.ts`

Expected: FAIL because `acquireNativeOverlay` accepts only one argument and `DesktopOverlayBridge.acquire` has no options parameter.

- [ ] **Step 3: Add and forward the typed option**

In `packages/contracts/src/ipc.ts`:

```typescript
export interface OverlayAcquireOptions {
  focus?: boolean;
}

export interface DesktopOverlayBridge {
  acquire(options?: OverlayAcquireOptions): Promise<string>;
  // existing methods unchanged
}
```

In `apps/desktop/src/preload.ts`, type and forward the optional object:

```typescript
acquire: (options?: import("@t3tools/contracts").OverlayAcquireOptions) =>
  ipcRenderer.invoke(OVERLAY_ACQUIRE_CHANNEL, options),
```

In `apps/web/src/nativeOverlayBridge.ts`, import `OverlayAcquireOptions`, accept it in `acquireNativeOverlayHandle`, and expose it from the low-level public helper:

```typescript
async function acquireNativeOverlayHandle(
  options?: OverlayAcquireOptions,
): Promise<NativeOverlayHandle | null> {
  // existing gate and focus snapshot
  id = await bridge.acquire(options);
}

export async function acquireNativeOverlay(
  initialMessage: OverlayRenderMessage,
  options?: OverlayAcquireOptions,
): Promise<NativeOverlayHandle | null> {
  const handle = await acquireNativeOverlayHandle(options);
  // existing render lifecycle
}
```

Keep `openNativeOverlay` and routed overlays calling `acquireNativeOverlayHandle()` without options so their behavior remains unchanged.

- [ ] **Step 4: Run the focused bridge test and verify GREEN**

Run: `bun run test apps/web/src/nativeOverlayBridge.test.ts`

Expected: PASS, including the new assertion that `{ focus: false }` reaches `overlay.acquire`.

- [ ] **Step 5: Commit the typed bridge change**

```bash
git add packages/contracts/src/ipc.ts apps/desktop/src/preload.ts apps/web/src/nativeOverlayBridge.ts apps/web/src/nativeOverlayBridge.test.ts
git commit -m "Add native overlay focus policy"
```

### Task 2: Honor the focus policy in Electron

**Files:**

- Create: `apps/desktop/src/overlayPool.test.ts`
- Modify: `apps/desktop/src/overlayPool.ts`

- [ ] **Step 1: Write failing pool tests for both focus modes**

Mock Electron's `BaseWindow`, `WebContentsView`, and `nativeTheme`, instantiate and pre-warm an `OverlayPool`, then assert the acquired view's `webContents.focus` behavior:

```typescript
it("focuses acquired overlays by default", () => {
  const pool = createPrewarmedPool();
  const entry = pool.acquire(targetWindow, hostWebContents);

  expect(entry.view.webContents.focus).toHaveBeenCalledOnce();
});

it("can acquire an overlay without taking host keyboard focus", () => {
  const pool = createPrewarmedPool();
  const entry = pool.acquire(targetWindow, hostWebContents, { focus: false });

  expect(entry.view.webContents.focus).not.toHaveBeenCalled();
});
```

The test fixture must provide `contentView.addChildView/removeChildView`, `getContentBounds`, `webContents.loadURL/send/isDestroyed/isLoading/getURL`, and `BaseWindow.isDestroyed/destroy`, matching only what `OverlayPool` exercises.

- [ ] **Step 2: Run the pool test and verify RED**

Run: `bun run test apps/desktop/src/overlayPool.test.ts`

Expected: FAIL because `OverlayPool.acquire` does not accept focus options and always calls `entry.view.webContents.focus()`.

- [ ] **Step 3: Implement the minimal Electron policy**

Accept `OverlayAcquireOptions` in `OverlayPool.acquire` and `acquireEntry`, defaulting to the existing focus behavior:

```typescript
acquire(
  targetWindow: BrowserWindow,
  hostWebContents: Electron.WebContents,
  options: OverlayAcquireOptions = {},
): OverlayPoolEntry {
  // existing entry selection
  return this.acquireEntry(entry, targetWindow, hostWebContents, options);
}

// after addChildView
if (options.focus !== false) {
  entry.view.webContents.focus();
}
```

Update the IPC handler to accept a raw options argument, validate only the boolean opt-out, and pass a normalized object to the pool:

```typescript
ipcMain.handle(OVERLAY_ACQUIRE_CHANNEL, (event, rawOptions: unknown) => {
  const options: OverlayAcquireOptions =
    typeof rawOptions === "object" &&
    rawOptions !== null &&
    (rawOptions as { focus?: unknown }).focus === false
      ? { focus: false }
      : {};
  // existing window/pool lookup
  const entry = pool.acquire(window, event.sender, options);
  return entry.id;
});
```

- [ ] **Step 4: Run the pool test and verify GREEN**

Run: `bun run test apps/desktop/src/overlayPool.test.ts`

Expected: PASS for default focusing and `{ focus: false }`.

- [ ] **Step 5: Commit the Electron behavior**

```bash
git add apps/desktop/src/overlayPool.ts apps/desktop/src/overlayPool.test.ts
git commit -m "Preserve host focus for passive overlays"
```

### Task 3: Opt the composer picker out and document the contract

**Files:**

- Modify: `apps/web/src/components/ChatView.tsx`
- Modify: `docs/overlays.md`
- Modify: `docs/browser-tools.md`

- [ ] **Step 1: Apply the composer-only focus policy**

Change the existing composer acquisition call in `ChatView.tsx`:

```typescript
void acquireNativeOverlay(message, { focus: false }).then((handle) => {
  // existing lifecycle unchanged
});
```

Do not alter `ComposerCommandKeyPlugin` or `onComposerCommandKey`; they already keep character input in Lexical, move the active item with Up/Down, and select with Tab/Enter.

- [ ] **Step 2: Update overlay interaction documentation**

Add an interaction rule to `docs/overlays.md` stating that the `composer-command` overlay is non-focusing: the host composer owns typing and command keys, while the overlay remains pointer-interactive.

Update `docs/browser-tools.md` so the IPC flow shows `overlay.acquire({ focus?: boolean })`, the host runtime section says overlays focus by default, and the composer-command section records its `{ focus: false }` exception.

- [ ] **Step 3: Run all focused regression tests**

Run:

```bash
bun run test apps/web/src/nativeOverlayBridge.test.ts
bun run test apps/desktop/src/overlayPool.test.ts
```

Expected: both commands exit 0 with no failures.

- [ ] **Step 4: Commit the composer behavior and docs**

```bash
git add apps/web/src/components/ChatView.tsx docs/overlays.md docs/browser-tools.md
git commit -m "Keep composer focused with file picker open"
```

### Task 4: Repository verification

**Files:**

- Verify only; do not stage the user's unrelated files.

- [ ] **Step 1: Run formatting**

Run: `bun fmt`

Expected: exit 0. Review `git status --short` afterward and keep unrelated pre-existing changes intact.

- [ ] **Step 2: Run linting**

Run: `bun lint`

Expected: exit 0 with no lint errors.

- [ ] **Step 3: Run type checking**

Run: `bun typecheck`

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 4: Re-run the focused tests after formatting**

Run:

```bash
bun run test apps/web/src/nativeOverlayBridge.test.ts
bun run test apps/desktop/src/overlayPool.test.ts
```

Expected: both commands exit 0 with no failures.

- [ ] **Step 5: Inspect the final diff and worktree ownership**

Run:

```bash
git diff --check HEAD
git status --short
git log -4 --oneline
```

Expected: no whitespace errors; implementation commits are present; the pre-existing changes to `apps/web/public/generated/changelog.json`, `docs/t3-agent-tools.md`, and `docs/codex-plugin-skills.md` remain unstaged and unmodified by this task except if `bun fmt` mechanically touches them, in which case restore only the formatter's task-unrelated delta without discarding the user's original content.
