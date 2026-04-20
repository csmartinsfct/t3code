import {
  CURSOR_INTERACTIVE_SCAN_SOURCE,
  type CursorInteractiveElement,
} from "./cursorInteractive.ts";
import type { AxNode, CdpClient, RefEntry, SnapshotOptions, SnapshotResult } from "./types.ts";

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "treeitem",
]);

const STRUCTURAL_ROOT_ROLES = new Set(["RootWebArea", "WebArea", "none", "generic"]);

interface CdpAxTreeResponse {
  nodes: AxNode[];
}

interface FlatAxNode {
  role: string;
  name: string;
  depth: number;
  backendNodeId?: number;
  props: string;
}

function valueAsString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function nodeRole(node: AxNode): string {
  return valueAsString(node.role?.value);
}

function nodeName(node: AxNode): string {
  return valueAsString(node.name?.value);
}

function nodeProps(node: AxNode): string {
  const props: string[] = [];
  for (const property of node.properties ?? []) {
    if (property.name === "level" && property.value?.value !== undefined) {
      props.push(`level=${property.value.value}`);
    }
  }
  return props.length > 0 ? `[${props.join(" ")}]` : "";
}

function shouldSkipWrapper(node: AxNode, isRoot: boolean): boolean {
  const role = nodeRole(node);
  const name = nodeName(node);
  return isRoot || (STRUCTURAL_ROOT_ROLES.has(role) && name.length === 0);
}

export function flattenAxTree(nodes: AxNode[]): FlatAxNode[] {
  if (nodes.length === 0) return [];

  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const childIds = new Set(nodes.flatMap((node) => node.childIds ?? []));
  const root = nodes.find((node) => !childIds.has(node.nodeId)) ?? nodes[0];
  const output: FlatAxNode[] = [];
  const seen = new Set<string>();

  const visit = (node: AxNode, depth: number, isRoot = false) => {
    if (seen.has(node.nodeId)) return;
    seen.add(node.nodeId);

    const role = nodeRole(node);
    const name = nodeName(node);
    const skipped = node.ignored || role.length === 0;
    const skipWrapper = shouldSkipWrapper(node, isRoot);
    const visibleDepth = skipWrapper ? depth : depth + 1;

    if (!skipped && !skipWrapper) {
      const flatNode: FlatAxNode = {
        role,
        name,
        depth,
        props: nodeProps(node),
      };
      if (node.backendDOMNodeId !== undefined) {
        flatNode.backendNodeId = node.backendDOMNodeId;
      }
      output.push(flatNode);
    }

    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child) visit(child, visibleDepth);
    }
  };

  if (root) visit(root, 0, true);
  return output;
}

export function buildSnapshotFromAxNodes(
  nodes: AxNode[],
  cursorElements: CursorInteractiveElement[],
  options: SnapshotOptions = {},
): SnapshotResult {
  const refs = new Map<string, RefEntry>();
  const lines: string[] = [];
  const flatNodes = flattenAxTree(nodes);
  const roleNameSeen = new Map<string, number>();
  let elementRefCounter = 1;

  for (const node of flatNodes) {
    const key = `${node.role}:${node.name}`;
    const nth = roleNameSeen.get(key) ?? 0;
    roleNameSeen.set(key, nth + 1);

    const isInteractive = INTERACTIVE_ROLES.has(node.role);
    if (options.depth !== undefined && node.depth > options.depth) continue;
    if (options.interactive && !isInteractive) continue;
    if (options.compact && !isInteractive && node.name.length === 0) continue;

    const ref = `e${elementRefCounter++}`;
    const entry: RefEntry = {
      kind: "ax",
      role: node.role,
      name: node.name,
      nth,
    };
    if (node.backendNodeId !== undefined) {
      entry.backendNodeId = node.backendNodeId;
    }
    refs.set(ref, entry);

    const indent = "  ".repeat(node.depth);
    const name = node.name ? ` "${node.name}"` : "";
    const props = node.props ? ` ${node.props}` : "";
    lines.push(`${indent}@${ref} [${node.role}]${name}${props}`);
  }

  const includeCursorInteractive = options.cursorInteractive || options.interactive;
  if (includeCursorInteractive && cursorElements.length > 0) {
    lines.push("");
    lines.push("── cursor-interactive (not in ARIA tree) ──");
    let cursorRefCounter = 1;
    for (const element of cursorElements) {
      const ref = `c${cursorRefCounter++}`;
      refs.set(ref, {
        kind: "cursor",
        role: "cursor-interactive",
        name: element.text,
        nth: cursorRefCounter - 2,
        selector: element.selector,
      });
      lines.push(`@${ref} [${element.reason}] "${element.text}"`);
    }
  }

  return {
    text: lines.length > 0 ? lines.join("\n") : "(no accessible elements found)",
    refs,
  };
}

export async function snapshotFromCdp(
  client: CdpClient,
  options: SnapshotOptions = {},
): Promise<SnapshotResult> {
  const axTree = await client.sendCommand<CdpAxTreeResponse>("Accessibility.getFullAXTree");
  const cursorElements =
    options.cursorInteractive || options.interactive
      ? await client
          .sendCommand<{ result: { value?: CursorInteractiveElement[] } }>("Runtime.evaluate", {
            expression: CURSOR_INTERACTIVE_SCAN_SOURCE,
            returnByValue: true,
          })
          .then((response) => response.result.value ?? [])
      : [];

  return buildSnapshotFromAxNodes(axTree.nodes, cursorElements, options);
}
