---
title: Backup and restore
description: Protect control-plane state, events and optional Source Map Artifacts.
---

> Canonical source: `docs/operations/backup-restore.md`. Edit the repository file; this page is generated during `pnpm site:build`.


## Recovery objectives

- PostgreSQL RPO: 15 minutes; RTO: 60 minutes for control-plane service.
- Use Alibaba Cloud RDS automated physical backups plus continuous log backup/PITR when PostgreSQL is managed. Enable cross-zone storage, encryption, deletion protection and 14-day retention.
- For self-managed PostgreSQL, use pgBackRest full weekly, differential daily and WAL archive continuously to a private encrypted OSS prefix. A `pg_dump --format=custom` logical backup is an additional portability check, not the primary PITR mechanism.
- Alert when the newest successful backup or archived WAL exceeds the RPO. Run a restore drill at least quarterly and before a destructive migration.

## Restore drill

1. Record the incident recovery timestamp and stop all OpenRUM writers if this is a real restore. Preserve the original database read-only.
2. Restore into a new database/instance; never overwrite the source during validation.
3. Apply no new migrations initially. Compare `openrum_schema_migrations`, row counts and constraints, then run `/app/migrate status all` against the restored endpoint.
4. Validate owner login, organization/project access, active key hashes, alert configuration decryption and a reversible metadata write. Confirm audit history predates the recovery point.
5. Point one canary API replica at the restored database, then cut over through the Kubernetes Secret and rolling deployment. Keep the old primary fenced and retained until the rollback window closes.
6. Record achieved RPO/RTO, missing transactions and evidence. A restore is not complete merely because PostgreSQL starts.

Example logical drill against an isolated database:

```bash
pg_dump --format=custom --dbname=<source-dsn> --file=<encrypted-drill.dump>
createdb <new-drill-database>
pg_restore --exit-on-error --single-transaction --dbname=<new-drill-dsn> <encrypted-drill.dump>
psql <new-drill-dsn> -c 'SELECT version, applied_at FROM openrum_schema_migrations ORDER BY version'
```

## Project deletion contract

`DELETE /api/v1/projects/{projectId}` is owner-only and CSRF protected. It atomically marks the project `deleting`, revokes all write keys, hides it from Console/query APIs, queues cleanup and records `project.deletion_requested`.

The worker deletes all project rows from ClickHouse local event/aggregate/mapping tables, verifies zero rows, deletes every Source Map OSS object, then removes PostgreSQL child metadata and records `project.deletion_completed`. Cleanup is idempotent and retried with backoff. A one-minute empty observation window catches Kafka or Distributed-table events that arrive after the first pass; any late row resets the window and is removed before completion. The queue deadline is 24 hours.

Alert when a deletion is `failed`, passes `deadline_at`, or remains `running` for 15 minutes. Do not manually mark it complete. Preserve the project tombstone and deletion audit; these contain no telemetry and prevent accidental reuse from being mistaken for the deleted project.

## Local drill evidence

On 2026-09-03, `openrum_test` was dumped in PostgreSQL custom format and restored into a new `openrum_restore_drill` database. The restored database matched the source at 7 applied migrations, 103 public constraints and 4 deletion tombstones. `/app/migrate status postgres` reported migrations 0000–0006 applied. A transactional write canary succeeded and rollback left zero canary rows. The isolated restored database was removed after validation; the source database was not modified by the drill.
