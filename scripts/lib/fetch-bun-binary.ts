import { execFileSync } from "node:child_process";
import { chmodSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

/**
 * Download + extract the Bun binary for a given platform/arch, returning the
 * absolute path to the extracted `bun` (or `bun.exe`).
 *
 * Used by `scripts/build-desktop-artifact.ts` to bundle Bun into the packaged
 * Electron app (T3CO-328). The packaged backend runs under Bun instead of
 * Electron-Node so the vendored browser code can static-import `bun:sqlite`.
 *
 * Cache layout: `~/.cache/t3-bun-bin/<BUN_VERSION>/<release-name>/bun[.exe]`.
 * Once downloaded, subsequent builds reuse the cached binary for the matching
 * version + platform.
 *
 * Pinned version is intentional — we don't pull 'latest' because a surprise
 * runtime upgrade mid-release-cycle is a nasty debugging experience.
 */

export const BUN_VERSION = "1.3.11";

export type BunPlatform = "darwin" | "linux" | "win";
export type BunArch = "x64" | "arm64";

function bunReleaseName(platform: BunPlatform, arch: BunArch): string {
  // Bun releases use "aarch64" for arm64 on darwin/linux, "x64" / "aarch64"
  // on windows.
  if (platform === "win") {
    const winArch = arch === "arm64" ? "aarch64" : "x64";
    return `bun-windows-${winArch}`;
  }
  const archSuffix = arch === "arm64" ? "aarch64" : "x64";
  return `bun-${platform}-${archSuffix}`;
}

function cacheDirFor(platform: BunPlatform, arch: BunArch): string {
  return join(homedir(), ".cache", "t3-bun-bin", BUN_VERSION, bunReleaseName(platform, arch));
}

export function cachedBunBinary(platform: BunPlatform, arch: BunArch): string | null {
  const exeName = platform === "win" ? "bun.exe" : "bun";
  const p = join(cacheDirFor(platform, arch), exeName);
  return existsSync(p) ? p : null;
}

export async function fetchBunBinary(
  platform: BunPlatform,
  arch: BunArch,
  options?: { readonly logger?: (msg: string) => void },
): Promise<string> {
  const log = options?.logger ?? (() => undefined);
  const cached = cachedBunBinary(platform, arch);
  if (cached) {
    log(`[fetch-bun] cached: ${cached}`);
    return cached;
  }

  const releaseName = bunReleaseName(platform, arch);
  const exeName = platform === "win" ? "bun.exe" : "bun";
  const cacheDir = cacheDirFor(platform, arch);
  mkdirSync(cacheDir, { recursive: true });
  const finalPath = join(cacheDir, exeName);

  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${releaseName}.zip`;
  const zipPath = join(tmpdir(), `${releaseName}-${Date.now()}.zip`);
  const extractDir = join(tmpdir(), `${releaseName}-${Date.now()}-extract`);

  log(`[fetch-bun] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download Bun binary: ${url} → HTTP ${res.status}`);
  }
  // Node's fetch returns a Web ReadableStream; node:stream/promises pipeline
  // accepts Web streams as well (Node 18.17+), but cast to satisfy TS.
  await pipeline(res.body as unknown as Readable, createWriteStream(zipPath));

  mkdirSync(extractDir, { recursive: true });
  try {
    if (platform === "win") {
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}'`,
        ],
        { stdio: "ignore" },
      );
    } else {
      execFileSync("unzip", ["-q", zipPath, "-d", extractDir], { stdio: "ignore" });
    }

    // Archive layout is `bun-<os>-<arch>/bun[.exe]`.
    const extracted = join(extractDir, releaseName, exeName);
    if (!existsSync(extracted)) {
      throw new Error(
        `Unexpected archive layout from ${url}; missing ${extracted}. ` +
          "Bun release format may have changed — update fetchBunBinary().",
      );
    }
    renameSync(extracted, finalPath);
    if (platform !== "win") {
      chmodSync(finalPath, 0o755);
    }
    log(`[fetch-bun] extracted: ${finalPath}`);
    return finalPath;
  } finally {
    rmSync(zipPath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }
}

/**
 * Map a T3 desktop build arch to a Bun arch. Desktop uses "universal" for
 * fat macOS builds; Bun does not publish a universal binary so callers must
 * target a single arch for builds that bundle Bun.
 */
export function desktopArchToBunArch(arch: "x64" | "arm64" | "universal"): BunArch {
  if (arch === "universal") {
    throw new Error(
      "Universal macOS builds that bundle Bun are not yet supported. " +
        "Build arm64 and x64 separately, or add per-arch lipo stitching to the packaging script.",
    );
  }
  return arch;
}

/**
 * Map a T3 desktop build platform to a Bun platform.
 */
export function desktopPlatformToBunPlatform(platform: "mac" | "linux" | "win"): BunPlatform {
  if (platform === "mac") return "darwin";
  return platform;
}
