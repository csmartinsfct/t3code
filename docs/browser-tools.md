# Browser Automation

In-process Chromium automation exposed to AI sessions via the `/api/browser` REST endpoint. Built by vendoring [GStack Browser](https://github.com/gstack/gstack) (MIT, © Garry Tan) into `apps/server/src/browser/core/` byte-identically, with T3-specific wrappers around it.

See the `NOTICE` file at `apps/server/src/browser/NOTICE` for the full attribution, vendoring approach, and list of intentionally-not-vendored files.

---

## Overview

T3 Code runs Playwright Chromium in-process, keyed by project id. Each project gets its own persistent Chromium profile so cookies, localStorage, and auth sessions survive server restarts and never bleed between projects. Agents drive the browser through plaintext-returning HTTP commands that use stable `@ref` element identifiers from an accessibility snapshot instead of fragile CSS selectors.

| Field              | Value                                                                       |
| ------------------ | --------------------------------------------------------------------------- |
| Endpoint           | `/api/browser`                                                              |
| Auth               | Bearer token (per-thread, `managedRunService.issueMcpAccess`) or dev-bypass |
| Response envelope  | `{ data: { message, data: { output: string } }, error: null }`              |
| Total tools        | 58 (navigate, read, interact, snapshot/screenshot, meta, batch)             |
| Underlying runtime | Playwright Chromium, `launchPersistentContext`                              |
| Profile location   | `<dataDir>/browser/<projectId>/chromium-profile/`                           |

---

## Call pattern

```bash
# Discover tools
curl -s "${BASE_URL}/api/browser?projectId=${PID}&threadId=${TID}" \
  -H "Authorization: Bearer ${TOKEN}"

# Invoke a tool
curl -s -X POST "${BASE_URL}/api/browser?projectId=${PID}&threadId=${TID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"tool":"goto","input":{"url":"https://example.com"}}'
```

Every successful response wraps the command's plaintext output:

```json
{
  "data": { "message": "OK", "data": { "output": "Navigated to https://example.com (200)" } },
  "error": null
}
```

Errors use the standard T3 shape:

```json
{ "data": null, "error": "Unknown tool: totallyFake" }
```

---

## The `@ref` system

The defining feature vs traditional CSS-selector-based automation. `snapshot` returns the accessibility tree with a stable `@e<N>` (interactive element) or `@c<N>` (cursor-interactive — `cursor:pointer`, `onclick`, `tabindex`) identifier per element. Use those refs in follow-up `click`, `fill`, `hover`, `attrs`, `css`, `is`, `screenshot`, `upload` calls.

Refs are invalidated on navigation — re-call `snapshot` after any `goto`, `click`, or `reload` that changes the page.

```json
// 1. snapshot
{"tool":"snapshot","input":{"interactive":true}}
// → "@e1 [link] \"Learn more\""

// 2. click by ref
{"tool":"click","input":{"ref":"@e1"}}
// → "Clicked @e1 → now at https://www.iana.org/help/example-domains"

// 3. re-snapshot (refs invalidated by navigation)
{"tool":"snapshot","input":{"interactive":true}}
```

CSS selectors still work as a fallback for any command that takes a `ref` or `selector` field, but refs are preferred — they survive minor DOM changes and are deterministic across snapshots.

---

## Command inventory

### Navigate

| Tool                        | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `goto`                      | Navigate to URL, wait for DOMContentLoaded |
| `back`, `forward`, `reload` | History / reload                           |
| `url`                       | Current URL of active tab                  |

### Read

| Tool                           | Purpose                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `text`                         | Cleaned visible text (scripts/styles/svg stripped)                                |
| `html`                         | innerHTML of a selector, or full page HTML                                        |
| `links`                        | All links as `text → href`                                                        |
| `forms`                        | Form fields as JSON (passwords + token-shape values redacted)                     |
| `accessibility`                | Raw ARIA tree (no @refs — use `snapshot` for refs)                                |
| `js` / `evaluate`              | Run JS expression, return result as string                                        |
| `eval`                         | Run JS read from a file (path must be safe)                                       |
| `css`                          | Computed CSS value of property on selector                                        |
| `attrs`                        | All attributes of element as JSON                                                 |
| `is`                           | State check: visible / hidden / enabled / disabled / checked / editable / focused |
| `console`, `network`, `dialog` | Captured console / network / dialog buffers                                       |
| `cookies`, `storage`           | Cookies JSON, localStorage+sessionStorage JSON                                    |
| `perf`                         | Page load timing metrics                                                          |
| `inspect`                      | CDP-driven box model + computed styles + matched rules                            |
| `media`                        | Discover `<img>`, `<video>`, `<audio>`, CSS background-image                      |
| `data`                         | JSON-LD, Open Graph, Twitter Cards, meta tags                                     |

### Interact

| Tool                                                        | Purpose                                                                                            |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `click`, `fill`, `hover`, `type`, `press`, `scroll`, `wait` | Standard interactions                                                                              |
| `select`                                                    | Dropdown option by value / label / text                                                            |
| `viewport`                                                  | Set viewport size (e.g. `1024x768`)                                                                |
| `cookie`, `cookie-import`, `cookie-import-browser`          | Cookie management (last reads from installed browsers — Chrome, Edge, Brave, Arc, Chromium, Comet) |
| `header`                                                    | Custom request header on future requests (colon-separated)                                         |
| `useragent`                                                 | Override UA — **currently broken, see known issues**                                               |
| `upload`                                                    | Upload file(s) via `<input type=file>`                                                             |
| `dialog-accept`, `dialog-dismiss`                           | Auto-handle next alert/confirm/prompt                                                              |
| `style`                                                     | Live CSS modification via CDP with undo history                                                    |
| `cleanup`                                                   | Remove ads / cookie banners / overlays / clutter                                                   |
| `prettyscreenshot`                                          | `cleanup --all` + screenshot                                                                       |

### Visual / Meta

| Tool                                | Purpose                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot`                          | Accessibility tree with @refs; supports `interactive`, `compact`, `depth`, `selector`, `diff`, `annotate`, `cursorInteractive`, `heatmap` |
| `screenshot`                        | PNG — full page, viewport, clipped, or element; disk path or base64 data URI                                                              |
| `pdf`                               | Export current page as PDF                                                                                                                |
| `responsive`                        | Screenshots at multiple viewport sizes                                                                                                    |
| `diff`                              | Unified text diff vs previous snapshot                                                                                                    |
| `tabs`, `tab`, `newtab`, `closetab` | Tab management                                                                                                                            |
| `focus`                             | Bring browser window to front (headed mode only)                                                                                          |
| `status`                            | Connection mode, tab count, active URL                                                                                                    |
| `ux-audit`                          | Heuristic UX/accessibility audit                                                                                                          |

### Batch

`batch` runs up to 50 of the above sequentially in one request. Each entry is `{ tool, input }` — same shape as a top-level POST. Nested `batch` is rejected. Per-entry errors surface as `[N] toolName ERROR: ...` lines in combined output; the overall request still resolves successfully so agents can inspect partial progress.

---

## Architecture

```
Agent (Claude / Codex / Gemini, out-of-process)
   │  HTTP POST /api/browser  + Bearer token + ?projectId=&threadId=
   ▼
apps/server/src/browser/http.ts            (T3-authored — REST handler + dispatch)
   │  { tool, input } → buildCommandHandlers(ctx)
   ▼
apps/server/src/browser/handlers.ts        (T3-authored — table-driven SPECS)
   │  argsFromInput(input) → string[]
   │  category: read | write | snapshot | meta
   ▼
apps/server/src/browser/Layers/BrowserManager.ts  (T3-authored — Effect layer)
   │  acquire(projectId) → BrowserInstance { inner: <vendored BM> }
   │  Lazy launchPersistentContext(<dataDir>/browser/<projectId>/chromium-profile/)
   │  Idle eviction (30min) + graceful shutdown
   ▼
apps/server/src/browser/core/             (vendored gstack — byte-identical)
   │  handleReadCommand / handleWriteCommand / handleSnapshot / handleMetaCommand
   ▼
Playwright Chromium (per-project persistent context)
```

### Key design decisions

- **Vendored code is byte-identical to upstream.** The `core/**` directory is excluded from T3's typecheck (DOM globals + `exactOptionalPropertyTypes` + strict null make gstack fail T3's compiler settings). `handlers.ts` bridges with dynamic `import("./core/...ts")` calls at runtime and declares minimal local interfaces for the vendored types it touches.
- **Composition, not modification.** Per-project Chromium profiles, T3-scoped data directories, and the REST surface live in T3-authored files outside `core/`. Never edit vendored files — pull-up cost would be paid on every gstack refresh.
- **Plaintext output.** Every command returns plaintext, not structured JSON. Agents read output directly; the envelope is only for transport. This saves ~2k tokens per command vs typical JSON-framed MCP tool output.
- **Bun production runtime.** The vendored `cookie-import-browser.ts` imports `bun:sqlite` at module load time. Rather than shim that, T3 runs `apps/server` under Bun in production (T3 already depends on `@effect/sql-sqlite-bun`). Tracked at [T3CO-328](t3://ticket/T3CO-328) for the `package.json` `start` script flip.

### Per-project profiles

Profile directory layout (production — `~/.t3/userdata/browser/<projectId>/chromium-profile/`):

```
Cookies                      Cache                       GPUCache
Cookies-journal              Code Cache                  Local Storage
PersistentOriginTrials       DIPS                        ...
```

The BrowserManager layer lazy-launches a persistent context on the first `acquire(projectId)` call and holds it in a `Map<ProjectId, BrowserContext>`. Contexts are closed (not deleted on disk) after 30 minutes of idle time, and a fresh launch restores all persistent auth state from the profile dir. A project's Chromium crash evicts only that project's context — other projects keep running.

Dev server: paths resolve under `~/.t3/dev/browser/<projectId>/...` when `ServerConfig.devUrl` is set (Electron dev mode), otherwise `~/.t3/userdata/browser/<projectId>/...`.

---

## Known issues

- **`useragent`** — calls the vendored `recreateContext()`, which assumes `this.browser !== null`. Under `launchPersistentContext` there is no separate Browser object, so the call crashes and resets the active tab to `about:blank`. Tracked at [T3CO-331](t3://ticket/T3CO-331). Avoid until fixed; the other 55 commands are unaffected.

---

## Related tickets

- [T3CO-318](t3://ticket/T3CO-318) — parent epic
- [T3CO-319](t3://ticket/T3CO-319) — vendor GStack browser code
- [T3CO-320](t3://ticket/T3CO-320) — Playwright lifecycle layer
- [T3CO-321](t3://ticket/T3CO-321) — REST endpoint scaffolding
- [T3CO-322](t3://ticket/T3CO-322) — walking-skeleton commands
- [T3CO-323](t3://ticket/T3CO-323) — full command port
- [T3CO-324](t3://ticket/T3CO-324) — browser admin prompt
- [T3CO-325](t3://ticket/T3CO-325) — integration tests
- [T3CO-328](t3://ticket/T3CO-328) — Bun production runtime switch (deferred)
- [T3CO-329](t3://ticket/T3CO-329) — Chromium auto-install (deferred)
- [T3CO-330](t3://ticket/T3CO-330) — headed/headless UX (deferred)
- [T3CO-331](t3://ticket/T3CO-331) — fix `useragent` under persistent context (deferred)
- [T3CO-333](t3://ticket/T3CO-333) — port pure-logic vendored tests (deferred)

---

## Debugging

| Symptom                                            | Check                                                                                                                                                                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Executable doesn't exist at .../chromium/chrome`  | Run `playwright install chromium` once per machine. Tracked for auto-install at [T3CO-329](t3://ticket/T3CO-329).                                                                                              |
| `Context recreation failed: null is not an object` | `useragent` crash — see known issues above.                                                                                                                                                                    |
| Cookies missing after restart                      | Verify profile dir exists at `<dataDir>/browser/<projectId>/chromium-profile/Default/Cookies`. Session cookies (no `max-age`) don't persist; that's per-spec.                                                  |
| `Ref @e3 not found`                                | Snapshot is stale. Re-call `snapshot` after any navigation.                                                                                                                                                    |
| Agent doesn't know the endpoint exists             | Settings → Prompts → Browser — confirm the admin prompt is enabled (it's a shipped default). Also check the `## T3 Browser Automation` block is present in the rendered system prompt for the failing session. |
