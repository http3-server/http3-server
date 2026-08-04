# HTTP/3 and WebTransport Server for Node.js

This package wraps MSH3 and MsQuic with a small event-oriented HTTP/3 and
WebTransport API.

```js
import { HTTP3Server } from "http3s";

const server = new HTTP3Server().handle({
	error(error) {
		console.error(error.code, error.message, error.details);
	},

	session(session) {
		if (session.path !== "/game") return false;
		console.log("player connected", session.id);
	},

	datagram(session, data) {
		// Disposable input/snapshot traffic.
		session.sendDatagram(data);
	},

	webTransportStream(stream) {
		console.log("reliable stream", stream.id);
	},

	webTransportData(stream, data) {
		// Reliable game events. Pass { fin: true } to close the send side.
		stream.send(data);
	},
});

await server.start({
	address: "0.0.0.0",
	port: 0,
	certificateFile: "certificate.pem",
	privateKeyFile: "private-key.pem",
});

console.log(`Listening on ${server.address}:${server.port}`);
```

`start()` resolves after the native listener is ready and `address` and `port` contain
its read-only bound endpoint. This makes `port: 0` suitable for tests and parallel local
servers. Both values return to `undefined` after `stop()` resolves.

`stop({ gracePeriodMs: 10_000 })` closes the listener, lets already accepted
requests and WebTransport work finish, and rejects new requests on existing
connections with 503. Remaining work is aborted when the deadline expires. Pass
`gracePeriodMs: 0` for immediate abort.

The `session` handler may return `false` to reject with 403, or a `Response`
to choose the successful or error status and response headers. Otherwise the
server accepts the extended CONNECT request with status 200.

## Request API and WebTransport API

Ordinary HTTP/3 uses the Fetch-style `stream` handler. Its argument extends the
standard `Request`, so method, URL, headers, abort signal, and streaming request body
work as expected. The handler may return a standard `Response`; response bodies are
sent incrementally with native backpressure rather than buffered in full.

```js
server.handle({
	async stream(request) {
		const body = request.method === "POST" ? await request.text() : "";
		return new Response(body || "hello", {
			headers: { "content-type": "text/plain" },
		});
	},
});
```

WebTransport starts as an extended CONNECT request but becomes a long-lived
`WebTransportSession`. The `session` handler decides whether to accept it; `datagram`
handles disposable unordered messages, while `webTransportStream` and
`webTransportData` handle reliable ordered stream traffic. Check `session.path` and
`session.headers.origin` as part of authorization—the server does not invent an origin
policy for the application.

The initial WebTransport implementation intentionally supports one session per QUIC
connection and client-created bidirectional streams. Client/server datagrams,
bidirectional stream traffic, rejection, abort, close, and reconnect are verified with
the pinned Chrome interoperability test. Server-created streams and unidirectional
streams are not implemented yet.

## Resource limits

Peer-controlled work is bounded and configurable:

| Setting | Default | Limit behavior |
| --- | ---: | --- |
| `maxConnections` | 1,024 | excess connections are rejected at transport admission |
| `maxStreamsPerConnection` | 256 | excess application streams receive 503 |
| `maxHeaderFields` | 128 | excessive decoded fields receive 431 |
| `maxHeaderBytes` | 64 KiB | excessive decoded header bytes receive 431 |
| `maxUrlLength` | 8 KiB | excessive reconstructed URLs receive 431 |
| `maxQueuedResponseBytes` | 8 MiB/request | new response sends settle `false` |
| `maxQueuedWebTransportBytes` | 4 MiB/stream | new reliable sends return `false` |
| `maxPendingWebTransportSends` | 256/stream | new reliable sends return `false` |
| `maxDatagramSize` | 1,200 bytes | oversized datagrams are rejected |
| `maxPendingDatagrams` | 256/server | overload drops the newest datagram |
| `receiveWindowBytes` | 1 MiB/stream | QUIC flow control pauses the peer |
| `connectionReceiveWindowBytes` | 16 MiB/connection | QUIC flow control pauses the peer |
| `maxIncompleteBodyMs` | 30 seconds | stalled application delivery aborts receive |

One inbound chunk may be pending per request or reliable WebTransport stream.
The QUIC receive windows default to 1 MiB per stream and 16 MiB per connection;
application delivery must finish within `maxIncompleteBodyMs` (30 seconds by
default) or the receive side is aborted. Limit rejections and timeouts are
reported to the optional `error` handler and cumulative counters are available
from `server.getDiagnostics()`.
