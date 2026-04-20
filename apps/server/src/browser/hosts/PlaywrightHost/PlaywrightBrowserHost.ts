import type { ProjectId } from "@t3tools/contracts";
import { Effect } from "effect";

import {
  installBrowserHostCommands,
  type BrowserHostCommand,
  type BrowserHostToolName,
} from "../../BrowserHost.ts";
import {
  type BrowserInstance,
  type BrowserManagerServiceShape,
} from "../../Services/BrowserManager.ts";

/** Narrow surface of the vendored TabSession we touch. */
interface VendoredSession {
  readonly page: unknown;
}

/** Narrow surface of the vendored BrowserManager we touch. */
interface VendoredBrowserManager {
  getActiveSession(): VendoredSession;
}

interface VendoredModules {
  readonly handleReadCommand: (
    command: string,
    args: string[],
    session: VendoredSession,
    bm?: VendoredBrowserManager,
  ) => Promise<string>;
  readonly handleWriteCommand: (
    command: string,
    args: string[],
    session: VendoredSession,
    bm: VendoredBrowserManager,
  ) => Promise<string>;
  readonly handleSnapshot: (args: string[], session: VendoredSession) => Promise<string>;
  readonly handleMetaCommand: (
    command: string,
    args: string[],
    bm: VendoredBrowserManager,
    shutdown: () => Promise<void> | void,
  ) => Promise<string>;
}

export type PlaywrightCommandCategory = "read" | "write" | "meta" | "snapshot";

export interface PlaywrightCommandDescriptor {
  readonly command: string;
  readonly category: PlaywrightCommandCategory;
}

const NOOP_SHUTDOWN = (): void => {
  console.warn("[t3/browser] vendored meta handler attempted to invoke shutdown - ignored");
};

let cachedModules: VendoredModules | null = null;

async function loadVendoredModules(): Promise<VendoredModules> {
  if (cachedModules) return cachedModules;
  const [readMod, writeMod, snapshotMod, metaMod] = await Promise.all([
    import("../../core/read-commands.ts" as string),
    import("../../core/write-commands.ts" as string),
    import("../../core/snapshot.ts" as string),
    import("../../core/meta-commands.ts" as string),
  ]);
  cachedModules = {
    handleReadCommand: readMod.handleReadCommand,
    handleWriteCommand: writeMod.handleWriteCommand,
    handleSnapshot: snapshotMod.handleSnapshot,
    handleMetaCommand: metaMod.handleMetaCommand,
  };
  return cachedModules;
}

export class PlaywrightBrowserHost {
  readonly kind = "playwright" as const;

  private readonly descriptors: ReadonlyMap<BrowserHostToolName, PlaywrightCommandDescriptor>;

  constructor(
    readonly projectId: ProjectId,
    private readonly browser: BrowserManagerServiceShape,
    descriptors: ReadonlyMap<BrowserHostToolName, PlaywrightCommandDescriptor>,
  ) {
    this.descriptors = descriptors;
    installBrowserHostCommands(this);
  }

  readonly dispose = async (): Promise<void> => {
    await Effect.runPromise(this.browser.release(this.projectId));
  };

  readonly runTool: BrowserHostCommand = async (args, input) => {
    const tool = input.__toolName;
    if (tool === "useragent") return this.useragent(args, input);
    if (tool === "visibility") return this.visibility(args, input);
    if (typeof tool !== "string") throw new Error("missing browser host tool name");

    const descriptor = this.descriptors.get(tool as BrowserHostToolName);
    if (!descriptor) throw new Error(`unknown Playwright browser tool '${tool}'`);

    const instance = await this.acquire();
    const modules = await loadVendoredModules();
    const bm = instance.inner as VendoredBrowserManager;
    const session = bm.getActiveSession();
    const normalizedArgs = [...args];

    switch (descriptor.category) {
      case "read":
        return modules.handleReadCommand(descriptor.command, normalizedArgs, session, bm);
      case "write":
        return modules.handleWriteCommand(descriptor.command, normalizedArgs, session, bm);
      case "snapshot":
        return modules.handleSnapshot(normalizedArgs, session);
      case "meta":
        return modules.handleMetaCommand(descriptor.command, normalizedArgs, bm, NOOP_SHUTDOWN);
    }
  };

  readonly useragent: BrowserHostCommand = async (args) => {
    if (args[0] === "--reset") {
      await this.recreate({ userAgent: null });
      return "User agent reset to Playwright default";
    }
    const value = args[0];
    if (!value) {
      throw new Error("useragent: missing required input.value (string), or pass reset=true");
    }
    await this.recreate({ userAgent: value });
    return `User agent set to "${value}"`;
  };

  readonly visibility: BrowserHostCommand = async (args) => {
    const mode = args[0];
    if (mode !== "headed" && mode !== "headless") {
      throw new Error("visibility: input.mode must be 'headed' or 'headless'");
    }
    await this.recreate({ headless: mode === "headless" });
    return `Browser mode set to ${mode}. Chromium relaunched with persistent profile intact.`;
  };

  private async acquire(): Promise<BrowserInstance> {
    return Effect.runPromise(this.browser.acquire(this.projectId));
  }

  private async recreate(overrides: Parameters<BrowserManagerServiceShape["recreate"]>[1]) {
    return Effect.runPromise(this.browser.recreate(this.projectId, overrides));
  }
}
