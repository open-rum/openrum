---
title: Configuration reference
description: Every environment variable the OpenRUM services read, with its default, whether it is required and what it does.
appliesTo: Alpha
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

Generated from `internal/config`; do not edit by hand.

These are the environment variables the OpenRUM services read. With the Helm chart you normally set them through [Helm values](/docs/reference/helm-values/) and the runtime Secret instead of by hand. Values containing credentials belong in a Secret, never in a values file you commit.

## Core

Every service reads these.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `APP_ENV` | All services | — | Runtime environment: `development`, `test`, `staging` or `production`. `production` enforces HTTPS and the object-storage endpoint allowlist. |
| `PUBLIC_BASE_URL` | All services | — | The address people use to open the Console, as an absolute URL such as `https://rum.example.com`. Must be HTTPS in production. |
| `BOOTSTRAP_TOKEN` | First setup | — | One-time token asked for on the `/setup` page when you create the first administrator. Generate it with `openssl rand -hex 32` and keep it in a password manager. |

## Data stores and queue

Where each service finds PostgreSQL, ClickHouse, Kafka and Redis.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `POSTGRES_DSN` | All services | — | PostgreSQL connection string for the control plane (accounts, Projects, rules). URL-encode special characters in the password. |
| `CLICKHOUSE_DSN` | `api`, `consumer`, `worker` | — | ClickHouse connection string for events and aggregates, for example `clickhouse://user:password@host:9000/openrum`. |
| `KAFKA_BROKERS` | `api`, `ingest`, `consumer` | — | Comma-separated Kafka broker addresses, reachable from the service. |
| `KAFKA_EVENT_TOPIC` | No | `rum-events-v1` | Topic that carries accepted events from Ingest to Consumer. |
| `OPENRUM_KAFKA_RETENTION_DURATION` | No | `168h` | The retention you configured on the Kafka event topic, at least `1h`. Used to estimate how much time Consumer has left to drain a backlog. |
| `REDIS_ADDR` | `api`, `ingest`, `consumer` | — | Redis address (`host:port`) for quotas, status and caches. |

## Listening and shutdown

Where each service listens, and how long it waits when it stops.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `API_HTTP_ADDR` | No | `:8080` | Listen address of the API service. |
| `INGEST_HTTP_ADDR` | No | `:8081` | Listen address of the Ingest service. |
| `CONSUMER_HTTP_ADDR` | No | `:8082` | Listen address of the Consumer service. |
| `WORKER_HTTP_ADDR` | No | `:8083` | Listen address of the Worker service. |
| `SHUTDOWN_TIMEOUT` | No | `10s` | How long a service waits for in-flight work when it receives a stop signal. A positive duration such as `30s`. |

## Ingest and network identity

How Ingest decides who a caller is and where a visitor is from.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `INGEST_TRUSTED_PROXIES` | No | empty | Comma-separated CIDRs or addresses of the proxies in front of Ingest. When empty, rate limits count the socket peer, so every caller behind a shared proxy counts as one. When set, `X-Forwarded-For` is read from those peers only. Never widen this to the public internet. |
| `GEO_COUNTRY_HEADER` | No | empty | Header that your edge proxy sets to the visitor's country, for example `CF-IPCountry`. When empty, country is not resolved and is stored as `ZZ`. |
| `GEO_TRUSTED_PROXIES` | With `GEO_COUNTRY_HEADER` | empty | Comma-separated CIDRs or addresses whose country header is trusted. Never widen this to the public internet. |
| `INGEST_BASE_URL` | No | `PUBLIC_BASE_URL` + `/ingest` | Ingest address used by the development data generator. You only need it when Ingest is not reachable under the public origin. |

## Consumer

Throughput of the service that writes events to ClickHouse.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPENRUM_CONSUMER_WORKERS` | No | `4` | Number of parallel writers per Consumer process, from 1 to 64. |
| `OPENRUM_CONSUMER_FLUSH_INTERVAL` | No | `10ms` | How often a writer flushes a partial batch to ClickHouse, from `1ms` to `1s`. |

## Default retention

Instance defaults for how long data is kept. An Administrator can change an unlocked value in the Console; setting the variable locks it.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPENRUM_DEFAULT_RAW_RETENTION_DAYS` | No | `14` | Days to keep raw events, from 1 to 90. |
| `OPENRUM_DEFAULT_AGGREGATE_RETENTION_DAYS` | No | `90` | Days to keep aggregates, from 1 to 730. |
| `OPENRUM_DEFAULT_SOURCEMAP_RETENTION_DAYS` | No | `0` | Days to keep Source Map files, from 0 to 3650. `0` deletes them together with their Release. |

## Email (SMTP)

Optional outgoing mail for alerts and invitations. Set `SMTP_HOST` to configure it here, or leave it empty and use the Console (Settings, Email service). When the deployment sets it, the Console shows the server read-only.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SMTP_HOST` | No | empty | Mail server host name, without a scheme or port. When empty, no deployment mail server is configured and every other `SMTP_*` value must also be empty. |
| `SMTP_PORT` | No | `587`, `465` for `tls`, `25` for `none` | Server port, from 1 to 65535. |
| `SMTP_SECURITY` | No | `starttls` | `starttls` upgrades a plain connection and refuses to continue without it, `tls` encrypts from the first byte (SMTPS), and `none` sends in the clear for a trusted relay and cannot carry credentials. |
| `SMTP_USERNAME` | No | empty | Account for the mail server. Set it together with `SMTP_PASSWORD`, or leave both empty for a relay that needs no login. |
| `SMTP_PASSWORD` | No | empty | Password or app-specific SMTP password. Keep it in the runtime Secret, never in a values file. |
| `SMTP_FROM` | With `SMTP_HOST` | — | Sender address, for example `no-reply@example.com` or `OpenRUM <no-reply@example.com>`. Use a domain you control and configure SPF and DKIM for it. |

## Object storage

Optional. Needed for Source Maps. The `OSS_*` variables are older names for the same settings and apply when the provider is `oss`.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OBJECT_STORAGE_PROVIDER` | No | none | `oss` or `s3`. Leave it empty to run without object storage. It is required as soon as any other `OBJECT_STORAGE_*` value is set. |
| `OBJECT_STORAGE_BUCKET` | With a provider | — | Bucket name. |
| `OBJECT_STORAGE_REGION` | With a provider | — | Bucket region. |
| `OBJECT_STORAGE_ENDPOINT` | No | provider default | Custom endpoint, for example for MinIO or an S3-compatible service. An absolute `http(s)` URL without credentials. In production it must be HTTPS, and either an Alibaba Cloud OSS host or listed in the endpoint allowlist. |
| `OBJECT_STORAGE_FORCE_PATH_STYLE` | No | `true` for `s3` with an endpoint, otherwise `false` | Use path-style addressing (`host/bucket`) instead of `bucket.host`. Most self-hosted S3-compatible services need `true`. |
| `OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST` | No | empty | Comma-separated hosts allowed as the endpoint in production. Alibaba Cloud OSS hosts are always allowed. |
| `OPENRUM_OSS_ENDPOINT_ALLOWLIST` | No | empty | Older name of `OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST`; the new name wins when both are set. |
| `AWS_ACCESS_KEY_ID` | No | — | Access key for the `s3` provider. Set it together with `AWS_SECRET_ACCESS_KEY`. When both are empty, the runtime's IAM role is used. |
| `AWS_SECRET_ACCESS_KEY` | No | — | Secret key for the `s3` provider. Set it together with `AWS_ACCESS_KEY_ID`. |
| `OSS_ACCESS_KEY_ID` | No | — | Access key for the `oss` provider. Set it together with `OSS_ACCESS_KEY_SECRET`. When both are empty, the runtime's RAM role is used. |
| `OSS_ACCESS_KEY_SECRET` | No | — | Secret key for the `oss` provider. Set it together with `OSS_ACCESS_KEY_ID`. |
| `OSS_BUCKET` | No | — | Older name of `OBJECT_STORAGE_BUCKET`, used when the provider is `oss`. Setting any `OSS_*` location variable selects `oss` automatically. |
| `OSS_ENDPOINT` | No | — | Older name of `OBJECT_STORAGE_ENDPOINT`, used when the provider is `oss`. |
| `OSS_REGION` | No | — | Older name of `OBJECT_STORAGE_REGION`, used when the provider is `oss`. |
| `KUBERNETES_SERVICE_HOST` | No | — | Set by Kubernetes in every Pod; do not set it yourself. It only lets the Console label static storage keys as coming from a Kubernetes Secret. |

## Encrypted credentials

Lets the Console store notification and storage credentials instead of the runtime Secret.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPENRUM_ALLOW_MANAGED_SECRETS` | No | `false` | Set to `true` to let the Console store credentials encrypted in PostgreSQL. Requires `OPENRUM_MASTER_KEY`. |
| `OPENRUM_MASTER_KEY` | With managed credentials | — | Base64 of exactly 32 bytes, for example from `openssl rand -base64 32`. Never stored in PostgreSQL; back it up securely, because encrypted credentials cannot be read without it. |
| `OPENRUM_MASTER_KEY_ID` | No | `v1` | Label stored with each encrypted value to tell key generations apart, up to 32 characters. |

## Storage pressure guard

Optional protection for low ClickHouse disk space. The ratios must satisfy hard stop < critical ≤ recovery < warning.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPENRUM_STORAGE_PRESSURE_GUARD_ENABLED` | No | `false` | Turns the guard on. It is opt-in because some hosted ClickHouse services do not let applications read `system.disks`. |
| `OPENRUM_STORAGE_WARNING_FREE_RATIO` | No | `0.15` | Free-space ratio below which storage pressure is reported. Greater than 0 and at most 1. |
| `OPENRUM_STORAGE_CRITICAL_FREE_RATIO` | No | `0.10` | Free-space ratio below which emergency sampling starts. |
| `OPENRUM_STORAGE_HARD_STOP_FREE_RATIO` | No | `0.05` | Free-space ratio below which Ingest stops accepting events. |
| `OPENRUM_STORAGE_RECOVERY_FREE_RATIO` | No | `0.10` | Free-space ratio that must be reached before emergency sampling and the hard stop are released. |
| `OPENRUM_STORAGE_EMERGENCY_SAMPLE_RATE` | No | `0.10` | Sampling cap pushed to Browser SDKs while the guard is active, from 0 to 1. |
| `OPENRUM_STORAGE_POLL_INTERVAL` | No | `30s` | How often ClickHouse disk capacity is checked, from `10s` to `10m`. |
