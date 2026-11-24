# Local OpenRUM Alpha

For a single-host production deployment, use the separate
[`production.compose.yml`](production.compose.yml),
[production Docker guide](../../apps/site/src/content/docs/docs/self-hosting/docker-production.mdx)
and [operations guide](../../apps/site/src/content/docs/docs/self-hosting/docker-operations.mdx).
Do not use this Demo stack for production. Kubernetes/Helm remains the recommended
production path when you need a cluster.

This Compose file starts the full core product: console, API, ingest, consumer, worker, PostgreSQL, ClickHouse, Kafka and Redis. Object storage is intentionally optional and is not bundled. The stack also runs migrations on startup.

```sh
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml up -d --build
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml ps
```

Console: `http://127.0.0.1:4173`

The first visit opens the setup page, where you register the initial owner account and sign in.

Default host ports are console `4173`, PostgreSQL `5433`, ClickHouse HTTP/native `8123`/`9000`, Kafka `9092`, and Redis `6379`. Override them by copying `.env.example` to an untracked `.env`.

Without object storage, behavior analytics, errors, performance, API monitoring and alerts remain available. To enable Source Map artifacts, configure either Alibaba OSS (`OBJECT_STORAGE_PROVIDER=oss`) or Amazon S3/S3-compatible storage (`OBJECT_STORAGE_PROVIDER=s3`) in the environment file.

Stop containers without deleting data:

```sh
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml down
```

Add `--volumes` only when you intentionally want a complete local reset. Example credentials and single-node dependencies must never be used for production.

For Vite hot reload and running the Go API from source against these dependencies, see [local development](https://openrum.netlify.app/docs/getting-started/local-development/).
