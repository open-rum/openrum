---
title: Architecture
description: High-level OpenRUM service and data topology.
---

OpenRUM is a self-hosted frontend monitoring platform with a browser SDK, Console and Go services.

## Components

| Component | Responsibility |
| --- | --- |
| Browser SDK | Capture Page Views, Custom Events, errors, Web Vitals and API Requests with privacy defaults |
| Vite plugin | Upload Source Map Artifacts for a Release |
| Ingest | Accept envelopes, validate/scrub, acknowledge to Kafka |
| Consumer | Persist Events and aggregates to ClickHouse |
| API | Authenticated Console/control-plane operations |
| Worker | Background jobs such as lifecycle and notifications |
| Console (`apps/web`) | Operator UI |
| Site (`apps/site`) | Public website and documentation |

## Data stores

- **PostgreSQL:** control-plane state
- **ClickHouse:** Events and aggregates
- **Kafka:** durable ingestion buffer
- **Redis:** quotas and short-lived state
- **Object storage (optional):** Source Map Artifacts

See [External dependencies](/docs/self-hosting/dependencies/) and root `CONTEXT.md` for domain language.
