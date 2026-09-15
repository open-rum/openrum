---
title: PostgreSQL
description: Operate the control-plane database for users, projects and workflow state.
---

> Canonical source: `docs/operations/postgres.md`. Edit the repository file; this page is generated during `pnpm site:build`.


**Owner:** database/platform on-call · **Critical data:** tenant, auth, project, release and workflow state

## Trigger and impact

Detect with readiness failures, API 5xx, connection saturation, replication lag and database provider alarms. PostgreSQL holds organizations, projects, credentials, alert rules, releases and issue workflow state. Existing SDK traffic may continue briefly through cached project-key authorization, but login, configuration and control-plane writes degrade. Treat an unavailable primary as a control-plane outage.

## Safe response

1. Record primary/replica state, connections, locks, CPU/disk, WAL/replication lag, recent migrations and Helm revision.
2. Freeze releases and migrations. Reduce API/worker replicas or connection concurrency if connection exhaustion is the cause; keep ingest only while authorization cache behavior and security posture are understood.
3. Use the managed database failover procedure. Keep the old primary fenced before promoting a replica; update the existing Kubernetes Secret and roll services only after the new endpoint is writable.
4. Do not kill unknown transactions, promote a lagging replica, run down migrations or restore over the live primary without incident-command approval.

## Recovery and validation

1. Verify migration status, read/write canaries and uniqueness/foreign-key constraints. Confirm replicas follow the single writable primary.
2. Run login, project-key authentication, SDK-config read and one reversible metadata write. Confirm audit records are emitted.
3. Re-enable workers, API traffic and releases gradually; watch 5xx, latency, connections and replication lag for 30 minutes.

Escalate for possible split brain, WAL loss, schema disagreement, suspected credential exposure, or any restore requirement. Follow `backup-restore.md` for restore drills.

## Read-only evidence queries

```sql
SELECT now(), pg_is_in_recovery();
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
SELECT pid, usename, wait_event_type, wait_event, age(clock_timestamp(), query_start) AS age FROM pg_stat_activity WHERE state <> 'idle' ORDER BY age DESC;
SELECT application_name, state, sync_state, write_lag, flush_lag, replay_lag FROM pg_stat_replication;
```

Use the migration binary's `status` command before and after recovery. A successful TCP connection alone is not recovery: require a read/write canary, valid login, tenant isolation and audit-log verification.

