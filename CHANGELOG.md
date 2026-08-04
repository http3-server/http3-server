# Changelog

All notable user-visible changes are recorded here. The eleven published packages share
one version and are released together.

## 0.2.0 — Unreleased

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
