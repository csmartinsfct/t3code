import { buildSnapshotFromAxNodes, snapshotFromCdp } from "./snapshot.ts";
import type {
  AxNode,
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
  cssVisualViewport?: {
    clientWidth?: number;
    clientHeight?: number;
  };
}

interface ResolveNodeResponse {
  object: {
    objectId?: string;
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

    const fallback = await this.resolveFromFullAxTree(entry);
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
      buttons: 1,
      clickCount: 1,
    });
    await this.client.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await this.activateResolved(resolved);
  }

  async fill(ref: string, text: string): Promise<void> {
    await this.click(ref);
    const modifiers = await this.selectAllModifier();
    await this.client.sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers,
    });
    await this.client.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers,
    });
    await this.type(text);
  }

  async type(text: string): Promise<void> {
    await this.client.sendCommand("Input.insertText", { text });
  }

  async scroll(deltaY: number, deltaX = 0, point?: { x: number; y: number }): Promise<void> {
    void point;
    await this.evaluate<void>(
      `window.scrollBy(${JSON.stringify(deltaX)}, ${JSON.stringify(deltaY)})`,
    );
  }

  async captureScreenshot(): Promise<ScreenshotResult> {
    const [screenshot, devicePixelRatio] = await Promise.all([
      this.client.sendCommand<{ data: string }>("Page.captureScreenshot", { format: "png" }),
      this.evaluate<number>("window.devicePixelRatio"),
    ]);
    return {
      buffer: Buffer.from(screenshot.data, "base64"),
      devicePixelRatio:
        Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1,
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

  private async resolveFromFullAxTree(entry: RefEntry): Promise<number | undefined> {
    const response = await this.client.sendCommand<{ nodes: AxNode[] }>(
      "Accessibility.getFullAXTree",
    );
    const snapshot = buildSnapshotFromAxNodes(response.nodes, [], {});
    for (const candidate of snapshot.refs.values()) {
      if (
        candidate.kind === "ax" &&
        candidate.role === entry.role &&
        candidate.name === entry.name &&
        candidate.nth === entry.nth
      ) {
        return candidate.backendNodeId;
      }
    }
    return undefined;
  }

  private async selectAllModifier(): Promise<number> {
    try {
      const platform = await this.evaluate<string>("navigator.platform");
      return /\bmac/i.test(platform) ? 4 : 2;
    } catch {
      return process.platform === "darwin" ? 4 : 2;
    }
  }

  private async viewportCenter(): Promise<{ x: number; y: number }> {
    const metrics = await this.client.sendCommand<LayoutMetricsResponse>("Page.getLayoutMetrics");
    return {
      x: (metrics.cssVisualViewport?.clientWidth ?? 0) / 2,
      y: (metrics.cssVisualViewport?.clientHeight ?? 0) / 2,
    };
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
    const rectPoint = await this.centerPointFromBackendNode(resolved.backendNodeId);
    if (rectPoint !== undefined) return rectPoint;

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

  private async centerPointFromBackendNode(
    backendNodeId: number,
  ): Promise<{ x: number; y: number } | undefined> {
    try {
      const resolved = await this.client.sendCommand<ResolveNodeResponse>("DOM.resolveNode", {
        backendNodeId,
      });
      const objectId = resolved.object.objectId;
      if (!objectId) return undefined;
      const response = await this.client.sendCommand<
        RuntimeEvaluateResponse<{ x: number; y: number; width: number; height: number }>
      >("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function () {
          const rect = this.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }`,
        returnByValue: true,
      });
      const rect = response.result.value;
      if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    } catch {
      return undefined;
    }
  }

  private async activateResolved(resolved: ResolvedRef): Promise<void> {
    try {
      if (resolved.entry.kind === "cursor") {
        const selector = JSON.stringify(resolved.entry.selector);
        await this.evaluate<void>(`document.querySelector(${selector})?.click()`);
        return;
      }
      if (resolved.backendNodeId === undefined) return;
      const node = await this.client.sendCommand<ResolveNodeResponse>("DOM.resolveNode", {
        backendNodeId: resolved.backendNodeId,
      });
      const objectId = node.object.objectId;
      if (!objectId) return;
      await this.client.sendCommand("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: "function () { this.click?.(); }",
        returnByValue: true,
      });
    } catch {
      // CDP input above is the primary path; activation is a best-effort embedded-mode fallback.
    }
  }
}
