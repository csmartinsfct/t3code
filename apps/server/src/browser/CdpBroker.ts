export interface CdpBrokerSendOptions {
  readonly timeoutMs?: number;
}

export interface CdpBrokerEvent {
  readonly method: string;
  readonly params: unknown;
  readonly sessionId?: string;
  readonly backpressure?: {
    readonly queued: number;
    readonly capacity: number;
    readonly dropped: number;
  };
}

export interface CdpBrokerTransport {
  readonly send: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly sessionId: string;
    readonly method: string;
    readonly params?: Record<string, unknown>;
  }) => Promise<unknown>;
  readonly subscribe: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly sessionId: string;
    readonly eventName: string;
    readonly emit: (event: CdpBrokerEvent) => void;
    readonly fail: (cause: unknown) => void;
  }) => Promise<() => Promise<void> | void>;
  readonly attachTarget?: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly targetId: string;
  }) => Promise<string>;
  readonly printPdf?: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly options?: Record<string, unknown>;
  }) => Promise<string>;
  readonly listTabs?: (request: {
    readonly id: string;
    readonly viewId: string;
  }) => Promise<BrowserTabListing>;
  readonly newTab?: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly url?: string;
  }) => Promise<number>;
  readonly switchTab?: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly tabId: number;
  }) => Promise<number>;
  readonly closeTab?: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly tabId: number;
  }) => Promise<number>;
  readonly installExtension?: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly extensionId: string;
  }) => Promise<InstalledExtensionInfo>;
  readonly listExtensions?: (request: {
    readonly id: string;
    readonly viewId: string;
  }) => Promise<ExtensionInfo[]>;
  readonly listExtensionWindows?: (request: {
    readonly id: string;
    readonly viewId: string;
  }) => Promise<ExtensionWindowInfo[]>;
  readonly extSwitch?: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly extensionId?: string;
    readonly popupKey?: string;
  }) => Promise<ExtSwitchResult>;
  readonly extClose?: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly extensionId?: string;
    readonly popupKey?: string;
  }) => Promise<void>;
  readonly extOpen?: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly extensionId: string;
  }) => Promise<{ popupKey: string }>;
  readonly loadUnpacked?: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly folderPath: string;
  }) => Promise<import("@t3tools/contracts").BrowserExtensionInfo>;
  readonly reloadExtension?: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly extensionId: string;
  }) => Promise<void>;
  readonly removeExtension?: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly extensionId: string;
  }) => Promise<void>;
}

export interface InstalledExtensionInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

export interface ExtensionInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly hasPopup: boolean;
}

export interface ExtensionWindowInfo {
  readonly popupKey: string;
  readonly extensionId: string;
  readonly popupType?: string;
  readonly title: string;
  readonly url: string;
  readonly isActive: boolean;
  readonly createdAt?: number;
}

export interface ExtSwitchResult {
  readonly switched: boolean;
  readonly popupKey: string | null;
}

export interface BrowserTabSummary {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly favicon: string | null;
  readonly active: boolean;
}

export interface BrowserTabListing {
  readonly tabs: ReadonlyArray<BrowserTabSummary>;
  readonly activeTabId: number;
}

function extensionPopupSelectorFromArg(value: string): {
  readonly extensionId?: string;
  readonly popupKey?: string;
} {
  return value.startsWith("popup-") ? { popupKey: value } : { extensionId: value };
}

export class CdpBrokerError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options: { code?: string; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CdpBrokerError";
    this.code = options.code ?? "CDP_BROKER_ERROR";
    this.details = options.details;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  label: string,
): Promise<T> {
  if (timeoutMs === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new CdpBrokerError(`${label} timed out after ${timeoutMs}ms`, { code: "CDP_TIMEOUT" }),
      );
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class CdpBroker {
  private nextRequestId = 1;

  constructor(
    private readonly transport: CdpBrokerTransport,
    private readonly options: { readonly eventQueueCapacity?: number } = {},
  ) {}

  private requestId(): string {
    return `cdp-${this.nextRequestId++}`;
  }

  async send<T = unknown>(
    viewId: string,
    sessionId: string,
    method: string,
    params?: Record<string, unknown>,
    options: CdpBrokerSendOptions = {},
  ): Promise<T> {
    try {
      return (await withTimeout(
        this.transport.send({
          id: this.requestId(),
          viewId,
          sessionId,
          method,
          ...(params === undefined ? {} : { params }),
        }),
        options.timeoutMs,
        `CDP ${method}`,
      )) as T;
    } catch (cause) {
      if (cause instanceof CdpBrokerError) throw cause;
      throw new CdpBrokerError(`CDP ${method} failed`, {
        code: "CDP_SEND_FAILED",
        details: { viewId, sessionId, method },
        cause,
      });
    }
  }

  subscribe(viewId: string, sessionId: string, eventName: string): AsyncIterable<CdpBrokerEvent> {
    const capacity = this.options.eventQueueCapacity ?? 100;
    const queue: CdpBrokerEvent[] = [];
    const waiters: Array<{
      readonly resolve: (next: IteratorResult<CdpBrokerEvent>) => void;
      readonly reject: (cause: unknown) => void;
    }> = [];
    let closed = false;
    let unsubscribe: (() => Promise<void> | void) | undefined;
    let setupError: unknown;
    let streamError: unknown;
    let dropped = 0;

    const fail = (cause: unknown): void => {
      if (closed) return;
      streamError = cause;
      closed = true;
      for (const waiter of waiters.splice(0)) waiter.reject(cause);
      void unsubscribe?.();
    };

    const emit = (event: CdpBrokerEvent): void => {
      if (closed) return;
      const queued = Math.min(queue.length + 1, capacity);
      const enriched = (wasDropped: boolean) =>
        ({
          ...event,
          backpressure: {
            queued: wasDropped ? capacity : queued,
            capacity,
            dropped,
          },
        }) satisfies CdpBrokerEvent;
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve({ done: false, value: enriched(false) });
        return;
      }
      if (queue.length >= capacity) {
        queue.shift();
        dropped++;
        queue.push(enriched(true));
        return;
      }
      queue.push(enriched(false));
    };

    const setup = this.transport
      .subscribe({
        id: this.requestId(),
        viewId,
        sessionId,
        eventName,
        emit,
        fail,
      })
      .then((dispose) => {
        unsubscribe = dispose;
        if (closed) void unsubscribe();
      })
      .catch((cause: unknown) => {
        setupError = cause;
        fail(cause);
      });

    return {
      [Symbol.asyncIterator]() {
        return {
          next: async (): Promise<IteratorResult<CdpBrokerEvent>> => {
            await setup;
            if (setupError) throw setupError;
            if (queue.length > 0) return { done: false, value: queue.shift()! };
            if (streamError) throw streamError;
            if (closed) return { done: true, value: undefined };
            return new Promise<IteratorResult<CdpBrokerEvent>>((resolve, reject) => {
              waiters.push({ resolve, reject });
            });
          },
          return: async (): Promise<IteratorResult<CdpBrokerEvent>> => {
            closed = true;
            for (const waiter of waiters.splice(0)) {
              waiter.resolve({ done: true, value: undefined });
            }
            await unsubscribe?.();
            return { done: true, value: undefined };
          },
        };
      },
    };
  }

  async attachTarget(viewId: string, targetId: string): Promise<string> {
    if (!this.transport.attachTarget) {
      throw new CdpBrokerError("CDP target attachment is not available for this transport", {
        code: "CDP_ATTACH_TARGET_UNAVAILABLE",
        details: { viewId, targetId },
      });
    }
    try {
      return await this.transport.attachTarget({ id: this.requestId(), viewId, targetId });
    } catch (cause) {
      throw new CdpBrokerError(`CDP attachTarget failed for target ${targetId}`, {
        code: "CDP_ATTACH_TARGET_FAILED",
        details: { viewId, targetId },
        cause,
      });
    }
  }

  // `Page.printToPDF` is not exposed on Electron's embedded debugger, so the
  // Electron transport routes PDF requests through `webContents.printToPDF()`
  // in the main process and returns a base64 blob. Transports without native
  // PDF support (e.g. Playwright) will throw `CDP_PRINT_PDF_UNAVAILABLE` here;
  // the host should fall back to `Page.printToPDF` via the regular send path.
  async printPdf(viewId: string, options?: Record<string, unknown>): Promise<string> {
    if (!this.transport.printPdf) {
      throw new CdpBrokerError("printPdf is not available for this transport", {
        code: "CDP_PRINT_PDF_UNAVAILABLE",
        details: { viewId },
      });
    }
    try {
      return await this.transport.printPdf({
        id: this.requestId(),
        viewId,
        ...(options === undefined ? {} : { options }),
      });
    } catch (cause) {
      throw new CdpBrokerError(`printPdf failed for view ${viewId}`, {
        code: "CDP_PRINT_PDF_FAILED",
        details: { viewId },
        cause,
      });
    }
  }

  async listTabs(viewId: string): Promise<BrowserTabListing> {
    if (!this.transport.listTabs) {
      throw new CdpBrokerError("listTabs is not available for this transport", {
        code: "CDP_LIST_TABS_UNAVAILABLE",
        details: { viewId },
      });
    }
    return this.transport.listTabs({ id: this.requestId(), viewId });
  }

  async newTab(viewId: string, url?: string): Promise<number> {
    if (!this.transport.newTab) {
      throw new CdpBrokerError("newTab is not available for this transport", {
        code: "CDP_NEW_TAB_UNAVAILABLE",
        details: { viewId },
      });
    }
    return this.transport.newTab({
      id: this.requestId(),
      viewId,
      ...(url === undefined ? {} : { url }),
    });
  }

  async switchTab(viewId: string, tabId: number): Promise<number> {
    if (!this.transport.switchTab) {
      throw new CdpBrokerError("switchTab is not available for this transport", {
        code: "CDP_SWITCH_TAB_UNAVAILABLE",
        details: { viewId },
      });
    }
    return this.transport.switchTab({ id: this.requestId(), viewId, tabId });
  }

  async closeTab(viewId: string, tabId: number): Promise<number> {
    if (!this.transport.closeTab) {
      throw new CdpBrokerError("closeTab is not available for this transport", {
        code: "CDP_CLOSE_TAB_UNAVAILABLE",
        details: { viewId },
      });
    }
    return this.transport.closeTab({ id: this.requestId(), viewId, tabId });
  }

  async installExtension(viewId: string, extensionId: string): Promise<InstalledExtensionInfo> {
    if (!this.transport.installExtension) {
      throw new CdpBrokerError("installExtension is not available for this transport", {
        code: "CDP_INSTALL_EXTENSION_UNAVAILABLE",
        details: { viewId },
      });
    }
    return this.transport.installExtension({ id: this.requestId(), viewId, extensionId });
  }

  async listExtensions(viewId: string): Promise<ExtensionInfo[]> {
    if (!this.transport.listExtensions) {
      throw new CdpBrokerError("listExtensions is not available for this transport", {
        code: "CDP_LIST_EXTENSIONS_UNAVAILABLE",
        details: { viewId },
      });
    }
    return this.transport.listExtensions({ id: this.requestId(), viewId });
  }

  async listExtensionWindows(viewId: string): Promise<ExtensionWindowInfo[]> {
    if (!this.transport.listExtensionWindows) {
      throw new CdpBrokerError("listExtensionWindows is not available for this transport", {
        code: "CDP_LIST_EXT_WINDOWS_UNAVAILABLE",
        details: { viewId },
      });
    }
    return this.transport.listExtensionWindows({ id: this.requestId(), viewId });
  }

  async extSwitch(
    viewId: string,
    selector?: string | { readonly extensionId?: string; readonly popupKey?: string },
  ): Promise<ExtSwitchResult> {
    if (!this.transport.extSwitch) {
      throw new CdpBrokerError("extSwitch is not available for this transport", {
        code: "CDP_EXT_SWITCH_UNAVAILABLE",
        details: { viewId },
      });
    }
    const resolved =
      typeof selector === "string" ? extensionPopupSelectorFromArg(selector) : selector;
    return this.transport.extSwitch({
      id: this.requestId(),
      viewId,
      ...(resolved?.extensionId ? { extensionId: resolved.extensionId } : {}),
      ...(resolved?.popupKey ? { popupKey: resolved.popupKey } : {}),
    });
  }

  async extClose(
    viewId: string,
    selector: string | { readonly extensionId?: string; readonly popupKey?: string },
  ): Promise<void> {
    if (!this.transport.extClose) {
      throw new CdpBrokerError("extClose is not available for this transport", {
        code: "CDP_EXT_CLOSE_UNAVAILABLE",
        details: { viewId },
      });
    }
    const resolved =
      typeof selector === "string" ? extensionPopupSelectorFromArg(selector) : selector;
    await this.transport.extClose({
      id: this.requestId(),
      viewId,
      ...(resolved.extensionId ? { extensionId: resolved.extensionId } : {}),
      ...(resolved.popupKey ? { popupKey: resolved.popupKey } : {}),
    });
  }

  async extOpen(viewId: string, extensionId: string): Promise<{ popupKey: string }> {
    if (!this.transport.extOpen) {
      throw new CdpBrokerError("extOpen is not available for this transport", {
        code: "CDP_EXT_OPEN_UNAVAILABLE",
        details: { viewId },
      });
    }
    return this.transport.extOpen({ id: this.requestId(), viewId, extensionId });
  }

  async loadUnpacked(
    viewId: string,
    folderPath: string,
  ): Promise<import("@t3tools/contracts").BrowserExtensionInfo> {
    if (!this.transport.loadUnpacked)
      throw new CdpBrokerError("loadUnpacked unavailable", {
        code: "CDP_LOAD_UNPACKED_UNAVAILABLE",
      });
    return this.transport.loadUnpacked({ id: this.requestId(), viewId, folderPath });
  }

  async reloadExtension(viewId: string, extensionId: string): Promise<void> {
    if (!this.transport.reloadExtension)
      throw new CdpBrokerError("reloadExtension unavailable", {
        code: "CDP_RELOAD_EXTENSION_UNAVAILABLE",
      });
    return this.transport.reloadExtension({ id: this.requestId(), viewId, extensionId });
  }

  async removeExtension(viewId: string, extensionId: string): Promise<void> {
    if (!this.transport.removeExtension)
      throw new CdpBrokerError("removeExtension unavailable", {
        code: "CDP_REMOVE_EXTENSION_UNAVAILABLE",
      });
    return this.transport.removeExtension({ id: this.requestId(), viewId, extensionId });
  }
}
