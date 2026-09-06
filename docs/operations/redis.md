# Redis failure runbook

**Owner:** platform on-call · **Severity:** usually degraded, critical only if security fallbacks fail · **Source of truth:** PostgreSQL/ClickHouse, never Redis

## Trigger and impact

Detect with readiness failures, Redis provider alarms, elevated latency and errors in rate-limit/cache/connection-status operations. Redis is not the source of truth: it supports login throttling, ingest rate limiting, overview cache and connection progress. Authentication failure limiting uses a conservative fallback; query cache misses may raise ClickHouse load.

## Safe response

1. Record topology, failover state, memory/evictions, latency, blocked clients, connection count and network errors.
2. Protect dependencies: reduce query concurrency or sampling if cache loss increases ClickHouse load. Confirm login and ingest fallback behavior before leaving public traffic open.
3. Fail over through the Redis owner/provider and update the existing endpoint/Secret if required. Roll one API and ingest replica first, validate, then continue.
4. Do not flush databases, disable authentication/TLS, change eviction policy during an incident or treat Redis connection-status keys as durable evidence.

## Recovery and validation

1. Verify authenticated read/write with a disposable key and TTL, then remove that key.
2. Test login throttling, project/IP ingest limiting, overview cache miss/fill and connection-status progression.
3. Watch Redis errors, evictions, ClickHouse query load and API latency for 30 minutes. Cache warm-up is expected; data replay is not required.

Escalate if security fallbacks fail open, memory corruption is suspected, or Redis recovery overloads ClickHouse.

## Local recovery drill

Use only the disposable Compose Alpha stack. Keep two terminals open so recovery does not depend on the failing service:

```sh
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml ps redis api
docker stop openrum-redis-1
docker exec openrum-api-1 wget -S -O- http://127.0.0.1:8080/health/ready
docker start openrum-redis-1
docker exec openrum-api-1 wget -qO- http://127.0.0.1:8080/health/ready
```

Expected: readiness returns HTTP 503 while Redis is stopped; after restart it returns HTTP 200 without event replay or database repair. Replace container names with those from `docker compose ps` when a project prefix is configured.

Last verified on 2026-09-03 with an isolated Compose project: the stopped dependency produced HTTP 503, Redis restarted with its volume, and API readiness immediately returned all four dependency checks as `ok`.
