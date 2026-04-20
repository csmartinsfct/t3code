import {
  ADMIN_PROMPT_IDS,
  ADMIN_PROMPT_SHIPPED_DEFAULTS,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import { buildT3ServiceInjectionPrompt } from "../provider/sessionContextPrompt.ts";
import { buildCommandHandlers, toolDefinitions } from "./handlers.ts";
import type { BrowserHost, BrowserHostCommand } from "./BrowserHost.ts";
import type { BrowserHostResolverShape } from "./BrowserHostResolver.ts";

const TEST_PROJECT = ProjectId.makeUnsafe("00000000-0000-0000-0000-000000000001");
const TEST_THREAD = ThreadId.makeUnsafe("t3co-325-test");

// ---------------------------------------------------------------------------
// Admin prompt wiring
// ---------------------------------------------------------------------------

it.effect("ADMIN_PROMPT_IDS includes browser alongside the other admin prompts", () =>
  Effect.sync(() => {
    assert.include(ADMIN_PROMPT_IDS, "browser");
    // All five expected ids are present, in a deterministic order.
    assert.deepEqual([...ADMIN_PROMPT_IDS].sort(), [
      "browser",
      "general",
      "managedRuns",
      "scheduledTasks",
      "ticketing",
    ]);
  }),
);

it.effect("ADMIN_PROMPT_SHIPPED_DEFAULTS.browser has non-empty content", () =>
  Effect.sync(() => {
    const doc = ADMIN_PROMPT_SHIPPED_DEFAULTS.browser;
    assert.equal(doc.version, 1);
    assert.isAtLeast(doc.blocks.length, 1);
    const text = doc.blocks.map((b) => b.text).join("");
    assert.isAtLeast(text.length, 500, "browser prompt should be substantial");
    // Must mention the endpoint and the ref system so agents know where
    // to call and how to reference elements.
    assert.include(text, "/api/browser");
    assert.include(text, "@ref");
    assert.include(text, "snapshot");
  }),
);

it.effect(
  "buildT3ServiceInjectionPrompt renders the browser prompt in the system-prompt output",
  () =>
    Effect.sync(() => {
      const output = buildT3ServiceInjectionPrompt({
        port: 3773,
        isDev: true,
        projectTitle: "T3 Code",
        token: "test-token-xxx",
        adminPrompts: {
          general: ADMIN_PROMPT_SHIPPED_DEFAULTS.general,
          managedRuns: ADMIN_PROMPT_SHIPPED_DEFAULTS.managedRuns,
          scheduledTasks: ADMIN_PROMPT_SHIPPED_DEFAULTS.scheduledTasks,
          ticketing: ADMIN_PROMPT_SHIPPED_DEFAULTS.ticketing,
          browser: ADMIN_PROMPT_SHIPPED_DEFAULTS.browser,
        },
      });
      // Header for the new admin prompt block
      assert.include(output, "## T3 Browser Automation");
      // Available-services table row
      assert.include(output, "| Browser |");
      assert.include(output, "http://127.0.0.1:3773/api/browser");
    }),
);

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

it.effect("toolDefinitions exposes the expected walking-skeleton tools plus batch", () =>
  Effect.sync(() => {
    const names = new Set(toolDefinitions.map((t) => t.name));
    for (const required of [
      "goto",
      "click",
      "fill",
      "snapshot",
      "screenshot",
      "evaluate",
      "batch",
      // spot-check from the full port
      "back",
      "forward",
      "tabs",
      "newtab",
      "closetab",
      "html",
      "links",
      "cookies",
      "storage",
    ]) {
      assert.isTrue(names.has(required), `missing required tool: ${required}`);
    }
    // Every tool definition has a non-empty description.
    for (const def of toolDefinitions) {
      assert.isNotEmpty(def.description, `${def.name} missing description`);
    }
  }),
);

// ---------------------------------------------------------------------------
// Handler dispatch against a stubbed BrowserManagerService
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake BrowserManagerService that returns an instance whose
 * `inner` is a hand-rolled vendored-shape stub. We replace the dynamic
 * module loader in handlers.ts indirectly by NOT letting the test reach
 * `withVendored`'s `loadVendoredModules()` — input validation happens before
 * that point for the paths we assert on.
 */
const unreachableBrowserTool: BrowserHostCommand = async () => {
  throw new Error("stub browser host should not be reached");
};

function stubBrowserHost(): BrowserHost {
  return new Proxy(
    {
      kind: "playwright" as const,
      projectId: TEST_PROJECT,
      dispose: async () => {},
      runTool: unreachableBrowserTool,
    },
    {
      get(target, property, receiver) {
        if (property in target) return Reflect.get(target, property, receiver);
        return unreachableBrowserTool;
      },
    },
  ) as unknown as BrowserHost;
}

function stubBrowserResolver(): BrowserHostResolverShape {
  const host = stubBrowserHost();
  return {
    get: () => Effect.succeed(host),
    persistElectronHost: () => Effect.void,
    announceElectronHosts: () => Effect.void,
    beginRestartRecovery: () => Effect.void,
    completeRestartRecovery: () => Effect.void,
  };
}

it.effect("unknown tool names are not present in the handler map", () =>
  Effect.sync(() => {
    const handlers = buildCommandHandlers({
      resolver: stubBrowserResolver(),
      projectId: TEST_PROJECT,
      threadId: TEST_THREAD,
    });
    assert.isUndefined(handlers["this_tool_does_not_exist"]);
    // batch is always present.
    assert.isDefined(handlers.batch);
  }),
);

it.effect("goto handler rejects missing input.url with a clear error envelope", () =>
  Effect.gen(function* () {
    const handlers = buildCommandHandlers({
      resolver: stubBrowserResolver(),
      projectId: TEST_PROJECT,
      threadId: TEST_THREAD,
    });
    const response = yield* handlers.goto!({}).pipe(
      Effect.catch((err) =>
        Effect.succeed({
          failed: true,
          message: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
    // When input validation fails we fail the Effect with an InputError;
    // the HTTP layer wraps it into a 500. Here we just assert the error
    // message surfaced to the caller is useful.
    if ("failed" in response) {
      assert.include(response.message, "goto");
      assert.include(response.message, "url");
    } else {
      // If validation passed it would try to dynamic-import the vendored
      // modules and fail there — either path is acceptable for this test,
      // but we specifically want the validation error not the runtime one.
      assert.fail("goto should have rejected missing input.url before runtime");
    }
  }),
);

// The three batch validation paths (non-array, >50 entries, nested batch)
// all resolve to `Effect.succeed(respondError(...))` or `respondOk` with an
// error line in the combined output. Rather than poke at the
// HttpServerResponse body — which isn't designed for direct test access —
// we assert that each bad-input path resolves the Effect cleanly without
// throwing. End-to-end body content is covered by the curl smoke tests in
// T3CO-322 / T3CO-323.

it.effect("batch handler resolves cleanly when input.commands is not an array", () =>
  Effect.gen(function* () {
    const handlers = buildCommandHandlers({
      resolver: stubBrowserResolver(),
      projectId: TEST_PROJECT,
      threadId: TEST_THREAD,
    });
    const response = yield* handlers.batch!({ commands: "not-an-array" });
    assert.isDefined(response);
  }),
);

it.effect("batch handler resolves cleanly when commands exceeds the 50-entry cap", () =>
  Effect.gen(function* () {
    const handlers = buildCommandHandlers({
      resolver: stubBrowserResolver(),
      projectId: TEST_PROJECT,
      threadId: TEST_THREAD,
    });
    const response = yield* handlers.batch!({
      commands: new Array(51).fill({ tool: "goto", input: { url: "https://example.com" } }),
    });
    assert.isDefined(response);
  }),
);

// Regression: tools whose slot on BrowserHost is a class method that shadows
// the `installBrowserHostCommands` delegator must still be invoked with
// `this` bound to the host. Dispatching `method(args, input)` (bare call)
// loses `this`, so class-methods like ElectronWebContentsBrowserHost.snapshot /
// .evaluate / .goto referenced `undefined.cdpHost` / `undefined.send` /
// `undefined.waitForLoadEvent` in production. Fixed by `method.call(host, ...)`
// in runCommand.
it.effect("handlers preserve `this` when dispatching class-method-shadowed tools", () =>
  Effect.gen(function* () {
    class ShadowHost {
      readonly kind = "electron-wc" as const;
      readonly projectId = TEST_PROJECT;
      readonly secret = "bound-correctly";
      dispose = async (): Promise<void> => {};
      runTool: BrowserHostCommand = async () => "unreachable via runTool";
      // Mirror the shadowing pattern on ElectronWebContentsBrowserHost:
      // an own class method with a BROWSER_HOST_TOOL_NAMES slot name that
      // references `this`.
      async html(): Promise<string> {
        return this.secret;
      }
    }
    const host = new ShadowHost() as unknown as BrowserHost;
    const handlers = buildCommandHandlers({
      resolver: {
        get: () => Effect.succeed(host),
        persistElectronHost: () => Effect.void,
        announceElectronHosts: () => Effect.void,
        beginRestartRecovery: () => Effect.void,
        completeRestartRecovery: () => Effect.void,
      },
      projectId: TEST_PROJECT,
      threadId: TEST_THREAD,
    });
    const result = yield* handlers.html!({}).pipe(
      Effect.catch((err) =>
        Effect.succeed({
          failed: true,
          message: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
    if ("failed" in result) {
      assert.fail(`html dispatch lost \`this\` binding: ${result.message}`);
    } else {
      assert.isDefined(result);
    }
  }),
);
