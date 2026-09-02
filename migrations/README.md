# Database migrations

Migration files are embedded into `services/api/cmd/migrate`. PostgreSQL migrations run in a transaction under an advisory lock. ClickHouse migrations must contain idempotent DDL because ClickHouse does not provide transactional DDL.

File names use a unique numeric version: `NNNN_description.up.sql`. Existing applied files are immutable; create a new version for every schema change.

```sh
export POSTGRES_DSN='postgres://openrum:openrum_local_only@127.0.0.1:5433/openrum?sslmode=disable'
export CLICKHOUSE_DSN='clickhouse://openrum:openrum_local_only@127.0.0.1:9000/openrum'
go run ./services/api/cmd/migrate status all
go run ./services/api/cmd/migrate up all
```

Application services only inspect `openrum_schema_migrations` for compatibility. They never apply schema changes during startup; production migrations run as a single pre-deployment job.
