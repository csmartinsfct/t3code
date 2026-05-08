import { Data, Effect } from "effect";
import type { HttpServerResponse } from "effect/unstable/http";

import type { ProjectId, ThreadId } from "@t3tools/contracts";

import { respondError, respondOk, type ToolDefinition } from "../restResponse";
import { BrowserHostResolver, type BrowserHostResolverShape } from "./BrowserHostResolver";
import type { BrowserHostToolName } from "./BrowserHost";
import type { PlaywrightCommandDescriptor } from "./hosts/PlaywrightHost/PlaywrightBrowserHost";

// ---------------------------------------------------------------------------
// Handler plumbing
// ---------------------------------------------------------------------------

export interface ToolContext {
  readonly resolver: BrowserHostResolverShape;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
}

export type ToolHandler = (
  input: Record<string, unknown>,
) => Effect.Effect<HttpServerResponse.HttpServerResponse, BrowserToolError, never>;

class BrowserToolError extends Data.TaggedError("BrowserToolError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toBrowserToolError(error: unknown): BrowserToolError {
  if (error instanceof BrowserToolError) return error;
  return new BrowserToolError({ message: errorMessage(error), cause: error });
}

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

class InputError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "InputError";
  }
}

function reqString(input: Record<string, unknown>, key: string, tool: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new InputError(`${tool}: missing required input.${key} (string)`);
  }
  return value;
}

function optString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optBool(input: Record<string, unknown>, key: string): boolean {
  return input[key] === true;
}

function optNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
}

function optStringArray(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((v): v is string => typeof v === "string") ? value : undefined;
}

// ---------------------------------------------------------------------------
// Command spec table
// ---------------------------------------------------------------------------

type Category = "read" | "write" | "meta" | "snapshot";

interface CommandSpec {
  /** The gstack command name (almost always == the T3 tool name). */
  readonly command: string;
  readonly category: Category;
  /** Build the string[] args that gstack expects. May throw `InputError`. */
  readonly argsFromInput: (input: Record<string, unknown>, tool: string) => string[];
  /** UI-facing metadata for the /api/browser tool registry. */
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

type Schema = Record<string, unknown>;

const s = {
  str: (description: string): Schema => ({ type: "string", description }),
  optStr: (description: string): Schema => ({ type: "string", optional: true, description }),
  optBool: (description: string): Schema => ({ type: "boolean", optional: true, description }),
  optNum: (description: string): Schema => ({ type: "number", optional: true, description }),
  optArr: (description: string): Schema => ({
    type: "array",
    optional: true,
    description,
  }),
} as const;

const REF_DESC = "@e<N>, @c<N>, or CSS selector (prefer @refs from snapshot)";

// Helpers for the flag-heavy commands
function boolFlag(flag: string, key: string, input: Record<string, unknown>): string[] {
  return optBool(input, key) ? [flag] : [];
}
function valueFlag(flag: string, key: string, input: Record<string, unknown>): string[] {
  const v = optString(input, key) ?? optNumber(input, key);
  return v === undefined ? [] : [flag, String(v)];
}

const SPECS: Record<string, CommandSpec> = {
  // ─── Navigate ─────────────────────────────────────────────
  goto: {
    command: "goto",
    category: "write",
    argsFromInput: (i, t) => [reqString(i, "url", t)],
    title: "Go to URL",
    description: "Navigate the active tab to the URL and wait for DOMContentLoaded.",
    inputSchema: { url: s.str("http(s) URL") },
  },
  back: {
    command: "back",
    category: "write",
    argsFromInput: () => [],
    title: "History back",
    description: "Navigate back in history.",
    inputSchema: {},
  },
  forward: {
    command: "forward",
    category: "write",
    argsFromInput: () => [],
    title: "History forward",
    description: "Navigate forward in history.",
    inputSchema: {},
  },
  reload: {
    command: "reload",
    category: "write",
    argsFromInput: () => [],
    title: "Reload page",
    description: "Reload the current page.",
    inputSchema: {},
  },
  url: {
    command: "url",
    category: "meta",
    argsFromInput: () => [],
    title: "Current URL",
    description: "Print the URL of the active tab.",
    inputSchema: {},
  },

  // ─── Read ─────────────────────────────────────────────────
  text: {
    command: "text",
    category: "read",
    argsFromInput: () => [],
    title: "Page text",
    description: "Cleaned visible text of the active tab (strips scripts/styles/svg).",
    inputSchema: {},
  },
  html: {
    command: "html",
    category: "read",
    argsFromInput: (i) => {
      const selector = optString(i, "selector");
      return selector ? [selector] : [];
    },
    title: "Page HTML",
    description: "innerHTML of a selector, or full page HTML if none given.",
    inputSchema: { selector: s.optStr("@ref or CSS selector; omit for full page") },
  },
  links: {
    command: "links",
    category: "read",
    argsFromInput: () => [],
    title: "Page links",
    description: "All links as 'text → href' one per line.",
    inputSchema: {},
  },
  forms: {
    command: "forms",
    category: "read",
    argsFromInput: () => [],
    title: "Form fields",
    description: "Form fields as JSON. Password fields and token-shaped values are redacted.",
    inputSchema: {},
  },
  accessibility: {
    command: "accessibility",
    category: "read",
    argsFromInput: () => [],
    title: "Accessibility tree",
    description: "Full ARIA tree of the body (raw, without @ref IDs — use `snapshot` for refs).",
    inputSchema: {},
  },
  js: {
    command: "js",
    category: "read",
    argsFromInput: (i, t) => [reqString(i, "expression", t)],
    title: "Run JavaScript expression",
    description:
      "Run a JS expression in the page context and return the result as a string. Supports top-level await. `evaluate` is an alias.",
    inputSchema: { expression: s.str("JavaScript expression") },
  },
  evaluate: {
    // alias for js — kept as a separate tool name so the agent-facing surface
    // matches conventional REST naming. Dispatches to the same vendored
    // `js` handler.
    command: "js",
    category: "read",
    argsFromInput: (i, t) => [reqString(i, "expression", t)],
    title: "Evaluate JavaScript",
    description: "Alias of `js`. Run a JavaScript expression and return the result as a string.",
    inputSchema: { expression: s.str("JavaScript expression") },
  },
  eval: {
    command: "eval",
    category: "read",
    argsFromInput: (i, t) => [reqString(i, "file", t)],
    title: "Evaluate JavaScript file",
    description: "Run JavaScript read from a file on disk. Path must be inside a safe directory.",
    inputSchema: { file: s.str("Absolute path to a .js file") },
  },
  css: {
    command: "css",
    category: "read",
    argsFromInput: (i, t) => [reqString(i, "selector", t), reqString(i, "property", t)],
    title: "Computed CSS value",
    description: "Get the computed CSS value of a property on a selector.",
    inputSchema: {
      selector: s.str(REF_DESC),
      property: s.str("CSS property name, e.g. color, font-size"),
    },
  },
  attrs: {
    command: "attrs",
    category: "read",
    argsFromInput: (i, t) => [reqString(i, "selector", t)],
    title: "Element attributes",
    description: "All attributes of the element as JSON.",
    inputSchema: { selector: s.str(REF_DESC) },
  },
  is: {
    command: "is",
    category: "read",
    argsFromInput: (i, t) => [reqString(i, "property", t), reqString(i, "selector", t)],
    title: "Element state check",
    description:
      "Returns 'true' or 'false'. Property is one of visible, hidden, enabled, disabled, checked, editable, focused.",
    inputSchema: {
      property: s.str("visible | hidden | enabled | disabled | checked | editable | focused"),
      selector: s.str(REF_DESC),
    },
  },
  console: {
    command: "console",
    category: "read",
    argsFromInput: (i) => {
      const args: string[] = [];
      if (optBool(i, "clear")) args.push("--clear");
      if (optBool(i, "errors")) args.push("--errors");
      return args;
    },
    title: "Console messages",
    description: "Captured console output. Use errors=true to filter to warn/error only.",
    inputSchema: {
      clear: s.optBool("Clear the buffer after returning"),
      errors: s.optBool("Only return warn/error entries"),
    },
  },
  network: {
    command: "network",
    category: "read",
    argsFromInput: (i) => (optBool(i, "clear") ? ["--clear"] : []),
    title: "Network requests",
    description: "Captured network request metadata (method, URL, status, duration).",
    inputSchema: { clear: s.optBool("Clear the buffer after returning") },
  },
  dialog: {
    command: "dialog",
    category: "read",
    argsFromInput: (i) => (optBool(i, "clear") ? ["--clear"] : []),
    title: "Dialog messages",
    description: "Captured alert / confirm / prompt dialog history.",
    inputSchema: { clear: s.optBool("Clear the buffer after returning") },
  },
  cookies: {
    command: "cookies",
    category: "read",
    argsFromInput: () => [],
    title: "All cookies",
    description: "All cookies visible to the current context as JSON.",
    inputSchema: {},
  },
  storage: {
    command: "storage",
    category: "read",
    argsFromInput: (i) => {
      const setKey = optString(i, "setKey");
      const setValue = optString(i, "setValue");
      if (setKey && setValue !== undefined) return ["set", setKey, setValue];
      return [];
    },
    title: "localStorage / sessionStorage",
    description:
      "Read both localStorage and sessionStorage, or set setKey/setValue to write to localStorage.",
    inputSchema: {
      setKey: s.optStr("localStorage key to set"),
      setValue: s.optStr("localStorage value (required if setKey given)"),
    },
  },
  perf: {
    command: "perf",
    category: "read",
    argsFromInput: () => [],
    title: "Page load timings",
    description: "Navigation timing metrics (DOM, load, first paint, etc).",
    inputSchema: {},
  },
  inspect: {
    command: "inspect",
    category: "read",
    argsFromInput: (i) => {
      const args: string[] = [];
      if (optBool(i, "includeUA")) args.push("--all");
      if (optBool(i, "history")) args.push("--history");
      const selector = optString(i, "selector");
      if (selector) args.push(selector);
      return args;
    },
    title: "Deep CSS inspect",
    description:
      "CDP-driven inspection of an element's box model, computed styles, and matched rules.",
    inputSchema: {
      selector: s.optStr(`${REF_DESC}; omit with history=true for modification log`),
      includeUA: s.optBool("Include user-agent stylesheet rules"),
      history: s.optBool("Return style-modification history instead of an element snapshot"),
    },
  },
  media: {
    command: "media",
    category: "read",
    argsFromInput: (i) => {
      const args: string[] = [];
      const filter = optString(i, "filter");
      if (filter === "images") args.push("--images");
      else if (filter === "videos") args.push("--videos");
      else if (filter === "audio") args.push("--audio");
      const selector = optString(i, "selector");
      if (selector) args.push(selector);
      return args;
    },
    title: "Media elements",
    description: "Discover <img>, <video>, <audio> and CSS background images on the page.",
    inputSchema: {
      filter: s.optStr("images | videos | audio (omit for all)"),
      selector: s.optStr("Scope to a subtree"),
    },
  },
  data: {
    command: "data",
    category: "read",
    argsFromInput: (i) => {
      const args: string[] = [];
      if (optBool(i, "jsonld")) args.push("--jsonld");
      if (optBool(i, "og")) args.push("--og");
      if (optBool(i, "meta")) args.push("--meta");
      if (optBool(i, "twitter")) args.push("--twitter");
      return args;
    },
    title: "Structured page data",
    description: "JSON-LD, Open Graph, Twitter Cards, meta tags.",
    inputSchema: {
      jsonld: s.optBool("Include JSON-LD blocks"),
      og: s.optBool("Include Open Graph tags"),
      meta: s.optBool("Include <meta> tags"),
      twitter: s.optBool("Include Twitter Card tags"),
    },
  },

  // ─── Interact ─────────────────────────────────────────────
  click: {
    command: "click",
    category: "write",
    argsFromInput: (i, t) => [reqString(i, "ref", t)],
    title: "Click element",
    description: "Click an element.",
    inputSchema: { ref: s.str(REF_DESC) },
  },
  fill: {
    command: "fill",
    category: "write",
    argsFromInput: (i, t) => {
      const ref = reqString(i, "ref", t);
      const value = i.value;
      if (typeof value !== "string") {
        throw new InputError(`${t}: missing required input.value (string)`);
      }
      return [ref, value];
    },
    title: "Fill form field",
    description: "Set the value of a form field.",
    inputSchema: { ref: s.str(REF_DESC), value: s.str("Text to place in the field") },
  },
  select: {
    command: "select",
    category: "write",
    argsFromInput: (i, t) => [reqString(i, "ref", t), reqString(i, "value", t)],
    title: "Select dropdown option",
    description: "Select by option value, label, or visible text.",
    inputSchema: {
      ref: s.str(REF_DESC),
      value: s.str("Option value / label / visible text"),
    },
  },
  hover: {
    command: "hover",
    category: "write",
    argsFromInput: (i, t) => [reqString(i, "ref", t)],
    title: "Hover element",
    description: "Move the mouse over the element.",
    inputSchema: { ref: s.str(REF_DESC) },
  },
  type: {
    command: "type",
    category: "write",
    argsFromInput: (i, t) => [reqString(i, "text", t)],
    title: "Type text",
    description: "Type into the currently focused element.",
    inputSchema: { text: s.str("Text to type") },
  },
  press: {
    command: "press",
    category: "write",
    argsFromInput: (i, t) => [reqString(i, "key", t)],
    title: "Press key",
    description:
      "Press a keyboard key. Examples: Enter, Tab, Escape, ArrowUp, Backspace, Shift+Enter.",
    inputSchema: { key: s.str("Key combination") },
  },
  scroll: {
    command: "scroll",
    category: "write",
    argsFromInput: (i) => {
      const selector = optString(i, "selector");
      return selector ? [selector] : [];
    },
    title: "Scroll",
    description: "Scroll an element into view, or to page bottom if no selector.",
    inputSchema: { selector: s.optStr(`${REF_DESC}; omit to scroll to bottom`) },
  },
  wait: {
    command: "wait",
    category: "write",
    argsFromInput: (i, t) => {
      if (optBool(i, "networkIdle")) return ["--networkidle"];
      if (optBool(i, "load")) return ["--load"];
      return [reqString(i, "selector", t)];
    },
    title: "Wait",
    description:
      "Wait for an element, network idle, or page load. Timeout is 15s. Set selector OR networkIdle OR load (exactly one).",
    inputSchema: {
      selector: s.optStr(REF_DESC),
      networkIdle: s.optBool("Wait for network idle"),
      load: s.optBool("Wait for page load event"),
    },
  },
  viewport: {
    command: "viewport",
    category: "write",
    argsFromInput: (i, t) => [reqString(i, "size", t)],
    title: "Set viewport",
    description: "Set the viewport size. Example: '1024x768'.",
    inputSchema: { size: s.str("WIDTHxHEIGHT") },
  },
  cookie: {
    command: "cookie",
    category: "write",
    argsFromInput: (i, t) => [reqString(i, "assignment", t)],
    title: "Set cookie",
    description: "Set a cookie on the current page domain. Example: 'name=value'.",
    inputSchema: { assignment: s.str("name=value") },
  },
  "cookie-import": {
    command: "cookie-import",
    category: "write",
    argsFromInput: (i, t) => [reqString(i, "file", t)],
    title: "Import cookies from JSON file",
    description: "Load cookies from a Playwright-format JSON array (path must be in safe dir).",
    inputSchema: { file: s.str("Absolute path to JSON file") },
  },
  "cookie-import-browser": {
    command: "cookie-import-browser",
    category: "write",
    argsFromInput: (i) => {
      const args: string[] = [];
      const browser = optString(i, "browser");
      if (browser) args.push(browser);
      const domain = optString(i, "domain");
      if (domain) args.push("--domain", domain);
      const profile = optString(i, "profile");
      if (profile) args.push("--profile", profile);
      if (optBool(i, "all")) args.push("--all");
      return args;
    },
    title: "Import cookies from installed browser",
    description:
      "Decrypt and import cookies from Chrome/Edge/Brave/Arc/Chromium/Comet. Use domain='example.com' for scoped import, or all=true to import everything.",
    inputSchema: {
      browser: s.optStr("Browser name (default: comet)"),
      domain: s.optStr("Single domain to import — must match current page hostname"),
      profile: s.optStr("Browser profile name (default: 'Default')"),
      all: s.optBool("Import every non-expired domain (prefer 'domain' for safety)"),
    },
  },
  header: {
    command: "header",
    category: "write",
    argsFromInput: (i, t) => [reqString(i, "header", t)],
    title: "Set custom request header",
    description:
      "Set a custom HTTP header on future requests. Colon-separated. Sensitive values auto-redacted in logs.",
    inputSchema: { header: s.str("name:value") },
  },
  useragent: {
    command: "useragent",
    category: "write",
    argsFromInput: (i, t) => {
      if (optBool(i, "reset")) return ["--reset"];
      return [reqString(i, "value", t)];
    },
    title: "Set user-agent",
    description: "Override the browser's user-agent string. Pass reset=true to restore default.",
    inputSchema: {
      value: s.optStr("User-agent string"),
      reset: s.optBool("Restore the default user-agent"),
    },
  },
  upload: {
    command: "upload",
    category: "write",
    argsFromInput: (i, t) => {
      const ref = reqString(i, "ref", t);
      const files = optStringArray(i, "files");
      if (!files || files.length === 0) {
        throw new InputError(`${t}: missing required input.files (array of file paths)`);
      }
      return [ref, ...files];
    },
    title: "Upload file(s)",
    description: "Upload one or more files via an <input type=file>.",
    inputSchema: {
      ref: s.str(REF_DESC),
      files: s.optArr("Array of absolute file paths"),
    },
  },
  "dialog-accept": {
    command: "dialog-accept",
    category: "write",
    argsFromInput: (i) => {
      const text = optString(i, "text");
      return text ? [text] : [];
    },
    title: "Accept next dialog",
    description: "Auto-accept the next alert/confirm/prompt. Optional text supplied to prompt().",
    inputSchema: { text: s.optStr("Text to supply to prompt()") },
  },
  "dialog-dismiss": {
    command: "dialog-dismiss",
    category: "write",
    argsFromInput: () => [],
    title: "Dismiss next dialog",
    description: "Auto-dismiss the next alert/confirm/prompt.",
    inputSchema: {},
  },
  style: {
    command: "style",
    category: "write",
    argsFromInput: (i, t) => {
      if (optBool(i, "undo")) {
        const index = optNumber(i, "index");
        return index === undefined ? ["--undo"] : ["--undo", String(index)];
      }
      return [reqString(i, "selector", t), reqString(i, "property", t), reqString(i, "value", t)];
    },
    title: "Modify page style",
    description:
      "Live-modify CSS via CDP. Use undo=true to revert, optionally index=<N> to pick a specific prior change.",
    inputSchema: {
      selector: s.optStr(REF_DESC),
      property: s.optStr("CSS property name"),
      value: s.optStr("CSS value"),
      undo: s.optBool("Revert a prior modification"),
      index: s.optNum("Index of modification to revert (default: last)"),
    },
  },
  cleanup: {
    command: "cleanup",
    category: "write",
    argsFromInput: (i) => {
      const args: string[] = [];
      if (optBool(i, "ads")) args.push("--ads");
      if (optBool(i, "cookies")) args.push("--cookies");
      if (optBool(i, "sticky")) args.push("--sticky");
      if (optBool(i, "social")) args.push("--social");
      if (optBool(i, "overlays")) args.push("--overlays");
      if (optBool(i, "clutter")) args.push("--clutter");
      if (optBool(i, "all") || args.length === 0) args.push("--all");
      return args;
    },
    title: "Clean up page noise",
    description: "Remove ads, cookie banners, sticky headers, social widgets, overlays, clutter.",
    inputSchema: {
      all: s.optBool("Remove everything (default when no category given)"),
      ads: s.optBool("Only ads"),
      cookies: s.optBool("Only cookie banners"),
      sticky: s.optBool("Only sticky headers/footers"),
      social: s.optBool("Only social share widgets"),
      overlays: s.optBool("Only modal overlays / paywalls"),
      clutter: s.optBool("Only related-articles / recirculation widgets"),
    },
  },
  prettyscreenshot: {
    command: "prettyscreenshot",
    category: "write",
    argsFromInput: (i) => {
      const outputPath = optString(i, "outputPath");
      return outputPath ? [outputPath] : [];
    },
    title: "Cleaned screenshot",
    description: "Runs `cleanup --all` then screenshot. Output path must be in a safe directory.",
    inputSchema: { outputPath: s.optStr("Where to write the PNG (default: temp dir)") },
  },

  // ─── Snapshot (its own category) ──────────────────────────
  snapshot: {
    command: "snapshot",
    category: "snapshot",
    argsFromInput: (i) => {
      const args: string[] = [];
      if (optBool(i, "interactive")) args.push("--interactive");
      if (optBool(i, "compact")) args.push("--compact");
      args.push(...valueFlag("--depth", "depth", i));
      args.push(...valueFlag("--selector", "selector", i));
      if (optBool(i, "diff")) args.push("--diff");
      if (optBool(i, "annotate")) args.push("--annotate");
      args.push(...valueFlag("--output", "outputPath", i));
      if (optBool(i, "cursorInteractive")) args.push("--cursor-interactive");
      args.push(...valueFlag("--heatmap", "heatmap", i));
      return args;
    },
    title: "Accessibility snapshot",
    description:
      "Accessibility tree of the active tab with stable @e<N>/@c<N> refs. Use the refs in follow-up click/fill/screenshot calls.",
    inputSchema: {
      interactive: s.optBool("Interactive elements only (auto-enables cursorInteractive)"),
      compact: s.optBool("Drop empty structural nodes"),
      depth: s.optNum("Max tree depth (0 = root only)"),
      selector: s.optStr("Scope to CSS selector"),
      diff: s.optBool("Unified diff against previous snapshot"),
      annotate: s.optBool("Annotated screenshot with overlay boxes"),
      outputPath: s.optStr("Output path for annotated screenshot"),
      cursorInteractive: s.optBool("Also include cursor:pointer / onclick elements"),
      heatmap: s.optStr('JSON ref→color map, e.g. {"@e1":"green"}'),
    },
  },

  // ─── Meta (screenshots, tabs, PDFs, misc) ─────────────────
  screenshot: {
    command: "screenshot",
    category: "meta",
    argsFromInput: (i) => {
      const args: string[] = [];
      args.push(...boolFlag("--viewport", "viewport", i));
      args.push(...boolFlag("--base64", "base64", i));
      args.push(...valueFlag("--clip", "clip", i));
      const selector = optString(i, "selector");
      if (selector) args.push(selector);
      const outputPath = optString(i, "outputPath");
      if (outputPath) args.push(outputPath);
      return args;
    },
    title: "Screenshot",
    description: "Capture PNG of full page, viewport, clipped region, or element.",
    inputSchema: {
      viewport: s.optBool("Viewport only (not full page)"),
      base64: s.optBool("Return as data: URI instead of writing to disk"),
      clip: s.optStr("Clip rectangle as x,y,w,h"),
      selector: s.optStr(`${REF_DESC} for element screenshot`),
      outputPath: s.optStr("Where to write the PNG"),
    },
  },
  pdf: {
    command: "pdf",
    category: "meta",
    argsFromInput: (i) => {
      const outputPath = optString(i, "outputPath");
      return outputPath ? [outputPath] : [];
    },
    title: "Export page as PDF",
    description: "Save the current page as a PDF in a safe directory.",
    inputSchema: { outputPath: s.optStr("PDF output path") },
  },
  responsive: {
    command: "responsive",
    category: "meta",
    argsFromInput: (i) => {
      const prefix = optString(i, "prefix");
      return prefix ? [prefix] : [];
    },
    title: "Responsive screenshots",
    description:
      "Capture full-page screenshots at mobile (375x812), tablet (768x1024), and desktop (1280x720) viewports. Saves to `<prefix>-mobile.png`, `<prefix>-tablet.png`, `<prefix>-desktop.png`. Default prefix `<TEMP_DIR>/browse-responsive`. Prefix must be inside a safe directory (TEMP_DIR or cwd).",
    inputSchema: {
      prefix: s.optStr(
        "Output path prefix; final files are `<prefix>-{mobile,tablet,desktop}.png`.",
      ),
    },
  },
  diff: {
    command: "diff",
    category: "meta",
    argsFromInput: () => [],
    title: "Text diff vs last snapshot",
    description: "Unified diff of page text against the previous snapshot on this tab.",
    inputSchema: {},
  },
  tabs: {
    command: "tabs",
    category: "meta",
    argsFromInput: () => [],
    title: "List tabs",
    description: "List all tabs in the current context with titles and URLs.",
    inputSchema: {},
  },
  tab: {
    command: "tab",
    category: "meta",
    argsFromInput: (i, t) => {
      const id = optNumber(i, "id");
      if (id === undefined) throw new InputError(`${t}: missing required input.id (number)`);
      return [String(id)];
    },
    title: "Switch tab",
    description: "Switch the active tab by numeric id (see tabs).",
    inputSchema: { id: { type: "number", description: "Numeric tab id from tabs" } },
  },
  newtab: {
    command: "newtab",
    category: "meta",
    argsFromInput: (i) => {
      const url = optString(i, "url");
      return url ? [url] : [];
    },
    title: "Open new tab",
    description: "Open a new tab, optionally navigating to a URL.",
    inputSchema: { url: s.optStr("URL to navigate the new tab to") },
  },
  closetab: {
    command: "closetab",
    category: "meta",
    argsFromInput: (i) => {
      const id = optNumber(i, "id");
      return id === undefined ? [] : [String(id)];
    },
    title: "Close tab",
    description: "Close a tab by id, or the active tab if omitted.",
    inputSchema: { id: s.optNum("Tab id (default: active tab)") },
  },
  focus: {
    command: "focus",
    category: "meta",
    argsFromInput: () => [],
    title: "Focus browser window",
    description: "Bring the browser window to the front (headed mode only).",
    inputSchema: {},
  },
  status: {
    command: "status",
    category: "meta",
    argsFromInput: () => [],
    title: "Server status",
    description: "Current connection mode, tab count, active URL.",
    inputSchema: {},
  },
  "ux-audit": {
    command: "ux-audit",
    category: "meta",
    argsFromInput: () => [],
    title: "UX audit",
    description: "Heuristic UX/accessibility audit of the current page.",
    inputSchema: {},
  },
  load_extension: {
    command: "load_extension",
    category: "meta",
    argsFromInput: () => [],
    title: "Load pending Chrome Web Store extension",
    description:
      "Reads the pending Chrome Web Store install captured by the 'Add to Chrome' button, fetches the CRX from Google, extracts it, and loads it into the project browser session. Navigate to the extension's Web Store page and click 'Add to Chrome' before calling this tool. Returns the installed extension name, version, and ID. Desktop (Electron) host only.",
    inputSchema: {},
  },
  list_extensions: {
    command: "list_extensions",
    category: "meta",
    argsFromInput: () => [],
    title: "List installed extensions",
    description:
      "List all Chrome extensions installed in the embedded browser for this project. Returns extension ID, name, version, and whether a popup window is currently open. Use the ID with ext_switch to target a popup for snapshot/click/fill commands. Desktop (Electron) host only.",
    inputSchema: {},
  },
  ext_windows: {
    command: "ext_windows",
    category: "meta",
    argsFromInput: () => [],
    title: "List open extension popup windows",
    description:
      "List all open extension popup windows — both user-opened action popups and dapp approval/notification windows from chrome.windows.create(). Returns extension ID, title, URL, and whether it is the current active CDP target. Use ext_switch with an extension ID to target one for snapshot/click/fill commands. Desktop (Electron) host only.",
    inputSchema: {},
  },
  ext_switch: {
    command: "ext_switch",
    category: "meta",
    argsFromInput: (i) => {
      const id = optString(i, "extensionId");
      return id ? [id] : [];
    },
    title: "Switch CDP target to extension popup",
    description:
      "Route subsequent snapshot/click/fill/js commands to an extension popup window instead of the main browser tab. Pass extensionId to switch; omit to revert to the main browser tab. The popup must already be open (use ext_windows to check). Note: CDP event subscriptions (console, network) are not supported while targeting a popup. Desktop (Electron) host only.",
    inputSchema: {
      extensionId: s.optStr(
        "Extension ID (32-char a-p string, e.g. dgdongbhnogjdmalcjmoaohehadoolep). Omit to revert to main tab.",
      ),
    },
  },
  ext_close: {
    command: "ext_close",
    category: "meta",
    argsFromInput: (i, t) => [reqString(i, "extensionId", t)],
    title: "Close extension popup",
    description:
      "Close an open extension popup window by extension ID. Automatically reverts the active CDP target to the main browser tab if the popup being closed was the active target. Desktop (Electron) host only.",
    inputSchema: {
      extensionId: s.str("Extension ID of the popup to close"),
    },
  },
};

// Tools explicitly dropped from the T3 surface (daemon-era or meta-unsafe):
//   chain (replaced by our `batch`), handoff, resume, connect, disconnect,
//   stop, restart, state, watch, inbox, frame.
// See apps/server/src/browser/NOTICE for the full dropped list.

// ---------------------------------------------------------------------------
// Generic command dispatcher
// ---------------------------------------------------------------------------

function runCommand(
  tool: string,
  ctx: ToolContext,
  input: Record<string, unknown>,
): Effect.Effect<string, BrowserToolError, never> {
  const layerHandler = LAYER_HANDLERS[tool];
  if (layerHandler) return layerHandler(ctx, input);

  const spec = SPECS[tool];
  if (!spec) return Effect.fail(new BrowserToolError({ message: `unknown tool '${tool}'` }));
  let args: string[];
  try {
    args = spec.argsFromInput(input, tool);
  } catch (err) {
    return Effect.fail(toBrowserToolError(err));
  }
  return Effect.gen(function* () {
    const host = yield* ctx.resolver.get(ctx.projectId).pipe(Effect.mapError(toBrowserToolError));
    // Always dispatch through runTool. Going via host[tool] picks up private
    // class methods that happen to share a name with a BROWSER_HOST_TOOL_NAMES
    // slot but do not implement the (args, input) BrowserHostCommand contract
    // (e.g. ElectronWebContentsBrowserHost.hover/press/scroll/viewport etc.
    // take individual unwrapped parameters and break when called with the
    // dispatch (args, input) shape).
    return yield* Effect.tryPromise({
      try: () => host.runTool(args, { ...input, __toolName: tool }),
      catch: toBrowserToolError,
    });
  });
}

// ---------------------------------------------------------------------------
// Layer-routed tools (bypass the vendored dispatch)
// ---------------------------------------------------------------------------

type LayerHandler = (
  ctx: ToolContext,
  input: Record<string, unknown>,
) => Effect.Effect<string, BrowserToolError, never>;

const LAYER_HANDLERS: Record<string, LayerHandler> = {
  useragent: (ctx, input) => {
    const reset = optBool(input, "reset");
    const value = optString(input, "value");
    const args = reset ? ["--reset"] : value ? [value] : [];
    if (!reset && args.length === 0) {
      return Effect.fail(
        new BrowserToolError({
          message: "useragent: missing required input.value (string), or pass reset=true",
        }),
      );
    }
    return Effect.gen(function* () {
      const host = yield* ctx.resolver.get(ctx.projectId).pipe(Effect.mapError(toBrowserToolError));
      return yield* Effect.tryPromise({
        try: () => host.useragent(args, { ...input, __toolName: "useragent" }),
        catch: toBrowserToolError,
      });
    });
  },

  visibility: (ctx, input) => {
    const mode = optString(input, "mode");
    if (mode !== "headed" && mode !== "headless") {
      return Effect.fail(
        new BrowserToolError({ message: "visibility: input.mode must be 'headed' or 'headless'" }),
      );
    }
    return Effect.gen(function* () {
      const host = yield* ctx.resolver.get(ctx.projectId).pipe(Effect.mapError(toBrowserToolError));
      return yield* Effect.tryPromise({
        try: () => host.visibility([mode], { ...input, __toolName: "visibility" }),
        catch: toBrowserToolError,
      });
    });
  },
};

// ---------------------------------------------------------------------------
// Public handler map + tool definitions
// ---------------------------------------------------------------------------

export const playwrightCommandDescriptors: ReadonlyMap<
  BrowserHostToolName,
  PlaywrightCommandDescriptor
> = new Map(
  Object.entries(SPECS).map(([name, spec]) => [
    name as BrowserHostToolName,
    { command: spec.command, category: spec.category },
  ]),
);

/**
 * The full T3 browser tool surface. Each spec in SPECS becomes a ToolHandler
 * that translates `{tool, input}` → vendored `{command, args[]}` → plaintext
 * output wrapped in `respondOk({ output })`. The `batch` tool is a special
 * case that runs multiple specs sequentially.
 */
export function buildCommandHandlers(ctx: ToolContext): Record<string, ToolHandler> {
  const wrap =
    (name: string): ToolHandler =>
    (input) =>
      runCommand(name, ctx, input).pipe(Effect.map((output) => respondOk({ output })));

  const handlers: Record<string, ToolHandler> = {};
  for (const name of Object.keys(SPECS)) {
    handlers[name] = wrap(name);
  }
  // T3-authored meta-tools that aren't in SPECS still need handler entries
  // so the dispatcher in http.ts finds them.
  for (const name of Object.keys(LAYER_HANDLERS)) {
    if (!handlers[name]) handlers[name] = wrap(name);
  }

  handlers.batch = (input) => {
    const commands = input.commands;
    if (!Array.isArray(commands))
      return Effect.succeed(
        respondError("batch: input.commands must be an array of { tool, input } objects"),
      );
    if (commands.length === 0)
      return Effect.succeed(respondError("batch: input.commands must contain at least one entry"));
    if (commands.length > 50)
      return Effect.succeed(respondError("batch: at most 50 commands per request"));

    return Effect.gen(function* () {
      const lines: string[] = [];
      for (let i = 0; i < commands.length; i++) {
        const entry = commands[i];
        if (!entry || typeof entry !== "object") {
          lines.push(`[${i + 1}] ERROR: batch entry is not an object`);
          continue;
        }
        const { tool, input: childInput } = entry as Record<string, unknown>;
        if (typeof tool !== "string") {
          lines.push(`[${i + 1}] ERROR: batch entry missing 'tool' string`);
          continue;
        }
        if (tool === "batch") {
          lines.push(`[${i + 1}] ERROR: nested batch is not allowed`);
          continue;
        }
        const normalized =
          childInput && typeof childInput === "object"
            ? (childInput as Record<string, unknown>)
            : {};
        const result = yield* runCommand(tool, ctx, normalized).pipe(
          Effect.map((output) => ({ ok: true as const, output })),
          Effect.catch((error) =>
            Effect.succeed({
              ok: false as const,
              error: errorMessage(error),
            }),
          ),
        );
        if (result.ok) {
          lines.push(`[${i + 1}] ${tool}:\n${result.output}`);
        } else {
          lines.push(`[${i + 1}] ${tool} ERROR: ${result.error}`);
        }
      }
      return respondOk({ output: lines.join("\n\n") });
    });
  };

  return handlers;
}

/** Tool registry for GET /api/browser. `batch` and `visibility` are
 *  hand-added since they are T3-authored meta-tools with no vendored SPEC
 *  entry. */
export const toolDefinitions: ToolDefinition[] = [
  ...Object.entries(SPECS).map(
    ([name, spec]): ToolDefinition => ({
      name,
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputSchema,
    }),
  ),
  {
    name: "visibility",
    title: "Set browser visibility (headed / headless)",
    description:
      "Flip the Chromium window between headless and headed. Default is headless — call this with mode='headed' when you want the user to watch the agent work (demos, debugging), then mode='headless' to hide again. The current tab is closed and relaunched but the per-project profile (cookies, localStorage, auth sessions) is preserved.",
    inputSchema: {
      mode: {
        type: "string",
        description: "'headed' (visible window) or 'headless' (default, invisible)",
      },
    },
  },
  {
    name: "batch",
    title: "Batch commands",
    description:
      "Execute up to 50 commands sequentially in a single request. Returns combined plaintext output. Nested batches are rejected.",
    inputSchema: {
      commands: {
        type: "array",
        description:
          "Array of { tool: string, input: object } entries. Each entry uses the same shape as a top-level /api/browser POST.",
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Kept for import-graph stability
// ---------------------------------------------------------------------------

export { BrowserHostResolver };
