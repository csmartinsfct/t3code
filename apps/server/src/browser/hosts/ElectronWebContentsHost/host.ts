import { snapshotFromCdp } from "./snapshot.ts";
import type {
  CdpBoxModel,
  CdpClient,
  RefEntry,
  ResolvedRef,
  ScreenshotResult,
  SnapshotOptions,
  SnapshotResult,
} from "./types.ts";

interface RuntimeEvaluateResponse<T> {
  result: {
    value?: T;
  };
}

interface LayoutMetricsResponse {
  visualViewport?: {
    scale?: number;
  };
}

export class ElectronWebContentsHost {
  private refs = new Map<string, RefEntry>();

  constructor(private readonly client: CdpClient) {}

  async snapshot(options: SnapshotOptions = {}): Promise<SnapshotResult> {
    const result = await snapshotFromCdp(this.client, options);
    this.refs = result.refs;
    return result;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.client.sendCommand<RuntimeEvaluateResponse<T>>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return response.result.value as T;
  }

  async resolveRef(ref: string): Promise<ResolvedRef> {
    const cleanRef = ref.startsWith("@") ? ref.slice(1) : ref;
    const entry = this.refs.get(cleanRef);
    if (!entry) throw new Error(`Ref ${ref} not found. Run snapshot to get fresh refs.`);

    if (entry.kind === "cursor") {
      return { ref: cleanRef, entry };
    }

    if (entry.backendNodeId !== undefined && (await this.isBackendNodeAlive(entry.backendNodeId))) {
      return { ref: cleanRef, entry, backendNodeId: entry.backendNodeId };
    }

    const fallback = await this.queryAxTreeForTuple(entry);
    if (fallback !== undefined) {
      entry.backendNodeId = fallback;
      return { ref: cleanRef, entry, backendNodeId: fallback };
    }

    throw new Error(`Ref ${ref} is stale. Run snapshot to get fresh refs.`);
  }

  async click(ref: string): Promise<void> {
    const resolved = await this.resolveRef(ref);
    const point = await this.centerPoint(resolved);
    await this.client.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await this.client.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
  }

  async fill(ref: string, text: string): Promise<void> {
    await this.click(ref);
    await this.client.sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers: 2,
    });
    await this.client.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers: 2,
    });
    await this.type(text);
  }

  async type(text: string): Promise<void> {
    await this.client.sendCommand("Input.insertText", { text });
  }

  async scroll(deltaY: number, deltaX = 0): Promise<void> {
    await this.client.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 0,
      y: 0,
      deltaX,
      deltaY,
    });
  }

  async captureScreenshot(): Promise<ScreenshotResult> {
    const [screenshot, metrics] = await Promise.all([
      this.client.sendCommand<{ data: string }>("Page.captureScreenshot", { format: "png" }),
      this.client.sendCommand<LayoutMetricsResponse>("Page.getLayoutMetrics"),
    ]);
    return {
      buffer: Buffer.from(screenshot.data, "base64"),
      devicePixelRatio: metrics.visualViewport?.scale ?? 1,
    };
  }

  private async isBackendNodeAlive(backendNodeId: number): Promise<boolean> {
    try {
      await this.client.sendCommand("DOM.describeNode", { backendNodeId });
      return true;
    } catch {
      return false;
    }
  }

  private async queryAxTreeForTuple(entry: RefEntry): Promise<number | undefined> {
    const response = await this.client.sendCommand<{
      nodes: Array<{
        role?: { value?: string };
        name?: { value?: string };
        backendDOMNodeId?: number;
      }>;
    }>("Accessibility.queryAXTree", {
      accessibleName: entry.name || undefined,
      role: entry.role,
    });
    const matches = response.nodes.filter((node) => {
      const role = String(node.role?.value ?? "");
      const name = String(node.name?.value ?? "");
      return role === entry.role && name === entry.name && node.backendDOMNodeId !== undefined;
    });
    return matches[entry.nth]?.backendDOMNodeId;
  }

  private async centerPoint(resolved: ResolvedRef): Promise<{ x: number; y: number }> {
    if (resolved.entry.kind === "cursor") {
      const selector = JSON.stringify(resolved.entry.selector);
      const box = await this.evaluate<{
        x: number;
        y: number;
        width: number;
        height: number;
      } | null>(
        `(() => {
          const el = document.querySelector(${selector});
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })()`,
      );
      if (!box) throw new Error(`Ref @${resolved.ref} is stale. Run snapshot to get fresh refs.`);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }

    if (resolved.backendNodeId === undefined) {
      throw new Error(`Ref @${resolved.ref} cannot be resolved to a backend node.`);
    }
    const response = await this.client.sendCommand<CdpBoxModel>("DOM.getBoxModel", {
      backendNodeId: resolved.backendNodeId,
    });
    const [x1, y1, x2, y2, x3, y3, x4, y4] = response.model.border;
    if (
      x1 === undefined ||
      y1 === undefined ||
      x2 === undefined ||
      y2 === undefined ||
      x3 === undefined ||
      y3 === undefined ||
      x4 === undefined ||
      y4 === undefined
    ) {
      throw new Error(`Ref @${resolved.ref} has no usable box model.`);
    }
    return {
      x: (x1 + x2 + x3 + x4) / 4,
      y: (y1 + y2 + y3 + y4) / 4,
    };
  }
}
