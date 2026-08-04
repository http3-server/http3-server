# HTTP/3 Runtime for Linux x64 with glibc

`@http3-server/linux-x64-gnu` contains the prebuilt Node.js addon, MSH3 library, and
MsQuic library used by [`http3s`](https://www.npmjs.com/package/http3s) on glibc-based
Linux x64 systems.

Applications should install `http3s`; its native loader selects this optional package
automatically. The included `build-manifest.json` records the exact producer revision,
upstream revisions, maintained patch hashes, architecture, sizes, and SHA-256 checksums
for every native file.

MIT-0. Third-party notices are included in `NOTICE`.
