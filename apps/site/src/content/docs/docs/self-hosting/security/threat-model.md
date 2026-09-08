---
title: Threat model
description: Trust boundaries, threats, controls and residual risks for a public Instance.
---

> Canonical source: `docs/security/threat-model.md`. Edit the repository file; this page is generated during `pnpm site:build`.


## Scope and trust boundaries

OpenRUM receives untrusted browser telemetry through a public Ingest endpoint and serves authenticated operators through the Console/API. Kafka, ClickHouse, PostgreSQL, Redis and Alibaba Cloud OSS are private dependencies. Kubernetes Secrets/workload identity cross the deployment trust boundary; source maps and notification channel credentials are sensitive. Project and organization IDs are never authorization by themselves.

Protected assets are tenant telemetry, user/session identifiers, project write keys, Console sessions, alert credentials, source maps, audit history and service availability. Raw telemetry is untrusted even after authentication.

## Threats and controls

| Threat | Primary controls | Verification |
| --- | --- | --- |
| Cross-tenant read/write | Repository queries join organization membership; unauthorized resources return not found; role/action matrix | metadata integration isolation and security auth tests |
| Session theft / CSRF | Secure HttpOnly session cookie, SameSite, absolute/idle TTL, same-origin check and double-submit token | auth handler and CSRF tests |
| Write-key abuse | Hashed keys, origin allowlist, rotation/revocation, project/IP limits, bounded payloads | ingest handler tests |
| PII/secrets in events | URL normalization, sensitive-key removal, email/token/JWT/card scrubbing, bounded strings/properties | privacy tests and fixtures |
| Decompression/parse exhaustion | Compressed/raw byte caps, decompression-ratio cap, single gzip member, source-map size cap | privacy and ingest bomb tests |
| Webhook SSRF / credential leak | HTTPS only, public-IP validation before request and redirects, proxy disabled, HMAC, encrypted config | webhook security tests |
| Source-map overwrite/tamper | Scoped immutable object keys, expected size/SHA-256 metadata, private OSS | source-map tests and OSS runbook |
| Queue/database outage | Acks-all before success, no offset commit before ClickHouse write, bounded retry/backpressure | pipeline tests and failure runbooks |
| Supply-chain/image compromise | Locked Go/pnpm dependencies, CI vulnerability scans, non-root read-only containers, dropped capabilities | CI and Helm render/lint |
| High-cardinality metrics/log leakage | Bounded reason codes and route patterns; request IDs instead of raw dependency errors | metric and handler tests |

## Security invariants

- An HTTP success from Ingest means Kafka durably acknowledged the envelope.
- No API repository accepts a project ID without resolving the authenticated user's organization membership.
- Secrets, session tokens, write keys and signed URLs are not logged or returned after their intended one-time display.
- Redirects and DNS are revalidated for every webhook attempt; private, loopback, link-local and carrier-grade NAT addresses are rejected.
- Destructive schema rollback, public OSS access and weakened Kafka durability are not automated recovery actions.

## Residual risks and response

User-supplied free text can contain identifiers not recognized by deterministic scrubbers; operators must configure capture conservatively and retention is bounded. Browser write keys are intentionally public and depend on origin/rate controls, not secrecy. A compromised allowed origin can submit plausible telemetry. Record accepted exceptions with an owner, expiry and compensating control; critical/high findings block rollout unless explicitly accepted by the security owner.
