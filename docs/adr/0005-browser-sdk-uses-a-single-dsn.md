# ADR 0005: Browser SDK uses a single DSN

- Status: Accepted
- Date: 2026-09-12

## Context

The Browser SDK originally required both an Ingest `endpoint` and a project
`writeKey`. Operators had to copy two related values even though neither was
useful independently during normal installation. This created avoidable setup
errors and differed from the familiar single-value setup used by tools such as
Sentry.

The underlying write credential is intentionally browser-public and remains
protected by Project Origin allowlists, rate limits, rotation, and revocation.

## Decision

`@openrum/browser` accepts one required `dsn` option. Its URL shape is:

```text
https://<public-write-key>@<instance-host>/ingest/v1/envelope
```

The SDK parses the DSN before starting. It removes URL user-info from the
network destination and continues sending the write key through the existing
`X-OpenRUM-Key` header. A password, non-HTTP scheme, relative URL, query, or
fragment makes the DSN invalid.

The Console creates the DSN from the Instance public URL when a project key is
created or rotated. Because this credential is necessarily public in a browser,
the control plane stores its public value alongside the validation hash and
returns the complete DSN to authorized Console users. Keys created before this
storage change must be rotated once before they can be shown again.

Every new Project receives one default DSN automatically. Normal setup exposes
only that DSN; additional client keys remain available as an advanced option
for client isolation or independent rotation. The default DSN may be rotated
but not revoked without a replacement.

## Consequences

- Installation requires one copied value and one SDK option.
- Self-hosted deployments remain supported because the Instance URL is encoded
  in the DSN.
- Key rotation and revocation keep their existing semantics and invalidate the
  corresponding DSN.
- A DSN can be viewed and copied again; abuse prevention relies on Origin
  allowlists, rate limits, sampling, rotation, and revocation rather than UI
  concealment.
- The default path has no key-creation step, while advanced multi-key workflows
  remain possible.
- The server-side Ingest authentication protocol does not change.
- `endpoint` and `writeKey` are no longer public Browser SDK initialization
  options in Alpha; internal transport code still operates on their parsed
  values.
