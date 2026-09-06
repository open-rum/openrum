---
title: Self-hosting overview
description: Choose Compose for evaluation or Kubernetes/Helm for production.
---

OpenRUM is designed to run in your own infrastructure. There is no required OpenRUM cloud dependency.

## Choose a path

| Path | Use when |
| --- | --- |
| [Compose](/docs/self-hosting/compose/) | Local evaluation, demos and contributor setup |
| [Kubernetes / Helm](/docs/self-hosting/kubernetes/) | Production or shared staging |
| [External dependencies](/docs/self-hosting/dependencies/) | Understanding PostgreSQL, ClickHouse, Kafka, Redis and optional object storage |

Compose is a single-replica evaluation topology. Production should use Kubernetes/Helm with production-grade dependencies, TLS, secret management, backups and capacity planning.

## Before production

- Terminate TLS and set the canonical `PUBLIC_BASE_URL`
- Inject DSNs, bootstrap token and optional object-storage keys through an external Secret
- Prefer workload identity where possible
- Configure backups and test a restore
- Establish retention, capacity and upgrade runbooks
- Run a production-like ingest/query benchmark with measured traffic inputs
- Read the [Threat model](/docs/security/threat-model/)

No MinIO deployment is required. Configure Alibaba OSS or an S3-compatible provider only when Source Map Artifacts are needed.
