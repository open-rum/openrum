---
title: Threat model
description: Trust boundaries, threats, controls and residual risks for a public Instance.
---

> Canonical source: `docs/security/threat-model.md`. Edit the repository file; this page is generated during `pnpm site:build`.


## Scope and trust boundaries

OpenRUM receives untrusted browser telemetry through a public Ingest endpoint and serves authenticated operators through the Console/API. Kafka, ClickHouse, PostgreSQL, Redis and Alibaba Cloud OSS are private dependencies. Kubernetes Secrets/workload identity cross the deployment trust boundary; source maps and notification channel credentials are sensitive. Project and organization IDs are never authorization by themselves.

Protected assets are tenant telemetry, user/session identifiers, project write keys, Console sessions, alert credentials, source maps, audit history and service availability. Raw telemetry is untrusted even after authentication.

## Threats and controls

| Threat                               | Primary controls                                                                                             | Verification                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Cross-tenant read/write              | Repository queries join organization membership; unauthorized resources return not found; role/action matrix | metadata integration isolation and security auth tests |
| Session theft / CSRF                 | Secure HttpOnly session cookie, SameSite, absolute/idle TTL, same-origin check and double-submit token       | auth handler and CSRF tests                            |
| Write-key abuse                      | Hashed keys, origin allowlist, rotation/revocation, project/IP limits, bounded payloads                      | ingest handler tests                                   |
| PII/secrets in events                | URL normalization, sensitive-key removal, email/token/JWT/card scrubbing, bounded strings/properties         | privacy tests and fixtures                             |
| Account creation without authentication | By default registration exists only behind a valid, unexpired, unrevoked invitation link (256-bit secret, only its hash stored); per-address registration limit; a new account is pending and reaches nothing until an Owner or Admin approves; links are capped at 50 open and 200 pending requests per organization and cannot offer Owner. An Instance Owner can open registration (off by default; changing it needs a password re-check and is audited) | invitation and registration integration and handler tests |
| Mass or hostile self-registration (open registration) | Off by default; email sign-up needs a mail server and a confirmed address (one-use 256-bit link, 24 hours, only its hash stored); an unconfirmed account cannot sign in and is removed after 7 days; sign-up, resend and confirm are limited per source address, and a resend per account once a minute; the answer never says whether an address is registered, and a repeat sign-up never changes an existing account's name or password; one password rule (8+ characters with upper case, lower case and a symbol). Accepted risk: someone can start a sign-up with an address they do not own, which only takes effect if the real owner opens the mailed link; an address typed after an external sign-in is unverified. Open registration lets anyone create Organizations and Projects, so it suits a trusted network and needs the storage-pressure and rate-limit protections | registration integration, password and page tests |
| Hostile or oversized profile pictures | Upload needs a session and CSRF token; PNG only, 512 KB, 32–512 px, decoded and re-encoded server-side so metadata and trailing data are dropped; stored in the private bucket and served only to the owner and members of a shared organization with `nosniff`; generated avatars accept only CC0 styles and a plain random seed | avatar package, handler and storage tests |
| Third-party avatar service sees viewers | Generated avatars load from api.dicebear.com with no referrer and a random seed; initials and uploads cause no third-party request; documented in the privacy page | privacy documentation |
| Credentials and personal data in captured headers and bodies | Capture off by default; per-API, per-direction opt-in; credential and client-address header names refused at save, in the SDK and in normalization; bodies limited to text/JSON/form under 64 KB, redacted by key and pattern in the browser and again in the Consumer, cut to 4 KB; the Consumer keeps only what a rule names; 3-day expiry | capture, privacy, consumer and SDK tests |
| Decompression/parse exhaustion       | Compressed/raw byte caps, decompression-ratio cap, single gzip member, source-map size cap                   | privacy and ingest bomb tests                          |
| Webhook SSRF / credential leak       | HTTPS only, public-IP validation before request and redirects, proxy disabled, HMAC, encrypted config        | webhook security tests                                 |
| Source-map overwrite/tamper          | Scoped immutable object keys, expected size/SHA-256 metadata, private OSS                                    | source-map tests and OSS runbook                       |
| Upload-token abuse                   | Hashed project-scoped tokens, upload/list only, no deletes, revocable, last-use shown                        | upload token auth tests                                |
| Queue/database outage                | Acks-all before success, no offset commit before ClickHouse write, bounded retry/backpressure                | pipeline tests and failure runbooks                    |
| Supply-chain/image compromise        | Locked Go/pnpm dependencies, CI vulnerability scans, non-root read-only containers, dropped capabilities     | CI and Helm render/lint                                |
| High-cardinality metrics/log leakage | Bounded reason codes and route patterns; request IDs instead of raw dependency errors                        | metric and handler tests                               |

## Security invariants

- An HTTP success from Ingest means Kafka durably acknowledged the envelope.
- No API repository accepts a project ID without resolving the authenticated user's organization membership.
- Secrets, session tokens and signed URLs are not logged or returned after their intended one-time display. Browser-public DSNs remain visible to authorized Project users.
- Redirects and DNS are revalidated for every webhook attempt; private, loopback, link-local and carrier-grade NAT addresses are rejected.
- Destructive schema rollback, public OSS access and weakened Kafka durability are not automated recovery actions.

## Residual risks and response

User-supplied free text can contain identifiers not recognized by deterministic scrubbers; operators must configure capture conservatively and retention is bounded. Browser write keys are intentionally public and depend on origin/rate controls, not secrecy. A compromised allowed origin can submit plausible telemetry. Record accepted exceptions with an owner, expiry and compensating control; critical/high findings block rollout unless explicitly accepted by the security owner.

