# HTTP/3, WebTransport, and WebSocket Server for Node.js

This package wraps MSH3 and MsQuic with a small event-oriented HTTP/3,
WebTransport, and WebSocket API, plus HTTP/2 and HTTP/1.1 fallback.

## Installation

```sh
npm install @http3-server/server
```

`@http3-server/server` supports Node.js 22, 24, and 26 on macOS, Linux, and Windows on arm64 and x64.
Both glibc and musl Linux systems, including Alpine Linux, are supported. The matching
native package is selected automatically. Running a server requires a TLS certificate
and private key, and the listening UDP port must be reachable by clients.

Runtime support is currently Node.js only. Bun and Deno can load many Node-API addons,
but `@http3-server/server` is not yet part of their tested support matrix. The separate
`@http3-server/dev-certificates` package is tested on Node.js, Bun, and Deno.

For local development, `@http3-server/dev-certificates` creates the short-lived P-256
certificate and browser hash required by WebTransport without OpenSSL or trust-store
changes. A complete Vite example is available in the
[`http3-server` repository](https://github.com/http3-server/http3-server/tree/main/examples/vite-webtransport).

## Quick start

```js
import { HTTP3Server } from "@http3-server/server";

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
servers. WebTransport is enabled by default; pass `webTransport: false` when only
ordinary HTTP/3 and WebSockets are needed. Extended CONNECT remains advertised for
HTTP/3 WebSockets. Both endpoint values return to `undefined` after `stop()` resolves.

`stop({ gracePeriodMs: 10_000 })` closes the listener, lets already accepted
requests and WebTransport work finish, and rejects new requests on existing
connections with 503. Remaining work is aborted when the deadline expires. Pass
`gracePeriodMs: 0` for immediate abort.

The `session` handler may return `false` to reject with 403, or a `Response`
to choose the successful or error status and response headers. Otherwise the
server accepts the extended CONNECT request with status 200.

`session.sendDatagram()` and `WebTransportStream#send()` return `true` when the
bounded native send queue accepts the message and `false` when it does not. Rejections
are also reported to the optional `error` handler.

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

For frame-level control, send on the same request object instead of returning a
`Response`:

```js
server.handle({
	async stream(request) {
		await request.sendHeaders({ ":status": "200", "content-type": "text/plain" });
		await request.sendData(new TextEncoder().encode("hello"), request.fin);
	},
});
```

`sendHeaders()` settles one `Promise<boolean>` and `sendData()` settles one result per
argument. The server-level `sendHeadersFrame()` and `sendDataFrame()` methods expose
the same operations by stream ID. Most applications should prefer returning a
`Response`, which handles ordering, streaming, backpressure, and FIN automatically.

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

## WebSockets with HTTP/3-first fallback

WebSockets use the same `.handle()` callbacks over all supported HTTP versions.
HTTP/3 follows [RFC 9220](https://www.rfc-editor.org/rfc/rfc9220) Extended CONNECT,
HTTP/2 follows [RFC 8441](https://www.rfc-editor.org/rfc/rfc8441) Extended CONNECT,
and HTTP/1.1 uses the original Upgrade handshake. In every case, WebSocket frames run
over one reliable ordered stream; HTTP/3 replaces TCP with QUIC but does not turn a
WebSocket into unordered UDP datagrams.

```js
import { HTTPServer } from "@http3-server/server";

const server = new HTTPServer().handle({
	webSocket(socket) {
		if (socket.path !== "/events") return false;
		// Returning an offered name selects the WebSocket subprotocol.
		return socket.offeredProtocols.includes("events.v1") ? "events.v1" : undefined;
	},
	async webSocketMessage(socket, data) {
		await socket.send(data);
	},
	webSocketClose(socket, code, reason) {
		console.log(socket.httpVersion, code, reason);
	},
});
```

The initial `webSocket` routing callback must return synchronously because its result
controls the protocol handshake. Return `false` to reject, a string to select one of
`socket.offeredProtocols`, or any other value to accept without a subprotocol.
`webSocketMessage` and `webSocketClose` may be asynchronous. Text messages arrive as
strings, binary messages as `Uint8Array`, and `send()` accepts either. Use `close()` for
an orderly closing handshake.

`HTTP3Server` exposes these callbacks for an HTTP/3-only listener. `HTTPServer` adds the
fallback listeners described below. Browser selection still depends on client support:
the server advertises HTTP/3 through `Alt-Svc` and Extended CONNECT settings, prefers
standards-compliant HTTP/3 when the client chooses it, then accepts the same handler over
HTTP/2 or HTTP/1.1 when the client falls back.

## HTTP/2 and HTTP/1.1 fallback

`HTTPServer` composes the HTTP/3 listener with Node.js HTTP/2 and HTTP/1.1 over TCP on
the same numeric port. One `.handle()` object serves every protocol: `stream` receives a
Fetch-compatible request for ordinary HTTP traffic, WebSocket handlers span HTTP/3,
HTTP/2, and HTTP/1.1, while WebTransport handlers are invoked only by HTTP/3.

```js
import { HTTPServer } from "@http3-server/server";

const server = new HTTPServer().handle({
	stream(request) {
		return new Response(`served over ${request.protocol}`);
	},
	session(session) {
		if (session.path !== "/game") return false;
	},
});

await server.start({
	address: "127.0.0.1",
	port: 4433,
	certificateFile: "certificate.pem",
	privateKeyFile: "private-key.pem",
});
```

TCP responses advertise the UDP listener with `Alt-Svc`, allowing browsers to move
eligible requests from HTTP/2 or HTTP/1.1 to HTTP/3. `allowHTTP1` defaults to `true` and
`altSvcMaxAge` defaults to 3,600 seconds. HTTP/2 Extended CONNECT is enabled by default;
pass `enableHTTP2ConnectProtocol: false` when an attached integration only handles
HTTP/1.1 WebSocket Upgrade, as Vite HMR does. This setting does not disable HTTP/3
Extended CONNECT. `server.http3` exposes the underlying
`HTTP3Server`, and `server.tcpServer` exposes the Node.js secure server for lower-level
integrations. When no shared `webSocket` handler is installed, an additional HTTP/1.1
`upgrade` listener on `tcpServer` may own the socket instead, which keeps integrations
such as Vite HMR working.

The portable part of the shared stream contract is `Request` to `Response`. On HTTP/3,
the request remains the richer `Stream` with frame-level methods; callers must narrow on
`request.protocol === "HTTP/3"` before using those methods. The `connection` callback is
also HTTP/3-specific. WebSockets have their own shared callbacks because neither an
accepted Extended CONNECT stream nor an HTTP/1.1 Upgrade is a normal Fetch response.

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
| `maxWebSocketMessageBytes` | 16 MiB/message | oversized frames or reassembled messages close with 1009 |
| `webSocketCloseTimeoutMs` | 5 seconds | an unanswered close handshake aborts the transport |

One inbound chunk may be pending per request or reliable WebTransport stream.
The QUIC receive windows default to 1 MiB per stream and 16 MiB per connection;
application delivery must finish within `maxIncompleteBodyMs` (30 seconds by
default) or the receive side is aborted. Limit rejections and timeouts are
reported to the optional `error` handler and cumulative counters are available
from `server.getDiagnostics()`.
