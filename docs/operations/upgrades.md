# OpenRUM upgrades and rollback

## Compatibility contract

OpenRUM applies PostgreSQL and ClickHouse migrations in a Helm `pre-install,pre-upgrade` Job before rolling application pods. Every migration in a normal release must be expand-first: additive columns/tables and readers that tolerate both N-1 and N schemas. Destructive cleanup is deferred until all N-1 pods have been retired for at least one release.

The migration Job is idempotent and protected by database advisory locks. A failed Job stops the Helm upgrade before application Deployments change.

Application images must provide `/bin/sh`; the chart's five-second `preStop` drain delay keeps a terminating process alive while Kubernetes removes its Service endpoint. Deployments allow zero unavailable pods, add one surge pod, and require it to remain ready for five seconds before retiring an old replica. The remaining termination grace period is reserved for the Go HTTP server and Kafka producer to finish in-flight work.

## N-1 to N procedure

1. Confirm PostgreSQL/ClickHouse backups, Kafka lag, ingest acceptance and query freshness are healthy.
2. Run `helm lint deploy/helm/openrum` and render the exact production values.
3. Upgrade with `helm upgrade openrum deploy/helm/openrum --namespace openrum --atomic --wait --timeout 15m -f values.production.yaml`.
4. Confirm the migration Job completed, every Deployment is available, Kafka lag returns to baseline, and `helm test openrum --namespace openrum` succeeds.
5. Keep SDK ingest checks running throughout the rollout; abort if acceptance drops or P99 crosses the agreed budget.

## Application rollback

Use `helm rollback openrum <revision> --namespace openrum --wait` only when the target application version is declared compatible with the already-applied schema. Helm rollback never runs a database down migration.

Do not automatically reverse migrations: stored events or newer writers may already depend on the expanded schema. If a release includes a non-backward-compatible migration, it is not eligible for rolling deployment and requires a separately reviewed maintenance plan, backup checkpoint and explicit data-loss assessment.

## Recovery from a failed migration

- Preserve Job logs and database migration-table state.
- Fix forward whenever possible and rerun the upgrade; migration locks and version rows prevent double application.
- Restore a backup only after stopping all writers and confirming the recovery point objective. Reconcile Kafka offsets before reopening ingest.
