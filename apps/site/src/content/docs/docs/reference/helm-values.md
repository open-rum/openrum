---
title: Helm values reference
description: Generated source-of-truth values for the OpenRUM Helm chart.
appliesTo: Alpha
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

Generated verbatim from `deploy/helm/openrum/values.yaml`; do not edit by hand.

Use a separate values file for your environment and keep credentials in the configured existing Kubernetes Secret.

```yaml
imagePullSecrets: []
nameOverride: ""
fullnameOverride: ""

image:
  repository: ghcr.io/open-rum/openrum
  tag: "0.1.0"
  pullPolicy: IfNotPresent

services:
  api:
    {
      replicas: 2,
      port: 8080,
      readyPath: /health/ready,
      livePath: /health/live,
      command: ["/app/api"],
      resources:
        {
          requests: { cpu: 200m, memory: 256Mi, ephemeral-storage: 64Mi },
          limits: { memory: 512Mi, ephemeral-storage: 256Mi },
        },
    }
  ingest:
    {
      replicas: 3,
      port: 8081,
      readyPath: /health/ready,
      livePath: /health/live,
      command: ["/app/ingest"],
      resources:
        {
          requests: { cpu: 500m, memory: 512Mi, ephemeral-storage: 64Mi },
          limits: { memory: 1Gi, ephemeral-storage: 256Mi },
        },
    }
  consumer:
    {
      replicas: 2,
      port: 8082,
      readyPath: /health/ready,
      livePath: /health/live,
      command: ["/app/consumer"],
      resources:
        {
          requests: { cpu: 500m, memory: 512Mi, ephemeral-storage: 64Mi },
          limits: { memory: 1Gi, ephemeral-storage: 256Mi },
        },
    }
  worker:
    {
      replicas: 1,
      port: 8083,
      readyPath: /health/ready,
      livePath: /health/live,
      command: ["/app/worker"],
      resources:
        {
          requests: { cpu: 200m, memory: 256Mi, ephemeral-storage: 64Mi },
          limits: { memory: 512Mi, ephemeral-storage: 256Mi },
        },
    }
  web:
    {
      replicas: 2,
      port: 8080,
      readyPath: /,
      livePath: /,
      command: ["/app/web"],
      resources:
        {
          requests: { cpu: 100m, memory: 128Mi, ephemeral-storage: 64Mi },
          limits: { memory: 256Mi, ephemeral-storage: 256Mi },
        },
    }

config:
  appEnv: production
  publicBaseURL: https://rum.example.com
  kafkaBrokers: kafka.example.svc:9092
  kafkaEventTopic: rum-events-v1
  # Must match the broker topic retention used to calculate remaining drain time.
  kafkaRetentionDuration: 168h
  storagePressure:
    # Disable only when a managed ClickHouse provider does not expose system.disks.
    guardEnabled: true
    warningFreeRatio: "0.15"
    criticalFreeRatio: "0.10"
    hardStopFreeRatio: "0.05"
    recoveryFreeRatio: "0.10"
    emergencySampleRate: "0.10"
    pollInterval: 30s
  # Comma-separated CIDRs or addresses of the proxies that terminate inbound
  # traffic. Leaving this empty keeps the ingest rate limit keyed on the socket
  # peer, which behind an ingress means every caller shares one limit. Declaring
  # the edge lets the limit apply per caller instead. Never widen it beyond the
  # proxies you run: whoever matches can choose the identity they are limited on.
  ingestTrustedProxies: ""
  # Country attribution. The header is only believed on requests arriving from
  # geoTrustedProxies, and setting the header without that list fails startup.
  geoCountryHeader: ""
  geoTrustedProxies: ""
  objectStorage:
    # Optional: "oss" for Alibaba OSS native API or "s3" for Amazon S3 and compatible providers.
    provider: ""
    endpoint: ""
    bucket: ""
    region: ""
    forcePathStyle: ""
    endpointAllowlist: ""
  managedSecrets:
    enabled: false
    masterKeyID: v1
  existingSecret: openrum-runtime
  secretKeys:
    postgresDSN: POSTGRES_DSN
    clickhouseDSN: CLICKHOUSE_DSN
    bootstrapToken: BOOTSTRAP_TOKEN
    ossAccessKeyID: OSS_ACCESS_KEY_ID
    ossAccessKeySecret: OSS_ACCESS_KEY_SECRET
    awsAccessKeyID: AWS_ACCESS_KEY_ID
    awsSecretAccessKey: AWS_SECRET_ACCESS_KEY
    awsSessionToken: AWS_SESSION_TOKEN
    managedSecretsMasterKey: OPENRUM_MASTER_KEY

# Redis holds rate-limit counters, login throttling, dashboard caches and short-lived
# connection state. None of it is a source of truth, but API and Ingest report not
# ready while Redis is unreachable.
redis:
  # "bundled" runs one Redis instance inside this release and points OpenRUM at it.
  # It is the quickest start, but a Redis restart briefly takes API and Ingest out of
  # service. "external" uses a Redis you run (for example a managed instance with
  # automatic failover behind one address) and is recommended for high availability.
  mode: bundled
  external:
    # host:port of your Redis. Required when mode is "external". OpenRUM connects
    # without a password or TLS today, so keep it on a private network.
    address: ""
  bundled:
    image:
      repository: redis
      tag: "7.2-alpine"
      pullPolicy: IfNotPresent
    # Cap Redis below the memory limit and evict least-recently-used keys when full,
    # matching the Compose topology.
    maxMemory: 192mb
    resources:
      requests: { cpu: 50m, memory: 64Mi }
      limits: { memory: 256Mi }
    # Redis data is disposable, so it lives in memory by default and a restart starts
    # empty. Enable a PersistentVolumeClaim to keep it across restarts.
    persistence:
      enabled: false
      size: 1Gi
      storageClassName: ""
    # Only pods of this release may connect. Takes effect when the cluster's network
    # plugin enforces NetworkPolicy.
    networkPolicy:
      enabled: true

ingress:
  enabled: true
  className: nginx
  annotations: {}
  host: rum.example.com
  tls: []

autoscaling:
  enabled: true
  targets:
    api: { minReplicas: 2, maxReplicas: 8, cpu: 70 }
    ingest: { minReplicas: 3, maxReplicas: 20, cpu: 65 }
    web: { minReplicas: 2, maxReplicas: 6, cpu: 70 }

pdb:
  enabled: true
  minAvailable: 1

serviceMonitor:
  enabled: false
  interval: 30s
  labels: {}

prometheusRules:
  enabled: false
  labels: {}

migration:
  enabled: true
  image:
    # Empty values inherit the application image repository and tag.
    repository: ""
    tag: ""
    pullPolicy: IfNotPresent
  command: ["/app/migrate", "up", "all"]
  backoffLimit: 2
  activeDeadlineSeconds: 600

smokeTest:
  image: busybox:1.37

termination:
  gracePeriodSeconds: 30
  # Keep the process alive briefly while kube-proxy removes the terminating endpoint.
  preStopCommand: ["/bin/sh", "-c", "sleep 5"]

podAnnotations: {}
nodeSelector: {}
tolerations: []
affinity: {}
```
