---
title: Compose
description: Run the local OpenRUM Alpha with Docker Compose.
---

**Applies to:** Alpha / main. Prerequisite: Docker with Compose v2.

```sh
docker compose --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml up -d --build
```

Wait until Web, API, Ingest, Consumer, Worker, PostgreSQL, ClickHouse, Kafka and Redis are healthy, then open `http://127.0.0.1:4173` and follow [Quickstart](/docs/getting-started/quickstart/).

Object storage is optional: Events, Sessions, Issues, analytics, performance and API monitoring work without it; Source Map Artifact upload and mapped frames do not.

## Notes

- Default host ports: console `4173`, PostgreSQL `5433`, ClickHouse `8123`/`9000`, Kafka `9092`, Redis `6379`.
- Override ports with an untracked `deploy/compose/.env`.
- Compose is not a production high-availability topology. See [Kubernetes](/docs/self-hosting/kubernetes/) and [External dependencies](/docs/self-hosting/dependencies/).

For reset and Demo seed details, see [Deterministic Demo data](/docs/getting-started/demo-data/) and [Troubleshooting](/docs/operations/troubleshooting/).
