#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

compose=(docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml)
postgres_dsn="postgres://openrum:openrum_local_only@127.0.0.1:5433/openrum_test?sslmode=disable"
clickhouse_dsn="clickhouse://openrum:openrum_local_only@127.0.0.1:9000/openrum_test"
kafka_topic="openrum-integration-v1"

"${compose[@]}" up -d --wait postgres clickhouse kafka redis

if ! "${compose[@]}" exec -T postgres psql -U openrum -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='openrum_test'" | tr -d '[:space:]' | rg -q '^1$'; then
  "${compose[@]}" exec -T postgres createdb -U openrum -O openrum openrum_test
fi

"${compose[@]}" exec -T clickhouse clickhouse-client \
  --host 127.0.0.1 --user openrum --password openrum_local_only \
  --query "CREATE DATABASE IF NOT EXISTS openrum_test"

"${compose[@]}" exec -T kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server 127.0.0.1:19092 --create --if-not-exists \
  --topic "$kafka_topic" --partitions 12 --replication-factor 1 \
  --config min.insync.replicas=1

POSTGRES_DSN="$postgres_dsn" CLICKHOUSE_DSN="$clickhouse_dsn" \
  go run ./services/api/cmd/migrate up all

TEST_POSTGRES_DSN="$postgres_dsn" \
TEST_CLICKHOUSE_DSN="$clickhouse_dsn" \
TEST_KAFKA_BROKERS="127.0.0.1:9092" \
TEST_KAFKA_TOPIC="$kafka_topic" \
TEST_REDIS_ADDR="127.0.0.1:6379" \
  go test -tags=integration -count=1 -p=1 ./...
