# Storage pressure and emergency recovery code map

<!-- cspell:ignore storagepressure -->

Read this file before changing ClickHouse capacity thresholds, automatic
sampling, the Ingest hard stop, emergency cleanup, or their Console and public
documentation.

## Stable product rules

- Warn at 85% used, cap Browser SDK sampling at 10% from 90%, and hard-stop
  Ingest at 95%.
- Hard stop deliberately returns an empty `202` without Kafka work so Browser
  SDKs do not create a retry storm.
- The hard stop remains latched until a successful capacity probe observes less
  than 90% used. Cleanup never opens it directly.
- Ordinary retention mutations are not the hard-stop recovery path.
- Emergency cleanup is available only while usage is at least 85%. It selects
  allowlisted Project/month partitions only after the calendar month ended at
  least 24 hours earlier, excludes recent data, and aims for 85% used.
- The Console owns the beginner-friendly workflow. Never instruct users to
  delete ClickHouse files, Kafka topics or Docker volumes.
- Emergency deletion requires an Instance Owner, a ten-minute single-use
  preview, explicit phrase plus password confirmation, one global job, progress
  reporting and audit records.

## Change map

| Concern | Primary files |
| --- | --- |
| Threshold state machine and capacity probe | `internal/storagepressure/monitor.go` |
| Configuration and deployment defaults | `internal/config/config.go`, `deploy/compose/`, `deploy/helm/openrum/` |
| Ingest hard stop | `services/ingest/internal/handler.go` |
| SDK emergency sampling configuration | `services/api/internal/handlers/sdk_config.go` |
| Read-only capacity API | `services/api/internal/handlers/storage_pressure.go` |
| Emergency preview and control API | `services/api/internal/handlers/admin_emergency_cleanup.go` |
| Preview/job persistence | `internal/metadata/emergency_cleanup.go`, `migrations/postgres/0020_emergency_cleanup.*.sql` |
| Partition drop Worker | `services/worker/internal/emergency_cleanup.go` |
| Global Banner | `apps/web/src/app/StoragePressureBanner.tsx` |
| Guided recovery UI | `apps/web/src/features/admin/EmergencyStorageRecovery.tsx` |
| Console API models | `apps/web/src/lib/api/admin.ts`, `apps/web/src/lib/api/storagePressure.ts` |
| Operator runbook | `docs/operations/storage-pressure.md` |
| Public documentation | `apps/site/src/content/docs/{docs,zh/docs}/self-hosting/storage-pressure.md` |
| Architecture decision | `docs/adr/0006-emergency-storage-recovery-drops-old-partitions.md` |

## Safety invariants

The API discovers candidates from active `system.parts` metadata. Project and
table identities are server-generated; clients receive summaries but never
submit table names or partition IDs. The Worker accepts only a fixed table
allowlist and lowercase 32-character partition IDs. An already-absent partition
is success, making retries idempotent.

If no complete old month exists, or selected partitions cannot reach the target,
say so. Never broaden deletion into the protected month. Volume expansion is the
fallback when safe candidates are insufficient or the control plane is down.

## Validation

```sh
go test ./internal/metadata ./internal/storagepressure ./services/api/internal/handlers ./services/ingest/internal ./services/worker/internal
go vet ./...
pnpm --filter @openrum/web typecheck
pnpm --filter @openrum/web lint
pnpm --filter @openrum/web test -- --run
pnpm site:build
pnpm site:spell
```

For the actual partition DDL, use an isolated ClickHouse test database and prove
that `DROP PARTITION ID` removes only the explicit test partition. Never validate
against a real Project partition.
