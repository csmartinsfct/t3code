import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";

import type { BrowserExtensionInfo } from "@t3tools/contracts";
import { app, Notification as ElectronNotification, session } from "electron";
import type { BaseWindow, WebContents } from "electron";
import { ElectronChromeExtensions } from "electron-chrome-extensions";
import {
  installChromeWebStore,
  uninstallExtension as webStoreUninstallExtension,
} from "electron-chrome-web-store";
import { unzipSync } from "fflate";

export interface InstalledExtensionInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

export interface ExtensionAgentInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly hasPopup: boolean;
}

export interface DesktopExtensionManagerOptions {
  readonly stateDir: string;
  readonly notifyExtensionsChanged: (projectId: string) => void;
  readonly createTab: (
    projectId: string,
    details: chrome.tabs.CreateProperties,
  ) => Promise<[WebContents, BaseWindow]>;
  readonly selectTab: (projectId: string, tab: WebContents) => void;
  readonly removeTab: (projectId: string, tab: WebContents) => void;
  readonly createWindow: (
    projectId: string,
    details: chrome.windows.CreateData,
  ) => Promise<BaseWindow>;
}

export class DesktopExtensionManager {
  private readonly chromeExtsByProjectId = new Map<string, ElectronChromeExtensions>();
  private readonly readyByProjectId = new Map<string, Promise<void>>();
  readonly preloadPath: string | undefined;

  constructor(private readonly options: DesktopExtensionManagerOptions) {
    let preloadPath: string | undefined;
    try {
      preloadPath = require.resolve("electron-chrome-extensions/preload");
    } catch {
      console.warn(
        "[desktop/browser] electron-chrome-extensions preload not found — Chrome APIs will be limited",
      );
    }
    this.preloadPath = preloadPath;
  }

  getExisting(projectId: string): ElectronChromeExtensions | undefined {
    return this.chromeExtsByProjectId.get(projectId);
  }

  getOrCreate(projectId: string): ElectronChromeExtensions {
    const existing = this.chromeExtsByProjectId.get(projectId);
    if (existing) return existing;

    const ses = session.fromPartition(`persist:${projectId}`);
    const extensionsPath = this.extensionsPath(projectId);

    if (this.preloadPath) {
      ses.registerPreloadScript({ id: "chrome-ext", type: "frame", filePath: this.preloadPath });
    }

    ses.on("extension-loaded", async (_, ext) => {
      const extPath = (ext as { path?: string }).path;
      if (!extPath) return;
      const idValid = await verifyManifestKeyMatchesId(extPath, ext.id);
      if (!idValid) {
        console.error("[desktop/browser] extension manifest.key/ID mismatch — unloading", {
          extId: ext.id,
          extPath,
          projectId,
        });
        ses.removeExtension(ext.id);
        return;
      }
      const wasPatched = await ensureExtensionPolyfill(extPath);
      if (wasPatched) {
        await clearExtensionWorkerCachesForProject(projectId, ses, "extension-loaded");
        ses.removeExtension(ext.id);
        await ses.loadExtension(extPath, { allowFileAccess: true });
      }
      this.options.notifyExtensionsChanged(projectId);
    });

    const readyPromise = preApplyPolyfillsToExtensions(extensionsPath, ses, projectId)
      .catch((err: unknown) => {
        console.warn("[desktop/browser] pre-patch failed", { projectId, err });
      })
      .then(() =>
        installChromeWebStore({
          session: ses,
          extensionsPath,
          autoUpdate: true,
          beforeInstall: async ({ id }: { id: string }) => {
            try {
              await this.loadVerifiedChromeWebStoreExtensionForProject(projectId, id);
              console.log("[desktop/browser] verified Web Store install", { projectId, id });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.warn("[desktop/browser] verified Web Store install failed", {
                projectId,
                id,
                err,
              });
              new ElectronNotification({
                title: "Extension install failed",
                body: message,
                silent: true,
              }).show();
              return { action: "deny" as const };
            }
            return { action: "deny" as const };
          },
        }),
      )
      .then(() => loadLegacyFlatExtensions(ses, extensionsPath, projectId))
      .then(() => this.options.notifyExtensionsChanged(projectId))
      .catch((error: unknown) => {
        console.warn("[desktop/browser] extension startup failed", { projectId, error });
      });
    this.readyByProjectId.set(projectId, readyPromise);

    const ext = new ElectronChromeExtensions({
      license: "GPL-3.0",
      session: ses,
      createTab: (details) => this.options.createTab(projectId, details),
      selectTab: (tab) => this.options.selectTab(projectId, tab),
      removeTab: (tab) => this.options.removeTab(projectId, tab),
      reloadExtension: async (extension: Electron.Extension, extPath: string) => {
        await reloadExtensionPathForProject(projectId, ses, extension, extPath, "runtime-reload");
      },
      createWindow: (details) => this.options.createWindow(projectId, details),
    } as ConstructorParameters<typeof ElectronChromeExtensions>[0] & {
      reloadExtension?: (extension: Electron.Extension, extensionPath: string) => Promise<void>;
    });

    ext.on("browser-action-popup-created", (popup) => {
      console.log("[desktop/browser] extension action popup created", { projectId });
      void popup.whenReady().then(() => {
        if (!popup.browserWindow) return;
        popup.browserWindow.show();
      });
    });

    this.chromeExtsByProjectId.set(projectId, ext);
    return ext;
  }

  async install(projectId: string, extensionId: string): Promise<InstalledExtensionInfo> {
    this.getOrCreate(projectId);
    await this.ready(projectId);
    const ext = await this.loadVerifiedChromeWebStoreExtensionForProject(projectId, extensionId);
    this.options.notifyExtensionsChanged(projectId);
    return {
      id: ext.id,
      name: (ext.manifest["name"] as string | undefined) ?? extensionId,
      version: (ext.manifest["version"] as string | undefined) ?? "unknown",
    };
  }

  async loadUnpacked(projectId: string, extPath: string): Promise<BrowserExtensionInfo> {
    const resolved = Path.resolve(extPath);
    await FS.promises.access(resolved);
    const stat = await FS.promises.stat(resolved);
    if (!stat.isDirectory()) throw new Error(`load-unpacked: ${resolved} is not a directory`);
    await FS.promises.access(Path.join(resolved, "manifest.json"));
    this.getOrCreate(projectId);
    await this.ready(projectId);
    const ses = session.fromPartition(`persist:${projectId}`);
    await prepareExtensionPathForLoad(projectId, ses, resolved, "load-unpacked");
    const ext = await ses.loadExtension(resolved, { allowFileAccess: true });
    this.options.notifyExtensionsChanged(projectId);
    const pinnedIds = await readPinnedExtensions(this.options.stateDir, projectId);
    return {
      id: ext.id,
      name: (ext.manifest["name"] as string | undefined) ?? Path.basename(resolved),
      iconUrl: null,
      popupUrl: null,
      pinned: pinnedIds.includes(ext.id),
      isUnpacked: true,
    };
  }

  async reload(projectId: string, extensionId: string): Promise<void> {
    this.getOrCreate(projectId);
    await this.ready(projectId);
    const ses = session.fromPartition(`persist:${projectId}`);
    const ext = ses.getAllExtensions().find((e) => e.id === extensionId);
    if (!ext) throw new Error(`reload: extension ${extensionId} not found`);
    const extPath = (ext as { path?: string }).path;
    if (!extPath) throw new Error(`reload: extension ${extensionId} has no known path`);
    await reloadExtensionPathForProject(projectId, ses, ext, extPath, "reload-extension");
    this.options.notifyExtensionsChanged(projectId);
  }

  async uninstall(
    projectId: string,
    extensionId: string,
    closePopup: (projectId: string, extensionId: string) => void,
  ): Promise<void> {
    this.getOrCreate(projectId);
    await this.ready(projectId);

    const ses = session.fromPartition(`persist:${projectId}`);
    const ext = ses.getAllExtensions().find((e) => e.id === extensionId);
    if (!ext) throw new Error(`uninstall: extension ${extensionId} not found`);

    closePopup(projectId, extensionId);

    const extensionsPath = this.extensionsPath(projectId);
    const extPath = (ext as { path?: string }).path;
    if (isManagedExtensionPath(extPath, extensionsPath)) {
      await webStoreUninstallExtension(extensionId, { session: ses, extensionsPath });
      console.log("[desktop/browser] uninstalled managed extension", { projectId, extensionId });
    } else {
      ses.removeExtension(extensionId);
      console.log("[desktop/browser] removed unpacked extension", {
        projectId,
        extensionId,
        extPath,
      });
    }

    await purgeExtensionProfileState(projectId, extensionId);
    await removePinnedExtension(this.options.stateDir, projectId, extensionId);
    this.options.notifyExtensionsChanged(projectId);
  }

  async listPanelExtensions(projectId: string): Promise<BrowserExtensionInfo[]> {
    this.getOrCreate(projectId);
    await this.ready(projectId);

    const ses = session.fromPartition(`persist:${projectId}`);
    const pinnedIds = await readPinnedExtensions(this.options.stateDir, projectId);
    const extensionsPath = this.extensionsPath(projectId);

    return Promise.all(
      ses.getAllExtensions().map(async (ext) => {
        const manifest = ext.manifest as {
          icons?: Record<string, string>;
          action?: { default_popup?: string };
          browser_action?: { default_popup?: string };
        };
        const icons = manifest.icons ?? {};
        const bestSize = Object.keys(icons)
          .map(Number)
          .filter((n) => !isNaN(n))
          .toSorted((a, b) => b - a)[0];
        const iconPath = bestSize !== undefined ? icons[String(bestSize)] : undefined;
        const popupPath =
          manifest.action?.default_popup ?? manifest.browser_action?.default_popup ?? undefined;

        let iconUrl: string | null = null;
        const extLoadPath = (ext as unknown as { path?: string }).path ?? "";
        if (iconPath && extLoadPath) {
          try {
            const candidate = Path.join(extLoadPath, iconPath);
            const data = await FS.promises.readFile(candidate);
            const extExt = Path.extname(iconPath).toLowerCase();
            const mime =
              extExt === ".svg"
                ? "image/svg+xml"
                : extExt === ".jpg" || extExt === ".jpeg"
                  ? "image/jpeg"
                  : "image/png";
            iconUrl = `data:${mime};base64,${data.toString("base64")}`;
          } catch {}
        }

        const isUnpacked = !isManagedExtensionPath(extLoadPath, extensionsPath);

        return {
          id: ext.id,
          name: ext.name,
          iconUrl,
          popupUrl: popupPath ? `chrome-extension://${ext.id}/${popupPath}` : null,
          pinned: pinnedIds.includes(ext.id),
          isUnpacked,
        };
      }),
    );
  }

  listLoadedExtensions(
    projectId: string,
    hasPopup: (extensionId: string) => boolean,
  ): ExtensionAgentInfo[] {
    const ses = session.fromPartition(`persist:${projectId}`);
    return ses.getAllExtensions().map((ext) => ({
      id: ext.id,
      name: ext.name,
      version: (ext.manifest["version"] as string | undefined) ?? "unknown",
      hasPopup: hasPopup(ext.id),
    }));
  }

  async setPinned(projectId: string, extensionIds: readonly unknown[]): Promise<void> {
    const ses = session.fromPartition(`persist:${projectId}`);
    const installedIds = new Set(ses.getAllExtensions().map((e) => e.id));
    const ids = extensionIds.filter(
      (id): id is string => typeof id === "string" && installedIds.has(id),
    );
    await writePinnedExtensions(this.options.stateDir, projectId, ids);
    this.options.notifyExtensionsChanged(projectId);
  }

  private async ready(projectId: string): Promise<void> {
    const ready = this.readyByProjectId.get(projectId);
    if (ready) await ready;
  }

  private extensionsPath(projectId: string): string {
    return Path.join(this.options.stateDir, "browser", projectId, "extensions");
  }

  private async loadVerifiedChromeWebStoreExtensionForProject(
    projectId: string,
    extensionId: string,
  ): Promise<Electron.Extension> {
    const ses = session.fromPartition(`persist:${projectId}`);
    const existing = ses.getAllExtensions().find((e) => e.id === extensionId);
    if (existing) return existing;
    const extDir = await downloadAndUnpackVerifiedChromeWebStoreExtension(
      extensionId,
      this.extensionsPath(projectId),
    );
    await prepareExtensionPathForLoad(projectId, ses, extDir, "web-store-install");
    return ses.loadExtension(extDir, { allowFileAccess: true });
  }
}

function chromeWebStoreCrxUrl(extensionId: string): string {
  return (
    `https://clients2.google.com/service/update2/crx` +
    `?response=redirect&prodversion=130.0.0.0&acceptformat=crx3` +
    `&x=id%3D${extensionId}%26installsource%3Dondemand%26uc`
  );
}

async function fetchChromeWebStoreCrx(extensionId: string): Promise<Buffer> {
  const crxResponse = await fetch(chromeWebStoreCrxUrl(extensionId), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    },
  });
  if (!crxResponse.ok) {
    throw new Error(
      `CRX download failed (${crxResponse.status}) for ${extensionId} — cannot verify signature`,
    );
  }
  return Buffer.from(await crxResponse.arrayBuffer());
}

function safeZipEntryPath(entryName: string): string {
  if (!entryName || entryName.includes("\0")) throw new Error("CRX contains an invalid path");
  const pathSegments = entryName.split(/[\\/]+/);
  if (pathSegments.includes("..")) {
    throw new Error(`CRX contains an unsafe path: ${entryName}`);
  }
  const normalized = Path.normalize(pathSegments.join(Path.sep));
  if (
    Path.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith(`..${Path.sep}`)
  ) {
    throw new Error(`CRX contains an unsafe path: ${entryName}`);
  }
  return normalized;
}

async function unpackVerifiedChromeWebStoreCrx(
  crxBuffer: Buffer,
  extensionId: string,
  extensionsPath: string,
): Promise<string> {
  const publicKey = verifyCrxSignature(crxBuffer, extensionId);
  const headerSize = crxBuffer.readUInt32LE(8);
  const zipBuffer = crxBuffer.subarray(12 + headerSize);
  const unpackId = Crypto.randomUUID();
  const unpackedPath = Path.join(extensionsPath, extensionId, unpackId);
  await FS.promises.rm(unpackedPath, { recursive: true, force: true });
  await FS.promises.mkdir(unpackedPath, { recursive: true });

  try {
    const entries = unzipSync(new Uint8Array(zipBuffer));
    for (const [entryName, contents] of Object.entries(entries)) {
      const safePath = safeZipEntryPath(entryName);
      if (safePath === ".") continue;
      const destination = Path.join(unpackedPath, safePath);
      if (!destination.startsWith(unpackedPath + Path.sep)) {
        throw new Error(`CRX contains an unsafe path: ${entryName}`);
      }
      if (entryName.endsWith("/")) {
        await FS.promises.mkdir(destination, { recursive: true });
        continue;
      }
      await FS.promises.mkdir(Path.dirname(destination), { recursive: true });
      await FS.promises.writeFile(destination, Buffer.from(contents));
    }

    const manifestPath = Path.join(unpackedPath, "manifest.json");
    const manifest = JSON.parse(await FS.promises.readFile(manifestPath, "utf-8")) as {
      key?: string;
      version?: string;
    };
    if (!manifest.version) {
      throw new Error(`Installed extension ${extensionId} is missing manifest version`);
    }
    manifest.key = publicKey.toString("base64");
    await FS.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    const versionedPath = Path.join(extensionsPath, extensionId, `${manifest.version}_0`);
    await FS.promises.rm(versionedPath, { recursive: true, force: true });
    await FS.promises.mkdir(Path.dirname(versionedPath), { recursive: true });
    await FS.promises.rename(unpackedPath, versionedPath);
    return versionedPath;
  } catch (error) {
    await FS.promises.rm(unpackedPath, { recursive: true, force: true });
    throw error;
  }
}

async function downloadAndUnpackVerifiedChromeWebStoreExtension(
  extensionId: string,
  extensionsPath: string,
): Promise<string> {
  const crxBuffer = await fetchChromeWebStoreCrx(extensionId);
  const extDir = await unpackVerifiedChromeWebStoreCrx(crxBuffer, extensionId, extensionsPath);
  console.log("[desktop/browser] CRX signature verified", { extensionId });
  return extDir;
}

function isManagedExtensionPath(extPath: string | undefined, extensionsPath: string): boolean {
  if (!extPath) return false;
  const managedRoot = Path.resolve(extensionsPath);
  const resolvedPath = Path.resolve(extPath);
  return resolvedPath === managedRoot || resolvedPath.startsWith(managedRoot + Path.sep);
}

async function readPinnedExtensions(stateDir: string, projectId: string): Promise<string[]> {
  const filePath = Path.join(stateDir, "browser", projectId, "pinned-extensions.json");
  try {
    const raw = await FS.promises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]).filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function writePinnedExtensions(
  stateDir: string,
  projectId: string,
  ids: readonly string[],
): Promise<void> {
  const dir = Path.join(stateDir, "browser", projectId);
  await FS.promises.mkdir(dir, { recursive: true });
  await FS.promises.writeFile(
    Path.join(dir, "pinned-extensions.json"),
    JSON.stringify(ids),
    "utf-8",
  );
}

async function removePinnedExtension(
  stateDir: string,
  projectId: string,
  extensionId: string,
): Promise<void> {
  const pinned = await readPinnedExtensions(stateDir, projectId);
  const updated = pinned.filter((id) => id !== extensionId);
  if (updated.length !== pinned.length) await writePinnedExtensions(stateDir, projectId, updated);
}

async function purgeExtensionProfileState(projectId: string, extensionId: string): Promise<void> {
  const partitionDir = Path.join(app.getPath("userData"), "Partitions", projectId);
  const prefsPath = Path.join(partitionDir, "Preferences");
  try {
    const prefs = JSON.parse(await FS.promises.readFile(prefsPath, "utf-8")) as {
      extensions?: { settings?: Record<string, unknown> };
    };
    if (prefs.extensions?.settings?.[extensionId]) {
      delete prefs.extensions.settings[extensionId];
      await FS.promises.writeFile(prefsPath, JSON.stringify(prefs), "utf-8");
    }
  } catch {}

  await FS.promises.rm(Path.join(partitionDir, "Local Extension Settings", extensionId), {
    recursive: true,
    force: true,
  });
}

function deriveCrxId(publicKeyBase64: string): string {
  const hash = Crypto.createHash("sha256").update(publicKeyBase64, "base64").digest();
  let id = "";
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i]! >> 4));
    id += String.fromCharCode(97 + (hash[i]! & 0x0f));
  }
  return id;
}

function crxReadVarInt(buf: Buffer, pos: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  while (pos < buf.length) {
    const b = buf[pos++]!;
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: result >>> 0, next: pos };
    shift += 7;
  }
  return { value: result >>> 0, next: pos };
}

function decodeCrx3Header(buf: Buffer): {
  sha256_with_rsa: Array<{ public_key: Buffer; signature: Buffer }>;
  signed_header_data?: Buffer;
} {
  const result: {
    sha256_with_rsa: Array<{ public_key: Buffer; signature: Buffer }>;
    signed_header_data?: Buffer;
  } = { sha256_with_rsa: [] };
  let pos = 0;
  while (pos < buf.length) {
    const tag = crxReadVarInt(buf, pos);
    pos = tag.next;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 0x7;
    if (wireType !== 2) {
      if (wireType === 0) {
        const value = crxReadVarInt(buf, pos);
        pos = value.next;
      } else if (wireType === 5) {
        pos += 4;
      } else if (wireType === 1) {
        pos += 8;
      }
      continue;
    }

    const length = crxReadVarInt(buf, pos);
    pos = length.next;
    const fieldBuf = buf.subarray(pos, pos + length.value);
    pos += length.value;

    if (fieldNumber === 2) {
      const proof = { public_key: Buffer.alloc(0), signature: Buffer.alloc(0) };
      let proofPos = 0;
      while (proofPos < fieldBuf.length) {
        const proofTag = crxReadVarInt(fieldBuf, proofPos);
        proofPos = proofTag.next;
        const proofField = proofTag.value >>> 3;
        const proofWireType = proofTag.value & 0x7;
        if (proofWireType !== 2) {
          if (proofWireType === 0) {
            const value = crxReadVarInt(fieldBuf, proofPos);
            proofPos = value.next;
          } else if (proofWireType === 5) {
            proofPos += 4;
          } else if (proofWireType === 1) {
            proofPos += 8;
          }
          continue;
        }

        const proofLength = crxReadVarInt(fieldBuf, proofPos);
        proofPos = proofLength.next;
        const proofFieldBuf = fieldBuf.subarray(proofPos, proofPos + proofLength.value);
        proofPos += proofLength.value;
        if (proofField === 1) proof.public_key = Buffer.from(proofFieldBuf);
        if (proofField === 2) proof.signature = Buffer.from(proofFieldBuf);
      }
      result.sha256_with_rsa.push(proof);
    } else if (fieldNumber === 10000) {
      result.signed_header_data = Buffer.from(fieldBuf);
    }
  }
  return result;
}

function verifyCrxSignature(crxBuffer: Buffer, expectedId: string): Buffer {
  if (crxBuffer.toString("ascii", 0, 4) !== "Cr24")
    throw new Error(`CRX verification failed: invalid magic bytes for ${expectedId}`);
  const version = crxBuffer.readUInt32LE(4);
  if (version !== 3)
    throw new Error(`CRX verification failed: unsupported version ${version} for ${expectedId}`);
  const headerSize = crxBuffer.readUInt32LE(8);
  if (12 + headerSize > crxBuffer.length)
    throw new Error(`CRX verification failed: header size exceeds file length for ${expectedId}`);
  const headerBuf = crxBuffer.subarray(12, 12 + headerSize);
  const zipBuf = crxBuffer.subarray(12 + headerSize);
  const header = decodeCrx3Header(headerBuf);
  if (!header.signed_header_data)
    throw new Error(`CRX verification failed: missing signed_header_data for ${expectedId}`);

  const signedHeaderData = header.signed_header_data;
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(signedHeaderData.length, 0);
  const message = Buffer.concat([
    Buffer.from("CRX3 SignedData\x00", "ascii"),
    lenBuf,
    signedHeaderData,
    zipBuf,
  ]);
  let verified = false;
  let verifiedPublicKey: Buffer | null = null;
  for (const proof of header.sha256_with_rsa) {
    if (!proof.public_key.length || !proof.signature.length) continue;
    const keyBase64 = proof.public_key.toString("base64");
    if (deriveCrxId(keyBase64) !== expectedId) continue;
    try {
      const pubKey = Crypto.createPublicKey({ key: proof.public_key, format: "der", type: "spki" });
      const verifier = Crypto.createVerify("RSA-SHA256");
      verifier.update(message);
      if (verifier.verify(pubKey, proof.signature)) {
        verified = true;
        verifiedPublicKey = proof.public_key;
        break;
      }
    } catch {
      // Malformed key, try the next proof entry.
    }
  }
  if (!verified)
    throw new Error(
      `CRX verification failed: RSA-SHA256 signature invalid for ${expectedId}. ` +
        `The extension may have been tampered with or downloaded incorrectly.`,
    );
  return verifiedPublicKey!;
}

async function verifyManifestKeyMatchesId(extPath: string, extId: string): Promise<boolean> {
  try {
    const raw = await FS.promises.readFile(Path.join(extPath, "manifest.json"), "utf-8");
    const manifest = JSON.parse(raw) as { key?: string };
    if (!manifest.key) return true;
    return deriveCrxId(manifest.key) === extId;
  } catch {
    return true;
  }
}

const POLYFILL_SENTINEL = "/*__t3_polyfill_v6__*/";

async function ensureExtensionPolyfill(extDir: string): Promise<boolean> {
  let manifest: { background?: { service_worker?: string; scripts?: string[] } };
  try {
    manifest = JSON.parse(
      await FS.promises.readFile(Path.join(extDir, "manifest.json"), "utf-8"),
    ) as typeof manifest;
  } catch {
    return false;
  }
  const bgScript =
    manifest.background?.service_worker ??
    (manifest.background?.scripts?.[0] as string | undefined);
  if (!bgScript) return false;
  if (bgScript.startsWith("/") || bgScript.includes("..")) return false;
  const bgPath = Path.resolve(Path.join(extDir, bgScript));
  if (!bgPath.startsWith(Path.resolve(extDir) + Path.sep)) return false;

  let changed = false;
  try {
    const existing = await FS.promises.readFile(bgPath, "utf-8");
    if (!existing.startsWith(POLYFILL_SENTINEL)) {
      const EXTENSION_POLYFILL = `${POLYFILL_SENTINEL}(function(){
  if(typeof requestAnimationFrame==='undefined'){
    globalThis.requestAnimationFrame=function(cb){return setTimeout(cb,16);};
    globalThis.cancelAnimationFrame=function(id){clearTimeout(id);};
  }
  if(typeof chrome!=='undefined'){
    var _nev=function(){return{addListener:function(){},removeListener:function(){},hasListener:function(){return false;}};};
    chrome.sidePanel={
      setOptions:function(){return Promise.resolve();},
      getOptions:function(){return Promise.resolve({});},
      open:function(){return Promise.resolve();},
      setPanelBehavior:function(){return Promise.resolve();},
      getPanelBehavior:function(){return Promise.resolve({openPanelOnActionClick:false});},
      onPanelShown:_nev(),onOptionsChanged:_nev()
    };
    chrome.offscreen={
      createDocument:function(){return Promise.resolve();},
      closeDocument:function(){return Promise.resolve();},
      hasDocument:function(){return Promise.resolve(false);},
      Reason:{AUDIO_PLAYBACK:'AUDIO_PLAYBACK',CLIPBOARD:'CLIPBOARD',DOM_PARSER:'DOM_PARSER',DOM_SCRAPING:'DOM_SCRAPING',LOCAL_STORAGE:'LOCAL_STORAGE',USER_MEDIA:'USER_MEDIA',WEB_RTC:'WEB_RTC',BLOBS:'BLOBS'},
    };
    if(!chrome.alarms){
      chrome.alarms={create:function(){},get:function(a,cb){if(cb)cb(undefined);return Promise.resolve(undefined);},getAll:function(cb){if(cb)cb([]);return Promise.resolve([]);},clear:function(a,cb){if(cb)cb(true);return Promise.resolve(true);},clearAll:function(cb){if(cb)cb(true);return Promise.resolve(true);},onAlarm:_nev()};
    }
    if(chrome.storage&&chrome.storage.local){
      var _t3K='__t3_first_run_v5__';
      chrome.storage.local.get(_t3K,function(r){
        if(!r[_t3K]){var _s={};_s[_t3K]=true;chrome.storage.local.set(_s);}
      });
    }
  }
})();\n`;
      await FS.promises.writeFile(bgPath, EXTENSION_POLYFILL + existing, "utf-8");
      console.log("[desktop/browser] applied extension polyfill", { extDir, bgScript });
      changed = true;
    }
  } catch {}

  return changed;
}

async function clearExtensionWorkerCachesForProject(
  projectId: string,
  ses: Electron.Session,
  reason: string,
): Promise<void> {
  const partitionDir = Path.join(app.getPath("userData"), "Partitions", projectId);
  for (const cacheSubdir of ["Service Worker", "Code Cache"]) {
    await FS.promises.rm(Path.join(partitionDir, cacheSubdir), {
      recursive: true,
      force: true,
    });
  }
  await ses.clearCodeCaches({});
  console.log("[desktop/browser] cleared extension worker caches after polyfill update", {
    projectId,
    reason,
  });
}

async function prepareExtensionPathForLoad(
  projectId: string,
  ses: Electron.Session,
  extPath: string,
  reason: string,
): Promise<boolean> {
  const wasPatched = await ensureExtensionPolyfill(extPath);
  if (wasPatched) {
    await clearExtensionWorkerCachesForProject(projectId, ses, reason);
  }
  return wasPatched;
}

async function reloadExtensionPathForProject(
  projectId: string,
  ses: Electron.Session,
  ext: Electron.Extension,
  extPath: string,
  reason: string,
): Promise<void> {
  await prepareExtensionPathForLoad(projectId, ses, extPath, reason);
  await ses.loadExtension(extPath, { allowFileAccess: true });
  console.log("[desktop/browser] reloaded extension", {
    projectId,
    extensionId: ext.id,
    reason,
  });
}

async function loadLegacyFlatExtensions(
  ses: Electron.Session,
  extensionsPath: string,
  projectId: string,
): Promise<void> {
  let entries: FS.Dirent[];
  try {
    entries = await FS.promises.readdir(extensionsPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const extDir = Path.join(extensionsPath, entry.name);
    try {
      await FS.promises.access(Path.join(extDir, "manifest.json"));
    } catch {
      continue;
    }
    const children = await FS.promises.readdir(extDir, { withFileTypes: true });
    const hasVersionedDir = children.some((c) => c.isDirectory() && /_\d+$/.test(c.name));
    if (hasVersionedDir) continue;
    const alreadyLoaded = ses.getAllExtensions().some((e) => {
      const ep = (e as unknown as { path?: string }).path;
      return ep && Path.resolve(ep) === Path.resolve(extDir);
    });
    if (alreadyLoaded) continue;
    const idValid = await verifyManifestKeyMatchesId(extDir, entry.name);
    if (!idValid) {
      console.warn("[desktop/browser] legacy extension manifest.key mismatch — skipping", {
        projectId,
        extensionId: entry.name,
        extDir,
      });
      continue;
    }
    try {
      await prepareExtensionPathForLoad(projectId, ses, extDir, "legacy-flat-startup");
      await ses.loadExtension(extDir, { allowFileAccess: true });
      console.log("[desktop/browser] loaded legacy flat extension", {
        projectId,
        extensionId: entry.name,
      });
    } catch (err) {
      console.warn("[desktop/browser] failed to load legacy flat extension", {
        projectId,
        extDir,
        err,
      });
    }
  }
}

async function preApplyPolyfillsToExtensions(
  extensionsPath: string,
  ses: Electron.Session,
  projectId: string,
): Promise<void> {
  let idDirs: FS.Dirent[];
  try {
    idDirs = await FS.promises.readdir(extensionsPath, { withFileTypes: true });
  } catch {
    return;
  }
  let anyCacheCleared = false;
  for (const idDir of idDirs) {
    if (!idDir.isDirectory()) continue;
    const idPath = Path.join(extensionsPath, idDir.name);
    const candidates: string[] = [];
    try {
      const children = await FS.promises.readdir(idPath, { withFileTypes: true });
      const versionedDirs = children.filter((c) => c.isDirectory() && /_\d+$/.test(c.name));
      if (versionedDirs.length > 0) {
        for (const v of versionedDirs) candidates.push(Path.join(idPath, v.name));
      } else {
        candidates.push(idPath);
      }
    } catch {
      continue;
    }
    for (const dir of candidates) {
      try {
        const wasPatched = await ensureExtensionPolyfill(dir);
        if (wasPatched && !anyCacheCleared) {
          await clearExtensionWorkerCachesForProject(projectId, ses, "startup-pre-patch");
          anyCacheCleared = true;
        }
      } catch {}
    }
  }
}
