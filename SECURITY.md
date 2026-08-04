# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
**Report a vulnerability** action on this repository's Security tab. Repository
collaborators may instead create a private draft security advisory. Include the
affected package and version, reproduction steps, impact, and any proposed fix.

The maintainers will acknowledge a report within three business days, keep the
reporter informed while it is investigated, and coordinate disclosure after a
fixed release is available.

## Supported versions

Until the first public release, only the current candidate is supported. After
publication, the current `latest` release and any explicitly announced security
backport line are supported.

## Upstream monitoring and response

Release maintainers monitor security advisories for
[MSH3](https://github.com/nibanks/msh3/security/advisories),
[MsQuic](https://github.com/microsoft/msquic/security/advisories),
[Node.js](https://nodejs.org/en/blog/vulnerability), and npm dependencies through
GitHub dependency alerts and `npm audit`.

A relevant advisory bypasses the normal release cadence, but not verification:

1. update and pin the affected dependency;
2. rebuild all six native platforms from one complete workflow run;
3. import that run atomically and generate a fresh candidate;
4. run the full release gates against the packed candidate; and
5. publish the fixed packages together, then disclose according to the advisory.
