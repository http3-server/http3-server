# Releasing

All eight published packages use one version. A release is promoted from a single
successful `msh3-node` build, never assembled from runs or local machines.

## 1. Produce native bundles

1. Merge the native change in `jsxtools/msh3-node`.
2. Wait for all six build jobs and the combined `builds` artifact.
3. Download and extract that artifact. Each platform directory must contain
   `build-manifest.json` alongside its three runtime files.

## 2. Import the exact build

From this repository:

```sh
npm run binaries:check -- /path/to/builds
npm run binaries:import -- /path/to/builds
npm run check:release:strict
```

The import verifies checksums, platform names, and architectures before replacing the
tracked runtime files as one rollback-capable transaction. Commit the six manifests with
the binaries. Manifest version 3 pins the exact `msh3-node` producer commit, the MSH3
and MsQuic commits, and each maintained patch checksum, so every published native file
has one exact source baseline.

## 3. Prepare a release candidate

```sh
npm run version:set -- 0.2.0
npm install --package-lock-only
npm run verify
npm run check:release:strict
npm run pack:release
npm run candidate:test
npm run candidate:test:protocol
npm run candidate:test:browser
```

Review the release notes for user-visible API changes, protocol support, and known
limitations. Commit and push the version, lockfile, binary manifests, and
imported binaries, then dispatch the candidate workflow with the same producer run:

```sh
gh workflow run release-candidate.yml \
  --repo http3-server/http3-server \
  -f producer_run_id=1234567890
```

The workflow imports that exact producer artifact into a clean checkout, repeats the
release checks across the supported matrix, and uploads `npm-release-candidate` without
publishing it. It requires the repository secret `MSH3_ARTIFACT_TOKEN` with read access
to the private producer workflow artifact. `release/candidate-manifest.json` records
package identities, dependency edges, tarball integrity, native checksums, and the
security-policy checksum.

## 4. Publish in dependency order

After reviewing the tarballs, publish:

1. the six `@http3-server/<platform>-<arch>` packages;
2. `@http3-server/native`;
3. `http3s`.

Use the same npm dist-tag for every package. For experimental releases, prefer `next`.
Move to `latest` only after the candidate passes the six-platform Node 22/24/26 load
matrix, the packed protocol/browser gates, and the scheduled promotion soak without
unbounded memory, hangs, or native crashes.

Publishing remains a deliberate maintainer action. CI creates and verifies candidates
but does not hold npm credentials or publish automatically yet.
