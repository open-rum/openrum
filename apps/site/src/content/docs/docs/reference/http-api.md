---
title: HTTP API
description: Overview of Console, ingest and control-plane HTTP surfaces in Alpha.
appliesTo: Alpha
---

OpenRUM exposes four HTTP surfaces:

| Surface          | Typical base                            | Audience                            |
| ---------------- | --------------------------------------- | ----------------------------------- |
| **Ingest**       | `/ingest/v1/envelope`                   | Browser SDK                         |
| **SDK delivery** | `/sdk/browser/{version}/openrum.min.js` | Browser pages without a bundler     |
| **Console API**  | `/api/*`                                | Authenticated Console and operators |
| **Health**       | `/health/live`, `/health/ready`         | Orchestrators and local checks      |

## Ingest

The Browser SDK posts bounded envelopes to ingest. An HTTP success means Kafka durably acknowledged the envelope. Payloads are schema-validated and privacy-scrubbed. A throttled request returns `429`, `Retry-After`, and OpenRUM scope/limit diagnostic headers; see [Rate limits](/docs/product/rate-limits/#http-response-contract). See [Event schema](/docs/reference/event-schema/) and [Browser SDK](/docs/sdk/browser/).

## SDK delivery

The Instance serves a versioned IIFE build for pages that cannot install an npm package. The
script is public, CORS-enabled and immutable for one year; changing its contents requires a new
versioned URL. The current path is `/sdk/browser/0.1.0/openrum.min.js`, which exposes the
documented singleton API on `window.OpenRUM`.

## Console API

Authenticated session cookies, CSRF validation and RBAC protect Console APIs. Project IDs are never authorization by themselves; membership is resolved server-side. Exact route catalogs will expand as Alpha stabilizes. Configuration environment variables are documented in [Configuration](/docs/reference/configuration/).

Instance emergency storage recovery uses three Console-only endpoints:

- `POST /api/v1/admin/emergency-cleanup/preview` creates a ten-minute,
  operator-bound preview of complete old Project/month partitions.
- `POST /api/v1/admin/emergency-cleanup/jobs` requires Instance Owner
  reauthentication and consumes the preview once.
- `GET /api/v1/admin/emergency-cleanup/jobs/latest` reports progress for the
  guided Console workflow.

These are maintenance surfaces rather than public automation APIs. Prefer the
Console workflow described in [Storage pressure](/docs/self-hosting/storage-pressure/).

## Health endpoints

Use readiness probes before sending traffic or declaring a local start successful:

```sh
curl --fail http://127.0.0.1:4173/health/ready
```

## Compatibility note

Alpha APIs may change before the first stable Release. Prefer the Browser SDK and documented Console workflows over raw HTTP integrations until the reference catalog is complete.
