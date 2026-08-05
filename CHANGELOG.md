# Changelog

All notable user-visible changes are recorded here. The eleven published packages share
one version and are released together.

## 0.3.0 — 2026-08-05

### Added

- A composed `HTTPServer` with one `.handle()` API across HTTP/3, HTTP/2, and HTTP/1.1,
  automatic `Alt-Svc` advertisement, shared-port startup, and coordinated shutdown.
- One WebSocket handler API across RFC 9220 HTTP/3 Extended CONNECT, RFC 8441 HTTP/2
  Extended CONNECT, and HTTP/1.1 Upgrade, including framing, subprotocol selection,
  bounded messages, ping/pong, and orderly close handling.
- An opt-in trusted development-certificate profile with a private ephemeral CA,
  cross-platform trust installation, cached rotation, and explicit removal.
- A same-origin Vite example serving ordinary HTTPS and WebTransport across the shared
  TCP and UDP port.

### Fixed

- Client-initiated unidirectional HTTP/3 streams are ignored instead of being surfaced
  as requests, and malformed-request rejection can no longer throw from a Node-API
  callback or mask the original handler error.
- Vite HMR can reserve WebSockets for HTTP/1.1 Upgrade without clients selecting an
  unsupported HTTP/2 Extended CONNECT path.

## 0.2.0 — 2026-08-04

First coordinated release candidate for the complete package set.

### Added

- Fetch-style HTTP/3 requests and streaming responses with native backpressure.
- WebTransport session acceptance, datagrams, and client-created bidirectional streams.
- Bounded connection, stream, header, body, response, and WebTransport resource limits.
- Graceful shutdown with a configurable drain deadline.
- Prebuilt native packages for macOS and Windows on arm64 and x64, plus glibc and musl
  Linux on both architectures.
- Zero-dependency development certificates for Node.js, Bun, and Deno.
- A complete Vite and browser WebTransport example.
- Checksummed native provenance, packed-candidate verification, cross-platform protocol
  tests, Chrome interoperability tests, stress coverage, and a scheduled soak gate.

### Known limitations

- WebTransport currently supports one session per QUIC connection.
- Server-created and unidirectional WebTransport streams are not implemented.
- Browser interoperability is pinned and continuously tested with Chrome; Firefox and
  Safari remain part of the expanding compatibility matrix.

## 0.1.0 — 2025-08-14

Historical prototype published for the native and platform packages only. It was not a
coordinated release of the current package set.
