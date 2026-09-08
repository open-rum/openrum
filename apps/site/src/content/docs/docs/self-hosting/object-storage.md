---
title: Object storage
description: Operate optional OSS or S3-compatible storage for Source Map Artifacts.
---

> Canonical source: `docs/operations/oss.md`. Edit the repository file; this page is generated during `pnpm site:build`.


**Owner:** storage/platform on-call · **Data classification:** private build artifacts; signed URLs and credentials are secrets

## Trigger and impact

Detect with provider API error/latency, source-map upload/finalize failures and unresolved stack-frame growth. Optional OSS or S3-compatible storage contains source-map objects; raw monitoring events and product metadata remain in Kafka/ClickHouse/PostgreSQL. Error ingestion continues, but new releases cannot be symbolicated and project deletion cleanup may be delayed.

## Safe response

1. Record region/bucket, endpoint, affected object prefix, provider incident, worker errors, credential expiry and recent policy changes. Never log signed URLs or access keys.
2. Pause source-map finalize/retry workers if repeated requests amplify the outage. Keep error ingest active and show symbolication as delayed.
3. Restore endpoint/DNS/IAM/KMS access with the cloud owner. Confirm that `oss` is selected for Alibaba's native API or `s3` for AWS Signature V4 services. Prefer credential rotation through workload identity or Kubernetes Secret; never place keys in values files or chat.
4. Do not make the bucket public, disable encryption/versioning, overwrite immutable release objects or bulk-delete prefixes to restore service.

## Recovery and validation

1. Upload a canary object with expected SHA-256 metadata, HEAD/read it through the worker path, then delete only that exact canary key.
2. Resume workers gradually; verify queued artifacts finalize and one known minified stack resolves to the expected source.
3. Reconcile PostgreSQL artifact rows with provider object keys for the incident window. Retry missing uploads; quarantine checksum mismatches.
4. Close after provider health and symbolication success remain normal for 30 minutes.

Escalate for possible key exposure, unexpected object deletion/overwrite, checksum mismatch, regional loss or inability to meet the 24-hour deletion commitment.

## Provider and credential setup

Object storage is optional. With no Bucket configured, event ingest, behavior analytics, errors, performance, API monitoring and alerts continue to work; Source Map artifacts are unavailable.

- Alibaba Cloud: set `OBJECT_STORAGE_PROVIDER=oss`, Region and Bucket. Prefer an ECS/ACK RAM Role; static `OSS_ACCESS_KEY_ID` and `OSS_ACCESS_KEY_SECRET` must be injected together through a Kubernetes Secret or deployment environment.
- Amazon S3 and compatible providers: set `OBJECT_STORAGE_PROVIDER=s3`. Custom endpoints cover MinIO, R2 and Ceph; set `OBJECT_STORAGE_FORCE_PATH_STYLE=true` when required. Prefer workload identity; otherwise inject both AWS key fields.
- Production custom endpoints require HTTPS and an exact host in `OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST`. This prevents the admin probe from becoming an SSRF primitive.

The optional console-managed mode requires `OPENRUM_ALLOW_MANAGED_SECRETS=true` and an external `OPENRUM_MASTER_KEY` containing Base64 for exactly 32 random bytes. Generate it with `openssl rand -base64 32`, store it only in a Kubernetes Secret or external secret manager, and set `OPENRUM_MASTER_KEY_ID` when rotating the envelope key. The console never returns the Secret; it probes a candidate with a random object and commits the AEAD envelope only after write/read/delete all pass.

Before a console-managed rotation, re-authenticate the current Instance Owner. The mutation rejects an elevation older than five minutes. A failed probe or database write leaves the live storage router unchanged; after a successful encrypted write, the router switches to the new client and does not retain the previous plaintext credentials as an application rollback value.

For Helm, add the key under the configured `existingSecret` using the name mapped by `config.secretKeys.managedSecretsMasterKey`. Enabling `config.managedSecrets.enabled` without that Secret makes services fail closed during startup.

## Evidence and canary boundaries

Use a unique key such as `runbook-canary/<incident-id>/<uuid>.txt` and record its SHA-256 before upload. Grant only `PutObject`, `GetObject`, `HeadObject` and exact-key `DeleteObject` for the drill prefix. Confirm public ACL remains disabled before and after the test. Never test recovery by changing the production bucket ACL, lifecycle rules or encryption policy.
