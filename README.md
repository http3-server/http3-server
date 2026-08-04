# HTTP/3 and WebTransport for Node.js

This repository is the release monorepo for an experimental HTTP/3 and WebTransport
server. It owns the JavaScript API, native loader, platform packages, tests, and npm
release process.

The native addon is built in
[`http3-server/msh3-node`](https://github.com/http3-server/msh3-node). Keeping the native
builder separate lets its cross-platform matrix evolve without coupling every build
tool to the published packages. The handoff between the repositories is a checksummed
`builds` artifact; see [RELEASING.md](RELEASING.md).

## Packages

| Package | Responsibility |
| --- | --- |
| `@http3-server/server` | Public HTTP/3 and WebTransport server API |
| `@http3-server/dev-certificates` | Portable short-lived development certificates |
| `@http3-server/native` | Selects and loads the current platform package |
| `@http3-server/<target>` | Native addon plus MSH3 and MsQuic runtime libraries |

Supported package targets are macOS and Windows on arm64 and x64, plus glibc and musl
Linux on both architectures. The binary package sources intentionally are not npm
workspaces: their `os`, `cpu`, and `libc` constraints make seven of the eight invalid on
every development machine. The local native loader uses the matching checked-out binary
instead.

The certificate package has no runtime dependencies and uses Web Crypto on Node.js,
Bun, and Deno. Its Node.js adapter safely caches and rotates PEM files for
`@http3-server/server`;
see [`packages/dev-certificates/README.md`](packages/dev-certificates/README.md).

## Development

Clone with Git LFS available, then run:

```sh
npm ci
npm run verify
```

To try WebTransport from a browser with Vite, run `npm run example:vite` and open
<http://127.0.0.1:5173>. The tested example generates and caches its own short-lived
certificate, starts Vite and `@http3-server/server` together, and demonstrates datagrams
and a reliable stream without proxying WebTransport through Vite. See
[`examples/vite-webtransport`](examples/vite-webtransport).

`verify` is the shared local and CI gate: formatting/lint checks, native loader tests,
an HTTP/3 listener smoke test, and release metadata consistency. After changing the
native producer, import its current-platform bundle and run the cross-repository protocol
baseline:

```sh
npm run binaries:import:local
npm run baseline
npm run browser
```

The importer uses a sibling `../msh3-node` checkout by default; set `MSH3_NODE_ROOT`
when the producer lives elsewhere. The baseline adds a real HTTP/3 request and
WebTransport session using the pinned integration client.

Use `npm run pack:check:protocol` and `npm run pack:check:browser` to install and
exercise the exact local tarballs, `npm run stress` for repeated native concurrency
coverage, and `npm run soak` for a long-lived HTTP/3 + WebTransport memory/cleanup run.

The public API and current WebTransport limitations are documented in
[`packages/server/README.md`](packages/server/README.md). Team workflow and review
expectations are in [CONTRIBUTING.md](CONTRIBUTING.md), and user-visible release notes
are maintained in [CHANGELOG.md](CHANGELOG.md).

## Project status

The HTTP/3 request API is usable and the WebTransport API is experimental. The initial
WebTransport implementation supports one session per QUIC connection, bidirectional
datagrams, and client-created bidirectional streams. Chrome 151 is pinned in CI for
accept/reject, datagrams, streams, abort, close, and reconnect. Server-created streams,
unidirectional streams, and multiple sessions per connection remain follow-up work.
Releases should stay pre-1.0 until the support matrix and wire interoperability are
broader.

## License

MIT-0. MSH3 and MsQuic notices are included with each published package.
