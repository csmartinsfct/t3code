import {
  CdpBroker,
  CdpBrokerError,
  type CdpBrokerEvent,
  type CdpBrokerTransport,
} from "./CdpBroker";
import type { ServerConfigShape } from "../config";

interface BrokerSuccess<T> {
  readonly ok: true;
  readonly result: T;
}

interface BrokerFailure {
  readonly ok: false;
  readonly error: {
    readonly message: string;
    readonly code?: string;
    readonly details?: unknown;
  };
}

type BrokerResponse<T> = BrokerSuccess<T> | BrokerFailure;

const brokersByEndpoint = new Map<string, CdpBroker>();

function endpointKey(url: string, token: string): string {
  return `${url}\0${token}`;
}

function brokerUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

async function parseBrokerResponse<T>(response: Response): Promise<T> {
  let payload: BrokerResponse<T> | undefined;
  try {
    payload = (await response.json()) as BrokerResponse<T>;
  } catch (cause) {
    throw new CdpBrokerError(`Electron CDP broker returned invalid JSON (${response.status})`, {
      code: "ELECTRON_CDP_HTTP_INVALID_JSON",
      cause,
    });
  }

  if (payload.ok) return payload.result;
  throw new CdpBrokerError(payload.error.message, {
    code: payload.error.code ?? "ELECTRON_CDP_REMOTE_ERROR",
    details: payload.error.details,
  });
}

class ElectronCdpHttpTransport implements CdpBrokerTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly cacheKey: string,
  ) {}

  async send(request: Parameters<CdpBrokerTransport["send"]>[0]): Promise<unknown> {
    try {
      const response = await fetch(brokerUrl(this.baseUrl, "send"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(request),
      });
      return await parseBrokerResponse<unknown>(response);
    } catch (cause) {
      this.evictOnTransportFailure(cause);
      throw cause;
    }
  }

  async subscribe(request: Parameters<CdpBrokerTransport["subscribe"]>[0]) {
    const controller = new AbortController();
    let response: Response;
    try {
      response = await fetch(brokerUrl(this.baseUrl, "subscribe"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) {
        await parseBrokerResponse<never>(response);
        throw new CdpBrokerError(`Electron CDP broker subscribe failed (${response.status})`, {
          code: "ELECTRON_CDP_SUBSCRIBE_FAILED",
        });
      }
    } catch (cause) {
      this.evictOnTransportFailure(cause);
      throw cause;
    }
    if (!response.body) {
      const cause = new CdpBrokerError("Electron CDP broker subscription response had no body", {
        code: "ELECTRON_CDP_SUBSCRIBE_NO_BODY",
      });
      this.evictOnTransportFailure(cause);
      throw cause;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let closed = false;

    const pump = async () => {
      try {
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) {
            if (!closed) {
              request.fail(
                new CdpBrokerError("Electron CDP broker subscription ended unexpectedly", {
                  code: "ELECTRON_CDP_SUBSCRIBE_ENDED",
                }),
              );
            }
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (line && !this.emitLine(line, request.emit, request.fail)) {
              closed = true;
              controller.abort();
              await reader.cancel().catch(() => {});
              break;
            }
            newlineIndex = buffer.indexOf("\n");
          }
        }
      } catch (cause) {
        if (!closed && (cause as { name?: string }).name !== "AbortError") {
          console.warn("Electron CDP broker subscription failed", cause);
        }
      }
    };
    void pump();

    return async () => {
      closed = true;
      controller.abort();
      await reader.cancel().catch(() => {});
    };
  }

  async attachTarget(
    request: Parameters<NonNullable<CdpBrokerTransport["attachTarget"]>>[0],
  ): Promise<string> {
    try {
      const response = await fetch(brokerUrl(this.baseUrl, "attach-target"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(request),
      });
      return await parseBrokerResponse<string>(response);
    } catch (cause) {
      this.evictOnTransportFailure(cause);
      throw cause;
    }
  }

  async printPdf(
    request: Parameters<NonNullable<CdpBrokerTransport["printPdf"]>>[0],
  ): Promise<string> {
    try {
      const response = await fetch(brokerUrl(this.baseUrl, "print-pdf"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(request),
      });
      return await parseBrokerResponse<string>(response);
    } catch (cause) {
      this.evictOnTransportFailure(cause);
      throw cause;
    }
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      "content-type": "application/json",
    };
  }

  private emitLine(
    line: string,
    emit: (event: CdpBrokerEvent) => void,
    fail: (cause: unknown) => void,
  ): boolean {
    let payload: BrokerResponse<CdpBrokerEvent>;
    try {
      payload = JSON.parse(line) as BrokerResponse<CdpBrokerEvent>;
    } catch (cause) {
      fail(
        new CdpBrokerError("Electron CDP broker subscription returned invalid JSON", {
          code: "ELECTRON_CDP_SUBSCRIBE_INVALID_JSON",
          cause,
        }),
      );
      return false;
    }
    if (payload.ok) {
      emit(payload.result);
      return true;
    }
    fail(
      new CdpBrokerError(payload.error.message, {
        code: payload.error.code ?? "ELECTRON_CDP_REMOTE_ERROR",
        details: payload.error.details,
      }),
    );
    return false;
  }

  private evictOnTransportFailure(cause: unknown): void {
    if (cause instanceof CdpBrokerError && cause.code === "ELECTRON_CDP_DEVTOOLS_OPEN") return;
    brokersByEndpoint.delete(this.cacheKey);
  }
}

export function electronCdpBrokerCacheKey(config: ServerConfigShape): string | undefined {
  if (!config.electronCdpBrokerUrl || !config.electronCdpBrokerToken) return undefined;
  return endpointKey(config.electronCdpBrokerUrl, config.electronCdpBrokerToken);
}

export function getElectronCdpBroker(config: ServerConfigShape): CdpBroker | undefined {
  const key = electronCdpBrokerCacheKey(config);
  if (!key || !config.electronCdpBrokerUrl || !config.electronCdpBrokerToken) return undefined;

  const existing = brokersByEndpoint.get(key);
  if (existing) return existing;

  const broker = new CdpBroker(
    new ElectronCdpHttpTransport(config.electronCdpBrokerUrl, config.electronCdpBrokerToken, key),
    { eventQueueCapacity: 100 },
  );
  brokersByEndpoint.set(key, broker);
  return broker;
}
