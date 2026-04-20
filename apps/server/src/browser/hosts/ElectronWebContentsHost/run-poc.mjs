import { app, BrowserWindow, WebContentsView } from "electron";

const TARGETS = [
  "https://example.com",
  "https://news.ycombinator.com",
  "https://accounts.google.com/signin/v2/identifier",
  "data:text/html,<button id='open'>Open</button><div id='modal' style='display:none;position:fixed;z-index:20;top:40px;left:40px'><div role='menu'><div role='menuitem'>Floating action</div></div></div><script>open.onclick=()=>modal.style.display='block'</script>",
  "data:text/html,<h1>Frame test</h1><iframe srcdoc='<button>Inside frame</button>'></iframe><button>Outer button</button>",
];

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

function valueAsString(value) {
  return value === undefined || value === null ? "" : String(value);
}

function flattenAxTree(nodes) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const childIds = new Set(nodes.flatMap((node) => node.childIds ?? []));
  const root = nodes.find((node) => !childIds.has(node.nodeId)) ?? nodes[0];
  const output = [];
  const seen = new Set();

  const visit = (node, depth, isRoot = false) => {
    if (seen.has(node.nodeId)) return;
    seen.add(node.nodeId);

    const role = valueAsString(node.role?.value);
    const name = valueAsString(node.name?.value);
    const skipWrapper =
      isRoot || ((role === "RootWebArea" || role === "WebArea" || role === "none") && name === "");
    const visibleDepth = skipWrapper ? depth : depth + 1;

    if (!node.ignored && role && !skipWrapper) {
      output.push({
        role,
        name,
        depth,
        backendNodeId: node.backendDOMNodeId,
      });
    }

    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child) visit(child, visibleDepth);
    }
  };

  if (root) visit(root, 0, true);
  return output;
}

function renderSnapshot(nodes) {
  const lines = [];
  const refs = new Map();
  const seen = new Map();
  let counter = 1;

  for (const node of flattenAxTree(nodes)) {
    if (!INTERACTIVE_ROLES.has(node.role) && node.role !== "heading") continue;
    const key = `${node.role}:${node.name}`;
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    const ref = `e${counter++}`;
    refs.set(ref, { role: node.role, name: node.name, nth, backendNodeId: node.backendNodeId });
    lines.push(
      `${"  ".repeat(node.depth)}@${ref} [${node.role}]${node.name ? ` "${node.name}"` : ""}`,
    );
  }

  return { text: lines.join("\n") || "(no accessible elements found)", refs };
}

async function main() {
  await app.whenReady();

  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { offscreen: true },
  });
  const view = new WebContentsView();
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1280, height: 900 });

  const debuggerClient = view.webContents.debugger;
  debuggerClient.attach("1.3");

  console.log(`Electron ${process.versions.electron} / Chrome ${process.versions.chrome}`);
  for (const target of TARGETS) {
    await view.webContents.loadURL(target);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const axTree = await debuggerClient.sendCommand("Accessibility.getFullAXTree");
    const snapshot = renderSnapshot(axTree.nodes);
    console.log(`\n## ${target}`);
    console.log(snapshot.text.split("\n").slice(0, 30).join("\n"));
    console.log(`refs=${snapshot.refs.size}`);
  }

  debuggerClient.detach();
  window.close();
  app.quit();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
