import { describe, expect, it, vi } from "vitest";
import { WS_METHODS, type OrchestrationEvent } from "@t3tools/contracts";

import { createWsRpcClient } from "./wsRpcClient";

describe("createWsRpcClient", () => {
  it("resumes orchestration subscriptions from the latest applied sequence when available", () => {
    const subscribe = vi.fn<
      (
        connect: (client: {
          [WS_METHODS.subscribeOrchestrationDomainEvents]: (input: unknown) => unknown;
        }) => unknown,
        listener: (event: OrchestrationEvent) => void,
      ) => () => void
    >(() => () => undefined);
    const transport = {
      dispose: vi.fn(),
      request: vi.fn(),
      requestStream: vi.fn(),
      subscribe,
    };
    const rpcClient = createWsRpcClient(transport as never);
    const listener = vi.fn<(event: OrchestrationEvent) => void>();
    let latestSequence: number | undefined;

    rpcClient.orchestration.onDomainEvent(listener, {
      getFromSequenceExclusive: () => latestSequence,
    });

    expect(subscribe).toHaveBeenCalledTimes(1);
    const firstSubscribeCall = subscribe.mock.calls[0];
    expect(firstSubscribeCall).toBeDefined();
    const [connect] = firstSubscribeCall!;
    const subscribeOrchestrationDomainEvents = vi.fn((input: unknown) => input);

    connect({
      [WS_METHODS.subscribeOrchestrationDomainEvents]: subscribeOrchestrationDomainEvents,
    });
    latestSequence = 42;
    connect({
      [WS_METHODS.subscribeOrchestrationDomainEvents]: subscribeOrchestrationDomainEvents,
    });

    expect(subscribeOrchestrationDomainEvents).toHaveBeenNthCalledWith(1, {});
    expect(subscribeOrchestrationDomainEvents).toHaveBeenNthCalledWith(2, {
      fromSequenceExclusive: 42,
    });
  });
});
