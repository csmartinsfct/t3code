# ElectronWebContentsHost PoC

This directory is the Phase 1 proof of concept for [T3CO-337](t3://ticket/T3CO-337).
It intentionally does not introduce the production `BrowserHost` resolver or main-process
CDP broker. Those are Phase 2 concerns.

The PoC ports the risky parts of the current Playwright snapshot system onto raw CDP:

- `Accessibility.getFullAXTree` is flattened into deterministic `@e<N>` refs.
- Refs store `{ role, name, nth, backendNodeId }`, with cached `backendNodeId`
  fast-path resolution and `Accessibility.queryAXTree` slow-path recovery.
- The cursor-interactive scan uses the same page-side JavaScript shape as the
  vendored Playwright implementation, executed through `Runtime.evaluate`.
- Basic primitives call CDP directly: `Input.dispatchMouseEvent`,
  `Input.insertText`, `Runtime.evaluate`, and `Page.captureScreenshot`.

Run the standalone Electron 40.6.0 harness from the repo root:

```bash
bunx electron apps/server/src/browser/hosts/ElectronWebContentsHost/run-poc.mjs
```

The script launches a hidden `BrowserWindow` plus a `WebContentsView`, attaches
`webContents.debugger.attach("1.3")`, and snapshots the target pages listed in
the ticket. It is a smoke harness, not a production integration point.
