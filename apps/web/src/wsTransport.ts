import { Duration, Effect, Exit, ManagedRuntime, Option, Scope, Stream } from "effect";
import { formatTimelineLog } from "@t3tools/shared/timeline";

import {
  createWsRpcProtocolLayer,
  makeWsRpcProtocolClient,
  type WsRpcProtocolClient,
} from "./rpc/protocol";
import { RpcClient } from "effect/unstable/rpc";

interface SubscribeOptions<TValue = unknown> {
  readonly retryDelay?: Duration.Input;
  readonly label?: string;
  readonly describeValue?: (value: TValue) => Record<string, unknown>;
}

interface RequestOptions {
  readonly timeout?: Option.Option<Duration.Input>;
}

const DEFAULT_SUBSCRIPTION_RETRY_DELAY_MS = Duration.millis(250);

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

export class WsTransport {
  private readonly runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>;
  private readonly clientScope: Scope.Closeable;
  private readonly clientPromise: Promise<WsRpcProtocolClient>;
  private disposed = false;

  constructor(url?: string) {
    this.runtime = ManagedRuntime.make(createWsRpcProtocolLayer(url));
    this.clientScope = this.runtime.runSync(Scope.make());
    this.clientPromise = this.runtime.runPromise(
      Scope.provide(this.clientScope)(makeWsRpcProtocolClient),
    );
    console.info(
      formatTimelineLog("web", "ws.transport.created", {
        hasExplicitUrl: typeof url === "string" && url.length > 0,
      }),
    );
  }

  async request<TSuccess>(
    execute: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, Error, never>,
    _options?: RequestOptions,
  ): Promise<TSuccess> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const client = await this.clientPromise;
    return await this.runtime.runPromise(Effect.suspend(() => execute(client)));
  }

  async requestStream<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
  ): Promise<void> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const client = await this.clientPromise;
    await this.runtime.runPromise(
      Stream.runForEach(connect(client), (value) =>
        Effect.sync(() => {
          try {
            listener(value);
          } catch {
            // Swallow listener errors so the stream can finish cleanly.
          }
        }),
      ),
    );
  }

  subscribe<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    options?: SubscribeOptions<TValue>,
  ): () => void {
    if (this.disposed) {
      return () => undefined;
    }

    let active = true;
    let attempt = 0;
    const retryDelayMs = options?.retryDelay ?? DEFAULT_SUBSCRIPTION_RETRY_DELAY_MS;
    const label = options?.label ?? "anonymous";
    console.info(formatTimelineLog("web", "ws.subscription.requested", { label }));
    const cancel = this.runtime.runCallback(
      Effect.promise(() => this.clientPromise).pipe(
        Effect.flatMap((client) =>
          Effect.sync(() => {
            attempt += 1;
            console.info(
              formatTimelineLog("web", "ws.subscription.stream.start", { attempt, label }),
            );
          }).pipe(
            Effect.andThen(
              Stream.runForEach(connect(client), (value) =>
                Effect.sync(() => {
                  if (!active) {
                    return;
                  }
                  const description = options?.describeValue?.(value);
                  if (description) {
                    console.info(
                      formatTimelineLog("web", "ws.subscription.stream.value", {
                        attempt,
                        label,
                        ...description,
                      }),
                    );
                  }
                  try {
                    listener(value);
                  } catch {
                    // Swallow listener errors so the stream stays live.
                  }
                }),
              ),
            ),
            Effect.tap(() =>
              Effect.sync(() => {
                console.info(
                  formatTimelineLog("web", "ws.subscription.stream.completed", {
                    attempt,
                    label,
                  }),
                );
              }),
            ),
          ),
        ),
        Effect.catch((error) => {
          if (!active || this.disposed) {
            return Effect.interrupt;
          }
          return Effect.sync(() => {
            console.warn(
              formatTimelineLog("web", "ws.subscription.disconnected", {
                attempt,
                error: formatErrorMessage(error),
                label,
              }),
            );
          }).pipe(Effect.andThen(Effect.sleep(retryDelayMs)));
        }),
        Effect.forever,
      ),
    );

    return () => {
      active = false;
      console.info(formatTimelineLog("web", "ws.subscription.unsubscribe", { attempt, label }));
      cancel();
    };
  }

  async dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    console.info(formatTimelineLog("web", "ws.transport.dispose"));
    await this.runtime.runPromise(Scope.close(this.clientScope, Exit.void)).finally(() => {
      this.runtime.dispose();
    });
  }
}
