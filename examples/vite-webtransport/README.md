# Vite + WebTransport

This example runs Vite and `http3-server` as separate servers. Vite serves the page and hot
module updates over HTTP; the browser connects directly to the HTTP/3 server over UDP.
Vite's HTTP proxy is intentionally not involved.

From the repository root:

```sh
npm ci
npm run example:vite
```

Open <http://127.0.0.1:5173>, select **Connect**, and send both a disposable datagram
and a reliable stream message. The server echoes each message over the same transport.

The development certificate is generated without OpenSSL or trust-store changes and
cached under this example's ignored `.http3-server` directory. Its SHA-256 hash is injected
into the page by Vite and passed to `new WebTransport()`.

The server accepts only `/game` sessions whose `Origin` header is exactly
`http://127.0.0.1:5173`. Production applications should apply their own authentication
and authorization in addition to checking the origin.
