import { assert, describe, it } from "@effect/vitest";

import { CURSOR_INTERACTIVE_SCAN_SOURCE } from "./cursorInteractive.ts";
import { ElectronWebContentsHost } from "./host.ts";
import { buildSnapshotFromAxNodes } from "./snapshot.ts";
import type { AxNode, CdpClient } from "./types.ts";

const axNodes: AxNode[] = [
  {
    nodeId: "1",
    role: { value: "RootWebArea" },
    name: { value: "" },
    childIds: ["2", "3", "4", "5"],
  },
  {
    nodeId: "2",
    role: { value: "heading" },
    name: { value: "Example Domain" },
    properties: [{ name: "level", value: { value: 1 } }],
    backendDOMNodeId: 100,
  },
  {
    nodeId: "3",
    role: { value: "link" },
    name: { value: "More information" },
    backendDOMNodeId: 101,
  },
  {
    nodeId: "4",
    role: { value: "link" },
    name: { value: "More information" },
    backendDOMNodeId: 102,
  },
  {
    nodeId: "5",
    role: { value: "textbox" },
    name: { value: "Email" },
    backendDOMNodeId: 103,
  },
];

describe("ElectronWebContentsHost snapshot PoC", () => {
  it("builds Playwright-shaped refs from a CDP AX tree", () => {
    const snapshot = buildSnapshotFromAxNodes(axNodes, [], {});
    assert.include(snapshot.text, '@e1 [heading] "Example Domain" [level=1]');
    assert.include(snapshot.text, '@e2 [link] "More information"');
    assert.include(snapshot.text, '@e3 [link] "More information"');
    assert.include(snapshot.text, '@e4 [textbox] "Email"');

    assert.deepEqual(snapshot.refs.get("e2"), {
      kind: "ax",
      role: "link",
      name: "More information",
      nth: 0,
      backendNodeId: 101,
    });
    assert.deepEqual(snapshot.refs.get("e3"), {
      kind: "ax",
      role: "link",
      name: "More information",
      nth: 1,
      backendNodeId: 102,
    });
  });

  it("keeps nth indexing stable when filtering to interactive refs", () => {
    const snapshot = buildSnapshotFromAxNodes(axNodes, [], { interactive: true });
    assert.notInclude(snapshot.text, "heading");
    assert.include(snapshot.text, '@e1 [link] "More information"');
    assert.include(snapshot.text, '@e2 [link] "More information"');
    assert.equal(snapshot.refs.get("e1")?.nth, 0);
    assert.equal(snapshot.refs.get("e2")?.nth, 1);
  });

  it("adds cursor-interactive refs from the Runtime.evaluate scan", () => {
    const snapshot = buildSnapshotFromAxNodes(
      axNodes,
      [
        {
          selector: "body > div:nth-child(1)",
          text: "Floating action",
          reason: "popover-child, role=menuitem",
        },
      ],
      { interactive: true },
    );
    assert.include(snapshot.text, "── cursor-interactive");
    assert.include(snapshot.text, '@c1 [popover-child, role=menuitem] "Floating action"');
    assert.deepEqual(snapshot.refs.get("c1"), {
      kind: "cursor",
      role: "cursor-interactive",
      name: "Floating action",
      nth: 0,
      selector: "body > div:nth-child(1)",
    });
  });

  it("uses cached backendNodeId first, then slow-path queryAXTree on staleness", async () => {
    const calls: string[] = [];
    const client: CdpClient = {
      async sendCommand(method, params) {
        calls.push(`${method}:${JSON.stringify(params ?? {})}`);
        if (method === "Accessibility.getFullAXTree") return { nodes: axNodes } as never;
        if (method === "DOM.describeNode") {
          if ((params as { backendNodeId: number }).backendNodeId === 101) throw new Error("stale");
          return { node: {} } as never;
        }
        if (method === "Accessibility.queryAXTree") {
          return {
            nodes: [
              {
                role: { value: "link" },
                name: { value: "More information" },
                backendDOMNodeId: 201,
              },
              {
                role: { value: "link" },
                name: { value: "More information" },
                backendDOMNodeId: 202,
              },
            ],
          } as never;
        }
        return {} as never;
      },
    };
    const host = new ElectronWebContentsHost(client);
    await host.snapshot();
    const resolved = await host.resolveRef("@e2");

    assert.equal(resolved.backendNodeId, 201);
    assert.isTrue(calls.some((call) => call.startsWith("DOM.describeNode")));
    assert.isTrue(calls.some((call) => call.startsWith("Accessibility.queryAXTree")));
  });

  it("uses the vendored cursor-interactive heuristics in the Runtime.evaluate source", () => {
    assert.include(CURSOR_INTERACTIVE_SCAN_SOURCE, "cursor:pointer");
    assert.include(CURSOR_INTERACTIVE_SCAN_SOURCE, "data-radix-portal");
    assert.include(CURSOR_INTERACTIVE_SCAN_SOURCE, "role=");
    assert.include(CURSOR_INTERACTIVE_SCAN_SOURCE, "menuitem");
    assert.include(CURSOR_INTERACTIVE_SCAN_SOURCE, "nth-child");
  });
});
