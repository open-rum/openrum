---
title: Capacity planning
description: Estimate dependency and service capacity from measured traffic, not Demo volume.
appliesTo: Alpha
---

Compose Demo volume exists for product evaluation and says nothing about production sizing. Capacity planning starts from measured Page Views, Custom Events, error rates, API Request volume and retention windows.

## Inputs to collect

- Peak Events per second and daily Event volume
- Session length and Events per Session
- Error and API Request sample rates
- Raw and aggregate retention days
- Source Map Artifact size and upload frequency

Multiply expected traffic by the sample rates before sizing anything. At the default rates an Instance stores every Page View and error but only one in five API Requests, so a naive Event-per-second figure overstates ClickHouse load and understates it as soon as `apiSampleRate` is raised.

The Project Rate Limit is measured in Ingest requests rather than Events. Convert peak Events per second using the measured average Events per request, keep operational headroom, and treat the result as a load-test input. See [Rate limits](/docs/product/rate-limits/#size-a-project-limit) for the formula and failure semantics.

## Dependency pressure

Read this alongside [Architecture](/docs/self-hosting/architecture/): Kafka is the only dependency whose failure drops Events, which is why its retention headroom is sized first.

| Dependency     | Watch                                                         |
| -------------- | ------------------------------------------------------------- |
| Kafka          | Produce acknowledgement P99, consumer lag, retention headroom |
| ClickHouse     | Insert success, query latency, disk growth                    |
| PostgreSQL     | Connections, control-plane write latency                      |
| Redis          | Memory and eviction behavior under quotas                     |
| Object storage | Artifact size, upload failures                                |

## Published figures

There are none yet, and none are inferred from the benchmark harness or from Demo data. The table below is the record this page will be filled in from; each row stays empty until a measured run exists under `docs/benchmarks/`.

| Measurement                                  | Status       | Evidence |
| -------------------------------------------- | ------------ | -------- |
| Envelopes per second per Ingest replica      | Not measured | —        |
| Events per second per Consumer replica       | Not measured | —        |
| ClickHouse bytes per stored Event            | Not measured | —        |
| Kafka retention needed per hour of traffic   | Not measured | —        |
| Console query latency at a given Event count | Not measured | —        |

Until those rows are populated, size an Instance from your own benchmark run rather than from a number quoted elsewhere. Run the guides under `docs/benchmarks/` with production-like inputs before exposing an Instance, and review [External dependencies](/docs/self-hosting/dependencies/) and the operations runbooks when alerts fire.

Install the disk, inode, fill-prediction and Kafka retention-headroom protections
described in [Storage pressure](/docs/self-hosting/storage-pressure/) before sending
production traffic.
