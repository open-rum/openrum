---
title: Troubleshooting
description: Diagnose local startup, missing Events, login and Source Map problems.
---

**Applies to:** Alpha / main.

## Local Compose will not become healthy

1. Confirm Docker and Compose v2 are available and host ports are free: `4173`, `5433`, `8123`, `9000`, `9092`, `6379`.
2. Inspect service status:

```sh
docker compose -f deploy/compose/docker-compose.yml ps
docker compose -f deploy/compose/docker-compose.yml logs --tail=100 api ingest consumer worker web
```

3. Override conflicting ports in `deploy/compose/.env`.
4. Recreate named volumes only when you intend to wipe local Demo data:

```sh
docker compose -f deploy/compose/docker-compose.yml down -v
```

## Console loads but login fails

- Use exactly `http://127.0.0.1:4173`, matching `PUBLIC_BASE_URL`.
- Confirm API readiness: `curl --fail http://127.0.0.1:4173/health/ready`.
- Demo credentials are `demo@openrum.local` / `OpenRUM-demo-2026!` for local evaluation only.

## Events do not appear

1. Confirm Browser SDK `endpoint` and `writeKey`.
2. Check ingest logs and Origin allowlist for the Project key.
3. Confirm Kafka, Consumer and ClickHouse are healthy; wait for Demo seed completion on first boot.
4. Open **Events** with a wide time range, then inspect **Sessions** for the same `session_id`.

## Investigation path incomplete

| Symptom | Likely cause | Next step |
| --- | --- | --- |
| Behavior charts empty | Seed unfinished or ClickHouse unhealthy | Wait, then check Consumer/ClickHouse |
| Session without errors | Selected Session has no error Events | Filter Sessions with errors on `/checkout` in Demo |
| Issue missing Source Map frames | Optional object storage not configured | Expected; core monitoring still works |
| API panel empty | No fetch/XHR captured or sampling disabled | Trigger traffic from the React example |

## Source Map upload fails

Object storage is optional. Configure OSS or an S3-compatible Bucket only when mapped frames are required, then follow [Source Maps](/docs/sdk/source-maps/) and [Object storage](/docs/self-hosting/object-storage/).

## Still stuck

- [Capacity planning](/docs/self-hosting/capacity/)
- Dependency runbooks under **Operations**
- [Threat model](/docs/self-hosting/security/threat-model/) before exposing an Instance publicly
- Open a repository Issue with Compose status, Request IDs and redacted logs
