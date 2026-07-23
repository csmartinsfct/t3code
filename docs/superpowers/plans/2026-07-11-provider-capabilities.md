# Provider Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-native plugin and skill capabilities to the existing composer Skills and `@` picker surfaces, shipping Codex support first without adding toolbar footprint.

**Architecture:** Introduce a provider-neutral capability contract and RPC, backed first by a Codex app-server discovery helper. Normalize local skills and provider capabilities into shared composer command rows, persist selected provider capabilities as next-turn-scoped draft chips, and pass selections through orchestration/provider send inputs. Codex activation wiring is gated behind a protocol probe that confirms the exact app-server payload before T3 emits it.

**Tech Stack:** TypeScript, Effect Schema contracts, Zustand draft persistence, React/Lexical composer nodes, TanStack Query-backed workspace search, Codex `app-server` JSON-RPC over stdio, Vitest browser/unit tests.

## Global Constraints

- Do not add a new composer toolbar button.
- Keep existing file mentions working.
- Keep existing local skill attachments working.
- Do not fake provider plugins by pasting raw `@plugin` text into the prompt.
- First implementation scope is Codex plugins and Codex plugin skills.
- Provider capability selections are next-turn scoped and clear with the sent draft.
- Existing MCP UI remains separate in this implementation.
- Run `bun fmt`, `bun lint`, and `bun typecheck` before considering the task complete.
- Do not run `bun test`; use `bun run test` for Vitest.

---

## File Structure

- `packages/contracts/src/providerCapabilities.ts`: new schema/types for provider capability discovery and selected draft capabilities.
- `packages/contracts/src/index.ts`: export the new contract module.
- `packages/contracts/src/server.ts`: add `ResolveProviderCapabilitiesInput` and `ResolveProviderCapabilitiesResult`.
- `packages/contracts/src/ipc.ts`: add provider capability RPC and extend `OverlayComposerCommandItem`.
- `packages/contracts/src/rpc.ts`: add `server.resolveProviderCapabilities`.
- `packages/contracts/src/provider.ts`: add selected provider capabilities to `ProviderSendTurnInput`.
- `packages/contracts/src/orchestration.ts`: add selected provider capabilities to `thread.turn.start`.
- `apps/server/src/provider/capabilities/codexCapabilities.ts`: new Codex discovery/probe helpers and normalization.
- `apps/server/src/provider/capabilities/index.ts`: provider dispatcher for capability discovery.
- `apps/server/src/ws.ts`: expose `resolveProviderCapabilities`.
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`: forward selected provider capabilities to `providerService.sendTurn`.
- `apps/server/src/provider/Layers/CodexAdapter.ts`: forward selected provider capabilities to `CodexAppServerManager`.
- `apps/server/src/codexAppServerManager.ts`: accept selected capabilities and, after the protocol probe task, emit the confirmed Codex payload.
- `apps/web/src/hooks/useProviderCapabilities.ts`: poll provider capabilities for the active provider/cwd.
- `apps/web/src/composerDraftStore.ts`: persist next-turn capability selections.
- `apps/web/src/composer-editor-mentions.ts`: represent provider capability segments when rehydrating prompt/chips.
- `apps/web/src/components/ComposerPromptEditor.tsx`: render provider capability chips.
- `apps/web/src/components/chat/ComposerCapabilityChips.tsx`: chip strip for selected provider capabilities.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx`: render provider plugin/skill rows.
- `apps/web/src/components/chat/SkillsPicker.tsx`: render local skills plus provider capability sections.
- `apps/web/src/components/ChatView.tsx`: combine capabilities into menu rows, select rows, persist chips, and send selected capabilities.
- `docs/superpowers/specs/2026-07-11-provider-capabilities-design.md`: update if implementation decisions materially change.
- `docs/features.md`: document the capability picker after implementation.
- `docs/codex-plugin-skills.md`: document Codex plugin discovery and activation limitations.

---

### Task 1: Add Provider Capability Contracts

**Files:**

- Create: `packages/contracts/src/providerCapabilities.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/server.ts`
- Modify: `packages/contracts/src/ipc.ts`
- Modify: `packages/contracts/src/rpc.ts`
- Modify: `packages/contracts/src/provider.ts`
- Modify: `packages/contracts/src/orchestration.ts`
- Test: `packages/contracts/src/providerCapabilities.test.ts`

**Interfaces:**

- Produces: `ProviderCapabilityEntry`, `SelectedProviderCapability`, `ResolveProviderCapabilitiesInput`, `ResolveProviderCapabilitiesResult`.
- Consumes: existing `ProviderKind`, `ThreadTurnStartCommand`, `ProviderSendTurnInput`, and `OverlayComposerCommandItem`.

- [ ] **Step 1: Write contract tests**

Create `packages/contracts/src/providerCapabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import {
  ProviderCapabilityEntry,
  ResolveProviderCapabilitiesResult,
  SelectedProviderCapability,
} from "./providerCapabilities";

describe("provider capability contracts", () => {
  it("decodes an installed provider plugin", () => {
    const decoded = Schema.decodeUnknownSync(ProviderCapabilityEntry)({
      id: "superpowers@openai-curated-remote",
      provider: "codex",
      kind: "plugin",
      name: "superpowers",
      displayName: "Superpowers",
      description: "Planning, TDD, debugging, and delivery workflows for coding agents",
      enabled: true,
      installed: true,
      source: "openai-curated-remote",
    });

    expect(decoded.kind).toBe("plugin");
    expect(decoded.displayName).toBe("Superpowers");
  });

  it("decodes a provider skill with parent plugin metadata", () => {
    const decoded = Schema.decodeUnknownSync(ProviderCapabilityEntry)({
      id: "superpowers:brainstorming",
      provider: "codex",
      kind: "skill",
      name: "superpowers:brainstorming",
      displayName: "Brainstorming",
      parentId: "superpowers@openai-curated-remote",
      parentDisplayName: "Superpowers",
      enabled: true,
      installed: true,
    });

    expect(decoded.parentDisplayName).toBe("Superpowers");
  });

  it("decodes next-turn selected provider capabilities", () => {
    const decoded = Schema.decodeUnknownSync(SelectedProviderCapability)({
      provider: "codex",
      kind: "skill",
      id: "superpowers:using-superpowers",
      displayName: "Using Superpowers",
      parentId: "superpowers@openai-curated-remote",
      parentDisplayName: "Superpowers",
    });

    expect(decoded.id).toBe("superpowers:using-superpowers");
  });

  it("decodes capability resolution results", () => {
    const decoded = Schema.decodeUnknownSync(ResolveProviderCapabilitiesResult)({
      capabilities: [
        {
          id: "superpowers@openai-curated-remote",
          provider: "codex",
          kind: "plugin",
          name: "superpowers",
          displayName: "Superpowers",
          enabled: true,
          installed: true,
        },
      ],
    });

    expect(decoded.capabilities).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the failing contract test**

Run: `bun run test packages/contracts/src/providerCapabilities.test.ts`

Expected: FAIL because `providerCapabilities.ts` does not exist.

- [ ] **Step 3: Add provider capability schemas**

Create `packages/contracts/src/providerCapabilities.ts`:

```ts
import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const ProviderCapabilityKind = Schema.Literals([
  "plugin",
  "skill",
  "agent",
  "mcp-server",
  "hook",
  "tool",
]);
export type ProviderCapabilityKind = typeof ProviderCapabilityKind.Type;

export const ProviderCapabilityEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  provider: ProviderKind,
  kind: ProviderCapabilityKind,
  name: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  parentId: Schema.optional(TrimmedNonEmptyString),
  parentDisplayName: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  installed: Schema.optional(Schema.Boolean),
  needsAuth: Schema.optional(Schema.Boolean),
  iconPath: Schema.optional(Schema.String),
  iconUrl: Schema.optional(Schema.String),
});
export type ProviderCapabilityEntry = typeof ProviderCapabilityEntry.Type;

export const SelectedProviderCapability = Schema.Struct({
  provider: ProviderKind,
  kind: ProviderCapabilityKind,
  id: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  parentId: Schema.optional(TrimmedNonEmptyString),
  parentDisplayName: Schema.optional(TrimmedNonEmptyString),
});
export type SelectedProviderCapability = typeof SelectedProviderCapability.Type;

export const ResolveProviderCapabilitiesInput = Schema.Struct({
  provider: ProviderKind,
  cwd: TrimmedNonEmptyString,
});
export type ResolveProviderCapabilitiesInput = typeof ResolveProviderCapabilitiesInput.Type;

export const ResolveProviderCapabilitiesResult = Schema.Struct({
  capabilities: Schema.Array(ProviderCapabilityEntry),
});
export type ResolveProviderCapabilitiesResult = typeof ResolveProviderCapabilitiesResult.Type;
```

Update `packages/contracts/src/index.ts` to export the module:

```ts
export * from "./providerCapabilities";
```

- [ ] **Step 4: Thread schemas through server/RPC/provider contracts**

Modify `packages/contracts/src/server.ts`:

```ts
import {
  ProviderCapabilityEntry,
  ResolveProviderCapabilitiesInput,
  ResolveProviderCapabilitiesResult,
} from "./providerCapabilities";
```

Add near the skills resolution section:

```ts
export {
  ProviderCapabilityEntry,
  ResolveProviderCapabilitiesInput,
  ResolveProviderCapabilitiesResult,
};

export class ResolveProviderCapabilitiesError extends Schema.TaggedErrorClass<ResolveProviderCapabilitiesError>()(
  "ResolveProviderCapabilitiesError",
  { message: TrimmedNonEmptyString },
) {}
```

Modify `packages/contracts/src/rpc.ts`:

```ts
serverResolveProviderCapabilities: "server.resolveProviderCapabilities",
```

Modify `packages/contracts/src/ipc.ts`:

```ts
import type {
  ProviderCapabilityEntry,
  ResolveProviderCapabilitiesInput,
  ResolveProviderCapabilitiesResult,
  SelectedProviderCapability,
} from "./providerCapabilities";
```

Add provider capability rows to `OverlayComposerCommandItem`:

```ts
  | {
      id: string;
      type: "provider-capability";
      capability: ProviderCapabilityEntry;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "local-skill";
      skillId: string;
      label: string;
      description: string;
    }
```

Add to the `server` IPC shape:

```ts
resolveProviderCapabilities: (input: ResolveProviderCapabilitiesInput) =>
  Promise<ResolveProviderCapabilitiesResult>;
```

Modify `packages/contracts/src/provider.ts`:

```ts
import { SelectedProviderCapability } from "./providerCapabilities";
```

Add to `ProviderSendTurnInput`:

```ts
providerCapabilities: Schema.optional(Schema.Array(SelectedProviderCapability)),
```

Modify `packages/contracts/src/orchestration.ts`:

```ts
import { SelectedProviderCapability } from "./providerCapabilities";
```

Add `providerCapabilities` to both `ThreadTurnStartCommand` and
`ClientThreadTurnStartCommand`:

```ts
providerCapabilities: Schema.optional(Schema.Array(SelectedProviderCapability)),
```

Add it to `ThreadTurnStartRequestedPayload` if the event needs replay/projection visibility:

```ts
providerCapabilities: Schema.optional(Schema.Array(SelectedProviderCapability)),
```

- [ ] **Step 5: Run contract tests**

Run: `bun run test packages/contracts/src/providerCapabilities.test.ts packages/contracts/src/provider.test.ts`

Expected: PASS.

---

### Task 2: Add Codex Provider Capability Discovery

**Files:**

- Create: `apps/server/src/provider/capabilities/codexCapabilities.ts`
- Create: `apps/server/src/provider/capabilities/index.ts`
- Modify: `apps/server/src/ws.ts`
- Modify: `apps/web/src/wsRpcClient.ts`
- Modify: `apps/web/src/wsNativeApi.ts`
- Test: `apps/server/src/provider/capabilities/codexCapabilities.test.ts`
- Test: `apps/web/src/wsNativeApi.test.ts`

**Interfaces:**

- Consumes: `ResolveProviderCapabilitiesInput`.
- Produces: `resolveProviderCapabilities(input): Effect<ResolveProviderCapabilitiesResult, ...>`.

- [ ] **Step 1: Write Codex normalization tests**

Create `apps/server/src/provider/capabilities/codexCapabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  normalizeCodexCapabilities,
  type CodexPluginListResponse,
  type CodexSkillsListResponse,
} from "./codexCapabilities";

describe("normalizeCodexCapabilities", () => {
  it("normalizes installed plugins and plugin skills", () => {
    const plugins: CodexPluginListResponse = {
      marketplaces: [
        {
          name: "openai-curated-remote",
          plugins: [
            {
              id: "superpowers@openai-curated-remote",
              name: "superpowers",
              installed: true,
              enabled: true,
              source: { type: "remote" },
              interface: {
                displayName: "Superpowers",
                shortDescription:
                  "Planning, TDD, debugging, and delivery workflows for coding agents",
                composerIcon: null,
                composerIconUrl: null,
              },
            },
          ],
        },
      ],
    };
    const skills: CodexSkillsListResponse = {
      data: [
        {
          cwd: "/repo",
          skills: [
            {
              name: "superpowers:brainstorming",
              description: "Explore intent before implementation",
              path: "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/brainstorming/SKILL.md",
              scope: "user",
              enabled: true,
              interface: {
                displayName: "Brainstorming",
                shortDescription: "Explore intent",
              },
            },
          ],
        },
      ],
    };

    const result = normalizeCodexCapabilities({ provider: "codex", plugins, skills });

    expect(result.map((entry) => entry.id)).toEqual([
      "superpowers@openai-curated-remote",
      "superpowers:brainstorming",
    ]);
    expect(result[1]).toMatchObject({
      kind: "skill",
      parentDisplayName: "Superpowers",
      displayName: "Brainstorming",
    });
  });

  it("dedupes duplicate provider skills by parent and display name", () => {
    const plugins: CodexPluginListResponse = {
      marketplaces: [
        {
          name: "openai-curated-remote",
          plugins: [
            {
              id: "superpowers@openai-curated-remote",
              name: "superpowers",
              installed: true,
              enabled: true,
              source: { type: "remote" },
              interface: { displayName: "Superpowers", shortDescription: "Workflows" },
            },
          ],
        },
      ],
    };
    const skills: CodexSkillsListResponse = {
      data: [
        {
          cwd: "/repo",
          skills: [
            {
              name: "superpowers:brainstorming",
              description: "Old",
              path: "/Users/me/.codex/plugins/cache/openai-curated/superpowers/hash/skills/brainstorming/SKILL.md",
              scope: "user",
              enabled: true,
              interface: { displayName: "Brainstorming" },
            },
            {
              name: "superpowers:brainstorming",
              description: "Current",
              path: "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/brainstorming/SKILL.md",
              scope: "user",
              enabled: true,
              interface: { displayName: "Brainstorming" },
            },
          ],
        },
      ],
    };

    const result = normalizeCodexCapabilities({ provider: "codex", plugins, skills });
    const brainstorming = result.filter((entry) => entry.id === "superpowers:brainstorming");

    expect(brainstorming).toHaveLength(1);
    expect(brainstorming[0]?.description).toBe("Current");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `bun run test apps/server/src/provider/capabilities/codexCapabilities.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement Codex normalization and app-server probing**

Create `apps/server/src/provider/capabilities/codexCapabilities.ts` with:

```ts
import { spawn } from "node:child_process";
import readline from "node:readline";
import { Effect } from "effect";
import type {
  ProviderCapabilityEntry,
  ProviderKind,
  ResolveProviderCapabilitiesResult,
} from "@t3tools/contracts";
import { buildCodexInitializeParams, killCodexChildProcess } from "../codexAppServer";

export interface CodexPluginListResponse {
  marketplaces?: Array<{
    name?: string;
    plugins?: Array<{
      id?: string;
      name?: string;
      installed?: boolean;
      enabled?: boolean;
      source?: unknown;
      interface?: {
        displayName?: string | null;
        shortDescription?: string | null;
        composerIcon?: string | null;
        composerIconUrl?: string | null;
      } | null;
    }>;
  }>;
}

export interface CodexSkillsListResponse {
  data?: Array<{
    cwd?: string;
    skills?: Array<{
      name?: string;
      description?: string;
      path?: string;
      scope?: string;
      enabled?: boolean;
      interface?: {
        displayName?: string | null;
        shortDescription?: string | null;
        iconSmall?: string | null;
        iconLarge?: string | null;
      } | null;
    }>;
  }>;
}

function pluginPrefixFromSkillName(skillName: string): string | null {
  const colon = skillName.indexOf(":");
  return colon > 0 ? skillName.slice(0, colon) : null;
}

function marketplaceHintFromPath(pathValue: string | undefined): string | null {
  if (!pathValue) return null;
  if (pathValue.includes("/openai-curated-remote/")) return "openai-curated-remote";
  if (pathValue.includes("/openai-curated/")) return "openai-curated";
  if (pathValue.includes("/openai-bundled/")) return "openai-bundled";
  if (pathValue.includes("/openai-primary-runtime/")) return "openai-primary-runtime";
  return null;
}

export function normalizeCodexCapabilities(input: {
  provider: ProviderKind;
  plugins: CodexPluginListResponse;
  skills: CodexSkillsListResponse;
}): ProviderCapabilityEntry[] {
  const result: ProviderCapabilityEntry[] = [];
  const installedPluginsByName = new Map<
    string,
    { id: string; displayName: string; marketplace: string; source?: string }
  >();

  for (const marketplace of input.plugins.marketplaces ?? []) {
    const marketplaceName = marketplace.name ?? "unknown";
    for (const plugin of marketplace.plugins ?? []) {
      if (!plugin.id || !plugin.name || plugin.installed !== true || plugin.enabled !== true) {
        continue;
      }
      const displayName = plugin.interface?.displayName?.trim() || plugin.name;
      installedPluginsByName.set(plugin.name, {
        id: plugin.id,
        displayName,
        marketplace: marketplaceName,
        source: marketplaceName,
      });
      result.push({
        id: plugin.id,
        provider: input.provider,
        kind: "plugin",
        name: plugin.name,
        displayName,
        ...(plugin.interface?.shortDescription
          ? { description: plugin.interface.shortDescription }
          : {}),
        source: marketplaceName,
        enabled: true,
        installed: true,
        ...(plugin.interface?.composerIcon ? { iconPath: plugin.interface.composerIcon } : {}),
        ...(plugin.interface?.composerIconUrl ? { iconUrl: plugin.interface.composerIconUrl } : {}),
      });
    }
  }

  const dedupedSkills = new Map<string, ProviderCapabilityEntry>();
  for (const block of input.skills.data ?? []) {
    for (const skill of block.skills ?? []) {
      if (!skill.name || skill.enabled === false) continue;
      const pluginName = pluginPrefixFromSkillName(skill.name);
      if (!pluginName) continue;
      const parent = installedPluginsByName.get(pluginName);
      if (!parent) continue;
      const displayName = skill.interface?.displayName?.trim() || skill.name.split(":").at(-1)!;
      const marketplaceHint = marketplaceHintFromPath(skill.path);
      const entry: ProviderCapabilityEntry = {
        id: skill.name,
        provider: input.provider,
        kind: "skill",
        name: skill.name,
        displayName,
        ...(skill.interface?.shortDescription || skill.description
          ? { description: skill.interface?.shortDescription ?? skill.description }
          : {}),
        parentId: parent.id,
        parentDisplayName: parent.displayName,
        enabled: true,
        installed: true,
        ...(marketplaceHint ? { source: marketplaceHint } : {}),
        ...(skill.interface?.iconSmall ? { iconPath: skill.interface.iconSmall } : {}),
      };
      const key = `${entry.provider}\u0000${entry.parentDisplayName}\u0000${entry.displayName}`;
      const existing = dedupedSkills.get(key);
      if (!existing || entry.source === parent.marketplace) {
        dedupedSkills.set(key, entry);
      }
    }
  }

  result.push(...dedupedSkills.values());
  return result;
}

export const resolveCodexProviderCapabilities = Effect.fn("resolveCodexProviderCapabilities")(
  function* (input: {
    provider: ProviderKind;
    cwd: string;
    binaryPath: string;
    homePath?: string;
  }): Effect.Effect<ResolveProviderCapabilitiesResult, Error> {
    const { plugins, skills } = yield* Effect.tryPromise({
      try: () => queryCodexAppServer(input),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    return {
      capabilities: normalizeCodexCapabilities({
        provider: input.provider,
        plugins,
        skills,
      }),
    };
  },
);

async function queryCodexAppServer(input: {
  binaryPath: string;
  homePath?: string;
}): Promise<{ plugins: CodexPluginListResponse; skills: CodexSkillsListResponse }> {
  // Use the same newline-delimited JSON-RPC shape as CodexAppServerManager.
  const child = spawn(input.binaryPath, ["app-server"], {
    env: { ...process.env, ...(input.homePath ? { CODEX_HOME: input.homePath } : {}) },
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const output = readline.createInterface({ input: child.stdout });
  let nextId = 1;
  const pending = new Map<
    number,
    {
      method: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  const request = (method: string, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}.`));
      }, 5_000);
      pending.set(id, { method, resolve, reject, timeout });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });

  output.on("line", (line) => {
    const parsed = JSON.parse(line) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    if (parsed.id === undefined) return;
    const entry = pending.get(parsed.id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    pending.delete(parsed.id);
    if (parsed.error?.message) {
      entry.reject(new Error(`${entry.method} failed: ${parsed.error.message}`));
      return;
    }
    entry.resolve(parsed.result);
  });

  try {
    await request("initialize", buildCodexInitializeParams());
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
    const [plugins, skills] = await Promise.all([
      request("plugin/list", {}),
      request("skills/list", {}),
    ]);
    return {
      plugins: plugins as CodexPluginListResponse,
      skills: skills as CodexSkillsListResponse,
    };
  } finally {
    output.close();
    killCodexChildProcess(child);
  }
}
```

Keep imports extensionless in app/server TypeScript files unless an adjacent file
in the same directory already uses a `.ts` suffix for that import style.

- [ ] **Step 4: Add provider capability dispatcher and RPC**

Create `apps/server/src/provider/capabilities/index.ts`:

```ts
import { Effect } from "effect";
import type {
  ProviderKind,
  ResolveProviderCapabilitiesInput,
  ResolveProviderCapabilitiesResult,
} from "@t3tools/contracts";
import { baseProviderKind } from "@t3tools/contracts";
import { resolveCodexProviderCapabilities } from "./codexCapabilities";

export const resolveProviderCapabilities = Effect.fn("resolveProviderCapabilities")(function* (
  input: ResolveProviderCapabilitiesInput & {
    binaryPathByProvider: Partial<Record<ProviderKind, string>>;
    homePathByProvider: Partial<Record<ProviderKind, string | undefined>>;
  },
): Effect.Effect<ResolveProviderCapabilitiesResult, Error> {
  if (baseProviderKind(input.provider) !== "codex") {
    return { capabilities: [] };
  }
  const binaryPath = input.binaryPathByProvider[input.provider] ?? input.binaryPathByProvider.codex;
  if (!binaryPath) return { capabilities: [] };
  return yield* resolveCodexProviderCapabilities({
    provider: input.provider,
    cwd: input.cwd,
    binaryPath,
    homePath: input.homePathByProvider[input.provider] ?? input.homePathByProvider.codex,
  });
});
```

Wire `apps/server/src/ws.ts` similarly to `resolveSkills`, using server settings
to resolve Codex binary/home for the selected provider. Add
`server.resolveProviderCapabilities` to `apps/web/src/wsRpcClient.ts` and
`apps/web/src/wsNativeApi.ts`.

- [ ] **Step 5: Run discovery tests**

Run: `bun run test apps/server/src/provider/capabilities/codexCapabilities.test.ts apps/web/src/wsNativeApi.test.ts`

Expected: PASS.

---

### Task 3: Persist Next-Turn Provider Capability Selections

**Files:**

- Modify: `apps/web/src/composerDraftStore.ts`
- Test: `apps/web/src/composerDraftStore.test.ts` or existing browser/store test file if present.

**Interfaces:**

- Consumes: `SelectedProviderCapability`.
- Produces: draft fields and store actions `addProviderCapability`, `removeProviderCapability`, `clearProviderCapabilities`.

- [ ] **Step 1: Write draft store tests**

Add tests that verify:

```ts
store.getState().addProviderCapability(threadId, {
  provider: "codex",
  kind: "plugin",
  id: "superpowers@openai-curated-remote",
  displayName: "Superpowers",
});
expect(store.getState().draftsByThreadId[threadId]?.providerCapabilities).toHaveLength(1);

store.getState().removeProviderCapability(threadId, "superpowers@openai-curated-remote");
expect(store.getState().draftsByThreadId[threadId]?.providerCapabilities).toHaveLength(0);
```

Also assert `clearComposerContent(threadId)` clears selected provider
capabilities.

- [ ] **Step 2: Run failing draft store test**

Run: `bun run test apps/web/src/composerDraftStore.test.ts`

Expected: FAIL because the actions/field do not exist.

- [ ] **Step 3: Add draft state and persistence**

Modify `apps/web/src/composerDraftStore.ts`:

```ts
import { SelectedProviderCapability } from "@t3tools/contracts";
```

Add persisted schema:

```ts
const PersistedSelectedProviderCapability = SelectedProviderCapability;
```

Add `providerCapabilities` to `PersistedComposerThreadDraftState`,
`ComposerThreadDraftState`, empty draft constants, `createEmptyThreadDraft`,
`createPersistedThreadDraft`, `shouldRemoveDraft`, hydration normalization, and
`clearComposerContent`.

Add store actions:

```ts
addProviderCapability: (threadId: ThreadId, capability: SelectedProviderCapability) => void;
removeProviderCapability: (threadId: ThreadId, capabilityId: string) => void;
clearProviderCapabilities: (threadId: ThreadId) => void;
```

Deduplicate by `provider + kind + id`.

- [ ] **Step 4: Run draft store tests**

Run: `bun run test apps/web/src/composerDraftStore.test.ts`

Expected: PASS.

---

### Task 4: Add Provider Capabilities To Skills Menu

**Files:**

- Create: `apps/web/src/hooks/useProviderCapabilities.ts`
- Modify: `apps/web/src/components/chat/SkillsPicker.tsx`
- Modify: `apps/web/src/components/ChatView.tsx`
- Test: `apps/web/src/components/chat/SkillsPicker.browser.tsx`

**Interfaces:**

- Consumes: `ProviderCapabilityEntry[]`, `SelectedProviderCapability[]`.
- Produces: `onAttachProviderCapability(capability)`.

- [ ] **Step 1: Write SkillsPicker browser test**

Add a test that mounts `SkillsPicker` with:

```ts
providerCapabilities={[
  {
    id: "superpowers@openai-curated-remote",
    provider: "codex",
    kind: "plugin",
    name: "superpowers",
    displayName: "Superpowers",
    description: "Planning workflows",
    enabled: true,
    installed: true,
  },
  {
    id: "superpowers:brainstorming",
    provider: "codex",
    kind: "skill",
    name: "superpowers:brainstorming",
    displayName: "Brainstorming",
    parentId: "superpowers@openai-curated-remote",
    parentDisplayName: "Superpowers",
    enabled: true,
    installed: true,
  },
]}
```

Assert the menu shows section headers `Codex plugins` and `Codex plugin skills`,
and selecting Superpowers calls `onAttachProviderCapability`.

- [ ] **Step 2: Run failing picker test**

Run: `bun run test apps/web/src/components/chat/SkillsPicker.browser.tsx`

Expected: FAIL because `SkillsPicker` does not accept provider capabilities.

- [ ] **Step 3: Add capability polling hook**

Create `apps/web/src/hooks/useProviderCapabilities.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import type { ProviderCapabilityEntry, ProviderKind } from "@t3tools/contracts";
import { readNativeApi } from "../nativeApi";

const EMPTY: readonly ProviderCapabilityEntry[] = [];
const POLL_INTERVAL_MS = 5_000;

export function useProviderCapabilities(input: {
  provider: ProviderKind | undefined;
  cwd: string | undefined;
}): readonly ProviderCapabilityEntry[] {
  const [capabilities, setCapabilities] = useState<readonly ProviderCapabilityEntry[]>(EMPTY);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!input.provider || !input.cwd) {
      setCapabilities(EMPTY);
      return;
    }
    let cancelled = false;
    const fetchCapabilities = () => {
      const api = readNativeApi();
      if (!api || cancelled) return;
      api.server
        .resolveProviderCapabilities({ provider: input.provider!, cwd: input.cwd! })
        .then((result) => {
          if (!cancelled) setCapabilities(result.capabilities);
        })
        .catch((error) => {
          console.error("[useProviderCapabilities] RPC failed:", error);
          if (!cancelled) setCapabilities(EMPTY);
        });
    };
    fetchCapabilities();
    intervalRef.current = setInterval(fetchCapabilities, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [input.provider, input.cwd]);

  return capabilities;
}
```

- [ ] **Step 4: Extend SkillsPicker sections**

Modify `SkillsPickerProps`:

```ts
providerCapabilities: readonly ProviderCapabilityEntry[];
attachedProviderCapabilityIds: ReadonlySet<string>;
onAttachProviderCapability: (capability: ProviderCapabilityEntry) => void;
```

Render local skills exactly as today, then provider plugin/skill sections when
present. Keep disabled behavior based on `attachedProviderCapabilityIds`.

- [ ] **Step 5: Wire ChatView**

Use:

```ts
const providerCapabilities = useProviderCapabilities({
  provider: selectedProvider,
  cwd: activeProject?.cwd,
});
```

Add:

```ts
const onAttachProviderCapability = useCallback(
  (capability: ProviderCapabilityEntry) => {
    if (!activeThreadId) return;
    addComposerDraftProviderCapability(activeThreadId, {
      provider: capability.provider,
      kind: capability.kind,
      id: capability.id,
      displayName: capability.displayName,
      ...(capability.parentId ? { parentId: capability.parentId } : {}),
      ...(capability.parentDisplayName ? { parentDisplayName: capability.parentDisplayName } : {}),
    });
  },
  [activeThreadId, addComposerDraftProviderCapability],
);
```

Pass provider capabilities to both compact and full `SkillsPicker` instances.

- [ ] **Step 6: Run picker tests**

Run: `bun run test apps/web/src/components/chat/SkillsPicker.browser.tsx`

Expected: PASS.

---

### Task 5: Add Provider Capabilities To The `@` Picker

**Files:**

- Modify: `apps/web/src/components/chat/ComposerCommandMenu.tsx`
- Modify: `packages/contracts/src/ipc.ts`
- Modify: `apps/web/src/components/ChatView.tsx`
- Test: `apps/web/src/components/ChatView.browser.tsx`

**Interfaces:**

- Consumes: local skills and provider capabilities.
- Produces: mixed `ComposerCommandItem[]` rows for path trigger.

- [ ] **Step 1: Write browser test for `@sup`**

Add a ChatView browser test that stubs:

```ts
resolveProviderCapabilities: async () => ({
  capabilities: [
    {
      id: "superpowers@openai-curated-remote",
      provider: "codex",
      kind: "plugin",
      name: "superpowers",
      displayName: "Superpowers",
      description: "Planning workflows",
      enabled: true,
      installed: true,
    },
  ],
});
```

Type `@sup` in the composer and assert the command menu shows `Superpowers`
with a `Plugin` badge before unrelated files.

- [ ] **Step 2: Run failing browser test**

Run: `bun run test apps/web/src/components/ChatView.browser.tsx -t "shows provider capabilities in composer picker"`

Expected: FAIL because the `@` picker only maps workspace entries.

- [ ] **Step 3: Extend `ComposerCommandItem` rendering**

In `ComposerCommandMenu.tsx`, add rendering for:

```tsx
{
  props.item.type === "provider-capability" ? (
    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
      {props.item.capability.kind === "plugin" ? "Plugin" : "Skill"}
    </Badge>
  ) : null;
}
{
  props.item.type === "local-skill" ? (
    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
      Skill
    </Badge>
  ) : null;
}
```

- [ ] **Step 4: Build mixed path-trigger rows**

In `ChatView.tsx`, when `composerTrigger.kind === "path"`, build:

```ts
const query = composerTrigger.query.trim().toLowerCase();
const capabilityItems = providerCapabilities
  .filter((capability) => {
    if (!query) return false;
    return (
      capability.displayName.toLowerCase().includes(query) ||
      capability.name.toLowerCase().includes(query) ||
      capability.parentDisplayName?.toLowerCase().includes(query)
    );
  })
  .map((capability) => ({
    id: `provider-capability:${capability.provider}:${capability.kind}:${capability.id}`,
    type: "provider-capability" as const,
    capability,
    label: capability.displayName,
    description:
      capability.kind === "skill" && capability.parentDisplayName
        ? `Skill · ${capability.parentDisplayName}`
        : "Plugin",
  }));
const localSkillItems = availableSkills
  .filter((skill) => query && skill.name.toLowerCase().includes(query))
  .map((skill) => ({
    id: `local-skill:${skill.id}`,
    type: "local-skill" as const,
    skillId: skill.id,
    label: skill.name,
    description: skill.group ? `Local skill · ${skill.group}` : "Local skill",
  }));
```

Sort exact prefix provider capability matches ahead of files. Return:

```ts
return [...rankedCapabilityItems, ...rankedLocalSkillItems, ...pathItems];
```

- [ ] **Step 5: Handle mixed row selection**

In `onSelectComposerItem`:

- For `provider-capability`, call `onAttachProviderCapability(item.capability)`, replace the trigger text with a textual placeholder such as `@Superpowers ` until Task 6 replaces it with a structured chip.
- For `local-skill`, find the skill by `skillId`, call `onAttachSkill(skill)`, replace trigger text with `@${skill.name} `.

Task 6 will convert the replacement text into true Lexical capability chips.

- [ ] **Step 6: Run picker browser test**

Run: `bun run test apps/web/src/components/ChatView.browser.tsx -t "shows provider capabilities in composer picker"`

Expected: PASS.

---

### Task 6: Render Provider Capability Chips

**Files:**

- Modify: `apps/web/src/composer-editor-mentions.ts`
- Modify: `apps/web/src/components/ComposerPromptEditor.tsx`
- Modify: `apps/web/src/components/ChatView.tsx`
- Optional Create: `apps/web/src/components/chat/ComposerCapabilityChips.tsx`
- Test: `apps/web/src/components/ComposerPromptEditor.browser.tsx` or existing ChatView browser tests.

**Interfaces:**

- Consumes: `SelectedProviderCapability[]` from the draft.
- Produces: removable visual chips and selected capability IDs for send.

- [ ] **Step 1: Write chip persistence/render test**

Add a browser test that selects Superpowers from the `@` picker and asserts:

- the composer displays a chip labelled `Superpowers`;
- the plain prompt does not contain raw plugin description text;
- removing the chip removes the draft provider capability.

- [ ] **Step 2: Run failing chip test**

Run: `bun run test apps/web/src/components/ChatView.browser.tsx -t "provider capability chip"`

Expected: FAIL because there is no provider capability chip.

- [ ] **Step 3: Prefer chip strip for first implementation**

To avoid overloading the existing file mention parser, render selected provider
capabilities in a small chip strip near existing composer attachments. Create
`apps/web/src/components/chat/ComposerCapabilityChips.tsx`:

```tsx
import type { SelectedProviderCapability } from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { Button } from "../ui/button";

export function ComposerCapabilityChips(props: {
  capabilities: readonly SelectedProviderCapability[];
  onRemove: (capabilityId: string) => void;
}) {
  if (props.capabilities.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-2 pt-2">
      {props.capabilities.map((capability) => (
        <span
          key={`${capability.provider}:${capability.kind}:${capability.id}`}
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-muted/60 px-2 py-1 text-xs"
          title={
            capability.parentDisplayName
              ? `${capability.kind} · ${capability.parentDisplayName}`
              : `${capability.kind} · ${capability.provider}`
          }
        >
          <span className="truncate">{capability.displayName}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-4 text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${capability.displayName}`}
            onClick={() => props.onRemove(capability.id)}
          >
            <XIcon className="size-3" />
          </Button>
        </span>
      ))}
    </div>
  );
}
```

Use this strip before the text editor in `ChatView.tsx`. This keeps provider
capabilities structured without pretending they are filesystem mentions.

- [ ] **Step 4: Remove textual placeholders after selection**

Update `onSelectComposerItem` for provider/local skill rows to replace the
trigger range with an empty string after adding the chip/attachment. The chip
strip becomes the visible activation state.

- [ ] **Step 5: Restore capability selections on send failure**

In `onSend`, snapshot `composerProviderCapabilities`. On send failure, if the
draft is restored, re-add provider capability selections along with images,
terminal contexts, and skills.

- [ ] **Step 6: Run chip test**

Run: `bun run test apps/web/src/components/ChatView.browser.tsx -t "provider capability chip"`

Expected: PASS.

---

### Task 7: Thread Provider Capabilities Through Send

**Files:**

- Modify: `apps/web/src/components/ChatView.tsx`
- Modify: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- Modify: `apps/server/src/provider/Layers/CodexAdapter.ts`
- Modify: `apps/server/src/codexAppServerManager.ts`
- Test: `apps/server/src/provider/Layers/CodexAdapter.test.ts`
- Test: `apps/server/src/codexAppServerManager.test.ts`

**Interfaces:**

- Consumes: `SelectedProviderCapability[]`.
- Produces: Codex manager receives selected capabilities, but final Codex
  activation payload waits for Task 8.

- [ ] **Step 1: Write send plumbing tests**

Add a Codex adapter test asserting `selectedProviderCapabilities` are forwarded
from `ProviderSendTurnInput` to `CodexAppServerManager.sendTurn`.

Add a manager test asserting `sendTurn` accepts `providerCapabilities` without
altering text input when no activation encoder is configured.

- [ ] **Step 2: Run failing send plumbing tests**

Run: `bun run test apps/server/src/provider/Layers/CodexAdapter.test.ts apps/server/src/codexAppServerManager.test.ts`

Expected: FAIL because inputs do not include provider capabilities.

- [ ] **Step 3: Pass selected capabilities from UI**

In `ChatView.tsx`, include:

```ts
providerCapabilities: composerProviderCapabilitiesSnapshot,
```

in `thread.turn.start`.

- [ ] **Step 4: Pass selected capabilities through reactor and adapter**

In `ProviderCommandReactor.ts`, forward `input.providerCapabilities` to
`providerService.sendTurn`.

In `CodexAdapter.ts`, include:

```ts
...(input.providerCapabilities?.length
  ? { providerCapabilities: input.providerCapabilities }
  : {}),
```

in `managerInput`.

In `CodexAppServerManager.ts`, extend `CodexAppServerSendTurnInput`:

```ts
readonly providerCapabilities?: ReadonlyArray<SelectedProviderCapability>;
```

Do not yet invent the Codex app-server activation payload.

- [ ] **Step 5: Run send plumbing tests**

Run: `bun run test apps/server/src/provider/Layers/CodexAdapter.test.ts apps/server/src/codexAppServerManager.test.ts`

Expected: PASS.

---

### Task 8: Confirm Codex Activation Protocol And Wire It

**Files:**

- Create: `scripts/probe-codex-capability-activation.ts` or a focused test helper under `apps/server/src/provider/capabilities/`
- Modify: `apps/server/src/codexAppServerManager.ts`
- Test: `apps/server/src/codexAppServerManager.test.ts`
- Docs: `docs/codex-plugin-skills.md`

**Interfaces:**

- Consumes: selected Codex provider capabilities.
- Produces: exact Codex app-server payload for next-turn activation.

- [ ] **Step 1: Add protocol probe script**

Create a small script that can spawn `codex app-server`, initialize it, call
`plugin/list` and `skills/list`, and test candidate activation methods against
a disposable thread. The probe must log the exact JSON-RPC payloads and whether
the resulting `codex debug prompt-input` or app-server response includes the
selected capability.

Run candidates in this order:

1. app-server-selected plugin/skill metadata if the schema exposes a direct
   field;
2. `skills/extraRoots/set` for selected skill roots;
3. text `text_elements` spans with placeholders only if Codex proves it uses
   those spans for activation.

- [ ] **Step 2: Run the probe manually**

Run: `bun run tsx scripts/probe-codex-capability-activation.ts`

Expected: output identifies the working Codex activation sequence or states
that the current Codex app-server version exposes discovery but not activation.

- [ ] **Step 3: Encode only confirmed behavior**

If the probe confirms a working activation payload, implement:

```ts
function buildCodexCapabilityActivationParams(
  capabilities: readonly SelectedProviderCapability[],
): Partial<TurnStartParams> {
  // exact confirmed payload from probe
}
```

Use it in `CodexAppServerManager.sendTurn`.

If the probe does not confirm activation, leave selected capabilities out of the
provider payload and render a disabled state in the UI for Codex activation
until Codex exposes the protocol. Do not send raw `@superpowers` as a fallback.

- [ ] **Step 4: Test confirmed behavior**

Update `codexAppServerManager.test.ts` to assert the exact confirmed payload.

Run: `bun run test apps/server/src/codexAppServerManager.test.ts`

Expected: PASS.

- [ ] **Step 5: Update docs**

Update `docs/codex-plugin-skills.md` with:

- discovery path;
- activation path if confirmed;
- limitations if activation is not exposed.

---

### Task 9: Documentation And Verification

**Files:**

- Modify: `docs/features.md`
- Modify: `docs/t3-agent-tools.md`
- Modify: `docs/superpowers/specs/2026-07-11-provider-capabilities-design.md` if implementation deviates.

**Interfaces:**

- Consumes: implemented behavior.
- Produces: project docs and final verification evidence.

- [ ] **Step 1: Update docs**

Add a concise feature note:

```md
- **Provider capabilities** — The composer `@` picker and Skills menu can show
  provider-native plugins and skills for the active provider. Selecting a
  capability adds a next-turn chip without expanding raw plugin text into the
  prompt. Codex support is backed by `codex app-server` discovery.
```

- [ ] **Step 2: Run focused tests**

Run the focused tests added/changed by this plan:

```bash
bun run test packages/contracts/src/providerCapabilities.test.ts
bun run test apps/server/src/provider/capabilities/codexCapabilities.test.ts
bun run test apps/web/src/components/chat/SkillsPicker.browser.tsx
bun run test apps/web/src/components/ChatView.browser.tsx -t "provider capabilities"
bun run test apps/server/src/provider/Layers/CodexAdapter.test.ts apps/server/src/codexAppServerManager.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run required repo checks**

Run:

```bash
bun fmt
bun lint
bun typecheck
```

Expected: all exit 0. `bun lint` may print existing warnings but must not fail.

- [ ] **Step 4: Final manual check**

In a Codex thread:

1. type `@sup`;
2. verify Superpowers appears as `Plugin`;
3. select it;
4. verify a removable `Superpowers` chip appears;
5. send a message;
6. verify the draft clears and existing file mention/local skill flows still work.

Expected: no new toolbar button, no raw plugin text pasted into the composer,
and unsupported activation states are explicit.
