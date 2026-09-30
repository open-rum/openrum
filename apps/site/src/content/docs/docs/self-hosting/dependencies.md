---
title: External dependencies
description: PostgreSQL, ClickHouse, Kafka, Redis and optional object storage requirements.
---

OpenRUM separates control-plane state from high-volume telemetry. Production deployments should use managed or HA versions of these dependencies; Compose is for local evaluation only.

## Topology

| Dependency | Role | Required |
| --- | --- | --- |
| **PostgreSQL** | Users, Organizations, Projects, keys, Releases, Issue workflow and audit state | Yes |
| **ClickHouse** | Immutable Events and query aggregates | Yes |
| **Kafka** | Durable ingestion buffer between accept and store | Yes |
| **Redis** | Quotas, short-lived state and rate limits | Yes |
| **Object storage** | Source Map Artifacts and future large objects (OSS or S3-compatible) | Optional |

## PostgreSQL

Holds the control plane. Login, Project configuration, write keys and Issue State depend on it. Back up with PITR or equivalent and restore as part of a single recovery set with ClickHouse and optional object storage. See [PostgreSQL operations](/docs/self-hosting/postgres/).

## ClickHouse

Stores Events and aggregates used by Analysis, Sessions, Issues, performance and API views. Consumer lag and insert health determine query freshness. See [ClickHouse operations](/docs/self-hosting/clickhouse/).

## Kafka

Accepts envelopes only after durable acknowledgement. Consumer failure delays visibility but must not delete committed data. Never reset offsets without an approved replay plan. See [Kafka operations](/docs/self-hosting/kafka/).

## Redis

Supports limits and ephemeral coordination. Treat Redis loss as degraded rate limiting and state, not as the only durable telemetry store. API and Ingest report not ready while it is unreachable. The Helm Chart can run a single Redis for you or use your own; see [Redis: bundled or external](/docs/self-hosting/kubernetes/#redis-bundled-or-external) and [Redis operations](/docs/self-hosting/redis/).

## Object storage

Optional. Core monitoring works without a Bucket. Source Map upload and mapped frames require Alibaba OSS or an S3-compatible provider. See [Object storage](/docs/self-hosting/object-storage/).

## Capacity starting point

Before production, review [Capacity planning](/docs/self-hosting/capacity/), run the documented benchmark with measured traffic inputs, and establish [backup/restore](/docs/self-hosting/backup-restore/) and [upgrade](/docs/self-hosting/upgrades/) runbooks.
