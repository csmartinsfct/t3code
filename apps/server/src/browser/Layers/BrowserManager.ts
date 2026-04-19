import * as nodePath from "node:path";

import { ProjectId } from "@t3tools/contracts";
import { Effect, Layer, Ref, Schedule } from "effect";

import { ServerConfig } from "../../config.ts";
import {
  BrowserInstance,
  BrowserLaunchError,
  type BrowserLaunchOverrides,
  BrowserManagerService,
  BrowserManagerServiceShape,
} from "../Services/BrowserManager.ts";

/**
 * BrowserManagerServiceLive — in-process Playwright lifecycle keyed by T3
 * project. Each project gets its own Chromium persistent context at
 * `<stateDir>/browser/<projectId>/chromium-profile/`, so cookies and auth
 * state are scoped per project and never bleed across.
 *
 * The vendored GStack `BrowserManager` class provides the ref/tab/command
 * plumbing. This layer instantiates one per project, injects a T3-managed
 * `BrowserContext` into its private field, and exposes the instance as an
 * opaque `BrowserInstance.inner` handle. The REST dispatch layer (T3CO-321)
 * will cast that handle to the vendored type and route command calls.
 *
 * Eviction: contexts go idle after {@link IDLE_TIMEOUT_MS} and are closed
 * in a background sweeper. Closing a context does NOT delete the profile
 * directory — persistent auth is the whole point of per-project scope.
 *
 * Shutdown: on layer teardown, every live context is closed cleanly.
 */

const IDLE_TIMEOUT_MS = 30 * 60 * 1_000;
const IDLE_SWEEP_INTERVAL_MS = 60 * 1_000;

interface ContextEntry {
  readonly instance: BrowserInstance;
  /**
   * Best-effort close handle for the vendored BM. Calls `bm.close()` which
   * closes the Chromium context + browser. Never rejects — errors are
   * logged and swallowed because shutdown paths must not fail.
   */
  readonly close: () => Promise<void>;
  /**
   * Overrides this context was launched with. Preserved so `recreate` can
   * merge partial updates (e.g. flip `headless` without losing `userAgent`).
   */
  readonly overrides: BrowserLaunchOverrides;
  lastUsedAtMs: number;
}

function browserDataDir(stateDir: string, projectId: ProjectId): string {
  return nodePath.join(stateDir, "browser", projectId, "chromium-profile");
}

/**
 * Verify that Playwright's Chromium binary is on disk at server startup.
 *
 * Packaged desktop builds ship Chromium via electron-builder's
 * `extraResources` and the Electron main process sets
 * `PLAYWRIGHT_BROWSERS_PATH` to point Playwright at the bundled copy (see
 * `scripts/build-desktop-artifact.ts` and `apps/desktop/src/main.ts`). Dev
 * builds rely on the developer having run `bunx playwright install chromium`.
 *
 * Runtime install is not a supported path: `playwright/cli.js` is
 * unresolvable from inside `app.asar.unpacked` under Bun, and a lazy 200 MB
 * download is a hostile first-use UX besides. If Chromium is missing we log
 * a clear, actionable error at startup instead of letting `launchPersistentContext`
 * fail opaquely deep inside a later agent turn.
 */
const assertChromiumAvailable = Effect.promise(async () => {
  const { chromium } = await import("playwright");
  const execPath = chromium.executablePath();
  const { existsSync } = await import("node:fs");
  if (execPath && existsSync(execPath)) {
    console.log("[t3/browser] Chromium available at", execPath);
    return;
  }
  const envHint = process.env.PLAYWRIGHT_BROWSERS_PATH
    ? ` PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH}`
    : "";
  console.error(
    `[t3/browser] Chromium binary not found at ${execPath || "(unknown)"}.${envHint}`,
    "Browser tools will fail until Chromium is installed.",
    "Dev: run `bunx playwright install chromium`.",
    "Packaged app: reinstall — the Chromium bundle should be shipped in Resources/playwright-browsers.",
  );
});

export const BrowserManagerServiceLive = Layer.effect(
  BrowserManagerService,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const entries = yield* Ref.make(new Map<ProjectId, ContextEntry>());

    const launchContext = (projectId: ProjectId, overrides: BrowserLaunchOverrides) =>
      Effect.tryPromise({
        try: async (): Promise<ContextEntry> => {
          // Dynamic import keeps core/** out of the typecheck graph while
          // still loading the module at runtime. core/ is excluded from
          // tsconfig because the vendored code does not satisfy T3's strict
          // compiler settings; see apps/server/src/browser/NOTICE.
          const playwright = await import("playwright");
          const coreModule = (await import("../core/browser-manager.ts" as string)) as {
            BrowserManager: new () => unknown;
          };

          const userDataDir = browserDataDir(config.stateDir, projectId);
          const ctx = await playwright.chromium.launchPersistentContext(userDataDir, {
            viewport: { width: 1280, height: 720 },
            // Match vendored BrowserManager.launch() behavior: disable the
            // Chromium sandbox on Windows because sandboxing breaks when the
            // server is spawned through Node (upstream GH #276). Leaving
            // defaults on macOS/Linux.
            chromiumSandbox: process.platform !== "win32",
            // Headless by default. Override flips the mode for agent
            // "visibility" calls (T3CO-330) without touching user-facing UI.
            headless: overrides.headless ?? true,
            // Custom user-agent (T3CO-331). `null` / `undefined` both fall
            // back to Playwright's default UA; only a non-empty string
            // overrides.
            ...(typeof overrides.userAgent === "string" && overrides.userAgent.length > 0
              ? { userAgent: overrides.userAgent }
              : {}),
          });

          const bm = new coreModule.BrowserManager() as Record<string, unknown>;
          // Inject the T3-owned context into the vendored BM. The vendored
          // fields are `private` in TypeScript, which is a compile-time-only
          // check; bracket-notation assignment is the documented escape hatch
          // and keeps core/** byte-identical to upstream. See NOTICE.
          bm.context = ctx;
          bm.browser = ctx.browser();

          // Replace the vendored crash handler (which calls process.exit(1))
          // with a T3-friendly one that only evicts this project's context.
          // A single project's Chromium crash must NOT take down the whole
          // server — other projects may have active sessions.
          const browser = ctx.browser();
          if (browser) {
            browser.on("disconnected", () => {
              void Effect.runPromise(releaseInternal(projectId));
            });
          }

          // Vendored BrowserManager.launch() also creates the first tab.
          // We replicate that here so the returned instance is immediately
          // usable without callers having to know about the initialization
          // contract.
          const newTab = bm.newTab as (url?: string) => Promise<number>;
          await newTab.call(bm);

          const instance: BrowserInstance = {
            _kind: "T3BrowserInstance",
            projectId,
            userDataDir,
            inner: bm,
          };

          return {
            instance,
            close: async () => {
              try {
                const closeFn = bm.close as () => Promise<void>;
                await closeFn.call(bm);
              } catch (err) {
                console.error(`[t3/browser] close failed for project ${projectId}:`, err);
              }
            },
            overrides,
            lastUsedAtMs: Date.now(),
          };
        },
        catch: (cause) => new BrowserLaunchError({ projectId, cause }),
      });

    const releaseInternal = (projectId: ProjectId) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(entries);
        const entry = current.get(projectId);
        if (!entry) return;
        yield* Ref.update(entries, (m) => {
          const next = new Map(m);
          next.delete(projectId);
          return next;
        });
        yield* Effect.promise(() => entry.close());
      });

    const acquire: BrowserManagerServiceShape["acquire"] = (projectId) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(entries);
        const existing = current.get(projectId);
        if (existing) {
          existing.lastUsedAtMs = Date.now();
          return existing.instance;
        }
        const entry = yield* launchContext(projectId, {});
        yield* Ref.update(entries, (m) => {
          const next = new Map(m);
          next.set(projectId, entry);
          return next;
        });
        return entry.instance;
      });

    const recreate: BrowserManagerServiceShape["recreate"] = (projectId, overrides) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(entries);
        const existing = current.get(projectId);
        // Merge partial overrides over current, so (e.g.) flipping headless
        // doesn't reset a previously-set userAgent.
        const merged: BrowserLaunchOverrides = {
          ...(existing?.overrides ?? {}),
          ...overrides,
        };
        if (existing) {
          yield* Ref.update(entries, (m) => {
            const next = new Map(m);
            next.delete(projectId);
            return next;
          });
          yield* Effect.promise(() => existing.close());
        }
        const entry = yield* launchContext(projectId, merged);
        yield* Ref.update(entries, (m) => {
          const next = new Map(m);
          next.set(projectId, entry);
          return next;
        });
        return entry.instance;
      });

    const releaseAll = () =>
      Effect.gen(function* () {
        const current = yield* Ref.get(entries);
        yield* Ref.set(entries, new Map());
        yield* Effect.forEach(
          Array.from(current.values()),
          (entry) => Effect.promise(() => entry.close()),
          { concurrency: "unbounded", discard: true },
        );
      });

    // Idle eviction sweeper — closes contexts that have not been touched
    // for IDLE_TIMEOUT_MS. Mirrors GStack's BROWSE_IDLE_TIMEOUT semantics.
    const sweep = Effect.gen(function* () {
      const now = Date.now();
      const current = yield* Ref.get(entries);
      const stale: ProjectId[] = [];
      for (const [projectId, entry] of current) {
        if (now - entry.lastUsedAtMs > IDLE_TIMEOUT_MS) {
          stale.push(projectId);
        }
      }
      yield* Effect.forEach(stale, (projectId) => releaseInternal(projectId), {
        discard: true,
      });
    });

    yield* sweep.pipe(
      Effect.ignoreCause({ log: true }),
      Effect.repeat(Schedule.spaced(`${IDLE_SWEEP_INTERVAL_MS} millis`)),
      Effect.forkScoped,
    );

    // Verify Chromium is on disk at startup. The check logs a clear
    // diagnostic rather than throwing — we don't want a missing browser to
    // prevent the rest of the server from booting, only to make sure the
    // failure mode is obvious the next time an agent reaches for the tool.
    yield* assertChromiumAvailable.pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);

    yield* Effect.addFinalizer(() => releaseAll());

    return {
      acquire,
      recreate,
      release: releaseInternal,
      releaseAll,
    } satisfies BrowserManagerServiceShape;
  }),
);
