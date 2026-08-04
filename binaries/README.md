# Native platform packages

Each directory is the source of one published `@http3-server/<platform>-<arch>`
package. Runtime binaries are imported only by `scripts/import-binaries.js` from one
complete `msh3-node` workflow artifact.

`build-manifest.json` records the exact MSH3 and MsQuic commits, both maintained patch
checksums, target architecture, file sizes, and file checksums. Do not copy individual
native files or combine workflow runs. See [`../RELEASING.md`](../RELEASING.md).
