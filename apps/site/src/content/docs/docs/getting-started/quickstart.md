---
title: Five-minute Quickstart
description: Start a local OpenRUM Instance and follow the seeded investigation path.
appliesTo: Alpha / main
---

**Prerequisite:** Docker with Compose v2.

## 1. Start the Instance

From the repository root:

```sh
docker compose --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml up -d --build
```

Wait until the Web, API, Ingest, Consumer, Worker, PostgreSQL, ClickHouse, Kafka and Redis services are healthy:

```sh
docker compose -f deploy/compose/docker-compose.yml ps
curl --fail http://127.0.0.1:4173/health/ready
```

If you are working from source rather than evaluating, `pnpm openrum up` runs the same containers but waits for readiness instead of for launch and reports both halves of the stack in one table. It needs the Go and Node toolchains, which is why this page uses Compose directly. See [Local development](/docs/contributing/local-development/).

Open `http://127.0.0.1:4173` and sign in:

```text
email: demo@openrum.local
password: OpenRUM-demo-2026!
```

These credentials are local evaluation fixtures. Change or remove them before any shared deployment.

## 2. Verify the investigation path

1. Open **Analysis** and compare country, device and browser data.
2. Open **Sessions**, filter Route `/checkout`, and select a Session with an error.
3. Follow the error event to its **Issue** and inspect affected users, breadcrumbs and the failed `POST /api/orders` Request.
4. Open **Releases** to understand why a Source Map Artifact is optional when no object-storage Bucket is configured.

## 3. Reset deterministic data

```sh
docker compose -f deploy/compose/docker-compose.yml down -v
docker compose --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml up -d --build
```

This deletes only the named Compose volumes for the local stack. See [Demo data](/docs/getting-started/demo-data/) before resetting a modified environment.

## Troubleshooting

- Port conflicts: change the published ports in `deploy/compose/.env`.
- API healthy but no query data: inspect Consumer and ClickHouse health, then wait for Demo seed completion.
- Source Map unavailable: expected without optional OSS/S3 configuration; all core monitoring remains available.
