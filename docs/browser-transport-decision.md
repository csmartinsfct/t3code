# Browser Transport Decision

Ticket: T3CO-338

## Decision

Use an **Electron-main-owned loopback HTTP broker** for the production CDP bridge shipped with the first embedded-browser UI.

Keep the existing `--bootstrap-fd 3` pipe as a one-shot startup envelope only. Do not extend it into CDP traffic. The bootstrap envelope now carries the broker URL and bearer token to the Bun server child.

## Why

The CDP bridge is not just request/response navigation. It needs request correlation, event fanout, cancellation, target/session ids, bounded queues, restart re-announcement, and backpressure for future tabs, iframes, extension workers, DevTools panes, and multi-agent observers.

A fresh fd pair with length-prefixed JSON is technically viable and fast, but it makes T3 own the transport protocol details permanently: framing, half-open pipe handling, flow control, listener fanout, and child restart recovery. That is acceptable for a narrow daemon but not for the browser broker that will sit between Electron-owned `WebContentsView` instances and server-side `/api/browser` tools.

`utilityProcess.fork` plus `MessageChannelMain` remains a durable Electron-native substrate, but it requires replacing the current Bun child-process server launch. That refactor is larger than the browser UI wiring needed for Phase 3, and it risks coupling this browser milestone to unrelated server lifecycle behavior.

The loopback broker keeps the current Bun child process model intact while still avoiding bespoke fd framing:

- Electron main listens on `127.0.0.1` with a random bearer token generated at startup;
- `--bootstrap-fd 3` delivers only `{ electronCdpBrokerUrl, electronCdpBrokerToken }`;
- server-side `/api/browser` builds a `CdpBroker` transport from that URL/token;
- `send` and `attachTarget` are JSON POST calls;
- `subscribe` is an NDJSON streaming POST whose response is cancelled by aborting the request;
- the broker still exposes the `CdpBroker` shape with correlated `send`, cancellable `subscribe`, and future `attachTarget`.

The future `utilityProcess` refactor can replace the HTTP transport under the same server-side `CdpBrokerTransport` interface if the launch model changes later.

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

Phase 2 introduced the broker as an Electron-main-owned service with a server-side client facade. The initial implementation exposes only the narrow primitives needed by the day-1 native host, but the protocol should carry:

- correlation ids;
- `viewId` and CDP `sessionId`;
- timeout and cancellation metadata;
- structured errors;
- subscription ids with explicit unsubscribe;
- a queue/backpressure signal for high-volume events.

If T3 later moves the backend from `ChildProcess.spawn(Bun)` to `utilityProcess`, the replacement transport should be tested before adding high-volume DevTools or extension-worker subscriptions.
