---
title: ClickHouse
description: Operate event storage, aggregates and query freshness.
---

> Canonical source: `docs/operations/clickhouse.md`. Edit the repository file; this page is generated during `pnpm site:build`.


**Owner:** data/platform on-call · **Primary protection:** Kafka retention and uncommitted consumer offsets

## Trigger and impact

Page on `OpenRUMClickHouseInsertErrors`, `OpenRUMDataFreshnessHigh`, high query latency or replica health. Ingest may continue while Kafka has retention headroom. Consumers retry failed inserts and do not commit the Kafka message until ClickHouse succeeds; dashboards become stale and should display freshness warnings.

## Safe response

1. Record cluster health, failed replicas, disk/inode usage, merges/mutations, rejected queries, Kafka lag and the first failing insert error.
2. Protect ingestion durability: reduce sampling if Kafka drain time approaches retention. Pause expensive console queries or reduce API concurrency before changing consumers.
3. Restore disk, network or replica health with the ClickHouse owner. Scale consumers down if retries amplify pressure; never skip/commit a failing Kafka offset.
4. Do not run `OPTIMIZE FINAL`, broad mutations, table drops, replica deletion or manual deduplication during the incident without a reviewed recovery plan.

## Recovery and validation

1. Confirm replicas are active, queues drain, disk headroom is safe and a canary insert/query succeeds.
2. Resume one consumer, then scale gradually. Watch insert error rate, P99, Kafka lag and freshness.
3. Verify an incident-window sample by event ID from Kafka through `rum_events`; idempotent insert tokens make replay safe, but duplicates must still be measured.
4. Close after lag and freshness return to baseline for 30 minutes and no partition remains blocked.

Escalate when retention may expire before recovery, replicated tables disagree, data loss is suspected, or repair needs restore/DDL.

## Read-only evidence queries

Run with a read-only ClickHouse account and retain the incident window:

```sql
SELECT database, table, is_readonly, absolute_delay, queue_size FROM system.replicas ORDER BY absolute_delay DESC;
SELECT database, table, mutation_id, command, is_done, latest_fail_reason FROM system.mutations WHERE NOT is_done;
SELECT name, path, free_space, total_space FROM system.disks;
SELECT type, event_time, query_id, exception FROM system.query_log WHERE event_time > now() - INTERVAL 15 MINUTE AND type = 'ExceptionWhileProcessing' LIMIT 100;
```

Do not copy raw event columns into tickets. Validate recovery using known synthetic event IDs, aggregate counts and freshness timestamps.

## Retention evidence

Product data retention is row-specific: raw events use `raw_expires_at`, while product aggregate tables use `aggregate_expires_at`. Verify policy propagation with bounded, read-only queries:

```sql
SELECT project_id, min(raw_expires_at), max(raw_expires_at), count()
FROM rum_events_local
WHERE timestamp >= now() - INTERVAL 15 MINUTE
GROUP BY project_id
LIMIT 100;

SELECT project_id, min(aggregate_expires_at), max(aggregate_expires_at), count()
FROM project_metrics_1m_local
WHERE bucket >= now() - INTERVAL 15 MINUTE
GROUP BY project_id
LIMIT 100;
```

Do not run broad `MATERIALIZE TTL` mutations during routine verification. Historical policy application is handled by the previewed, rate-limited maintenance workflow so ingestion merges retain capacity.

Historical retention jobs execute at most one project/table/month step globally at a time, with a five-second cooldown between successful steps. A step uses a deterministic Worker timestamp, performs a bounded delete followed by an expiry update, and waits synchronously for each mutation. Inspect progress through `GET /api/v1/admin/maintenance-jobs`; do not bypass a failed job with an ad-hoc cluster-wide mutation.
