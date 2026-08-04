# Development Certificates for HTTP/3 and WebTransport

`@http3-server/dev-certificates` creates short-lived ECDSA P-256 certificates for local
TLS, HTTP/3, and WebTransport development. It has no runtime dependencies and does not
install a certificate authority or change a system trust store.

The portable entry point uses the standard Web Crypto API and is tested on Node.js,
Bun, and Deno. The Node.js entry point adds safe filesystem caching and rotation.

## Installation

```sh
npm install --save-dev @http3-server/dev-certificates
```

## Portable generation

```js
import { createDevelopmentCertificate } from "@http3-server/dev-certificates";

const certificate = await createDevelopmentCertificate({
	dnsNames: ["localhost"],
	ipAddresses: ["127.0.0.1", "::1"],
});
```

The result includes DER and PEM certificate forms, a PKCS#8 private key, the SHA-256
certificate hash, validity dates, and a `serverCertificateHashes` value ready for the
browser's `WebTransport` constructor:

```js
const transport = new WebTransport("https://localhost:4433/game", {
	serverCertificateHashes: certificate.serverCertificateHashes,
});

await transport.ready;
```

The portable API performs no filesystem or network access. In Deno it therefore needs
no permissions; Bun and Node.js can use it without runtime-specific imports.

## Node.js caching

```js
import { ensureDevelopmentCertificate } from "@http3-server/dev-certificates/node";
import { HTTP3Server } from "http3s";

const certificate = await ensureDevelopmentCertificate({ directory: ".http3s" });
const server = new HTTP3Server();

await server.start({
	address: "127.0.0.1",
	port: 4433,
	certificateFile: certificate.certificateFile,
	privateKeyFile: certificate.privateKeyFile,
});
```

The helper reuses a matching valid certificate, rotates it one day before expiration,
stores immutable key/certificate pairs behind an atomically updated cache pointer, and
gives private keys owner-only permissions where the platform supports them. Overlapping
callers therefore always receive a matching pair. Add the chosen directory to the
application's ignore file.

## Certificate profile

Generated certificates deliberately have a narrow development profile:

- self-signed X.509 v3;
- ECDSA using P-256 and SHA-256;
- ten-day validity by default, with a maximum of thirteen days;
- `CA: false`, `digitalSignature`, and `serverAuth` constraints; and
- `localhost`, `127.0.0.1`, and `::1` subject alternative names by default.

The short lifetime and P-256 key make the certificate suitable for WebTransport
certificate-hash authentication. Certificate hashes authenticate only the server; an
application must still authenticate users and authorize WebTransport sessions.

This package is not a production certificate authority, ACME client, or replacement for
public Web PKI. Ordinary HTTPS clients will not trust these self-signed certificates
unless configured separately; the hash bypass applies specifically to WebTransport.
Use an automatically renewed publicly trusted certificate in production.
