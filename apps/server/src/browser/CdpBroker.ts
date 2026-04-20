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
  }) => Promise<() => Promise<void> | void>;
  readonly attachTarget?: (request: {
    readonly id: string;
    readonly viewId: string;
    readonly targetId: string;
  }) => Promise<string>;
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
    const waiters: Array<(next: IteratorResult<CdpBrokerEvent>) => void> = [];
    let closed = false;
    let unsubscribe: (() => Promise<void> | void) | undefined;
    let setupError: unknown;
    let dropped = 0;

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
        waiter({ done: false, value: enriched(false) });
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
      })
      .then((dispose) => {
        unsubscribe = dispose;
      })
      .catch((cause: unknown) => {
        setupError = cause;
        const waiter = waiters.shift();
        if (waiter) {
          closed = true;
          waiter(Promise.reject(cause) as unknown as IteratorResult<CdpBrokerEvent>);
        }
      });

    return {
      [Symbol.asyncIterator]() {
        return {
          next: async (): Promise<IteratorResult<CdpBrokerEvent>> => {
            await setup;
            if (setupError) throw setupError;
            if (queue.length > 0) return { done: false, value: queue.shift()! };
            if (closed) return { done: true, value: undefined };
            return new Promise<IteratorResult<CdpBrokerEvent>>((resolve) => {
              waiters.push(resolve);
            });
          },
          return: async (): Promise<IteratorResult<CdpBrokerEvent>> => {
            closed = true;
            for (const waiter of waiters.splice(0)) waiter({ done: true, value: undefined });
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
}
