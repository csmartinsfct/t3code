import type { ProjectId } from "@t3tools/contracts";

export const BROWSER_HOST_TOOL_NAMES = [
  "goto",
  "back",
  "forward",
  "reload",
  "url",
  "text",
  "html",
  "links",
  "forms",
  "accessibility",
  "js",
  "evaluate",
  "eval",
  "css",
  "attrs",
  "is",
  "console",
  "network",
  "dialog",
  "cookies",
  "storage",
  "perf",
  "inspect",
  "media",
  "data",
  "click",
  "fill",
  "select",
  "hover",
  "type",
  "press",
  "scroll",
  "wait",
  "viewport",
  "cookie",
  "cookie-import",
  "cookie-import-browser",
  "header",
  "useragent",
  "upload",
  "dialog-accept",
  "dialog-dismiss",
  "style",
  "cleanup",
  "prettyscreenshot",
  "snapshot",
  "screenshot",
  "pdf",
  "responsive",
  "diff",
  "tabs",
  "tab",
  "newtab",
  "closetab",
  "focus",
  "status",
  "ux-audit",
  "visibility",
  "load_extension",
  "load_unpacked",
  "reload_extension",
  "list_extensions",
  "open_extension",
  "ext_windows",
  "ext_switch",
  "ext_close",
] as const;

export type BrowserHostToolName = (typeof BROWSER_HOST_TOOL_NAMES)[number];

export type BrowserHostKind = "playwright" | "electron-wc";

export type BrowserHostCommand = (
  args: readonly string[],
  input: Readonly<Record<string, unknown>>,
) => Promise<string>;

export type BrowserHost = {
  readonly kind: BrowserHostKind;
  readonly projectId: ProjectId;
  readonly dispose: () => Promise<void>;
  readonly runTool: BrowserHostCommand;
} & {
  readonly [K in BrowserHostToolName]: BrowserHostCommand;
};

export function installBrowserHostCommands<T extends { runTool: BrowserHostCommand }>(
  target: T,
): T & { readonly [K in BrowserHostToolName]: BrowserHostCommand } {
  const host = target as T & { [K in BrowserHostToolName]: BrowserHostCommand };
  for (const name of BROWSER_HOST_TOOL_NAMES) {
    if (typeof host[name] === "function") continue;
    host[name] = (args, input) => target.runTool(args, input);
  }
  return host;
}
