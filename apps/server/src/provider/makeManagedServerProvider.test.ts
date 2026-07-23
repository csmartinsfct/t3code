import { assert, it } from "@effect/vitest";
import type { ServerProvider } from "@t3tools/contracts";
import { Effect, Ref, Stream } from "effect";

import { makeManagedServerProvider } from "./makeManagedServerProvider";

const readyProvider: ServerProvider = {
  provider: "codex",
  status: "ready",
  enabled: true,
  installed: true,
  auth: { status: "authenticated" },
  checkedAt: "2026-07-23T00:00:00.000Z",
  version: "1.0.0",
  models: [],
};

it.effect(
  "checks provider status only when initialized, settings change, or refresh is requested",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settings = yield* Ref.make({ binaryPath: "codex" });
        const checkCount = yield* Ref.make(0);
        const provider = yield* makeManagedServerProvider({
          getSettings: Ref.get(settings),
          streamSettings: Stream.never,
          haveSettingsChanged: (previous, next) => previous.binaryPath !== next.binaryPath,
          checkProvider: Ref.updateAndGet(checkCount, (count) => count + 1).pipe(
            Effect.as(readyProvider),
          ),
        });

        assert.strictEqual(yield* Ref.get(checkCount), 1);

        yield* provider.getSnapshot;
        assert.strictEqual(yield* Ref.get(checkCount), 1);

        yield* Ref.set(settings, { binaryPath: "/custom/codex" });
        yield* provider.getSnapshot;
        assert.strictEqual(yield* Ref.get(checkCount), 2);

        yield* provider.refresh;
        assert.strictEqual(yield* Ref.get(checkCount), 3);
      }),
    ),
);
