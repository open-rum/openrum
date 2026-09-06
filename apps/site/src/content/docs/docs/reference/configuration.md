---
title: Configuration reference
description: Generated environment-variable reference for OpenRUM services.
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

**Applies to:** Alpha / main. Generated from `internal/config/config.go`; do not edit by hand.

| Variable | Purpose |
| --- | --- |
| `APP_ENV` | Runtime environment: development, test, staging or production. |
| `AWS_ACCESS_KEY_ID` | Optional service or feature configuration; see source validation for constraints. |
| `AWS_SECRET_ACCESS_KEY` | Optional service or feature configuration; see source validation for constraints. |
| `BOOTSTRAP_TOKEN` | Optional service or feature configuration; see source validation for constraints. |
| `CLICKHOUSE_DSN` | Event and aggregate ClickHouse connection string. |
| `GEO_COUNTRY_HEADER` | Header carrying the visitor country, injected by the edge proxy (for example CF-IPCountry). Unset disables country resolution and stores ZZ. |
| `GEO_TRUSTED_PROXIES` | Comma-separated CIDRs or addresses whose forwarded country header is believed. Required when GEO_COUNTRY_HEADER is set; never widen this to the public internet. |
| `INGEST_BASE_URL` | Optional service or feature configuration; see source validation for constraints. |
| `KAFKA_BROKERS` | Comma-separated Kafka brokers. |
| `KAFKA_EVENT_TOPIC` | Optional service or feature configuration; see source validation for constraints. |
| `KUBERNETES_SERVICE_HOST` | Optional service or feature configuration; see source validation for constraints. |
| `OBJECT_STORAGE_BUCKET` | Optional service or feature configuration; see source validation for constraints. |
| `OBJECT_STORAGE_ENDPOINT` | Optional service or feature configuration; see source validation for constraints. |
| `OBJECT_STORAGE_FORCE_PATH_STYLE` | Optional service or feature configuration; see source validation for constraints. |
| `OBJECT_STORAGE_PROVIDER` | Optional oss or s3 provider. |
| `OBJECT_STORAGE_REGION` | Optional service or feature configuration; see source validation for constraints. |
| `OPENRUM_ALLOW_MANAGED_SECRETS` | Explicit opt-in for console-managed encrypted credentials. |
| `OPENRUM_MASTER_KEY` | Base64 for exactly 32 external key bytes; never stored in PostgreSQL. |
| `OPENRUM_MASTER_KEY_ID` | Optional service or feature configuration; see source validation for constraints. |
| `OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST` | Optional service or feature configuration; see source validation for constraints. |
| `OPENRUM_OSS_ENDPOINT_ALLOWLIST` | Optional service or feature configuration; see source validation for constraints. |
| `OSS_ACCESS_KEY_ID` | Optional service or feature configuration; see source validation for constraints. |
| `OSS_ACCESS_KEY_SECRET` | Optional service or feature configuration; see source validation for constraints. |
| `OSS_BUCKET` | Optional service or feature configuration; see source validation for constraints. |
| `OSS_ENDPOINT` | Optional service or feature configuration; see source validation for constraints. |
| `OSS_REGION` | Optional service or feature configuration; see source validation for constraints. |
| `POSTGRES_DSN` | Control-plane PostgreSQL connection string. |
| `PUBLIC_BASE_URL` | Canonical Console origin; HTTPS is required in production. |
| `REDIS_ADDR` | Redis address for quotas, status and caches. |
| `SHUTDOWN_TIMEOUT` | Optional service or feature configuration; see source validation for constraints. |
