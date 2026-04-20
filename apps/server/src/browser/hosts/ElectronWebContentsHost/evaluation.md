# T3CO-337 Phase 1 Evaluation

## Question

Is `Accessibility.getFullAXTree` producing the same ref shape as Playwright
`ariaSnapshot()`?

## Finding

Go, with one known parity gap to carry into Phase 2.

For the Phase 1 target shape, CDP's `Accessibility.getFullAXTree` is stable
enough to reproduce T3's current `@ref` contract:

- The AX tree exposes the same load-bearing tuple the vendored snapshot parser
  needs: role, accessible name, tree order, and `backendDOMNodeId`.
- Ref identity can be rebuilt as `{ role, name, nth, backendNodeId }`, where
  `nth` follows Playwright's `getByRole(role, { name }).nth(index)` model.
- Cached `backendDOMNodeId` gives a fast path for immediate actions after a
  snapshot. When it is stale, `Accessibility.queryAXTree` can re-select by
  role/name and re-apply the stored `nth`.
- The cursor-interactive scan ports directly to `Runtime.evaluate`; it does not
  depend on Playwright locators.
- Input and screenshot primitives line up with CDP's model: mouse/keyboard input
  uses CSS pixels, while screenshots return a buffer plus DPR metadata.

## Divergence

`ariaSnapshot()` gives a compact YAML-like tree that already matches
Playwright's role locator semantics. `Accessibility.getFullAXTree` is lower
level: it includes ignored and structural nodes, role names are Chromium AX role
names, and iframe handling is not automatically scoped the way the current
`TabSession` active-frame abstraction is. The PoC walker filters wrappers and
ignored nodes, then preserves active-page tree order for ref assignment.

The main Phase 2 risk is not basic ref shape; it is semantic edge cases around
Chromium AX roles that differ from Playwright's normalized role names on complex
sites. That risk is acceptable because the stored tuple has enough information
to fail cleanly as stale and re-snapshot, and because the high-value interactive
roles used by the browser tools are present in the CDP AX tree.

## Recommendation

Go for Phase 2. Build the production `BrowserHost`/`CdpBroker` path behind the
same tuple contract, keep the active-frame-only policy explicit, and add parity
tests against real Electron pages before expanding the tool surface.
