# Native HTTP/3 Loader for Node.js

`@http3-server/native` selects and loads the prebuilt HTTP/3 and WebTransport runtime
for the current operating system and CPU architecture.

Most applications should install [`http3s`](https://www.npmjs.com/package/http3s)
instead of depending on this package directly:

```sh
npm install http3s
```

The eight native packages are optional dependencies. Current npm releases install the
package matching macOS or Windows on arm64 or x64, or the matching glibc/musl Linux
target. Older npm releases that do not filter the `libc` package field may retain both
Linux variants for the current CPU; the loader still selects only the correct one. The
postinstall check reports a clear error when no supported native runtime is available.

Every platform package contains a checksummed build manifest tying its native addon,
MSH3 library, and MsQuic library to one exact producer revision. See the
[`http3-server` release documentation](https://github.com/http3-server/http3-server/blob/main/RELEASING.md)
for the complete promotion and verification process.

## Support

`@http3-server/native` supports Node.js 22, 24, and 26. Bun and Deno runtime support is
not yet tested or claimed. Report issues in the
[`http3-server` repository](https://github.com/http3-server/http3-server/issues).

## License

MIT-0. Third-party notices for MSH3 and MsQuic are included in the package.
