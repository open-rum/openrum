---
title: Kubernetes and Helm
description: Deploy OpenRUM with the Helm chart for shared or production environments.
---

**Applies to:** Alpha / main.

Use the Helm chart under `deploy/helm/openrum` for multi-replica API, ingest, consumer, worker and Console deployments.

## Checklist

1. Provision PostgreSQL, ClickHouse, Kafka and Redis outside the evaluation Compose topology.
2. Store DSNs, bootstrap values, storage credentials and an optional managed-secret master key in a Kubernetes Secret.
3. Set the public Console URL and terminate TLS at the ingress.
4. Review the generated [Helm values reference](/docs/reference/helm-values/) before rollout.
5. Configure readiness probes against `/health/ready` and establish [upgrade](/docs/operations/upgrades/) plus [backup/restore](/docs/operations/backup-restore/) procedures.

Optional object storage is required only for Source Map Artifacts. See [External dependencies](/docs/self-hosting/dependencies/) and [Threat model](/docs/security/threat-model/).
