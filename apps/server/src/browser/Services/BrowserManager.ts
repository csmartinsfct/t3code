import { ProjectId } from "@t3tools/contracts";
import { Data, Effect, ServiceMap } from "effect";

/**
 * Opaque handle to a vendored GStack `BrowserManager` instance, keyed by
 * T3 project. The vendored class lives under `apps/server/src/browser/core/`
 * and is intentionally excluded from typecheck (see NOTICE). Consumers that
 * need to dispatch commands against the underlying Playwright surface cast
 * `inner` to the vendored type inside their own module — this is the one
 * place where the opaque escape hatch is used.
 */
export interface BrowserInstance {
  readonly _kind: "T3BrowserInstance";
  readonly projectId: ProjectId;
  readonly userDataDir: string;
  /**
   * The vendored `BrowserManager` instance. Typed as `unknown` so that
   * callers must consciously opt in to touching the vendored API. The
   * only authorized caller is `apps/server/src/browser/http.ts` (T3CO-321)
   * which dispatches `handleReadCommand` / `handleWriteCommand` / etc.
   */
  readonly inner: unknown;
}

export class BrowserLaunchError extends Data.TaggedError("BrowserLaunchError")<{
  readonly projectId: ProjectId;
  readonly cause: unknown;
}> {}

/**
 * Launch-time overrides applied when (re)creating a Chromium context. All
 * fields are optional; `undefined` means 'use the layer default'. Overrides
 * persist for the lifetime of the context and are cleared when the entry
 * is released (next `acquire` starts from defaults).
 *
 * Currently two axes:
 * - `userAgent` — custom UA string. Used by the `useragent` T3 tool
 *   (T3CO-331); the vendored `useragent` command crashes under
 *   `launchPersistentContext` because its `recreateContext` assumes a
 *   non-null Browser object, so we handle the flip here instead.
 * - `headless` — launch mode. Used by the `visibility` T3 tool (T3CO-330).
 *   Default is `true`; passing `false` re-launches with the window visible.
 */
export interface BrowserLaunchOverrides {
  /**
   * Custom User-Agent string. Pass `null` to explicitly reset to Playwright's
   * default (the merge semantics in `recreate` need a sentinel for 'clear'
   * that is distinct from 'don't change', which is what `undefined` means).
   */
  readonly userAgent?: string | null;
  readonly headless?: boolean;
}

export interface BrowserManagerServiceShape {
  readonly acquire: (projectId: ProjectId) => Effect.Effect<BrowserInstance, BrowserLaunchError>;
  /**
   * Close the existing context for `projectId` (if any) and re-launch with
   * the given overrides merged over current overrides. Cookies, localStorage
   * and other profile state persist across the recreate because the profile
   * directory is the same. Returns the new BrowserInstance.
   */
  readonly recreate: (
    projectId: ProjectId,
    overrides: BrowserLaunchOverrides,
  ) => Effect.Effect<BrowserInstance, BrowserLaunchError>;
  readonly release: (projectId: ProjectId) => Effect.Effect<void, never>;
  readonly releaseAll: () => Effect.Effect<void, never>;
}

export class BrowserManagerService extends ServiceMap.Service<
  BrowserManagerService,
  BrowserManagerServiceShape
>()("t3/browser/Services/BrowserManager/BrowserManagerService") {}
