# Releasing

All eleven published packages use one version. A release is promoted from a single
successful `msh3-node` build, never assembled from runs or local machines. The first
coordinated version is `0.2.0` and should initially use the `next` distribution tag.
Version `0.1.0` was published in 2025 for selected native packages only and must not be
reused.

## 0. Registry and repository prerequisites

The npm organization and unscoped package name `http3-server` must exist, and the
release maintainer must use 2FA. All package manifests pin the public npm registry,
public access, and provenance generation.

npm does not allow staged or trusted publishing for a package that has never been
published. Bootstrap the first release with a short-lived granular npm token that can
publish the eleven package names and bypass publish 2FA. Store it only as the `NPM_TOKEN`
secret in the protected `npm` GitHub environment; never commit it or place it in a
repository-level configuration file. Remove the token immediately after the first
release and complete the trusted-publishing migration in section 5.

## 1. Produce native bundles

1. Merge the native change in `http3-server/msh3-node`.
2. Wait for all eight target builds and the combined `builds` artifact.
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
tracked runtime files as one rollback-capable transaction. Commit the eight manifests
with the binaries. Manifest version 4 pins the target OS, CPU and libc, conservative
libc build baseline, exact `msh3-node` producer commit, MSH3 and MsQuic commits, and each
maintained patch checksum, so every published native file has one exact source baseline.

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

## 4. Publish the verified candidate

The `Publish npm release` workflow accepts only a completed successful release-candidate
run, checks out that candidate's exact source commit, downloads its immutable tarball
artifact, verifies it again, and publishes in dependency order:

1. `@http3-server/dev-certificates`;
2. the eight `@http3-server/<target>` packages;
3. `@http3-server/native`;
4. `http3-server`.

After reviewing the candidate artifact, dispatch the workflow with its run ID and exact
version. The confirmation input deliberately includes the version:

```sh
gh workflow run publish.yml \
  --repo http3-server/http3-server \
  -f candidate_run_id=1234567890 \
  -f version=0.2.0 \
  -f dist_tag=next \
  -f 'confirmation=publish 0.2.0'
```

The publisher checks all existing versions before changing the registry. A retry skips
an already-published package only when its registry integrity exactly matches the
candidate, making recovery from an interrupted eleven-package bootstrap safe. It refuses
live publication outside GitHub Actions.

Use the same npm dist-tag for every package. Move to `latest` only after the candidate
passes the eight-target Node 22/24/26 load matrix, the packed protocol/browser gates,
and the scheduled promotion soak without unbounded memory, hangs, or native crashes.

After all packages are visible, create the annotated `v0.2.0` tag and GitHub release
from the same candidate commit. Never tag a partial publication.

## 5. Replace the bootstrap token

Once every package exists, configure `publish.yml` as its trusted GitHub Actions
publisher. Allow `npm publish` for the initial migration; staged publication can be
enabled for later release review:

```sh
npm trust github @http3-server/dev-certificates \
  --repo http3-server/http3-server --file publish.yml --allow-publish
```

Repeat that command for the eight native target packages, `@http3-server/native`, and
`http3-server`. Then set each package's publishing access to require 2FA and disallow tokens,
delete the `NPM_TOKEN` GitHub secret, and verify the next `next` release through OIDC.
Trusted publishing automatically produces provenance for public packages from this
public repository.

Publishing remains a deliberate maintainer action. CI creates and verifies candidates
without publishing. Only a manually confirmed run using the protected `npm` environment
can change the registry.
