import { spawn } from "node:child_process";
import { access, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { PassThrough } from "node:stream";
import { Data, Effect } from "effect";
import type {
  ProviderCapabilityEntry,
  ProviderKind,
  SelectedProviderCapability,
} from "@t3tools/contracts";
import { asProviderInput } from "@t3tools/contracts";

import { buildCodexInitializeParams, killCodexChildProcess } from "../codexAppServer";

class CodexCapabilityDiscoveryError extends Data.TaggedError("CodexCapabilityDiscoveryError")<{
  readonly cause: unknown;
}> {}

const CODEX_CAPABILITY_CACHE_TTL_MS = 60_000;

type CodexCapabilityDiscoveryResult = {
  capabilities: ProviderCapabilityEntry[];
};

const capabilityCache = new Map<
  string,
  { expiresAt: number; result: CodexCapabilityDiscoveryResult }
>();
const capabilityDiscoveryInFlight = new Map<string, Promise<CodexCapabilityDiscoveryResult>>();
let capabilityCacheGeneration = 0;

export interface CodexPluginListResponse {
  marketplaces?: Array<{
    name?: string;
    plugins?: Array<{
      id?: string;
      name?: string;
      installed?: boolean;
      enabled?: boolean;
      source?: unknown;
      capabilityRootPath?: string;
      appIds?: string[];
      catalogIconUrl?: string;
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

function readStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate : undefined;
}

function pluginSourcePath(source: unknown): string | undefined {
  return readStringProperty(source, "path");
}

function appIdsFromManifest(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const apps = (value as { apps?: unknown }).apps;
  if (!apps || typeof apps !== "object") return [];
  const ids: string[] = [];
  for (const app of Object.values(apps as Record<string, unknown>)) {
    const id = readStringProperty(app, "id");
    if (id) ids.push(id);
  }
  return ids;
}

async function readLocalPluginAppIds(pluginRootPath: string | undefined): Promise<string[]> {
  if (!pluginRootPath) return [];
  try {
    const manifest = await readFile(path.join(pluginRootPath, ".app.json"), "utf8");
    return appIdsFromManifest(JSON.parse(manifest));
  } catch {
    return [];
  }
}

async function readCachedPluginIconUrls(
  homePath: string | undefined,
): Promise<Map<string, string>> {
  const catalogRoot = path.join(
    homePath || defaultCodexHomePath(),
    "cache",
    "remote_plugin_catalog",
  );
  try {
    const entries = await readdir(catalogRoot, { withFileTypes: true });
    const catalogs = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => ({
          path: path.join(catalogRoot, entry.name),
          modifiedAt: (await stat(path.join(catalogRoot, entry.name))).mtimeMs,
        })),
    );
    const latest = catalogs.toSorted((left, right) => right.modifiedAt - left.modifiedAt)[0];
    if (!latest) return new Map();
    const parsed = JSON.parse(await readFile(latest.path, "utf8")) as {
      plugins?: Array<{
        name?: string;
        release?: {
          interface?: {
            composer_icon_url?: string | null;
            logo_url?: string | null;
          } | null;
        } | null;
      }>;
    };
    return new Map(
      (parsed.plugins ?? []).flatMap((plugin) => {
        const iconUrl =
          plugin.release?.interface?.composer_icon_url ?? plugin.release?.interface?.logo_url;
        return plugin.name && iconUrl ? [[plugin.name, iconUrl] as const] : [];
      }),
    );
  } catch {
    return new Map();
  }
}

function defaultCodexHomePath(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

async function cachedPluginRootPath(input: {
  homePath: string | undefined;
  marketplaceName: string | undefined;
  pluginName: string | undefined;
}): Promise<string | undefined> {
  if (!input.marketplaceName || !input.pluginName) return undefined;
  const cacheRoot = path.join(
    input.homePath || defaultCodexHomePath(),
    "plugins",
    "cache",
    input.marketplaceName,
    input.pluginName,
  );
  try {
    const entries = await readdir(cacheRoot, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory())
      .toSorted((left, right) =>
        right.name.localeCompare(left.name, undefined, { numeric: true, sensitivity: "base" }),
      )
      .map((entry) => path.join(cacheRoot, entry.name));
    for (const candidate of candidates) {
      try {
        await access(path.join(candidate, ".codex-plugin", "plugin.json"));
        return candidate;
      } catch {
        continue;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function enrichPluginAppMetadata(plugins: CodexPluginListResponse, homePath?: string) {
  const cachedIconUrls = await readCachedPluginIconUrls(homePath);
  await Promise.all(
    (plugins.marketplaces ?? []).flatMap((marketplace) =>
      (marketplace.plugins ?? []).map(async (plugin) => {
        const rootPath =
          plugin.capabilityRootPath ??
          pluginSourcePath(plugin.source) ??
          (await cachedPluginRootPath({
            homePath,
            marketplaceName: marketplace.name,
            pluginName: plugin.name,
          }));
        if (!rootPath) return;
        plugin.capabilityRootPath = rootPath;
        plugin.appIds = plugin.appIds ?? (await readLocalPluginAppIds(rootPath));
        const catalogIconUrl = cachedIconUrls.get(plugin.name ?? "");
        if (catalogIconUrl) plugin.catalogIconUrl = catalogIconUrl;
      }),
    ),
  );
}

export function normalizeCodexCapabilities(input: {
  provider: ProviderKind;
  plugins: CodexPluginListResponse;
  skills: CodexSkillsListResponse;
}): ProviderCapabilityEntry[] {
  const result: ProviderCapabilityEntry[] = [];
  const installedPluginsByName = new Map<
    string,
    {
      id: string;
      displayName: string;
      marketplace: string;
      source?: string;
      capabilityRootPath?: string;
      appIds?: string[];
    }
  >();

  for (const marketplace of input.plugins.marketplaces ?? []) {
    const marketplaceName = marketplace.name ?? "unknown";
    for (const plugin of marketplace.plugins ?? []) {
      if (!plugin.id || !plugin.name || plugin.installed !== true || plugin.enabled !== true) {
        continue;
      }
      const displayName = plugin.interface?.displayName?.trim() || plugin.name;
      const capabilityRootPath = plugin.capabilityRootPath ?? pluginSourcePath(plugin.source);
      installedPluginsByName.set(plugin.name, {
        id: plugin.id,
        displayName,
        marketplace: marketplaceName,
        source: marketplaceName,
        ...(capabilityRootPath ? { capabilityRootPath } : {}),
        ...(plugin.appIds && plugin.appIds.length > 0 ? { appIds: plugin.appIds } : {}),
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
        ...(capabilityRootPath ? { capabilityRootPath } : {}),
        ...(plugin.appIds && plugin.appIds.length > 0 ? { appIds: plugin.appIds } : {}),
        ...(plugin.interface?.composerIcon ? { iconPath: plugin.interface.composerIcon } : {}),
        ...(plugin.interface?.composerIconUrl || plugin.catalogIconUrl
          ? { iconUrl: plugin.interface?.composerIconUrl ?? plugin.catalogIconUrl }
          : {}),
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
        ...(parent.capabilityRootPath ? { capabilityRootPath: parent.capabilityRootPath } : {}),
        ...(parent.appIds && parent.appIds.length > 0 ? { appIds: parent.appIds } : {}),
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

function toCanonicalSelection(capability: ProviderCapabilityEntry): SelectedProviderCapability {
  return {
    provider: capability.provider,
    kind: capability.kind,
    id: capability.id,
    ...(capability.name ? { name: capability.name } : {}),
    ...(capability.path ? { path: capability.path } : {}),
    displayName: capability.displayName,
    ...(capability.parentId ? { parentId: capability.parentId } : {}),
    ...(capability.parentDisplayName ? { parentDisplayName: capability.parentDisplayName } : {}),
    ...(capability.capabilityRootPath ? { capabilityRootPath: capability.capabilityRootPath } : {}),
    ...(capability.appIds ? { appIds: capability.appIds } : {}),
    ...(capability.iconPath ? { iconPath: capability.iconPath } : {}),
    ...(capability.iconUrl ? { iconUrl: capability.iconUrl } : {}),
  };
}

export function canonicalizeCodexSelectedCapabilities(input: {
  discovered: ReadonlyArray<ProviderCapabilityEntry>;
  requested: ReadonlyArray<SelectedProviderCapability> | undefined;
}): SelectedProviderCapability[] {
  const discoveredByKey = new Map(
    input.discovered.map((capability) => [
      `${capability.provider}\u0000${capability.kind}\u0000${capability.id}`,
      capability,
    ]),
  );
  const requested =
    input.requested ??
    input.discovered.filter(
      (capability) =>
        capability.kind === "plugin" &&
        capability.enabled &&
        capability.installed !== false &&
        Boolean(capability.capabilityRootPath) &&
        Boolean(capability.appIds?.length),
    );
  const result: SelectedProviderCapability[] = [];
  const seen = new Set<string>();
  for (const selection of requested) {
    const key = `${selection.provider}\u0000${selection.kind}\u0000${selection.id}`;
    if (seen.has(key)) continue;
    const canonical = discoveredByKey.get(key);
    if (!canonical) continue;
    seen.add(key);
    result.push(toCanonicalSelection(canonical));
  }
  return result;
}

function codexCapabilityCacheKey(input: {
  provider: ProviderKind;
  cwd: string;
  binaryPath: string;
  homePath?: string;
}): string {
  return JSON.stringify([input.provider, input.cwd, input.binaryPath, input.homePath ?? null]);
}

export function clearCodexProviderCapabilitiesCache(): void {
  capabilityCacheGeneration += 1;
  capabilityCache.clear();
  capabilityDiscoveryInFlight.clear();
}

async function resolveCachedCodexProviderCapabilities(input: {
  provider: ProviderKind;
  cwd: string;
  binaryPath: string;
  homePath?: string;
}): Promise<CodexCapabilityDiscoveryResult> {
  const key = codexCapabilityCacheKey(input);
  const now = Date.now();
  const cached = capabilityCache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;
  if (cached) capabilityCache.delete(key);

  const existingDiscovery = capabilityDiscoveryInFlight.get(key);
  if (existingDiscovery) return existingDiscovery;

  for (const [candidateKey, candidate] of capabilityCache) {
    if (candidate.expiresAt <= now) capabilityCache.delete(candidateKey);
  }

  const generation = capabilityCacheGeneration;
  const discovery = queryCodexAppServer(input)
    .then(({ plugins, skills }) => ({
      capabilities: normalizeCodexCapabilities({
        provider: input.provider,
        plugins,
        skills,
      }),
    }))
    .then((result) => {
      if (generation === capabilityCacheGeneration) {
        capabilityCache.set(key, {
          expiresAt: Date.now() + CODEX_CAPABILITY_CACHE_TTL_MS,
          result,
        });
      }
      return result;
    })
    .finally(() => {
      if (capabilityDiscoveryInFlight.get(key) === discovery) {
        capabilityDiscoveryInFlight.delete(key);
      }
    });
  capabilityDiscoveryInFlight.set(key, discovery);
  return discovery;
}

export const resolveCodexProviderCapabilities = Effect.fn("resolveCodexProviderCapabilities")(
  function* (input: {
    provider: ProviderKind;
    cwd: string;
    binaryPath: string;
    homePath?: string;
  }) {
    return yield* Effect.tryPromise({
      try: () => resolveCachedCodexProviderCapabilities(input),
      catch: (cause) => new CodexCapabilityDiscoveryError({ cause }),
    });
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
    await enrichPluginAppMetadata(plugins as CodexPluginListResponse, input.homePath);
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
