---
title: Capacity planning
description: Estimate dependency and service capacity from measured traffic, not Demo volume.
---

**Applies to:** Alpha / main.

Compose Demo volume is for product evaluation, not production sizing. Capacity planning must start from measured Page Views, Custom Events, error rates, API Request volume and retention windows.

## Inputs to collect

- Peak Events per second and daily Event volume
- Session length and Events per Session
- Error and API Request sample rates
- Raw and aggregate retention days
- Source Map Artifact size and upload frequency

## Dependency pressure

| Dependency | Watch |
| --- | --- |
| Kafka | Produce acknowledgement P99, lag, retention headroom |
| ClickHouse | Insert success, query latency, disk growth |
| PostgreSQL | Connections, control-plane write latency |
| Redis | Memory and eviction behavior under quotas |
| Object storage | Artifact size, upload failures |

Run the repository benchmark guides under `docs/benchmarks/` with production-like inputs before exposing an Instance. Review [External dependencies](/docs/self-hosting/dependencies/) and operations runbooks when alerts fire.
