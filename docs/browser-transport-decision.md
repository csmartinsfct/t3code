# Browser Transport Decision

Ticket: T3CO-338

## Decision

Use **Option beta: Electron `utilityProcess.fork` plus `MessageChannelMain`** for the long-lived main-to-server CDP broker.

Keep the existing `--bootstrap-fd 3` pipe as a one-shot startup envelope only. Do not extend it into CDP traffic.

## Why

The CDP bridge is not just request/response navigation. It needs request correlation, event fanout, cancellation, target/session ids, bounded queues, restart re-announcement, and backpressure for future tabs, iframes, extension workers, DevTools panes, and multi-agent observers.

A fresh fd pair with length-prefixed JSON is technically viable and fast, but it makes T3 own the transport protocol details permanently: framing, half-open pipe handling, flow control, listener fanout, and child restart recovery. That is acceptable for a narrow daemon but not for the browser broker that will sit between Electron-owned `WebContentsView` instances and server-side `/api/browser` tools.

`utilityProcess.fork` plus `MessageChannelMain` is a larger launch refactor, but it is the more durable Electron-native substrate:

- structured messages remove bespoke length framing;
- message ports give an explicit, long-lived channel separate from bootstrap;
- Electron owns port lifecycle semantics across the main/utility boundary;
- the model fits a `CdpBroker` with correlated `send`, cancellable `subscribe`, and future `attachTarget`;
- restart recovery can be expressed as a utility-process lifecycle: main re-announces active views after the server utility process is replaced.

## Existing Bootstrap Channel

The current channel is one-shot by construction:

- `apps/desktop/src/main.ts` writes one bootstrap envelope to fd 3 and ends the stream.
- `apps/server/src/bootstrap.ts` reads one line and destroys its side of the stream.

That path remains useful for early process configuration. It should not become browser RPC.

## Measurement

I ran a synthetic local fd-pair echo benchmark using Node child-process extra fds and 4-byte length-prefixed JSON frames:

- messages: 10,000
- payload size: 852 bytes
- elapsed: 30 ms
- throughput: roughly 337,000 round-trip messages/sec
- one-way payload rate: roughly 275 MiB/sec

This shows Option alpha has enough raw throughput for CDP-sized traffic. The decision is therefore based on lifecycle and maintainability, not bandwidth.

## Consequences

Phase 2 should introduce the broker as an Electron-main-owned service with a server-side client facade. The initial implementation can expose only the narrow primitives needed by the day-1 native host, but the protocol should carry:

- correlation ids;
- `viewId` and CDP `sessionId`;
- timeout and cancellation metadata;
- structured errors;
- subscription ids with explicit unsubscribe;
- a queue/backpressure signal for high-volume events.

The launch refactor should be tested before implementing broad tool parity, because it is the foundation for backend restart recovery.
