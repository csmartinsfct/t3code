# start-electron-dev

Start a single Electron development instance for T3 Code with the web dev server, desktop bundle watcher, and backend.

## Steps

1. From the repo root, clean up any stale Electron dev launchers if needed:

```bash
pkill -f 'scripts/dev-electron.mjs|--t3code-dev-root=.*/apps/desktop' || true
```

2. Start the desktop dev stack from the repo root:

```bash
bun run dev:desktop
```

## Notes

- This is the preferred command for Electron dev because it starts the web dev server and desktop dev process together
- Keep only one `bun run dev:desktop` session running at a time, or you can end up with multiple Electron dev instances
- The app loads the renderer from `http://localhost:5733`
- The desktop launcher waits for `apps/desktop/dist-electron/main.js`, `apps/desktop/dist-electron/preload.js`, and `apps/server/dist/bin.mjs` before launching Electron
- If you run `apps/desktop` directly with `bun run dev`, it expects the renderer dev server to already be running
