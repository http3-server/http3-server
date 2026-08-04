# Native platform packages

Each directory is the source of one published `@http3-server/<target>` package. Linux
targets include their glibc or musl C library in the package name. Runtime binaries are
imported only by `scripts/import-binaries.js` from one complete `msh3-node` workflow
artifact.

`build-manifest.json` records the exact MSH3 and MsQuic commits, both maintained patch
checksums, target OS, architecture and libc, file sizes, and file checksums. Do not copy
individual native files or combine workflow runs. See
[`../RELEASING.md`](../RELEASING.md).
