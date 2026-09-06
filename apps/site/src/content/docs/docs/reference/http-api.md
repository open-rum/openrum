---
title: HTTP API
description: Overview of Console, ingest and control-plane HTTP surfaces in Alpha.
---

**Applies to:** Alpha / main. Status: skeleton for Alpha.

OpenRUM exposes three HTTP surfaces:

| Surface | Typical base | Audience |
| --- | --- | --- |
| **Ingest** | `/ingest/v1/envelope` | Browser SDK |
| **Console API** | `/api/*` | Authenticated Console and operators |
| **Health** | `/health/live`, `/health/ready` | Orchestrators and local checks |

## Ingest

The Browser SDK posts bounded envelopes to ingest. An HTTP success means Kafka durably acknowledged the envelope. Payloads are schema-validated and privacy-scrubbed. See [Event schema](/docs/reference/event-schema/) and [Browser SDK](/docs/sdk/browser/).

## Console API

Authenticated session cookies, CSRF validation and RBAC protect Console APIs. Project IDs are never authorization by themselves; membership is resolved server-side. Exact route catalogs will expand as Alpha stabilizes. Configuration environment variables are documented in [Configuration](/docs/reference/configuration/).

## Health endpoints

Use readiness probes before sending traffic or declaring a local Quickstart successful:

```sh
curl --fail http://127.0.0.1:4173/health/ready
```

## Compatibility note

Alpha APIs may change before the first stable Release. Prefer the Browser SDK and documented Console workflows over raw HTTP integrations until the reference catalog is complete.
