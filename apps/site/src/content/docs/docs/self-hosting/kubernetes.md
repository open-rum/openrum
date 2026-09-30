---
title: Kubernetes and Helm reference
description: Chart resource, routing, scaling, security and upgrade reference for a production Kubernetes deployment.
appliesTo: Alpha
---

The chart under `deploy/helm/openrum` deploys the five OpenRUM workloads — `api`, `ingest`, `consumer`, `worker` and `web` — with rolling updates, health probes, autoscaling and a schema migration hook. For a new Kubernetes Instance, follow the three-step [production deployment](/docs/getting-started/production-deployment/) tutorial first. This page is the Chart reference for configuration, security and operation details.

By default it also runs a single Redis instance for the release ([Redis: bundled or external](#redis-bundled-or-external)). It does **not** provision PostgreSQL, ClickHouse or Kafka, create the Kafka topic, issue TLS certificates or create the Secret it reads. Those are prerequisites. Missing the Secret or the two databases fails the install outright; a missing Kafka topic installs cleanly and then drops events at runtime, which is the harder one to notice.

## Before you install

**Provision PostgreSQL, ClickHouse and Kafka.** The Compose topology is for evaluation only. Use managed or HA services, and decide whether Redis is bundled or your own. Size them with [Capacity planning](/docs/self-hosting/capacity/) before you take production traffic. See [External dependencies](/docs/self-hosting/dependencies/) for what each one holds.

**Create the Kafka topic yourself.** Both the producer and the consumer set `AllowAutoTopicCreation: false`, so a missing topic is a runtime failure rather than a self-healing condition. The default topic name is `rum-events-v1`, and ingest only reports durable acceptance after `acks=all`.

**Use an image your cluster can pull.** Helm installs the chart; Kubernetes pulls the referenced container images. The chart defaults to `ghcr.io/openrum/openrum`. This address becomes usable only after the first official versioned release is published and the package is public. Before then, build and publish your own image and override `image.repository` in your own values file rather than editing the chart.

**Decide on a hostname and a TLS certificate.** `config.appEnv: production` makes every service reject a non-HTTPS `PUBLIC_BASE_URL` at startup, and `ingress.tls` is empty by default — see [Routing and TLS](#routing-and-tls).

The chart declares `kubeVersion: ">=1.28.0-0"`; it uses `autoscaling/v2` and `policy/v1`, so older clusters are not supported.

## 1. Create the runtime Secret

The chart never creates this Secret; it only references the name in `config.existingSecret` (default `openrum-runtime`). **Create it before `helm install`**, because the migration Job runs as a `pre-install` hook and reads the two DSNs from it. A missing Secret fails the release before any workload is scheduled.

```sh
kubectl -n openrum create secret generic openrum-runtime \
  --from-literal=POSTGRES_DSN='postgres://openrum:...@postgres:5432/openrum?sslmode=require' \
  --from-literal=CLICKHOUSE_DSN='clickhouse://openrum:...@clickhouse:9000/openrum' \
  --from-literal=BOOTSTRAP_TOKEN="$(openssl rand -hex 32)"
```

Only `POSTGRES_DSN` and `CLICKHOUSE_DSN` are mandatory. Every other key is mounted with `optional: true`, so it can be absent — which is exactly why `BOOTSTRAP_TOKEN` is easy to forget and why [step 5](#5-create-the-first-administrator) explains what omitting it costs you.

| Secret key | Required | Purpose |
| --- | --- | --- |
| `POSTGRES_DSN` | Yes | Control-plane database |
| `CLICKHOUSE_DSN` | Yes | Event storage |
| `BOOTSTRAP_TOKEN` | Strongly recommended | Authorises first-administrator creation |
| `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET` | Only for Alibaba OSS | Source Map Artifact storage |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | Only for S3-compatible storage | Source Map Artifact storage |
| `OPENRUM_MASTER_KEY` | Only with managed secrets | Encrypts stored notification-channel credentials |

Key names are configurable under `config.secretKeys` if your secret manager imposes its own naming.

`OPENRUM_MASTER_KEY` must be base64 for **exactly 32 bytes**; anything else is rejected at startup rather than ignored. It is only read when `config.managedSecrets.enabled` is `true`, and without it the Console returns `503 MANAGED_SECRETS_REQUIRED` when someone tries to save a notification channel.

## 2. Write a values file

Keep your environment in its own file rather than editing the chart. These values are specific to your deployment:

```yaml
config:
  appEnv: production
  publicBaseURL: https://rum.example.com
  kafkaBrokers: kafka-0.kafka:9092,kafka-1.kafka:9092
  existingSecret: openrum-runtime

# Omit this block to use the bundled Redis.
redis:
  mode: external
  external:
    address: redis-master.data:6379

ingress:
  enabled: true
  className: nginx
  host: rum.example.com
  tls:
    - hosts: [rum.example.com]
      secretName: openrum-tls
```

To use an internal mirror, add `image.repository: registry.example.com/openrum` and `image.tag: "0.1.0"` to this file, using the exact image version paired with the Chart. For a private registry, create an image-pull Secret in the same namespace and add `imagePullSecrets: [{ name: your-registry-secret }]`. The chart passes it to the application Deployments, the pre-install migration Job, and the Helm test Pod. If the cluster cannot pull the default `busybox:1.37` test image, also override `smokeTest.image`.

`publicBaseURL` must be an absolute `http(s)` URL, and under `appEnv: production` it must be HTTPS. It is the origin the Console and the SDK are told to use, so it has to be the address users actually reach — not an internal Service name.

Object storage is optional, but it is all-or-nothing: if you set any of `endpoint`, `bucket` or `region` while leaving `provider` empty, every pod exits with `OBJECT_STORAGE_PROVIDER is required when object storage fields are configured`. Set `provider` to `oss` or `s3`, or leave the whole block empty. See [Object storage](/docs/self-hosting/object-storage/).

The full annotated list is the [Helm values reference](/docs/reference/helm-values/), generated from `values.yaml`.

### Redis: bundled or external

`redis.mode` selects where Redis comes from. OpenRUM keeps rate-limit counters, login throttling, dashboard caches and connection progress there. None of it is a source of truth, but API and Ingest report not ready while Redis is unreachable, so its availability is theirs.

| Mode | What the chart does | Use it when |
| --- | --- | --- |
| `bundled` (default) | Runs one Redis (`redis:7.2-alpine`) as a StatefulSet with a Service named `<release>-openrum-redis`, and points `REDIS_ADDR` at it | Evaluation, small Instances, or a first install |
| `external` | Creates no Redis and uses `redis.external.address` (`host:port`) | Production that needs high availability: use a managed Redis with automatic failover behind one address |

The bundled Redis has these defaults:

- `--maxmemory 192mb` under a 256 MiB limit, evicting least-recently-used keys, like the Compose topology.
- Data in memory only, so a restart starts empty. `redis.bundled.persistence.enabled: true` adds a PersistentVolumeClaim with append-only persistence. The claim template cannot change on an existing StatefulSet, so switching persistence later means `kubectl delete statefulset <release>-openrum-redis` before the upgrade; the data is disposable.
- A NetworkPolicy that admits only this release's pods. It takes effect only if your network plugin enforces NetworkPolicy.
- For a private registry, mirror the image and set `redis.bundled.image.repository`.

A bundled Redis restart takes API and Ingest out of service for a few seconds. For zero-downtime maintenance, use `external`. OpenRUM connects without a password or TLS and supports neither Sentinel nor Cluster mode today, so an external Redis must be reachable at one private address.

`config.redisAddress` from earlier chart versions has been removed. A values file that still sets it fails to render with a message pointing to `redis.external.address`.

## 3. Install

Once the official `0.1.0` release is available, install its OCI chart and matching default image:

```sh
helm upgrade --install openrum oci://ghcr.io/openrum/charts/openrum \
  --version 0.1.0 \
  --namespace openrum --create-namespace \
  --values values.production.yaml \
  --wait --timeout 15m
```

Before the first official release, use `deploy/helm/openrum` in place of the OCI chart and point `image.repository` at an image you published. Publishing a Chart does not install it into your cluster.

The `pre-install,pre-upgrade` hook runs `/app/migrate up all` — PostgreSQL migrations, then ClickHouse — at hook weight `-5`, so the schema is in place before any workload starts. It retries twice (`migration.backoffLimit`) inside a 600-second Job deadline, but the binary imposes its own two-minute context timeout, so a genuinely long migration fails on that limit first.

The migrator takes a PostgreSQL advisory lock for the duration, so two releases applied at once serialise instead of racing.

A failed migration fails the release. The Job is kept (`hook-delete-policy: before-hook-creation,hook-succeeded`) so you can read it:

```sh
kubectl -n openrum logs -l app.kubernetes.io/component=migration --tail=-1
```

## 4. Verify the rollout

```sh
helm test openrum --namespace openrum
kubectl -n openrum get deploy,hpa,ingress -l app.kubernetes.io/instance=openrum
```

`helm test` runs a smoke-test pod that requests the liveness endpoint of `api`, `ingest` and `web` through their Services, which confirms in-cluster routing rather than just pod readiness.

Each service exposes `/health/ready` and `/health/live`; `web` also answers both plus a `/metrics` stub from its nginx front end. Readiness is polled every 2 seconds, liveness every 20, and a startup probe allows 30 failures at 2-second intervals — about a minute for a cold start before the kubelet gives up.

## 5. Create the first administrator

Open `https://rum.example.com/setup`, then follow [First use and maintenance](/docs/getting-started/production-deployment/first-run/) and [Create your first project](/docs/getting-started/create-first-project/).

### Set BOOTSTRAP_TOKEN before the ingress is reachable

**Bootstrap authorisation is skipped entirely when `BOOTSTRAP_TOKEN` is empty.** The endpoint that creates the first user and organisation is `POST /api/v1/setup/bootstrap`, and the ingress publishes it under the `/api` prefix. On a fresh Instance with a public hostname and no token, whoever reaches it first becomes the administrator.

With a token set, the request must carry it in the `X-OpenRUM-Bootstrap-Token` header. Either way the window closes permanently once one user exists — the endpoint then returns `409 ALREADY_INITIALIZED`.

## What the chart creates

| Resource | Notes |
| --- | --- |
| 5 Deployments | `maxUnavailable: 0`, `maxSurge: 1`, `minReadySeconds: 5` |
| 5 Services | Port `80` forwarding to each container's port |
| Redis StatefulSet, Service and NetworkPolicy | Only with `redis.mode: bundled` |
| 1 ConfigMap | Non-secret environment; its checksum is a pod annotation |
| 1 Ingress | Single host, three path rules |
| 3 HorizontalPodAutoscaler resources | `api`, `ingest`, `web` only |
| PodDisruptionBudgets | Only for services with more than one replica |
| Migration Job | Per release revision, as an install/upgrade hook |
| ServiceMonitor, PrometheusRule | Both disabled by default |

Because the ConfigMap checksum is annotated onto every pod template, changing a value under `config` rolls the pods automatically. Changing the referenced Secret does **not** — Kubernetes has no equivalent trigger, so rotate credentials with an explicit `kubectl rollout restart`.

## Routing and TLS

The Ingress publishes one host with three prefix rules, in this order of specificity:

| Path | Service |
| --- | --- |
| `/api` | `api` |
| `/ingest` | `ingest` |
| `/` | `web` (Console) |

Browser SDK traffic therefore posts to `https://<host>/ingest`, and the Console and SDK share the origin in `publicBaseURL`.

**TLS is not configured by default.** `ingress.tls` is an empty list, and the chart neither requests nor references a certificate. Terminate TLS at the ingress by populating `ingress.tls` with a Secret you manage, and add issuer annotations under `ingress.annotations` if you use an automated certificate controller. Leaving this empty while `appEnv` is `production` produces an Instance that advertises an HTTPS base URL over a plaintext listener.

## Scaling

Autoscaling is enabled by default for `api` (2–8), `ingest` (3–20) and `web` (2–6), all on 70% CPU except ingest at 65%, scaling up after 30 seconds and down after 300.

`consumer` and `worker` are deliberately not autoscaled. Consumer throughput is bounded by Kafka partitions and ClickHouse insert pressure, so scale it against measured lag rather than CPU — see [Kafka](/docs/self-hosting/kafka/).

`worker` ships one replica because its two jobs scale differently. Alert evaluation is leader-elected with `pg_try_advisory_lock`, so only one replica ever evaluates rules and the rest idle. Project deletion claims work with `FOR UPDATE SKIP LOCKED`, so that part does spread across replicas. Adding workers therefore buys deletion throughput and failover, not faster alerting.

Two consequences of how the chart is written are worth knowing:

- The Deployment template always writes `services.*.replicas`, so a `helm upgrade` resets the replica count to that static value and leaves the HPA to scale back up. Expect a brief dip on autoscaled services during upgrades.
- PodDisruptionBudgets are generated from `services.*.replicas`, not from the HPA's `minReplicas`. If you lower a service's `replicas` to 1 while relying on the HPA, that service silently loses its disruption budget.

## Security defaults

Every pod runs `runAsNonRoot` with a read-only root filesystem, all capabilities dropped, `allowPrivilegeEscalation: false`, the `RuntimeDefault` seccomp profile and `fsGroup: 65532`. The image's only writable path is a 128 MiB `emptyDir` at `/tmp`, which nginx uses for its own temporary directories. The bundled Redis follows the same restrictions as the image's `redis` user (UID 999) and writes only to `/data`.

Because the root filesystem is read only, a custom image that expects to write outside `/tmp` will crash-loop. Review the [Threat model](/docs/self-hosting/security/threat-model/) and [Privacy](/docs/self-hosting/security/privacy/) before opening ingest to the internet.

### Declare your edge, or the per-IP limit becomes one shared limit

This is the pre-authentication layer of the two-part protection described in [Rate limits](/docs/product/rate-limits/#two-protection-layers).

Ingest rate limits on the socket peer by default, because a forwarding header is written by the caller: believing one unconditionally would let anybody mint unlimited identities and walk past the limiter entirely. Behind an Ingress that peer is the gateway, so all callers collapse onto a single 1000 req/s bucket. Legitimate aggregate traffic above that threshold is then rejected at random, and the symptom looks like intermittent reporting failures rather than a limit.

Set `config.ingestTrustedProxies` to the CIDRs your gateway pods run in to key the limit on the caller instead:

```yaml
config:
  ingestTrustedProxies: 10.42.0.0/16
```

`X-Forwarded-For` is then read, but only on requests whose peer is in that list, and only from the right-hand end of the chain — the part your proxy wrote. Entries a caller prepended are ignored. Keep the list to the proxies you actually run: anything that matches can choose the identity it is limited on.

## Limits of this chart

These are real gaps, not oversights to work around silently:

- **No arbitrary environment variables.** The ConfigMap template has a fixed key list, so settings the binaries support but the chart does not render — `SHUTDOWN_TIMEOUT`, `INGEST_BASE_URL` — cannot be set through values. Setting them requires patching the ConfigMap or extending the template.
- **`services.web.port` is not really configurable.** The chart wires it to the container port and probes, but the Console's nginx configuration hard-codes `listen 8080`. Changing it leaves the pod permanently unready.
- **Only Redis can be bundled.** PostgreSQL, ClickHouse and Kafka hold data that must survive, so the chart does not run them. The bundled Redis is a single instance, not a highly available one.
- **Monitoring integration is opt-in and needs the Prometheus Operator.** `serviceMonitor` and `prometheusRules` render CRDs that must already exist in the cluster.

## Upgrades and rollback

`helm upgrade` re-runs the migration hook before the new pods roll. Migrations are forward-only in practice: `/app/migrate down` refuses any target other than `postgres`, so a `helm rollback` reverts workloads and configuration but **not** the schema. Read [Upgrades](/docs/self-hosting/upgrades/) for the supported sequence, and confirm [Backup and restore](/docs/self-hosting/backup-restore/) works before your first production upgrade.

When something is wrong after a rollout, start from [Troubleshooting](/docs/self-hosting/troubleshooting/).
