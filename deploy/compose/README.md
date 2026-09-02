# OpenRUM local dependencies

This Compose stack is for development only. Production uses managed or existing PostgreSQL, ClickHouse, Kafka, Redis, and Alibaba Cloud OSS; MinIO is not part of the production topology.

## Start

```sh
cp deploy/compose/.env.example deploy/compose/.env
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml up -d --wait
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml ps
```

The stack exposes PostgreSQL on `5433`, ClickHouse HTTP/native on `8123`/`9000`, Kafka on `9092`, Redis on `6379`, and development object storage/API console on `9100`/`9101` by default. PostgreSQL intentionally avoids the common local `5432` port. Override host ports in `.env` when they conflict with existing services.

Application connection values:

```dotenv
POSTGRES_DSN=postgres://openrum:openrum_local_only@127.0.0.1:5433/openrum?sslmode=disable
CLICKHOUSE_DSN=clickhouse://openrum:openrum_local_only@127.0.0.1:9000/openrum
KAFKA_BROKERS=127.0.0.1:9092
KAFKA_EVENT_TOPIC=rum-events-v1
REDIS_ADDR=127.0.0.1:6379
OSS_ENDPOINT=http://127.0.0.1:9100
OSS_BUCKET=openrum
OSS_ACCESS_KEY_ID=openrum
OSS_ACCESS_KEY_SECRET=openrum_local_only
```

Create the development bucket after the first start:

```sh
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml exec object-storage mc mb --ignore-existing local/openrum
```

## Stop

`docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml down` stops containers without deleting data. Add `--volumes` only when you intentionally want to reset all local dependency data.

Never reuse the example credentials outside local development and never commit `deploy/compose/.env`.
