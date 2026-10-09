# Local OpenRUM Alpha

For a single-host production deployment, use the separate
[`production.compose.yml`](production.compose.yml),
[production Docker guide](../../apps/site/src/content/docs/docs/self-hosting/docker-production.mdx)
and [operations guide](../../apps/site/src/content/docs/docs/self-hosting/docker-operations.mdx).
Do not use this Demo stack for production. Kubernetes/Helm remains the recommended
production path when you need a cluster.

This Compose file starts the full core product: console, API, ingest, consumer, worker, PostgreSQL, ClickHouse, Kafka and Redis. Object storage is intentionally optional and is not bundled. The stack also runs migrations. An idempotent demo seeder is available on demand.

```sh
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml up -d --build
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml ps
```

To load the demo account and dataset, run the seeder once the services are healthy (or `pnpm openrum seed`):

```sh
docker compose --profile seed --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml run --rm --no-deps demo-seed
```

Console: `http://127.0.0.1:4173`
Login after seeding: `demo@openrum.local` / `OpenRUM-demo-2026!`. Without seeding, the first visit opens the setup page.

The seeder initializes the demo owner and project, then loads a deterministic 14-day ecommerce dataset with approximately 30,000 sessions and 301,000 events. If an owner other than the demo owner already exists, it exits without changing that instance. Running the seeder again preserves and does not duplicate demo events. See the [demo data guide](../../docs/demo-data.md) for explicit rerun and reset commands.

Default host ports are console `4173`, PostgreSQL `5433`, ClickHouse HTTP/native `8123`/`9000`, Kafka `9092`, and Redis `6379`. Override them by copying `.env.example` to an untracked `.env`.

Without object storage, behavior analytics, errors, performance, API monitoring and alerts remain available. To enable Source Map artifacts, configure either Alibaba OSS (`OBJECT_STORAGE_PROVIDER=oss`) or Amazon S3/S3-compatible storage (`OBJECT_STORAGE_PROVIDER=s3`) in the environment file.

Stop containers without deleting data:

```sh
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml down
```

Add `--volumes` only when you intentionally want a complete local reset. Example credentials and single-node dependencies must never be used for production.

For Vite hot reload and running the Go API from source against these dependencies, see [local development](../../docs/local-development.md).
