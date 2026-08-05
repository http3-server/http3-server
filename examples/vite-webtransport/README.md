# Vite + WebTransport

This example serves Vite and WebTransport from one trusted local origin. TCP provides
HTTP/2 with HTTP/1.1 fallback for initial navigation and secure HMR, while UDP provides
HTTP/3 and WebTransport on the same port. Every protocol uses the same Fetch-style
`stream` handler.

Vite's HMR server handles HTTP/1.1 WebSocket Upgrade, so this example disables HTTP/2
Extended CONNECT on the TCP listener. HTTP/3 Extended CONNECT and WebTransport remain
enabled.

From the repository root:

```sh
npm ci
npm run example:vite
```

The first run creates a development CA under `~/.http3-server` and asks the operating
system to trust it. Open <https://localhost:4433>, select **Connect**, and send both a disposable datagram
and a reliable stream message. The server echoes each message over the same transport.

TCP responses include `Alt-Svc: h3=":4433"`, so browsers can discover HTTP/3 after the
initial request. The page connects to same-origin `/game` without injecting a certificate
hash. Browser developer tools can show which ordinary requests moved to H3.

The server accepts only `/game` sessions whose `Origin` header is exactly
`https://localhost:4433`. Production applications should apply their own authentication
and authorization in addition to checking the origin.
