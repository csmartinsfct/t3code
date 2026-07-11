import { spawn } from "node:child_process";
import readline from "node:readline";
import { PassThrough } from "node:stream";
import { Data, Effect } from "effect";
import type { ProviderCapabilityEntry, ProviderKind } from "@t3tools/contracts";
import { asProviderInput } from "@t3tools/contracts";

import { buildCodexInitializeParams, killCodexChildProcess } from "../codexAppServer";

class CodexCapabilityDiscoveryError extends Data.TaggedError("CodexCapabilityDiscoveryError")<{
  readonly cause: unknown;
}> {}

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
        provider: asProviderInput(input.provider),
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
      if (!skill.name || skill.enabled !== true) continue;
      const pluginName = pluginPrefixFromSkillName(skill.name);
      if (!pluginName) continue;
      const parent = installedPluginsByName.get(pluginName);
      if (!parent) continue;
      const displayName = skill.interface?.displayName?.trim() || skill.name.split(":").at(-1)!;
      const marketplaceHint = marketplaceHintFromPath(skill.path);
      const entry: ProviderCapabilityEntry = {
        id: skill.name,
        provider: asProviderInput(input.provider),
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
        ...(skill.path ? { path: skill.path } : {}),
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
  }) {
    const { plugins, skills } = yield* Effect.tryPromise({
      try: () => queryCodexAppServer(input),
      catch: (cause) => new CodexCapabilityDiscoveryError({ cause }),
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
  cwd: string;
  homePath?: string;
}): Promise<{ plugins: CodexPluginListResponse; skills: CodexSkillsListResponse }> {
  const child = spawn(input.binaryPath, ["app-server"], {
    cwd: input.cwd,
    env: { ...process.env, ...(input.homePath ? { CODEX_HOME: input.homePath } : {}) },
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
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

  let failed = false;
  const fail = (cause: unknown) => {
    if (failed) return;
    failed = true;
    const error = cause instanceof Error ? cause : new Error(String(cause));
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    pending.clear();
  };

  child.stdout.once("error", fail);
  const stdout = new PassThrough();
  child.stdout.pipe(stdout);
  const output = readline.createInterface({ input: stdout });

  const request = (method: string, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}.`));
      }, 5_000);
      pending.set(id, { method, resolve, reject, timeout });
      try {
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      } catch (cause) {
        fail(cause);
      }
    });

  output.on("line", (line) => {
    let parsed: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch (cause) {
      fail(new Error(`Received invalid JSON from codex app-server: ${String(cause)}`));
      return;
    }
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
  child.once("error", fail);
  child.stdin.once("error", fail);
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    fail(
      new Error(
        `codex app-server exited before capability discovery completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
      ),
    );
  };
  child.once("exit", onExit);

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
    child.stdout.unpipe(stdout);
    stdout.destroy();
    child.removeListener("error", fail);
    child.stdin.removeListener("error", fail);
    child.stdout.removeListener("error", fail);
    child.removeListener("exit", onExit);
    killCodexChildProcess(child);
  }
}
