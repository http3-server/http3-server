# Contributing

## Repository responsibilities

- Change native C++ bindings, the MSH3 patch, or cross-platform compilation in
  `http3-server/msh3-node`.
- Change the JavaScript API, package selection, documentation, or release metadata in
  this repository.
- Move a binary between repositories only with `npm run binaries:import`; do not copy
  individual files by hand.

For local integration work, build `msh3-node` and atomically import only the current
platform bundle:

```sh
npm run binaries:import:local
```

This uses a sibling `../msh3-node` checkout by default. Set `MSH3_NODE_ROOT` when the
producer lives elsewhere.

The release importer still requires all six bundles from one workflow run.
Each v3 build manifest records the exact `msh3-node` producer commit, and
`native-baseline.json` pins that revision for the release monorepo. Any producer
source, patch, declaration, or build-tool change that can affect bundles therefore
requires a deliberate baseline update and one new complete six-platform import;
stale or mixed-revision bundles are rejected.

## Working agreement

1. Keep HTTP/3 behavior and WebTransport behavior independently testable.
2. Add or update a test with behavior changes.
3. Run `npm run verify` before requesting review.
4. Treat `npm run check:release:strict` as the binary-provenance gate. It is expected to
   fail until all six platform bundles from one native build have been imported.
5. Keep package versions in lockstep. Use `npm run version:set -- <version>` rather than
   editing eight manifests independently.

Native changes should land in the builder first. The npm monorepo change should record
the successful native workflow run used for the import in its pull request description.

Use the narrowest additional gate that matches the change:

- `npm run integration` for protocol or lifecycle behavior;
- `npm run browser` for WebTransport wire behavior;
- `npm run pack:check:protocol` and `npm run pack:check:browser` for package or loader changes;
- `npm run stress` for concurrency-sensitive native changes; and
- `HTTP3_SOAK_SECONDS=300 npm run soak` for memory or cleanup changes.

The soak uses the first half of short local runs (up to five minutes) to warm Node,
TLS, QUIC, and allocator pools, then bounds retained post-GC RSS growth. Native
diagnostics and the public connection registry must return to zero every iteration.

CI keeps these as separate fast, platform, protocol, browser, stress, and scheduled soak
jobs so failures have a clear owner. The browser and candidate workflows pin the Chrome
version rather than silently changing protocol behavior with the runner image.

## Baseline

After building and locally importing the current platform bundle, run:

```sh
npm run baseline
```

The first run creates an ignored, pinned aioquic environment under `.cache/`. The
command checks the producer patch and bundle, confirms that the local platform package
matches that bundle, runs deterministic package tests, and exercises a real HTTP/3 GET
and WebTransport CONNECT on a dynamically assigned port. Set `MSH3_NODE_ROOT` when the
producer repository is not the default sibling checkout.

aioquic 1.3.0 is the selected conforming client and low-level adversarial-driver base.
The baseline uses its HTTP/3 API; malformed-frame tests should use its underlying raw QUIC
stream interface so the conforming and hostile clients remain pinned together.

## Pull request scope

Prefer one of these reviewable units:

- native protocol or binding change plus its builder validation;
- one complete six-platform binary refresh;
- JavaScript API and tests;
- release metadata or documentation.

Do not combine an unrelated API redesign with a binary refresh. That separation makes
regressions and rollbacks substantially easier to identify.
